import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import {
  chatDbOk,
  chatDbError,
  messageCount,
  listChats,
  getChat,
  getMessages,
  searchMessages,
  chatsForHandles,
  getRecentSentTexts,
  isGroupStartedByMe,
} from '../db/chatdb.js';
import {
  archiveChat,
  unarchiveChat,
  getArchivedMap,
  getTriage,
  setTriage,
  createDraft,
  getDraft,
  addEditPair,
  getEditPairs,
  getFollowup,
  setFollowup,
  getDismissedMap,
  dismissFollowup,
  isFollowupDismissed,
} from '../db/appdb.js';
import { sendDirectMessage, sendMessage } from '../imessage/send.js';
import {
  contactsStatus,
  exportContactsCsv,
  resolveName,
  searchContacts,
} from '../imessage/contacts.js';
import {
  aiAvailable,
  classificationProvider,
  DRAFT_MODEL,
  FOLLOWUP_MODEL,
  GEMINI_FALLBACK_MODEL,
  GEMINI_MODEL,
  TRIAGE_MODEL,
} from '../ai/client.js';
import { generateDraft } from '../ai/draft.js';
import { classifyBatch } from '../ai/triage.js';
import { classifyFollowups } from '../ai/followups.js';
import { isFollowupCandidate } from '../lib/candidates.js';
import { recentMessages } from '../lib/followupContext.js';
import { candidateEmailsForChat, chatHasCalendarInvite } from '../lib/calendarMatch.js';
import { calendarInviteUrl } from '../lib/calendarActions.js';
import {
  getInvitedAttendeeEmails,
  calendarStatus,
  hasInvitedEmail,
  getCalendarAuthUrl,
  completeCalendarOAuth,
  disconnectCalendar,
  hasGoogleCredentials,
} from '../calendar/index.js';
import { sseHandler } from '../lib/events.js';

const router = Router();

const AI_UNAVAILABLE = 'AI unavailable — set ANTHROPIC_API_KEY';

const isDryRun = () => process.env.JOEY_DRY_RUN === '1';

// Route wrapper: any thrown/rejected error becomes a JSON 500.
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
};

function chatName(chat) {
  if (chat.displayName) return chat.displayName;
  const names = (chat.participants || [])
    .map((p) => resolveName(p) || p)
    .join(', ');
  return names || chat.chatIdentifier;
}

function participantDetails(chat) {
  return (chat.participants || []).map((id) => ({
    id,
    name: resolveName(id) || id,
  }));
}

// Effective-archive rule: archived entry exists AND no message newer than the
// rowid recorded at archive time (new arrivals auto-surface the chat).
function isEffectivelyArchived(chat, archivedMap) {
  const entry = archivedMap.get(chat.guid);
  if (!entry) return false;
  if (!chat.lastMessage) return true;
  return chat.lastMessage.rowid <= entry.lastMessageRowid;
}

// Short codes (bare 3–8 digit senders like "96916") are automated blasts —
// they never belong in the Time Sensitive queue and aren't worth classifying.
function isShortCodeChat(chat) {
  return !chat.isGroup && /^\d{3,8}$/.test(chat.chatIdentifier || '');
}

// Group chats and short codes are exempt from time-sensitive triage.
function isTriageExempt(chat) {
  return chat.isGroup || isShortCodeChat(chat);
}

// Group chats often list phone-only participants; emails appear in thread text.
const CALENDAR_MATCH_MSG_LIMIT = 30;

function calendarMatchMessages(chat) {
  return getMessages(chat.guid, { limit: CALENDAR_MATCH_MSG_LIMIT });
}

function calendarInviteCoversChat(chat, invitedEmails, messages = calendarMatchMessages(chat)) {
  if (!invitedEmails) return false;
  const candidates = candidateEmailsForChat(chat, messages);
  return candidates.some((e) => hasInvitedEmail(invitedEmails, e));
}

