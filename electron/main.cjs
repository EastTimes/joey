const { app, BrowserWindow, dialog, shell } = require('electron');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let mainWindow;
let joeyServer;
let appUrl;

function normalizeLocalUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

async function hasJoeyServer(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 900);
  try {
    const response = await fetch(`${url}/api/status`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function findExternalServer() {
  const candidates = [
    normalizeLocalUrl(process.env.JOEY_EXTERNAL_URL),
    'http://127.0.0.1:3456',
  ].filter(Boolean);
  const uniqueCandidates = [...new Set(candidates)];

  for (const candidate of uniqueCandidates) {
    if (await hasJoeyServer(candidate)) {
      return candidate;
    }
  }

  return null;
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
  if (process.env.JOEY_PORT) {
    return Number(process.env.JOEY_PORT);
  }

  for (let port = 3456; port < 3556; port += 1) {
    if (await canUsePort(port)) return port;
  }

  throw new Error('No local port available for Joey between 3456 and 3555.');
}

async function startJoeyServer() {
  const port = await pickPort();
  process.env.JOEY_PORT = String(port);
  const serverModuleUrl = pathToFileURL(path.join(__dirname, '..', 'server', 'index.js')).href;
  const { startServer } = await import(serverModuleUrl);
  joeyServer = await startServer({ port, exitOnError: false });
  return joeyServer.url;
}

function createMainWindow(url) {
  const allowedOrigin = new URL(url).origin;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    title: 'Joey',
    backgroundColor: '#f8f7f2',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    let targetOrigin;
    try {
      targetOrigin = new URL(targetUrl).origin;
    } catch {
      targetOrigin = null;
    }
    if (targetOrigin !== allowedOrigin) {
      event.preventDefault();
      if (targetOrigin) shell.openExternal(targetUrl);
    }
  });

  mainWindow.loadURL(url);
}

async function boot() {
  try {
    appUrl = (await findExternalServer()) || (await startJoeyServer());
    createMainWindow(appUrl);
  } catch (err) {
    dialog.showErrorBox('Joey could not start', err?.message || String(err));
    app.quit();
  }
}

app.setName('Joey');

app.whenReady().then(boot);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && appUrl) {
    createMainWindow(appUrl);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (joeyServer?.watcher) {
    joeyServer.watcher.close();
  }
  if (joeyServer?.server) {
    joeyServer.server.close();
  }
});
