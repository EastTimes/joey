// Server-Sent Events: push a 'change' event to connected clients whenever
// Messages writes to chat.db (or its -wal/-shm siblings). Purely advisory —
// the frontend keeps its polling as a fallback, so a broken watcher only
// costs latency, never correctness.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHATDB_PATH =
  process.env.JOEY_CHATDB || path.join(os.homedir(), 'Library/Messages/chat.db');

const DEBOUNCE_MS = 400;
const HEARTBEAT_MS = 25_000;

const clients = new Set();

function broadcast(payload) {
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

// Express handler for GET /api/events.
export function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(': connected\n\n');
  clients.add(res);
  req.on('close', () => {
    clients.delete(res);
  });
}

// Keep intermediaries and clients from timing out idle streams.
const heartbeat = setInterval(() => {
  if (clients.size > 0) broadcast(': hb\n\n');
}, HEARTBEAT_MS);
heartbeat.unref();

let debounceTimer = null;

function scheduleChange() {
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    broadcast('event: change\ndata: {}\n\n');
  }, DEBOUNCE_MS);
}

// Watch the directory containing chat.db (SQLite writes land in chat.db-wal /
// chat.db-shm, so we filter on the 'chat.db' filename prefix). Best-effort:
// if fs.watch is unavailable or errors, log once and rely on polling.
export function startWatcher(dbPath = CHATDB_PATH) {
  try {
    const dir = path.dirname(dbPath);
    const base = path.basename(dbPath);
    const watcher = fs.watch(dir, (eventType, filename) => {
      try {
        if (filename && filename.startsWith(base)) scheduleChange();
      } catch {
        // never let a watcher callback take the server down
      }
    });
    watcher.on('error', (err) => {
      console.warn(`[joey] chat.db watcher stopped (${err?.message || err}) — falling back to polling`);
      try {
        watcher.close();
      } catch {}
    });
    return watcher;
  } catch (err) {
    console.warn(`[joey] could not watch chat.db directory (${err?.message || err}) — falling back to polling`);
    return null;
  }
}
