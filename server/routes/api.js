import { Router } from 'express';
import {
  chatDbOk,
  messageCount,
  listChats,
  getChat,
  getMessages,
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
import { sendMessage } from '../imessage/send.js';
import { resolveName } from '../imessage/contacts.js';
import { aiAvailable, DRAFT_MODEL } from '../ai/client.js';
import { generateDraft } from '../ai/draft.js';
import { classifyBatch } from '../ai/triage.js';
import { classifyFollowups } from '../ai/followups.js';
import { isFollowupCandidate } from '../lib/candidates.js';
import { recentMessages } from '../lib/followupContext.js';
import { candidateEmailsForChat, chatHasCalendarInvite } from '../lib/calendarMatch.js';
import { getInvitedAttendeeEmails, calendarStatus, hasInvitedEmail } from '../calendar/google.js';
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

function calendarInviteCoversChat(chat, invitedEmails) {
  if (!invitedEmails) return false;
  return candidateEmailsForChat(chat).some((e) => hasInvitedEmail(invitedEmails, e));
}

function activeFollowup(chat, dismissedMap, invitedEmails) {
  const last = chat.lastMessage;
  if (!last) return null;
  if (chat.isGroup && isGroupStartedByMe(chat.guid)) return null;
  const cached = getFollowup(chat.guid);
  if (!cached || cached.lastMessageRowid !== last.rowid) return null;
  if (!cached.needsFollowup || !cached.kind) return null;
  if (isFollowupDismissed(chat.guid, cached.kind, dismissedMap)) return null;
  if (cached.kind === 'calendar_pending' && calendarInviteCoversChat(chat, invitedEmails)) {
    return null;
  }
  return {
    kind: cached.kind,
    reason: cached.reason,
    triggerDateMs: last.dateMs,
  };
}

function toSummary(chat, archivedMap, dismissedMap, invitedEmails) {
  const last = chat.lastMessage;
  const triageable = last && !last.isFromMe && !isTriageExempt(chat);
  const archived = isEffectivelyArchived(chat, archivedMap);
  return {
    ...chat,
    name: chatName(chat),
    archived,
    triage: triageable ? getTriage(last.guid) : null,
    followup: archived ? null : activeFollowup(chat, dismissedMap, invitedEmails),
  };
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
    messageCount: dbOk ? messageCount() : 0,
    draftModel: DRAFT_MODEL,
    calendar: calendarStatus(),
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
