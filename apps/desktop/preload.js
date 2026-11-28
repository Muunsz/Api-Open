const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apiOpenDesktop', {
  platform: process.platform,
  versions: process.versions,
  isDesktop: true,
  runtime: 'electron',
  executeRequest: (payload) =>
    ipcRenderer.invoke('api-open:execute-request', payload),
  saveFile: (options) => ipcRenderer.invoke('api-open:save-file', options),
  openFile: (options) => ipcRenderer.invoke('api-open:open-file', options),
  checkForUpdates: () => ipcRenderer.invoke('api-open:check-updates'),
  downloadUpdate: (payload) =>
    ipcRenderer.invoke('api-open:download-update', payload),
  onUpdateAvailable: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('api-open:update-available', handler);
    return () => ipcRenderer.removeListener('api-open:update-available', handler);
  },
});
