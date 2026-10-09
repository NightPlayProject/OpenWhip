const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  whipCrack: () => ipcRenderer.send('whip-crack'),
  hideOverlay: () => ipcRenderer.send('hide-overlay'),
  onSpawnWhip: (fn) => ipcRenderer.on('spawn-whip', (_event, point) => fn(point)),
  onDropWhip: (fn) => ipcRenderer.on('drop-whip', () => fn()),
  onCursorState: (fn) => ipcRenderer.on('cursor-state', (_event, point) => fn(point)),
  onStopWhip: (fn) => ipcRenderer.on('stop-whip', () => fn()),
});
