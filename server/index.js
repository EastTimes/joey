import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './routes/api.js';
import { loadContacts } from './imessage/contacts.js';
import { chatDbOk, messageCount } from './db/chatdb.js';
import { aiAvailable } from './ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'web', 'dist');
const indexHtml = path.join(distDir, 'index.html');

const app = express();
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

  app.listen(port, '127.0.0.1', () => {
    console.log(
      `[joey] http://127.0.0.1:${port} chatDbOk=${dbOk} messages=${count} ` +
      `aiAvailable=${aiAvailable()} dryRun=${process.env.JOEY_DRY_RUN === '1'}`
    );
  });
}

main().catch((err) => {
  console.error('[joey] failed to start:', err?.message || err);
  process.exit(1);
});
