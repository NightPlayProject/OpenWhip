const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  whipCrack: () => ipcRenderer.send('whip-crack'),
  hideOverlay: () => ipcRenderer.send('hide-overlay'),
  onSpawnWhip: (fn) => ipcRenderer.on('spawn-whip', (_event, point) => fn(point)),
  onDropWhip: (fn) => ipcRenderer.on('drop-whip', () => fn()),
  onCursorState: (fn) => ipcRenderer.on('cursor-state', (_event, point) => fn(point)),
  onRebaseWhip: (fn) => ipcRenderer.on('rebase-whip', (_event, offset) => fn(offset)),
  onStopWhip: (fn) => ipcRenderer.on('stop-whip', () => fn()),
  onSoundConfig: (fn) => ipcRenderer.on('sound-config', (_event, config) => fn(config)),
  onSoundPreview: (fn) => ipcRenderer.on('sound-preview', () => fn()),
  soundPlayed: mode => ipcRenderer.send('sound-played', mode),
});
