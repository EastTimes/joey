// Read-only access to the macOS Messages database (~/Library/Messages/chat.db).
import Database from 'better-sqlite3';
import os from 'node:os';
import path from 'node:path';
import { decodeAttributedBody } from '../lib/typedstream.js';

const APPLE_EPOCH_MS = 978307200000; // 2001-01-01 in unix ms

const CHATDB_PATH =
  process.env.JOEY_CHATDB || path.join(os.homedir(), 'Library/Messages/chat.db');

let db = null;
let stmts = null;

function open() {
  if (db) return db;
  db = new Database(CHATDB_PATH, { readonly: true, fileMustExist: true });
  stmts = prepareStatements(db);
  return db;
}

const MSG_COLS = `
  m.ROWID AS rowid, m.guid, m.text, m.attributedBody, m.date,
  m.is_from_me, m.service, m.cache_has_attachments, h.id AS handleId
`;

const MSG_FILTER = `m.associated_message_type < 2000 AND m.item_type = 0`;

function prepareStatements(d) {
  return {
    messageCount: d.prepare(`SELECT COUNT(*) AS n FROM message`),

    // Top chats by last activity, driven by chat_message_join.message_date.
    topChats: d.prepare(`
      SELECT c.ROWID AS chatRowid, c.guid, c.chat_identifier AS chatIdentifier,
             c.service_name AS serviceName, c.display_name AS displayName,
             c.style, MAX(cmj.message_date) AS lastDate
      FROM chat_message_join cmj
      JOIN chat c ON c.ROWID = cmj.chat_id
      GROUP BY cmj.chat_id
      ORDER BY lastDate DESC
      LIMIT ?
    `),

    participants: d.prepare(`
      SELECT h.id FROM chat_handle_join chj
      JOIN handle h ON h.ROWID = chj.handle_id
      WHERE chj.chat_id = ?
    `),

    unreadByChat: d.prepare(`
      SELECT cmj.chat_id AS chatId, COUNT(*) AS n
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      WHERE m.is_read = 0 AND m.is_from_me = 0 AND ${MSG_FILTER}
      GROUP BY cmj.chat_id
    `),

    lastMessages: d.prepare(`
      SELECT ${MSG_COLS}
      FROM chat_message_join cmj
      JOIN message m ON m.ROWID = cmj.message_id
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE cmj.chat_id = ? AND (@before IS NULL OR cmj.message_id < @before) AND ${MSG_FILTER}
      ORDER BY cmj.message_id DESC
      LIMIT @limit
    `),

    chatRowidByGuid: d.prepare(`SELECT ROWID AS rowid FROM chat WHERE guid = ?`),

    chatByGuid: d.prepare(`
      SELECT ROWID AS chatRowid, guid, chat_identifier AS chatIdentifier,
             service_name AS serviceName, display_name AS displayName, style
      FROM chat WHERE guid = ?
    `),

    unreadForChat: d.prepare(`
      SELECT COUNT(*) AS n
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      WHERE cmj.chat_id = ? AND m.is_read = 0 AND m.is_from_me = 0 AND ${MSG_FILTER}
    `),

    messagesPage: d.prepare(`
      SELECT ${MSG_COLS}
      FROM chat_message_join cmj
      JOIN message m ON m.ROWID = cmj.message_id
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE cmj.chat_id = ? AND (@before IS NULL OR cmj.message_id < @before) AND ${MSG_FILTER}
      ORDER BY cmj.message_id DESC
      LIMIT @limit
    `),

    lastIncoming: d.prepare(`
      SELECT ${MSG_COLS}
      FROM chat_message_join cmj
      JOIN message m ON m.ROWID = cmj.message_id
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE cmj.chat_id = ? AND m.is_from_me = 0 AND ${MSG_FILTER}
      ORDER BY cmj.message_id DESC
      LIMIT ?
    `),

    // +m.is_from_me defeats the (is_read,is_from_me,item_type) index, which would
    // otherwise temp-sort every sent message; a backward rowid scan is ~100x faster.
    recentSent: d.prepare(`
      SELECT m.text, m.attributedBody
      FROM message m
      WHERE +m.is_from_me = 1 AND ${MSG_FILTER}
      ORDER BY m.ROWID DESC
      LIMIT ?
    `),
  };
}

function appleDateToMs(v) {
  if (!v) return 0;
  // Legacy rows store seconds since 2001; modern rows store nanoseconds.
  if (v < 1e12) return v * 1000 + APPLE_EPOCH_MS;
  return Math.round(v / 1e6) + APPLE_EPOCH_MS;
}

