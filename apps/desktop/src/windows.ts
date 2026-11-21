import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { themes, windowOverlay } from "@domos/ui/tokens";
import {
  app,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  shell,
  WebContentsView,
} from "electron";
import {
  applicationIcon,
  applicationIconPath,
  applicationId,
} from "./icons.ts";

const sources = new Map<number, string>();
export function workspaceSource(
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
) {
  try {
    return (
      event.senderFrame === event.sender.mainFrame &&
      sources.get(event.sender.id) === new URL(event.senderFrame.url).origin
    );
  } catch {
    return false;
  }
}

export async function prepareInstance(
  window: BrowserWindow,
  url: string,
  desktopSession:
    | ((currentToken?: string) => Promise<{ token: string; expires: number }>)
    | undefined,
  signal: AbortSignal,
  pairing: () => void,
) {
  const origin = new URL(url).origin;
  const partition = `persist:domos-${createHash("sha256").update(origin).digest("hex").slice(0, 24)}`;
  const view = new WebContentsView({
    webPreferences: {
      partition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
    },
  });
  const contents = view.webContents;
  sources.set(contents.id, origin);
  const authorized = Promise.withResolvers<void>();
  let shown = false;
  const resize = () => {
    const { width, height } = window.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  resize();
  const show = () => {
    if (shown) return;
    shown = true;
    resize();
    window.contentView.addChildView(view);
    window.show();
    window.focus();
  };
  const check = (event: Electron.IpcMainEvent) =>
    event.sender === contents && workspaceSource(event);
  const ready = (event: Electron.IpcMainEvent) => {
    if (!check(event)) return;
    void contents.session
      .fetch(new URL("/hosting/session", origin).href, {
        credentials: "include",
        signal,
        redirect: "error",
      })
      .then(async (response) => {
        if (!response.ok) throw new Error("目标电脑尚未授权。");
        await response.body?.cancel();
        authorized.resolve();
      })
      .catch(authorized.reject);
  };
  const pair = (event: Electron.IpcMainEvent) => {
    if (!check(event)) return;
    show();
    pairing();
  };
  const cancel = (event: Electron.IpcMainEvent) => {
    if (check(event)) authorized.reject(new Error("连接已取消。"));
  };
  const abort = () => authorized.reject(signal.reason);
  ipcMain.on("desktop:connected", ready);
  ipcMain.on("desktop:pairing", pair);
  ipcMain.on("desktop:cancel", cancel);
  signal.addEventListener("abort", abort, { once: true });
  window.on("resize", resize);
  const closed = () => authorized.reject(new Error("窗口已关闭。"));
  window.once("closed", closed);
  const guard = (event: Electron.Event, target: string) => {
    try {
      if (new URL(target).origin === origin) return;
    } catch {}
    event.preventDefault();
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === "https:" && !target.username && !target.password)
        void shell.openExternal(target.href);
    } catch {}
    return { action: "deny" };
  });
  const fullscreenAllowed = (
    contents: Electron.WebContents | null,
    permission: string,
    requestingUrl: string | undefined,
    mainFrame: boolean,
  ) => {
    if (
      contents !== view.webContents ||
      permission !== "fullscreen" ||
      !mainFrame ||
      !requestingUrl
    )
      return false;
    try {
      return new URL(requestingUrl).origin === origin;
    } catch {
      return false;
    }
  };
  contents.session.setPermissionRequestHandler(
    (contents, permission, callback, details) =>
      callback(
        fullscreenAllowed(
          contents,
          permission,
          details.requestingUrl,
          details.isMainFrame,
        ),
      ),
  );
  contents.session.setPermissionCheckHandler(
    (contents, permission, _requestingOrigin, details) =>
      fullscreenAllowed(
        contents,
        permission,
        details.requestingUrl,
        details.isMainFrame,
      ),
  );
  const dispose = () => {
    sources.delete(contents.id);
    window.removeListener("resize", resize);
    if (!window.isDestroyed() && shown)
      window.contentView.removeChildView(view);
    if (!contents.isDestroyed()) contents.close();
  };
  try {
    await Promise.all([
      (async () => {
        if (desktopSession) {
          const cookies = await contents.session.cookies.get({
            url: origin,
            name: "domos_session",
          });
          const session = await desktopSession(cookies[0]?.value);
          signal.throwIfAborted();
          await contents.session.cookies.set({
            url: origin,
            name: "domos_session",
            value: session.token,
            httpOnly: true,
            secure: origin.startsWith("https:"),
            sameSite: "strict",
            path: "/",
            expirationDate: session.expires / 1000,
          });
        }
        signal.throwIfAborted();
        await contents.loadURL(url);
      })(),
      authorized.promise,
    ]);
    signal.throwIfAborted();
    return { view, origin, show, dispose };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    ipcMain.removeListener("desktop:connected", ready);
    ipcMain.removeListener("desktop:pairing", pair);
    ipcMain.removeListener("desktop:cancel", cancel);
    signal.removeEventListener("abort", abort);
    window.removeListener("closed", closed);
  }
}

export function createWindow(preload: string, partition?: string, show = true) {
  const window = new BrowserWindow({
    title: "Domos",
    show: false,
    icon: applicationIcon,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    autoHideMenuBar: true,
    backgroundColor:
      themes[nativeTheme.shouldUseDarkColors ? "dark" : "light"].frame,
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
  if (process.platform === "win32")
    window.setAppDetails({
      appId: applicationId,
      appIconPath: applicationIconPath,
      relaunchCommand: app.isPackaged
        ? `"${process.execPath}"`
        : `"${process.execPath}" "${app.getAppPath()}"`,
      relaunchDisplayName: "Domos",
    });
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  if (show) window.show();
  return window;
}
