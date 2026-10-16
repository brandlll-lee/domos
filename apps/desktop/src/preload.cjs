const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("domos", {
  state: () => ipcRenderer.invoke("setup:state"),
  host: () => ipcRenderer.invoke("setup:host"),
  connect: (url, name) => ipcRenderer.invoke("setup:connect", { url, name }),
  cancel: () => ipcRenderer.invoke("setup:cancel"),
  maintain: (action, password) =>
    ipcRenderer.invoke("setup:maintain", { action, password }),
  progress: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on("setup:progress", handler);
    return () => ipcRenderer.removeListener("setup:progress", handler);
  },
});