function activeFollowup(chat, dismissedMap, invitedEmails) {
  const last = chat.lastMessage;
  if (!last) return null;
  if (chat.isGroup && isGroupStartedByMe(chat.guid)) return null;
  const cached = getFollowup(chat.guid);
  if (!cached || cached.lastMessageRowid !== last.rowid) return null;
  if (!cached.needsFollowup || !cached.kind) return null;
  if (isFollowupDismissed(chat.guid, cached.kind, dismissedMap)) return null;

  const followup = {
    kind: cached.kind,
    reason: cached.reason,
    triggerDateMs: last.dateMs,
  };

  if (cached.kind === 'calendar_pending') {
    const messages = calendarMatchMessages(chat);
    if (calendarInviteCoversChat(chat, invitedEmails, messages)) return null;
    const emails = candidateEmailsForChat(chat, messages);
    followup.action = {
      type: 'calendar_invite',
      emails,
      calendarUrl: calendarInviteUrl(emails, `Meeting with ${chatName(chat)}`),
    };
  }

  return followup;
}

function toSummary(chat, archivedMap, dismissedMap, invitedEmails) {
  const last = chat.lastMessage;
  const triageable = last && !last.isFromMe && !isTriageExempt(chat);
  const archived = isEffectivelyArchived(chat, archivedMap);
  return {
    ...chat,
    name: chatName(chat),
    participantDetails: participantDetails(chat),
    archived,
    triage: triageable ? getTriage(last.guid) : null,
    followup: archived ? null : activeFollowup(chat, dismissedMap, invitedEmails),
  };
}

