const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apiOpenDesktop', {
  platform: process.platform,
  versions: process.versions,
  isDesktop: true,
  executeRequest: (payload) =>
    ipcRenderer.invoke('api-open:execute-request', payload),
});
