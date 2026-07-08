import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './routes/api.js';
import { loadContacts } from './imessage/contacts.js';
import { chatDbOk, messageCount } from './db/chatdb.js';
import { aiAvailable } from './ai/client.js';
import { startWatcher } from './lib/events.js';
import { getInvitedAttendeeEmails, calendarConfigured } from './calendar/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'web', 'dist');
const indexHtml = path.join(distDir, 'index.html');

const app = express();

// Local-only hardening. The server binds 127.0.0.1, but a browser on this
// machine can still be tricked into reaching it:
//  - DNS rebinding: a hostile page's domain re-resolves to 127.0.0.1, making
//    our API "same-origin" for that page. Rejecting non-local Host headers
//    (any port) closes this — the forged requests carry the hostile hostname.
//  - CSRF: cross-origin "simple" POSTs (no body) execute without a preflight.
//    Browsers attach an Origin header to all cross-origin POSTs, so rejecting
//    non-local Origins on state-changing methods closes this. Requests
//    without an Origin (curl, same-origin GETs) are untouched.
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isLocalHostHeader(host) {
  if (!host) return false;
  const h = host.trim().toLowerCase();
  const hostname = h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
  return LOCAL_HOSTNAMES.has(hostname);
}

function isLocalOrigin(origin) {
  try {
    return LOCAL_HOSTNAMES.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  if (!isLocalHostHeader(req.headers.host)) {
    return res.status(403).json({ error: 'forbidden: non-local Host header' });
  }
  const origin = req.headers.origin;
  const stateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (origin && stateChanging && !isLocalOrigin(origin)) {
    return res.status(403).json({ error: 'forbidden: cross-origin request' });
  }
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use('/api', apiRouter);

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
}

// Final catch-all (Express 5: no app.get('*')). SPA fallback for non-/api GETs.
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'not found' });
  }
  if (req.method === 'GET' && fs.existsSync(indexHtml)) {
    return res.sendFile(indexHtml);
  }
  res.status(404).json({
    error: 'not found',
    hint: 'API is under /api. Build the frontend (cd web && npx vite build) to serve the app here, or run the vite dev server.',
  });
});

// Safety net for errors thrown by middleware (e.g. malformed JSON bodies).
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message || 'internal error' });
});

const port = Number(process.env.JOEY_PORT || 3456);

async function main() {
  await loadContacts();

  let dbOk = false;
  let count = 0;
  try {
    dbOk = chatDbOk();
    count = dbOk ? messageCount() : 0;
  } catch {
    // chat.db unreachable; status stays false
  }

  startWatcher(); // best-effort chat.db change events for /api/events

  if (calendarConfigured()) {
    getInvitedAttendeeEmails().catch(() => {});
  }

  // Express 5 invokes this callback even when listen fails (error-first) —
  // only announce success when there is no error; the 'error' listener below
  // handles the failure output.
  const server = app.listen(port, '127.0.0.1', (err) => {
    if (err) return;
    console.log(
      `[joey] http://127.0.0.1:${port} chatDbOk=${dbOk} messages=${count} ` +
      `aiAvailable=${aiAvailable()} calendar=${calendarConfigured()} ` +
      `dryRun=${process.env.JOEY_DRY_RUN === '1'}`
    );
  });
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(
        `[joey] port ${port} is already in use — is Joey already running? (set JOEY_PORT to use another port)`
      );
      process.exit(1);
    }
    throw err; // other listen errors keep the default (crash) behavior
  });
}

main().catch((err) => {
  console.error('[joey] failed to start:', err?.message || err);
  process.exit(1);
});
