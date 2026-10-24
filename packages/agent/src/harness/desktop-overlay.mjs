import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mountComputerEffect } from "@domos/ui/computer-effect";
import { app, BrowserWindow, screen } from "electron";

export async function openDesktopOverlay(channel) {
  const windows = new Map();
  const loaded = new WeakSet();
  let state;
  let suspended = false;
  let heartbeat;
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  if (process.platform === "linux")
    app.commandLine.appendSwitch("ozone-platform", "x11");
  await app.whenReady();
  app.dock?.hide();
  const physical = (rect) => {
    if (process.platform === "win32") return screen.dipToScreenRect(null, rect);
    if (process.platform !== "linux") return rect;
    const origin = screen.dipToScreenPoint({ x: rect.x, y: rect.y });
    const { scaleFactor } = screen.getDisplayMatching(rect);
    return {
      ...origin,
      width: Math.round(rect.width * scaleFactor),
      height: Math.round(rect.height * scaleFactor),
    };
  };
  function render() {
    const displays = screen.getAllDisplays();
    for (const [id, window] of windows) {
      if (!displays.some((display) => display.id === id)) {
        window.destroy();
        windows.delete(id);
      }
    }
    for (const display of displays) {
      let window = windows.get(display.id);
      if (!state || suspended || state.expiresAt <= Date.now()) {
        window?.hide();
        continue;
      }
      if (!window) {
        window = new BrowserWindow({
          ...display.bounds,
          show: false,
          transparent: true,
          frame: false,
          focusable: false,
          skipTaskbar: true,
          hasShadow: false,
          resizable: false,
          movable: false,
          enableLargerThanScreen: true,
          backgroundColor: "#00000000",
          webPreferences: {
            preload: fileURLToPath(
              new URL("desktop-overlay-preload.cjs", import.meta.url),
            ),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
          },
        });
        windows.set(display.id, window);
        window.setAlwaysOnTop(true, "floating");
        window.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
          skipTransformProcessType: true,
        });
        window.setIgnoreMouseEvents(true);
        window.setContentProtection(true);
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.on("will-navigate", (event) =>
          event.preventDefault(),
        );
        window.webContents.ipc.once("computer-effect-ready", () => {
          loaded.add(window);
          render();
        });
        const html = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}</style><domos-computer-effect></domos-computer-effect><script>const effect=(${mountComputerEffect.toString()})(document.querySelector('domos-computer-effect'));window.computerEffect.subscribe(value=>effect.update(value));</script>`;
        void window.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
        );
      }
      window.setBounds(display.bounds, false);
      if (!loaded.has(window)) continue;
      window.webContents.send("computer-effect", {
        ...state,
        screen: physical(display.bounds),
      });
      window.showInactive();
    }
  }
  function changed() {
    channel.send({
      type: "screen",
      bounds: physical(screen.getPrimaryDisplay().bounds),
      displays: screen.getAllDisplays().map((display) => ({
        dip: display.bounds,
        physical: physical(display.bounds),
      })),
    });
    render();
  }
  for (const event of [
    "display-added",
    "display-removed",
    "display-metrics-changed",
  ])
    screen.on(event, changed);
  changed();
  channel.on("message", (value) => {
    try {
      if (JSON.stringify(value).length > 131072)
        throw new Error("Invalid frame");
      if (value?.type === "capture") {
        suspended = value.hidden;
        render();
        setTimeout(() => channel.send({ type: "capture", id: value.id }), 32);
        return;
      }
      state = value;
      clearTimeout(heartbeat);
      heartbeat = setTimeout(() => {
        state = null;
        render();
      }, 2500);
      render();
    } catch {
      app.quit();
    }
  });
  channel.once("disconnect", () => app.quit());
  app.on("before-quit", () => clearTimeout(heartbeat));
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  openDesktopOverlay(process).catch(() => app.quit());
