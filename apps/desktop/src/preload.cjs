const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("domosDesktop", {
  platform: process.platform,
  appearance: (theme) => ipcRenderer.invoke("desktop:appearance", theme),
  menu: (scope) => ipcRenderer.invoke("desktop:menu", scope),
  prepare: () => ipcRenderer.invoke("desktop:prepare"),
  state: () => ipcRenderer.invoke("desktop:state"),
  maintain: (action, password) =>
    ipcRenderer.invoke("desktop:maintain", { action, password }),
});