function validRecipient(target) {
  const value = String(target || '').trim();
  if (!value || value.length > 256) return false;
  if (value.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  return value.replace(/\D/g, '').length >= 7;
}

function findChat(guid) {
  try {
    return getChat(guid);
  } catch {
    return null;
  }
}

function withSenderName(m) {
  return {
    ...m,
    senderName: m.isFromMe
      ? null
      : m.senderId
        ? resolveName(m.senderId) || m.senderId
        : null,
  };
}

router.get('/status', wrap(async (req, res) => {
  const dbOk = chatDbOk();
  await getInvitedAttendeeEmails();
  res.json({
    ok: true,
    aiAvailable: aiAvailable(),
    dryRun: isDryRun(),
    chatDbOk: dbOk,
    chatDbError: dbOk ? null : chatDbError(),
    messageCount: dbOk ? messageCount() : 0,
    features: {
      messageSearch: true,
      contactSearch: true,
      directCompose: true,
    },
    contacts: contactsStatus(),
    draftModel: DRAFT_MODEL,
    triageProvider: classificationProvider('triage'),
    triageModel: classificationProvider('triage') === 'gemini' ? GEMINI_MODEL : TRIAGE_MODEL,
    triageFallbackModel: classificationProvider('triage') === 'gemini' ? GEMINI_FALLBACK_MODEL : null,
    followupProvider: classificationProvider('followup'),
    followupModel: classificationProvider('followup') === 'gemini' ? GEMINI_MODEL : FOLLOWUP_MODEL,
    followupFallbackModel: classificationProvider('followup') === 'gemini' ? GEMINI_FALLBACK_MODEL : null,
    calendar: calendarStatus(),
  });
}));

router.get('/contacts/export.csv', wrap(async (req, res) => {
  const { csv } = exportContactsCsv();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=\"joey-contacts.csv\"');
  res.send(csv);
}));

// Google Calendar OAuth — browser sign-in, no manual token.json editing.
router.get('/calendar/connect', wrap(async (req, res) => {
  try {
    res.redirect(getCalendarAuthUrl());
  } catch (err) {
    res.status(400).send(err?.message || String(err));
  }
}));

router.get('/calendar/callback', wrap(async (req, res) => {
  const errMsg = req.query.error_description || req.query.error;
  if (errMsg) {
    return res.redirect(`/?calendar=error&message=${encodeURIComponent(String(errMsg))}`);
  }
  const code = req.query.code;
  const state = req.query.state;
  if (!code) return res.status(400).send('missing code');
  try {
    const email = await completeCalendarOAuth(code, state);
    res.redirect(`/?calendar=connected&email=${encodeURIComponent(email)}`);
  } catch (err) {
    res.redirect(`/?calendar=error&message=${encodeURIComponent(err?.message || String(err))}`);
  }
}));

router.post('/calendar/disconnect', wrap(async (req, res) => {
  disconnectCalendar();
  res.json({ ok: true });
}));

router.post('/calendar/credentials', wrap(async (req, res) => {
  const { clientId, clientSecret } = req.body || {};
  if (typeof clientId !== 'string' || !clientId.trim()) {
    return res.status(400).json({ error: 'clientId required' });
  }
  if (typeof clientSecret !== 'string' || !clientSecret.trim()) {
    return res.status(400).json({ error: 'clientSecret required' });
  }
  const port = Number(process.env.JOEY_PORT || 3456);
  const dir = process.env.JOEY_DATA_DIR || path.join(os.homedir(), '.joey');
  fs.mkdirSync(dir, { recursive: true });
  const creds = {
    installed: {
      client_id: clientId.trim(),
      project_id: 'joey-local',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      client_secret: clientSecret.trim(),
      redirect_uris: [`http://127.0.0.1:${port}/api/calendar/callback`],
    },
  };
  fs.writeFileSync(path.join(dir, 'google-credentials.json'), JSON.stringify(creds, null, 2));
  res.json({ ok: true, redirectUri: creds.installed.redirect_uris[0] });
}));

router.get('/calendar/setup', wrap(async (req, res) => {
  const port = Number(process.env.JOEY_PORT || 3456);
  const fromEnv = !!(process.env.JOEY_GOOGLE_CLIENT_ID && process.env.JOEY_GOOGLE_CLIENT_SECRET);
  res.json({
    oauthReady: hasGoogleCredentials(),
    credentialsFromEnv: fromEnv,
    redirectUri: `http://127.0.0.1:${port}/api/calendar/callback`,
  });
}));

// SSE stream: `event: change` whenever chat.db changes on disk (see lib/events.js).
router.get('/events', sseHandler);

router.get('/chats', wrap(async (req, res) => {
  const filter = req.query.filter || 'inbox';
  const archivedMap = getArchivedMap();
  const dismissedMap = getDismissedMap();
  const invitedEmails = await getInvitedAttendeeEmails();
  let chats = listChats().map((c) => toSummary(c, archivedMap, dismissedMap, invitedEmails));
  if (filter === 'archived') chats = chats.filter((c) => c.archived);
  else if (filter !== 'all') chats = chats.filter((c) => !c.archived);
  res.json({ chats });
}));

router.get('/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const archivedMap = getArchivedMap();
  const dismissedMap = getDismissedMap();
  const invitedEmails = await getInvitedAttendeeEmails();
  const contactResults = searchContacts(q, { limit: 12 }).map((contact) => {
    const chats = chatsForHandles([...contact.phones, ...contact.emails], { limit: 1 });
    const chat = chats[0] ? toSummary(chats[0], archivedMap, dismissedMap, invitedEmails) : null;
    return {
      type: 'contact',
      contact,
      chat,
      message: null,
    };
  });
  const messageResults = searchMessages({ query: q, limit }).map(({ chat, message }) => ({
    type: 'message',
    chat: toSummary(chat, archivedMap, dismissedMap, invitedEmails),
    message: withSenderName(message),
  }));
  const results = [...contactResults, ...messageResults].slice(0, limit);
  res.json({ results });
}));

