// The entire main-process side of the IPC surface. Every handler here has a
// one-for-one counterpart in src/preload/index.js -- adding a renderer
// capability means adding it in both places, and nowhere else.

const { ipcMain, shell, clipboard } = require('electron');

const { overlayUrl } = require('./constants');
const { REGION_MAP, settingsToServerConfig } = require('./regions');
const { loadSettings, saveSettings } = require('./settings-store');

/**
 * @param {object} deps
 * @param {function} deps.getOverlayServer - the running server instance
 * @param {function} deps.requestQuit
 */
function registerIpcHandlers({ getOverlayServer, requestQuit }) {
  ipcMain.handle('get-settings', () => loadSettings());

  ipcMain.handle('save-settings', (event, settings) => {
    saveSettings(settings);
    getOverlayServer().updateConfig(settingsToServerConfig(settings));
    return { ok: true };
  });

  ipcMain.handle('get-overlay-url', () => overlayUrl());

  ipcMain.handle('copy-overlay-url', () => {
    clipboard.writeText(overlayUrl());
    return { ok: true };
  });

  ipcMain.handle('open-overlay-in-browser', () => shell.openExternal(overlayUrl()));

  ipcMain.handle('get-status', () => getOverlayServer().getStatus());

  ipcMain.handle('set-mock-mode', (event, enabled) => {
    getOverlayServer().setMockMode(enabled);
    return { ok: true };
  });

  ipcMain.handle('get-region-map', () => REGION_MAP);

  ipcMain.handle('quit-app', () => requestQuit());
}

module.exports = { registerIpcHandlers };
