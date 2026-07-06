import { Router } from 'express';
import {
  chatDbOk,
  messageCount,
  listChats,
  getChat,
  getMessages,
  getRecentSentTexts,
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
} from '../db/appdb.js';
import { sendMessage } from '../imessage/send.js';
import { resolveName } from '../imessage/contacts.js';
import { aiAvailable, DRAFT_MODEL } from '../ai/client.js';
import { generateDraft } from '../ai/draft.js';
import { classifyBatch } from '../ai/triage.js';

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

function toSummary(chat, archivedMap) {
  const last = chat.lastMessage;
  return {
    ...chat,
    name: chatName(chat),
    archived: isEffectivelyArchived(chat, archivedMap),
    triage: last && !last.isFromMe ? getTriage(last.guid) : null,
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
  res.json({
    ok: true,
    aiAvailable: aiAvailable(),
    dryRun: isDryRun(),
    chatDbOk: dbOk,
    messageCount: dbOk ? messageCount() : 0,
    draftModel: DRAFT_MODEL,
  });
}));

router.get('/chats', wrap(async (req, res) => {
  const filter = req.query.filter || 'inbox';
  const archivedMap = getArchivedMap();
  let chats = listChats().map((c) => toSummary(c, archivedMap));
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

router.post('/triage/refresh', wrap(async (req, res) => {
  if (!aiAvailable()) return res.status(503).json({ error: AI_UNAVAILABLE });
  const archivedMap = getArchivedMap();
  const items = [];
  for (const chat of listChats()) {
    if (isEffectivelyArchived(chat, archivedMap)) continue;
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
