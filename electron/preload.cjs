const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spotifyAPI', {
  login: (config) => ipcRenderer.invoke('spotify:login', config),
  getLyrics: (track) => ipcRenderer.invoke('lyrics:get', track),
});
