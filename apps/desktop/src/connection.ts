import { fileURLToPath } from "node:url";
import type { InstallProgress } from "@domos/hosting/install";
import type { Instance } from "@domos/hosting/instance";
import { type BrowserWindow, ipcMain, shell } from "electron";
import { z } from "zod";
import { createWindow } from "./windows.ts";

export class ConnectionSetup {
  private window?: BrowserWindow;
  private controller?: AbortController;
  private busy = false;
  private error = "";
  private prepare = false;
  private readonly url = new URL("./setup.html", import.meta.url);

  constructor(
    private readonly options: {
      instances: () => Instance[];
      selected: () => Instance | undefined;
      local: (
        progress: (value: InstallProgress) => void,
        signal: AbortSignal,
      ) => Promise<void>;
      remote: (url: string, name: string, signal: AbortSignal) => Promise<void>;
    },
  ) {
    ipcMain.handle("setup:state", (event) => {
      this.check(event);
      return {
        instances: this.options.instances(),
        selected: this.options.selected(),
        error: this.error,
        prepare: this.prepare,
      };
    });
    ipcMain.handle("setup:submit", async (event, value) => {
      this.check(event);
      if (this.busy) return { ok: false, error: "请等待当前连接完成。" };
      const input = z
        .discriminatedUnion("mode", [
          z.object({ mode: z.literal("local") }),
          z.object({
            mode: z.literal("existing"),
            url: z.string().min(1),
            name: z.string().trim().min(1).max(80),
          }),
        ])
        .parse(value);
      this.busy = true;
      const controller = new AbortController();
      this.controller = controller;
      const window = this.window;
      try {
        if (input.mode === "local")
          await this.options.local((progress) => {
            if (window && !window.isDestroyed())
              window.webContents.send("setup:progress", progress);
          }, controller.signal);
        else
          await this.options.remote(input.url, input.name, controller.signal);
        window?.close();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          cancelled: controller.signal.aborted,
          error:
            error instanceof Error ? error.message : "连接未完成。请重试。",
        };
      } finally {
        this.busy = false;
        this.controller = undefined;
      }
    });
    ipcMain.handle("setup:cancel", (event) => {
      this.check(event);
      this.controller?.abort();
    });
    ipcMain.handle("setup:docker", (event) => {
      this.check(event);
      return shell.openExternal(
        "https://docs.docker.com/desktop/setup/install/",
      );
    });
  }

  private check(event: Electron.IpcMainInvokeEvent) {
    if (
      !this.window ||
      event.sender !== this.window.webContents ||
      event.senderFrame !== this.window.webContents.mainFrame ||
      event.senderFrame.url !== this.url.href
    )
      throw new Error("请求来源无效。");
  }

  open(error = "", prepare = false) {
    this.error = error;
    this.prepare = prepare;
    if (this.window) {
      this.window.show();
      this.window.focus();
      return;
    }
    const window = createWindow("./setup-preload.cjs");
    window.setSize(680, 760);
    window.setMinimumSize(360, 540);
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("will-redirect", (event) => event.preventDefault());
    window.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.on("closed", () => {
      this.controller?.abort();
      this.window = undefined;
    });
    this.window = window;
    void window.loadFile(fileURLToPath(this.url));
  }
}
