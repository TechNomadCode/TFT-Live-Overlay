// Electron main process entry point: app lifecycle, the single-instance lock,
// and the one shutdown path everything funnels through. The window, the tray,
// the IPC handlers and the overlay server each live in their own module -- this
// file only decides when they come up and when they go down.

const path = require('path');
const { app, BrowserWindow, dialog } = require('electron');

const { APP_NAME, OVERLAY_PORT } = require('./constants');
const { createMainWindow } = require('./windows/main-window');
const { createTray } = require('./windows/tray');
const { registerIpcHandlers } = require('./ipc');
const { loadSettings } = require('./settings-store');
const { settingsToServerConfig } = require('./regions');
const { createOverlayServer } = require('../server');

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
  app.on('second-instance', showMainWindow);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function requestQuit() {
  isQuitting = true;
  app.quit();
}

async function startOverlayServer() {
  overlayServer = createOverlayServer({
    onStatusChange: (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('status-update', status);
      }
    },
    // A packaged app has no console anyone will ever see, which is why the first
    // report of the overlay not animating came with no evidence at all. The
    // server resolves nothing about this path itself -- src/server must stay
    // free of Electron.
    logDir: path.join(app.getPath('userData'), 'logs'),
  });

  try {
    await overlayServer.start(OVERLAY_PORT);
  } catch (err) {
    // Belt-and-suspenders: requestSingleInstanceLock() handles the
    // common case (app already running), but this covers any other
    // reason the port fails to bind (e.g. another process squatting
    // on it) so it's a visible dialog instead of a silent dead window.
    dialog.showErrorBox(
      `${APP_NAME} — failed to start`,
      `Could not start the overlay server on port ${OVERLAY_PORT}.\n\n${err.message}\n\n` +
      'Another program may be using this port. Close it and relaunch the app.'
    );
    requestQuit();
    return false;
  }

  overlayServer.updateConfig(settingsToServerConfig(loadSettings()));
  return true;
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    mainWindow = createMainWindow({ isQuitting: () => isQuitting });
    tray = createTray({ onOpenSettings: showMainWindow, onQuit: requestQuit });
    registerIpcHandlers({ getOverlayServer: () => overlayServer, requestQuit });
    await startOverlayServer();
  });
}

app.on('window-all-closed', () => {
  // On macOS apps conventionally stay running; on Windows/Linux we also
  // want to stay alive in the tray since the overlay server must keep
  // serving OBS/Streamlabs even with no window open.
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow({ isQuitting: () => isQuitting });
  } else {
    showMainWindow();
  }
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
