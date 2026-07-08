// Joey app state: archives, triage cache, drafts, edit-pair learning.
// Lives in ${JOEY_DATA_DIR:-~/.joey}/joey.db (separate from the read-only chat.db).

import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let db = null;
let stmts = null;

function dataDir() {
  return process.env.JOEY_DATA_DIR || path.join(os.homedir(), '.joey');
}

// followups was briefly keyed by message_guid; current schema is per-chat.
function migrateFollowups(d) {
  const tables = d
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'followups'`)
    .all();
  if (tables.length === 0) return;

  const cols = d.prepare(`PRAGMA table_info(followups)`).all();
  if (cols.some((c) => c.name === 'chat_guid')) return;

  d.exec(`DROP TABLE followups`);
}

export function openAppDb() {
  if (db && stmts) return db;

  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });

  if (!db) {
    db = new Database(path.join(dir, 'joey.db'));
    db.pragma('journal_mode = WAL');
  }

  migrateFollowups(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS archived_chats (
      guid                TEXT PRIMARY KEY,
      last_message_rowid  INTEGER NOT NULL,
      archived_at         TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS triage (
      message_guid    TEXT PRIMARY KEY,
      time_sensitive  INTEGER NOT NULL,
      reason          TEXT NOT NULL,
      deadline        TEXT,
      classified_at   TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drafts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_guid   TEXT NOT NULL,
      text        TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS edit_pairs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_guid   TEXT NOT NULL,
      draft       TEXT NOT NULL,
      final       TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS followups (
      chat_guid           TEXT PRIMARY KEY,
      last_message_rowid  INTEGER NOT NULL,
      needs_followup      INTEGER NOT NULL,
      kind                TEXT,
      reason              TEXT NOT NULL,
      classified_at       TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS followup_dismissals (
      chat_guid     TEXT PRIMARY KEY,
      kind          TEXT NOT NULL,
      dismissed_at  TEXT NOT NULL,
      snooze_until  TEXT
    );
  `);

  stmts = {
    archive: db.prepare(
      `INSERT INTO archived_chats (guid, last_message_rowid, archived_at)
       VALUES (?, ?, ?)
       ON CONFLICT(guid) DO UPDATE SET
         last_message_rowid = excluded.last_message_rowid,
         archived_at = excluded.archived_at`
    ),
    unarchive: db.prepare(`DELETE FROM archived_chats WHERE guid = ?`),
    archivedAll: db.prepare(
      `SELECT guid, last_message_rowid, archived_at FROM archived_chats`
    ),
    getTriage: db.prepare(
      `SELECT time_sensitive, reason, deadline FROM triage WHERE message_guid = ?`
    ),
    setTriage: db.prepare(
      `INSERT INTO triage (message_guid, time_sensitive, reason, deadline, classified_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(message_guid) DO UPDATE SET
         time_sensitive = excluded.time_sensitive,
         reason = excluded.reason,
         deadline = excluded.deadline,
         classified_at = excluded.classified_at`
    ),
    createDraft: db.prepare(
      `INSERT INTO drafts (chat_guid, text, created_at) VALUES (?, ?, ?)`
    ),
    getDraft: db.prepare(
      `SELECT id, chat_guid, text, created_at FROM drafts WHERE id = ?`
    ),
    addEditPair: db.prepare(
      `INSERT INTO edit_pairs (chat_guid, draft, final, created_at) VALUES (?, ?, ?, ?)`
    ),
    getEditPairs: db.prepare(
      `SELECT draft, final FROM edit_pairs ORDER BY id DESC LIMIT ?`
    ),
    getFollowup: db.prepare(
      `SELECT last_message_rowid, needs_followup, kind, reason FROM followups WHERE chat_guid = ?`
    ),
    setFollowup: db.prepare(
      `INSERT INTO followups (chat_guid, last_message_rowid, needs_followup, kind, reason, classified_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_guid) DO UPDATE SET
         last_message_rowid = excluded.last_message_rowid,
         needs_followup = excluded.needs_followup,
         kind = excluded.kind,
         reason = excluded.reason,
         classified_at = excluded.classified_at`
    ),
    dismissFollowup: db.prepare(
      `INSERT INTO followup_dismissals (chat_guid, kind, dismissed_at, snooze_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_guid) DO UPDATE SET
         kind = excluded.kind,
         dismissed_at = excluded.dismissed_at,
         snooze_until = excluded.snooze_until`
    ),
    undismissFollowup: db.prepare(`DELETE FROM followup_dismissals WHERE chat_guid = ?`),
    dismissedAll: db.prepare(
      `SELECT chat_guid, kind, dismissed_at, snooze_until FROM followup_dismissals`
    ),
  };

  return db;
}

