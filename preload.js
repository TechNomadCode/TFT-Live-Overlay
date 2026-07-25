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
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (event, status) => callback(status));
  },
});
