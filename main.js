const { app, BrowserWindow, Tray, Menu, ipcMain, shell, clipboard, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { createOverlayServer } = require('./overlay-server');

// Fixed port so an existing Streamlabs/OBS Browser Source pointed at
// http://localhost:3000/overlay.html keeps working without reconfiguring.
const OVERLAY_PORT = 3000;
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

let mainWindow = null;
let tray = null;
let overlayServer = null;
let isQuitting = false;
let isShuttingDown = false;

// A second launch while the app is already running (very easy to trigger,
// since closing the window minimizes to tray instead of quitting) would
// otherwise try to bind the same fixed port a second time, fail with
// EADDRINUSE, and leave a second, totally non-functional window open with
// no indication anything went wrong. Claim the lock up front and just
// hand focus to the existing window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

const REGION_MAP = {
  // platform -> [regionRoute, display label]
  euw1: ['europe', 'EUW'], eun1: ['europe', 'EUNE'], tr1: ['europe', 'TR'], ru: ['europe', 'RU'],
  na1: ['americas', 'NA'], br1: ['americas', 'BR'], la1: ['americas', 'LAN'], la2: ['americas', 'LAS'], oc1: ['americas', 'OCE'],
  kr: ['asia', 'KR'], jp1: ['asia', 'JP'],
};

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      gameName: '', tagLine: '', riotApiKey: '',
      platformRoute: 'euw1', pollIntervalMs: 5000,
    };
  }
}

function saveSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
}

function settingsToServerConfig(settings) {
  const [regionRoute, regionLabel] = REGION_MAP[settings.platformRoute] || ['europe', ''];
  return {
    riotApiKey: settings.riotApiKey || '',
    gameName: settings.gameName || '',
    tagLine: settings.tagLine || '',
    platformRoute: settings.platformRoute || 'euw1',
    regionRoute,
    regionLabel,
    pollIntervalMs: settings.pollIntervalMs || 5000,
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    minWidth: 420,
    minHeight: 560,
    title: 'TFT Live Overlay',
    icon: path.join(__dirname, 'assets', 'icon-256.png'),
    backgroundColor: '#121721',
    // Performance: no unnecessary GPU/CPU overhead for a simple form-based
    // settings UI -- no animations, no dev tools, no background throttling
    // fights needed since this window isn't doing continuous rendering work.
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Close button minimizes to tray instead of quitting -- the overlay
  // server needs to keep running for OBS/Streamlabs even if you close
  // the settings window.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon-32.png'));
  tray = new Tray(icon);
  tray.setToolTip('TFT Live Overlay');

  const menu = Menu.buildFromTemplate([
    { label: 'Open Settings', click: () => { mainWindow.show(); } },
    {
      label: 'Copy Overlay URL', click: () => {
        clipboard.writeText(`http://localhost:${OVERLAY_PORT}/overlay.html`);
      }
    },
    { label: 'Open Overlay in Browser', click: () => shell.openExternal(`http://localhost:${OVERLAY_PORT}/overlay.html`) },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => { mainWindow.show(); });
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    createWindow();
    createTray();

    overlayServer = createOverlayServer({
      onStatusChange: (status) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('status-update', status);
        }
      },
    });

    try {
      await overlayServer.start(OVERLAY_PORT);
    } catch (err) {
      // Belt-and-suspenders: requestSingleInstanceLock() handles the
      // common case (app already running), but this covers any other
      // reason the port fails to bind (e.g. another process squatting
      // on it) so it's a visible dialog instead of a silent dead window.
      dialog.showErrorBox(
        'TFT Live Overlay — failed to start',
        `Could not start the overlay server on port ${OVERLAY_PORT}.\n\n${err.message}\n\n` +
        'Another program may be using this port. Close it and relaunch the app.'
      );
      isQuitting = true;
      app.quit();
      return;
    }

    const settings = loadSettings();
    overlayServer.updateConfig(settingsToServerConfig(settings));
  });
}

app.on('window-all-closed', () => {
  // On macOS apps conventionally stay running; on Windows/Linux we also
  // want to stay alive in the tray since the overlay server must keep
  // serving OBS/Streamlabs even with no window open.
});

// Single shutdown path for every way this app can exit: tray Quit, the
// window's X (via quit-app), Ctrl+C in a terminal, or a SIGTERM at logout.
async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  isQuitting = true;

  // Explicitly remove the tray icon. Nothing else did this, and a bare
  // process.exit() leaves the OS tray host still painting the icon of a
  // process that's already gone -- that's the duplicate/ghost tray icon
  // you get after Ctrl+C'ing `npm start` and relaunching, which only
  // disappears once you click it and the tray notices the owner is dead.
  try {
    if (tray && !tray.isDestroyed()) tray.destroy();
  } catch { /* tray may already be gone */ }
  tray = null;

  // Never let a wedged socket hang the exit -- OBS/Streamlabs may still
  // be holding a keep-alive connection open when we're asked to quit.
  const watchdog = setTimeout(() => process.exit(0), 3000);
  if (watchdog.unref) watchdog.unref();

  try {
    if (overlayServer) await overlayServer.stop();
  } catch { /* shutting down anyway */ }

  process.exit(0);
}

app.on('before-quit', (e) => {
  if (!isShuttingDown) {
    e.preventDefault();
    gracefulShutdown();
  }
});

// Ctrl+C / kill from the terminal (`npm start`) doesn't reliably route
// through app.quit() on every platform, so send both signals down the
// same path rather than letting the process die with the tray still
// registered.
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else mainWindow.show();
});

// ---- IPC handlers ----
ipcMain.handle('get-settings', () => loadSettings());

ipcMain.handle('save-settings', (event, settings) => {
  saveSettings(settings);
  overlayServer.updateConfig(settingsToServerConfig(settings));
  return { ok: true };
});

ipcMain.handle('get-overlay-url', () => `http://localhost:${OVERLAY_PORT}/overlay.html`);

ipcMain.handle('copy-overlay-url', () => {
  clipboard.writeText(`http://localhost:${OVERLAY_PORT}/overlay.html`);
  return { ok: true };
});

ipcMain.handle('get-status', () => overlayServer.getStatus());

ipcMain.handle('set-mock-mode', (event, enabled) => {
  overlayServer.setMockMode(enabled);
  return { ok: true };
});

ipcMain.handle('open-overlay-in-browser', () => {
  shell.openExternal(`http://localhost:${OVERLAY_PORT}/overlay.html`);
});

ipcMain.handle('quit-app', () => {
  isQuitting = true;
  app.quit();
});

ipcMain.handle('get-region-map', () => REGION_MAP);