function ensure() {
  openAppDb();
  if (!stmts) throw new Error('appdb failed to initialize prepared statements');
  return stmts;
}

export function archiveChat(chatGuid, lastMessageRowid) {
  ensure().archive.run(chatGuid, lastMessageRowid, new Date().toISOString());
}

export function unarchiveChat(chatGuid) {
  ensure().unarchive.run(chatGuid);
}

export function getArchivedMap() {
  const map = new Map();
  for (const row of ensure().archivedAll.all()) {
    map.set(row.guid, {
      archivedAt: row.archived_at,
      lastMessageRowid: row.last_message_rowid,
    });
  }
  return map;
}

export function getTriage(messageGuid) {
  const row = ensure().getTriage.get(messageGuid);
  if (!row) return null;
  return {
    timeSensitive: !!row.time_sensitive,
    reason: row.reason,
    deadline: row.deadline,
  };
}

export function setTriage(messageGuid, triage) {
  ensure().setTriage.run(
    messageGuid,
    triage.timeSensitive ? 1 : 0,
    triage.reason,
    triage.deadline ?? null,
    new Date().toISOString()
  );
}

export function createDraft(chatGuid, text) {
  const info = ensure().createDraft.run(chatGuid, text, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

export function getDraft(draftId) {
  const row = ensure().getDraft.get(draftId);
  if (!row) return null;
  return { id: row.id, chatGuid: row.chat_guid, text: row.text, createdAt: row.created_at };
}

export function addEditPair({ chatGuid, draft, final }) {
  ensure().addEditPair.run(chatGuid, draft, final, new Date().toISOString());
}

export function getEditPairs(limit = 12) {
  return ensure().getEditPairs.all(limit);
}

export function getFollowup(chatGuid) {
  const row = ensure().getFollowup.get(chatGuid);
  if (!row) return null;
  return {
    lastMessageRowid: row.last_message_rowid,
    needsFollowup: !!row.needs_followup,
    kind: row.kind,
    reason: row.reason,
  };
}

export function setFollowup(chatGuid, { lastMessageRowid, needsFollowup, kind, reason }) {
  ensure().setFollowup.run(
    chatGuid,
    lastMessageRowid,
    needsFollowup ? 1 : 0,
    kind ?? null,
    reason || '',
    new Date().toISOString()
  );
}

export function getDismissedMap() {
  const map = new Map();
  for (const row of ensure().dismissedAll.all()) {
    map.set(row.chat_guid, {
      kind: row.kind,
      dismissedAt: row.dismissed_at,
      snoozeUntil: row.snooze_until,
    });
  }
  return map;
}

export function dismissFollowup(chatGuid, kind, { snoozeHours } = {}) {
  let snoozeUntil = null;
  if (snoozeHours != null && Number.isFinite(snoozeHours) && snoozeHours > 0) {
    snoozeUntil = new Date(Date.now() + snoozeHours * 3_600_000).toISOString();
  }
  ensure().dismissFollowup.run(chatGuid, kind, new Date().toISOString(), snoozeUntil);
}

export function undismissFollowup(chatGuid) {
  ensure().undismissFollowup.run(chatGuid);
}

export function isFollowupDismissed(chatGuid, kind, dismissedMap) {
  const entry = dismissedMap.get(chatGuid);
  if (!entry) return false;
  if (entry.snoozeUntil && new Date(entry.snoozeUntil) <= new Date()) return false;
  return entry.kind === kind;
}
