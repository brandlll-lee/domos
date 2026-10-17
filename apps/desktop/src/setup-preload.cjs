const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("domosSetup", {
  state: () => ipcRenderer.invoke("setup:state"),
  submit: (value) => ipcRenderer.invoke("setup:submit", value),
  cancel: () => ipcRenderer.invoke("setup:cancel"),
  docker: () => ipcRenderer.invoke("setup:docker"),
  progress: (listener) =>
    ipcRenderer.on("setup:progress", (_event, value) => listener(value)),
});