function rowToMsg(r) {
  const isFromMe = !!r.is_from_me;
  const text = r.text ?? decodeAttributedBody(r.attributedBody) ?? '';
  return {
    rowid: r.rowid,
    guid: r.guid,
    text,
    dateMs: appleDateToMs(r.date),
    isFromMe,
    senderId: isFromMe ? null : r.handleId ?? null,
    service: r.service || 'iMessage',
    hasAttachments: !!r.cache_has_attachments,
  };
}

// Keep messages with real text, or attachments even if textless.
function msgVisible(msg) {
  return msg.text.length > 0 || msg.hasAttachments;
}

export function chatDbOk() {
  try {
    open();
    stmts.messageCount.get();
    return true;
  } catch {
    return false;
  }
}

export function messageCount() {
  open();
  return stmts.messageCount.get().n;
}

// Newest message that survives the visibility filter; pages backwards past
// runs of tapbacks/renames (bounded so a pathological chat can't stall the list).
function lastVisibleMessage(chatRowid) {
  let before = null;
  for (let page = 0; page < 10; page++) {
    const batch = stmts.lastMessages.all(chatRowid, { before, limit: 10 });
    if (batch.length === 0) return null;
    for (const mr of batch) {
      const msg = rowToMsg(mr);
      if (msgVisible(msg)) return msg;
    }
    before = batch[batch.length - 1].rowid;
  }
  return null;
}

export function listChats({ limit = 300 } = {}) {
  open();
  const rows = stmts.topChats.all(limit);

  const unread = new Map();
  for (const u of stmts.unreadByChat.all()) unread.set(u.chatId, u.n);

  const chats = rows.map((c) => {
    const lastMessage = lastVisibleMessage(c.chatRowid);
    return {
      guid: c.guid,
      chatIdentifier: c.chatIdentifier || '',
      serviceName: c.serviceName || '',
      displayName: c.displayName || '',
      isGroup: c.style === 43,
      participants: stmts.participants.all(c.chatRowid).map((p) => p.id),
      lastMessage,
      unreadCount: unread.get(c.chatRowid) || 0,
      _activity: lastMessage ? lastMessage.dateMs : 0,
    };
  });

  // Raw activity order can be skewed by filtered rows (tapbacks, renames);
  // re-sort by the visible last message so the list reads by recency.
  // Chats with no visible messages at all sink to the bottom.
  chats.sort((a, b) => b._activity - a._activity);
  for (const c of chats) delete c._activity;
  return chats;
}

function chatRowid(chatGuid) {
  const row = stmts.chatRowidByGuid.get(chatGuid);
  return row ? row.rowid : null;
}

// Direct single-chat lookup (same shape as listChats entries, without the scan).
export function getChat(chatGuid) {
  open();
  const c = stmts.chatByGuid.get(chatGuid);
  if (!c) return null;
  return {
    guid: c.guid,
    chatIdentifier: c.chatIdentifier || '',
    serviceName: c.serviceName || '',
    displayName: c.displayName || '',
    isGroup: c.style === 43,
    participants: stmts.participants.all(c.chatRowid).map((p) => p.id),
    lastMessage: lastVisibleMessage(c.chatRowid),
    unreadCount: stmts.unreadForChat.get(c.chatRowid).n,
  };
}

export function getMessages(chatGuid, { limit = 60, beforeRowid = null } = {}) {
  open();
  const cid = chatRowid(chatGuid);
  if (cid == null) return [];

  const out = [];
  let before = beforeRowid;
  // Over-fetch to absorb rows dropped by the empty-text filter.
  while (out.length < limit) {
    const batch = stmts.messagesPage.all(cid, { before, limit: limit - out.length + 20 });
    if (batch.length === 0) break;
    for (const r of batch) {
      const msg = rowToMsg(r);
      if (msgVisible(msg)) out.push(msg);
      if (out.length >= limit) break;
    }
    before = batch[batch.length - 1].rowid;
  }
  return out.reverse();
}

export function getLastIncomingMessage(chatGuid) {
  open();
  const cid = chatRowid(chatGuid);
  if (cid == null) return null;
  for (const r of stmts.lastIncoming.all(cid, 25)) {
    const msg = rowToMsg(r);
    if (msgVisible(msg)) return msg;
  }
  return null;
}

export function getRecentSentTexts({ limit = 30 } = {}) {
  open();
  const seen = new Set();
  const out = [];
  for (const r of stmts.recentSent.all(limit * 12)) {
    const text = (r.text ?? decodeAttributedBody(r.attributedBody) ?? '').trim();
    if (text.length < 3 || text.length > 300) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}
