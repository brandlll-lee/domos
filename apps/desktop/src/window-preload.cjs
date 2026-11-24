const { ipcRenderer } = require("electron");

module.exports = {
  platform: process.platform,
  command: (action) => ipcRenderer.invoke("desktop:window", action),
  subscribe: (listener) => {
    const receive = (_event, state) => listener(state);
    ipcRenderer.on("desktop:window-state", receive);
    return () => ipcRenderer.removeListener("desktop:window-state", receive);
  },
};
