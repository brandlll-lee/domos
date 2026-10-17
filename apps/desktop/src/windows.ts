import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { themes, windowOverlay } from "@domos/ui/tokens";
import { BrowserWindow, nativeTheme, shell } from "electron";
import { applicationIcon } from "./icons.ts";

export async function openInstance(
  url: string,
  desktopSession?: { token: string; expires: number },
) {
  const origin = new URL(url).origin;
  const partition = `persist:domos-${createHash("sha256").update(origin).digest("hex").slice(0, 24)}`;
  const window = createWindow("./preload.cjs", partition);
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
  if (desktopSession)
    await window.webContents.session.cookies.set({
      url: origin,
      name: "domos_session",
      value: desktopSession.token,
      httpOnly: true,
      secure: origin.startsWith("https:"),
      sameSite: "strict",
      path: "/",
      expirationDate: desktopSession.expires / 1000,
    });
  void window.loadURL(url);
  return window;
}

export function createWindow(preload: string, partition?: string) {
  const window = new BrowserWindow({
    title: "Domos",
    icon: applicationIcon,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    autoHideMenuBar: true,
    backgroundColor:
      themes[nativeTheme.shouldUseDarkColors ? "dark" : "light"].background,
    ...(process.platform !== "darwin"
      ? {
          titleBarOverlay: {
            ...windowOverlay,
            symbolColor:
              themes[nativeTheme.shouldUseDarkColors ? "dark" : "light"].text,
          },
        }
      : {}),
    width: 1200,
    height: 820,
    minWidth: 360,
    minHeight: 540,
    webPreferences: {
      partition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: fileURLToPath(new URL(preload, import.meta.url)),
    },
  });
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  return window;
}
