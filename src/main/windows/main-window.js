// The settings/dashboard window. One window, created once, hidden rather than
// destroyed -- see the close handler.

const { BrowserWindow, shell } = require('electron');
const { APP_NAME, RENDERER_HTML, PRELOAD_SCRIPT, assetPath } = require('../constants');

/**
 * @param {object} deps
 * @param {function} deps.isQuitting - true only during a real shutdown
 * @returns {BrowserWindow}
 */
function createMainWindow({ isQuitting }) {
  const win = new BrowserWindow({
    width: 480,
    height: 640,
    minWidth: 420,
    minHeight: 560,
    title: APP_NAME,
    icon: assetPath('icon-256.png'),
    backgroundColor: '#121721',
    // Performance: no unnecessary GPU/CPU overhead for a simple form-based
    // settings UI -- no animations, no dev tools, no background throttling
    // fights needed since this window isn't doing continuous rendering work.
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
    },
    show: false,
  });

  win.loadFile(RENDERER_HTML);

  win.once('ready-to-show', () => win.show());

  // Close button minimizes to tray instead of quitting -- the overlay
  // server needs to keep running for OBS/Streamlabs even if you close
  // the settings window.
  win.on('close', (e) => {
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
