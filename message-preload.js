const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('messageEditor', {
  load: () => ipcRenderer.invoke('message-load'),
  save: message => ipcRenderer.invoke('message-save', message),
  close: () => ipcRenderer.send('message-close'),
});