router.get('/recipient/resolve', wrap(async (req, res) => {
  const target = String(req.query.target || '').trim();
  if (!validRecipient(target)) return res.status(400).json({ error: 'target must be a phone number or email' });

  const archivedMap = getArchivedMap();
  const dismissedMap = getDismissedMap();
  const invitedEmails = await getInvitedAttendeeEmails();
  const chat = chatsForHandles([target], { limit: 12 }).find((c) => !c.isGroup);
  res.json({
    chat: chat ? toSummary(chat, archivedMap, dismissedMap, invitedEmails) : null,
    target,
    name: resolveName(target) || target,
  });
}));

router.post('/compose/send', wrap(async (req, res) => {
  const { target, text } = req.body || {};
  if (!validRecipient(target)) {
    return res.status(400).json({ error: 'target must be a phone number or email' });
  }
  if (typeof text !== 'string' || text.trim() === '' || text.length > 10000) {
    return res.status(400).json({ error: 'text must be a non-empty string of at most 10000 characters' });
  }
  const result = await sendDirectMessage({ target: String(target).trim(), text });
  res.json({ ok: result.ok, dryRun: result.dryRun });
}));

router.get('/chats/:guid/messages', wrap(async (req, res) => {
  const chat = findChat(req.params.guid);
  if (!chat) return res.status(404).json({ error: 'unknown chat' });
  const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 500);
  const rawBefore = Number(req.query.before);
  const before = Number.isSafeInteger(rawBefore) && rawBefore > 0 ? rawBefore : null;
  const messages = getMessages(chat.guid, { limit, beforeRowid: before })
    .map(withSenderName);
  res.json({ messages });
}));

router.post('/chats/:guid/send', wrap(async (req, res) => {
  const { text, draftId } = req.body || {};
  if (typeof text !== 'string' || text.trim() === '' || text.length > 10000) {
    return res.status(400).json({ error: 'text must be a non-empty string of at most 10000 characters' });
  }
  const chat = findChat(req.params.guid);
  if (!chat) return res.status(404).json({ error: 'unknown chat' });

  if (draftId != null) {
    const draft = getDraft(draftId);
    if (draft && text !== draft.text) {
      addEditPair({ chatGuid: chat.guid, draft: draft.text, final: text });
    }
  }

  const result = await sendMessage({
    chatGuid: chat.guid,
    chatIdentifier: chat.chatIdentifier,
    isGroup: chat.isGroup,
    service: chat.serviceName,
    text,
  });
  res.json({ ok: result.ok, dryRun: result.dryRun });
}));

router.post('/chats/:guid/archive', wrap(async (req, res) => {
  const chat = findChat(req.params.guid);
  if (!chat) return res.status(404).json({ error: 'unknown chat' });
  archiveChat(chat.guid, chat.lastMessage ? chat.lastMessage.rowid : 0);
  res.json({ ok: true });
}));

router.post('/chats/:guid/unarchive', wrap(async (req, res) => {
  unarchiveChat(req.params.guid);
  res.json({ ok: true });
}));

router.post('/chats/:guid/draft', wrap(async (req, res) => {
  if (!aiAvailable()) return res.status(503).json({ error: AI_UNAVAILABLE });
  const chat = findChat(req.params.guid);
  if (!chat) return res.status(404).json({ error: 'unknown chat' });

  const messages = getMessages(chat.guid, { limit: 25 }).map(withSenderName);
  const text = await generateDraft({
    chatName: chatName(chat),
    isGroup: chat.isGroup,
    messages,
    styleExamples: getRecentSentTexts(),
    editPairs: getEditPairs(),
  });
  const draftId = createDraft(chat.guid, text);
  res.json({ draftId, text });
}));

