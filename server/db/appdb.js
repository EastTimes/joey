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

export function openAppDb() {
  if (db) return db;

  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });

  db = new Database(path.join(dir, 'joey.db'));
  db.pragma('journal_mode = WAL');

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
  };

  return db;
}

function ensure() {
  if (!db) openAppDb();
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
