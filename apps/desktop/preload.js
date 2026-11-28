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
  getAppVersion: () => ipcRenderer.invoke('api-open:get-version'),
  openExternal: (url) => ipcRenderer.invoke('api-open:open-external', url),
  checkForUpdates: () => ipcRenderer.invoke('api-open:check-updates'),
  downloadUpdate: (payload) =>
    ipcRenderer.invoke('api-open:download-update', payload),
  onUpdateAvailable: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('api-open:update-available', handler);
    return () => ipcRenderer.removeListener('api-open:update-available', handler);
  },
  onUpdateProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('api-open:update-progress', handler);
    return () => ipcRenderer.removeListener('api-open:update-progress', handler);
  },
  onDeepLink: (callback) => {
    const handler = (_event, url) => callback(url);
    ipcRenderer.on('api-open:deep-link', handler);
    return () => ipcRenderer.removeListener('api-open:deep-link', handler);
  },
});
