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

  // Merge rather than replace. The renderer builds this object from the form
  // fields it owns, so a bare write would drop every key it doesn't know about
  // -- window geometry today, anything added later.
  ipcMain.handle('save-settings', (event, settings) => {
    const merged = { ...loadSettings(), ...settings };
    saveSettings(merged);
    getOverlayServer().updateConfig(settingsToServerConfig(merged));
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

  // Troubleshooting a machine we don't have. showItemInFolder rather than
  // openPath: it reveals the file with it already selected, so "send me that
  // file" is one drag, and it doesn't depend on a .log handler being registered.
  ipcMain.handle('reveal-log', () => {
    const logPath = getOverlayServer().diagnosticsPath;
    if (!logPath) return { ok: false };
    shell.showItemInFolder(logPath);
    return { ok: true };
  });

  ipcMain.handle('copy-diagnostics', () => {
    const text = getOverlayServer().readDiagnostics();
    if (!text) return { ok: false };
    clipboard.writeText(text);
    return { ok: true };
  });

  ipcMain.handle('quit-app', () => requestQuit());
}

module.exports = { registerIpcHandlers };
