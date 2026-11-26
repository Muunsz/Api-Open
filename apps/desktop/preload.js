const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('apiOpenDesktop', {
  platform: process.platform,
  versions: process.versions,
});
