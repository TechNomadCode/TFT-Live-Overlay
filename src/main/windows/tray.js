// Tray icon and menu. The app lives here whenever the settings window is
// closed, which is the normal state while streaming.

const { Tray, Menu, nativeImage, shell, clipboard } = require('electron');
const { APP_NAME, assetPath, overlayUrl } = require('../constants');

/**
 * @param {object} deps
 * @param {function} deps.onOpenSettings
 * @param {function} deps.onQuit
 * @returns {Tray}
 */
function createTray({ onOpenSettings, onQuit }) {
  const tray = new Tray(nativeImage.createFromPath(assetPath('icon-32.png')));
  tray.setToolTip(APP_NAME);

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Settings', click: onOpenSettings },
    { label: 'Copy Overlay URL', click: () => clipboard.writeText(overlayUrl()) },
    { label: 'Open Overlay in Browser', click: () => shell.openExternal(overlayUrl()) },
    { type: 'separator' },
    { label: 'Quit', click: onQuit },
  ]));

  tray.on('click', onOpenSettings);

  return tray;
}

module.exports = { createTray };
