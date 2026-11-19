import { fileURLToPath } from "node:url";
import {
  DockerError,
  type InstallProgress,
  startDocker,
} from "@domos/hosting/install";
import type { Instance } from "@domos/hosting/instance";
import { themes, windowOverlay } from "@domos/ui/tokens";
import { type BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
import { z } from "zod";
import { createWindow } from "./windows.ts";

export class ConnectionSetup {
  private window?: BrowserWindow;
  private controller?: AbortController;
  private busy = false;
  private loading = false;
  private error = "";
  private prepare = false;
  private remote = false;
  private readonly url = new URL("./setup.html", import.meta.url);

  constructor(
    private readonly options: {
      instances: () => Instance[];
      selected: () => Instance | undefined;
      local: (
        runtime: "native" | "docker",
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
        remote: this.remote,
      };
    });
    ipcMain.handle("setup:submit", async (event, value) => {
      this.check(event);
      if (this.busy) return { ok: false, error: "请等待当前连接完成。" };
      const input = z
        .discriminatedUnion("mode", [
          z.object({
            mode: z.literal("local"),
            runtime: z.enum(["native", "docker"]),
            startDocker: z.boolean().optional(),
          }),
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
        if (input.mode === "local") {
          this.setLoadingAppearance(true);
          const progress = (value: InstallProgress) => {
            if (window && !window.isDestroyed())
              window.webContents.send("setup:progress", value);
          };
          if (input.startDocker) {
            if (process.platform !== "win32" || input.runtime !== "docker")
              throw new Error("此操作需要 Windows Docker Desktop。");
            await startDocker(controller.signal, progress);
          }
          await this.options.local(input.runtime, progress, controller.signal);
        } else
          await this.options.remote(input.url, input.name, controller.signal);
        window?.close();
        return { ok: true };
      } catch (error) {
        if (window && !window.isDestroyed()) {
          this.setLoadingAppearance(false);
          window.show();
          window.focus();
        }
        return {
          ok: false,
          cancelled: controller.signal.aborted,
          docker: error instanceof DockerError ? error.code : undefined,
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

  private setLoadingAppearance(loading: boolean) {
    this.loading = loading;
    const dark = loading || nativeTheme.shouldUseDarkColors;
    this.window?.setBackgroundColor(themes[dark ? "dark" : "light"].startup);
    if (process.platform !== "darwin")
      this.window?.setTitleBarOverlay({
        ...windowOverlay,
        symbolColor: themes[dark ? "dark" : "light"].text,
      });
  }

  hide() {
    this.window?.hide();
  }

  open(error = "", prepare = false, remote = false) {
    this.error = error;
    this.prepare = prepare;
    this.remote = remote;
    if (this.window) {
      this.window.show();
      this.window.focus();
      return;
    }
    const window = createWindow("./setup-preload.cjs");
    const appearance = () => this.setLoadingAppearance(this.loading);
    nativeTheme.on("updated", appearance);
    window.setSize(1120, 820);
    window.setMinimumSize(360, 540);
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("will-redirect", (event) => event.preventDefault());
    window.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.on("closed", () => {
      nativeTheme.removeListener("updated", appearance);
      this.controller?.abort();
      this.window = undefined;
    });
    this.window = window;
    this.setLoadingAppearance(prepare);
    void window.loadFile(fileURLToPath(this.url));
  }
}