router.post('/followups/refresh', wrap(async (req, res) => {
  if (!aiAvailable()) return res.status(503).json({ error: AI_UNAVAILABLE });
  await getInvitedAttendeeEmails({ force: true });
  const archivedMap = getArchivedMap();
  const items = [];

  for (const chat of listChats()) {
    if (isEffectivelyArchived(chat, archivedMap)) continue;
    if (isShortCodeChat(chat)) continue;

    const groupStartedByMe = chat.isGroup && isGroupStartedByMe(chat.guid);
    if (groupStartedByMe) {
      const last = chat.lastMessage;
      if (last) {
        setFollowup(chat.guid, {
          lastMessageRowid: last.rowid,
          needsFollowup: false,
          kind: null,
          reason: '',
        });
      }
      continue;
    }

    const messages = getMessages(chat.guid, { limit: 60 }).map(withSenderName);
    const window = recentMessages(messages);
    if (!isFollowupCandidate(chat, window, { groupStartedByMe })) continue;

    const last = chat.lastMessage;
    if (!last) continue;

    const cached = getFollowup(chat.guid);
    if (cached && cached.lastMessageRowid === last.rowid) continue;

    items.push({
      chatGuid: chat.guid,
      chat,
      window,
      chatName: chatName(chat),
      isGroup: chat.isGroup,
      groupStartedByMe,
      lastDateMs: last.dateMs,
      lastMessageRowid: last.rowid,
      transcript: window
        .map((m) => {
          const who = m.isFromMe ? 'Me' : m.senderName || m.senderId || 'Them';
          return `${who}: ${m.text || (m.hasAttachments ? '[attachment]' : '')}`;
        })
        .join('\n'),
    });
  }

  let updated = 0;
  if (items.length > 0) {
    const results = await classifyFollowups(items);
    for (const item of items) {
      let result = results.get(item.chatGuid) || {
        needsFollowup: false,
        kind: null,
        reason: '',
        lastMessageRowid: item.lastMessageRowid,
      };
      if (result.kind === 'calendar_pending' && (await chatHasCalendarInvite(item.chat, item.window))) {
        result = {
          needsFollowup: false,
          kind: null,
          reason: '',
          lastMessageRowid: item.lastMessageRowid,
        };
      }
      setFollowup(item.chatGuid, result);
      updated++;
    }
  }
  res.json({ updated, scanned: items.length });
}));

router.post('/chats/:guid/dismiss-followup', wrap(async (req, res) => {
  const { kind, snoozeHours } = req.body || {};
  const valid = ['gc_intro', 'awaiting_reply', 'calendar_pending'];
  if (!valid.includes(kind)) {
    return res.status(400).json({ error: 'kind must be gc_intro, awaiting_reply, or calendar_pending' });
  }
  const chat = findChat(req.params.guid);
  if (!chat) return res.status(404).json({ error: 'unknown chat' });
  dismissFollowup(chat.guid, kind, {
    snoozeHours: snoozeHours != null ? Number(snoozeHours) : undefined,
  });
  res.json({ ok: true });
}));

router.post('/triage/refresh', wrap(async (req, res) => {
  if (!aiAvailable()) return res.status(503).json({ error: AI_UNAVAILABLE });
  const archivedMap = getArchivedMap();
  const items = [];
  for (const chat of listChats()) {
    if (isEffectivelyArchived(chat, archivedMap)) continue;
    if (isTriageExempt(chat)) continue;
    const last = chat.lastMessage;
    if (!last || last.isFromMe) continue;
    if (getTriage(last.guid)) continue;
    const contextText = getMessages(chat.guid, { limit: 8 })
      .filter((m) => m.guid !== last.guid)
      .slice(-3)
      .map((m) => `${m.isFromMe ? 'Me' : 'Them'}: ${m.text}`)
      .join('\n');
    items.push({
      guid: last.guid,
      chatName: chatName(chat),
      text: last.text,
      dateMs: last.dateMs,
      contextText,
    });
  }

  let updated = 0;
  if (items.length > 0) {
    const results = await classifyBatch(items);
    for (const [guid, triage] of results) {
      setTriage(guid, triage);
      updated++;
    }
  }
  res.json({ updated });
}));

export default router;
