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
});
