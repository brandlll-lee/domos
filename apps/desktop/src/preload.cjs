const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("domosDesktop", {
  platform: process.platform,
  appearance: (theme) => ipcRenderer.invoke("desktop:appearance", theme),
  menu: (scope) => ipcRenderer.invoke("desktop:menu", scope),
  prepare: () => ipcRenderer.invoke("desktop:prepare"),
  state: () => ipcRenderer.invoke("desktop:state"),
  unread: (count) => ipcRenderer.invoke("desktop:unread", count),
  notify: (input) => ipcRenderer.invoke("desktop:notify", input),
  connection: (input) => ipcRenderer.invoke("desktop:connection", input),
  connected: () =>
    new Promise((resolve) => {
      ipcRenderer.once("desktop:activated", () => resolve());
      ipcRenderer.send("desktop:connected");
    }),
  pairing: () => ipcRenderer.send("desktop:pairing"),
  cancelConnection: () => ipcRenderer.send("desktop:cancel"),
  maintain: (action, password) =>
    ipcRenderer.invoke("desktop:maintain", { action, password }),
  file: (input) => ipcRenderer.invoke("desktop:file", input),
  fileCache: (action) => ipcRenderer.invoke("desktop:file-cache", action),
});
ipcRenderer.on("desktop:chat-target", (_event, target) => {
  window.dispatchEvent(
    new CustomEvent("domos:chat-target", { detail: target }),
  );
});
ipcRenderer.on("desktop:service", (_event, state) => {
  window.dispatchEvent(new CustomEvent("domos:service", { detail: state }));
});
ipcRenderer.on("desktop:leave", () => {
  window.dispatchEvent(new Event("domos:workspace-save"));
  window.dispatchEvent(new Event("domos:workspace-leave"));
  setTimeout(() => ipcRenderer.send("desktop:left"), 0);
});
