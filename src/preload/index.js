// The entire IPC surface available to the renderer, exposed as `window.tftApp`.
// contextIsolation is on and nodeIntegration is off, so this is the only bridge
// between the settings window and the main process -- every entry here mirrors
// an ipcMain.handle in src/main/ipc.js one-for-one.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tftApp', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getOverlayUrl: () => ipcRenderer.invoke('get-overlay-url'),
  copyOverlayUrl: () => ipcRenderer.invoke('copy-overlay-url'),
  openOverlayInBrowser: () => ipcRenderer.invoke('open-overlay-in-browser'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  setMockMode: (enabled) => ipcRenderer.invoke('set-mock-mode', enabled),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  getRegionMap: () => ipcRenderer.invoke('get-region-map'),
  revealLog: () => ipcRenderer.invoke('reveal-log'),
  copyDiagnostics: () => ipcRenderer.invoke('copy-diagnostics'),
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (event, status) => callback(status));
  },
});
