// The settings/dashboard window. One window, created once, hidden rather than
// destroyed -- see the close handler.

const { app, BrowserWindow, screen, shell } = require('electron');
const { APP_NAME, RENDERER_HTML, PRELOAD_SCRIPT, assetPath } = require('../constants');
const { loadWindowBounds, saveWindowBounds } = require('../settings-store');

const DEFAULT_WIDTH = 1040;
const DEFAULT_HEIGHT = 720;
const MIN_WIDTH = 880;
const MIN_HEIGHT = 620;

// Debounced so a drag across the desktop writes settings.json once, not once
// per frame of the drag.
const SAVE_DEBOUNCE_MS = 400;

/**
 * Restored bounds are only trusted if they still land on a display that exists.
 * Unplugging the monitor the app was last closed on would otherwise reopen it
 * at coordinates nothing can show, i.e. an app that launches into nowhere.
 */
function restoredBounds() {
  const saved = loadWindowBounds();
  if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') return null;

  const width = Math.max(MIN_WIDTH, Math.round(saved.width));
  const height = Math.max(MIN_HEIGHT, Math.round(saved.height));
  if (typeof saved.x !== 'number' || typeof saved.y !== 'number') {
    return { width, height, maximized: !!saved.maximized };
  }

  const area = screen.getDisplayMatching({ x: saved.x, y: saved.y, width, height }).workArea;
  const onScreen =
    saved.x + width > area.x &&
    saved.y + height > area.y &&
    saved.x < area.x + area.width &&
    saved.y < area.y + area.height;

  return onScreen
    ? { width, height, x: Math.round(saved.x), y: Math.round(saved.y), maximized: !!saved.maximized }
    : { width, height, maximized: !!saved.maximized };
}

/**
 * @param {object} deps
 * @param {function} deps.isQuitting - true only during a real shutdown
 * @returns {BrowserWindow}
 */
function createMainWindow({ isQuitting }) {
  const saved = restoredBounds();

  const win = new BrowserWindow({
    width: saved?.width ?? DEFAULT_WIDTH,
    height: saved?.height ?? DEFAULT_HEIGHT,
    x: saved?.x,
    y: saved?.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: APP_NAME,
    icon: assetPath('icon-256.png'),
    // Same value as the renderer's --bg and the overlay's page background, so
    // the pre-paint flash matches what loads into it.
    backgroundColor: '#0f1218',
    // The Overlay page embeds the real overlay in an iframe, so this window
    // does render continuously while it's visible. backgroundThrottling is what
    // keeps that free the rest of the time -- Chromium throttles the whole
    // window's timers and animations once it's hidden or occluded, which is
    // most of a stream.
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
    },
    show: false,
  });

  if (saved?.maximized) win.maximize();

  win.loadFile(RENDERER_HTML);

  win.once('ready-to-show', () => win.show());

  // Menu.setApplicationMenu(null) in main/index.js takes the default
  // accelerators down with the menu bar. Devtools is worth keeping while
  // developing; a packaged build gets nothing.
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = (input.key || '').toLowerCase();
      if (key === 'f12' || (input.control && input.shift && key === 'i')) {
        win.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  let saveTimer = null;
  function persistBounds() {
    // Maximized/minimized bounds are the chrome's, not the user's chosen size --
    // keep the last restored size so unmaximizing on the next launch returns to
    // something sensible.
    if (win.isDestroyed() || win.isMinimized()) return;
    const maximized = win.isMaximized();
    const { width, height, x, y } = maximized ? (loadWindowBounds() || win.getBounds()) : win.getBounds();
    saveWindowBounds({ width, height, x, y, maximized });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistBounds, SAVE_DEBOUNCE_MS);
  }

  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('maximize', scheduleSave);
  win.on('unmaximize', scheduleSave);

  // Close button minimizes to tray instead of quitting -- the overlay
  // server needs to keep running for OBS/Streamlabs even if you close
  // the settings window.
  win.on('close', (e) => {
    clearTimeout(saveTimer);
    persistBounds();
    if (!isQuitting()) {
      e.preventDefault();
      win.hide();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

module.exports = { createMainWindow };
