import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("spotifyAPI", {
  login: (config) => ipcRenderer.invoke("spotify:login", config),
});
