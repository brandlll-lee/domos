const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("computerEffect", {
  subscribe: (receive) => {
    ipcRenderer.on("computer-effect", (_event, value) => receive(value));
    ipcRenderer.send("computer-effect-ready");
  },
});
