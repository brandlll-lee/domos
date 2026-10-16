import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { BrowserWindow, shell } from "electron";

export function openInstance(url: string) {
  const origin = new URL(url).origin;
  const partition = `persist:domos-${createHash("sha256").update(origin).digest("hex").slice(0, 24)}`;
  const window = new BrowserWindow({
    title: "Domos",
    width: 1200,
    height: 820,
    minWidth: 360,
    minHeight: 540,
    webPreferences: {
      partition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const guard = (event: Electron.Event, target: string) => {
    try {
      if (new URL(target).origin === origin) return;
    } catch {}
    event.preventDefault();
  };
  window.webContents.on("will-navigate", guard);
  window.webContents.on("will-redirect", guard);
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === "https:" && !target.username && !target.password)
        void shell.openExternal(target.href);
    } catch {}
    return { action: "deny" };
  });
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  void window.loadURL(url);
  return window;
}

export function setupWindow() {
  const window = new BrowserWindow({
    title: "连接 Domos",
    width: 560,
    height: 740,
    minWidth: 360,
    minHeight: 600,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  void window.loadURL("domos-setup://app/setup.html");
  return window;
}
