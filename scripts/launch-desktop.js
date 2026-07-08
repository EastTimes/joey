import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const DEFAULT_PORT = 3456;
const MAX_PORT = 3555;
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const JOEY_DIR = path.join(os.homedir(), '.joey');
const SERVER_LOG = path.join(JOEY_DIR, 'server.log');
const SERVER_STATE = path.join(JOEY_DIR, 'server.json');
const INSTALLED_APP = '/Applications/Joey.app';
const BUILT_APP = path.join(PROJECT_ROOT, 'dist', 'mac-arm64', 'Joey.app');
const LOCAL_ELECTRON = path.join(
  PROJECT_ROOT,
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
  'Contents',
  'MacOS',
  'Electron'
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serverUrl(port) {
  return `http://127.0.0.1:${port}`;
}

async function readStatus(url, timeoutMs = 900) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}/api/status`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function canUseForDesktop(status) {
  return !!(
    status?.chatDbOk &&
    status?.features?.messageSearch &&
    status?.features?.contactSearch &&
    status?.features?.directCompose &&
    status?.features?.contactEditing
  );
}

function canUsePort(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, '127.0.0.1');
  });
}

async function pickPort() {
  for (let port = DEFAULT_PORT; port <= MAX_PORT; port += 1) {
    if (await canUsePort(port)) return port;
  }
  throw new Error(`No local port available between ${DEFAULT_PORT} and ${MAX_PORT}.`);
}

async function waitForServer(url) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const status = await readStatus(url, 1200);
    if (canUseForDesktop(status)) return status;
    await sleep(300);
  }
  return null;
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readServerState() {
  try {
    return JSON.parse(fs.readFileSync(SERVER_STATE, 'utf8'));
  } catch {
    return null;
  }
}

async function reusableServerUrl() {
  const state = readServerState();
  if (!state || state.projectRoot !== PROJECT_ROOT || !isProcessAlive(state.pid)) {
    return null;
  }

  const url = serverUrl(state.port);
  const status = await readStatus(url);
  return canUseForDesktop(status) ? url : null;
}

function appExecutable(appPath) {
  return path.join(appPath, 'Contents', 'MacOS', 'Joey');
}

function findLaunchTarget() {
  if (fs.existsSync(LOCAL_ELECTRON)) {
    return {
      executable: LOCAL_ELECTRON,
      args: [PROJECT_ROOT],
      label: 'local Electron',
    };
  }
  if (fs.existsSync(appExecutable(INSTALLED_APP))) {
    return {
      executable: appExecutable(INSTALLED_APP),
      args: [],
      label: INSTALLED_APP,
    };
  }
  if (fs.existsSync(appExecutable(BUILT_APP))) {
    return {
      executable: appExecutable(BUILT_APP),
      args: [],
      label: BUILT_APP,
    };
  }
  throw new Error('Electron is not installed yet. Run npm install, then npm run desktop.');
}

async function ensureServer() {
  fs.mkdirSync(JOEY_DIR, { recursive: true });

  const defaultUrl = serverUrl(DEFAULT_PORT);
  const existing = await readStatus(defaultUrl);
  if (canUseForDesktop(existing)) {
    return defaultUrl;
  }

  const reusableUrl = await reusableServerUrl();
  if (reusableUrl) return reusableUrl;

  const port = await pickPort();
  const url = serverUrl(port);

  const logFd = fs.openSync(SERVER_LOG, 'a');
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: PROJECT_ROOT,
    detached: true,
    env: {
      ...process.env,
      JOEY_PORT: String(port),
    },
    stdio: ['ignore', logFd, logFd],
  });
  server.unref();

  const status = await waitForServer(url);
  if (!status) {
    throw new Error(
      `Joey server did not start. Make sure Terminal has Full Disk Access, then try again. Log: ${SERVER_LOG}.`
    );
  }

  fs.writeFileSync(
    SERVER_STATE,
    JSON.stringify(
      {
        pid: server.pid,
        port,
        projectRoot: PROJECT_ROOT,
        startedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  return url;
}

async function main() {
  const url = await ensureServer();
  const target = findLaunchTarget();
  const app = spawn(target.executable, target.args, {
    cwd: PROJECT_ROOT,
    detached: true,
    env: {
      ...process.env,
      JOEY_EXTERNAL_URL: url,
    },
    stdio: 'ignore',
  });
  app.unref();
  console.log(`[joey] opened ${target.label}`);
  console.log(`[joey] using ${url}`);
}

main().catch((err) => {
  console.error(`[joey] ${err?.message || err}`);
  process.exit(1);
});
