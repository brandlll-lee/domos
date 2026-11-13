import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type InstallProgress,
  prepareWorkImages,
  releaseSchema,
  writeConfiguration,
} from "@domos/hosting/install";
import {
  type Instance,
  instanceSchema,
  probeInstance,
} from "@domos/hosting/instance";
import { LocalStack } from "@domos/hosting/stack";
import { themes, windowOverlay } from "@domos/ui/tokens";
import { app, type BrowserWindow, dialog, ipcMain, Menu, Tray } from "electron";
import { z } from "zod";
import { ConnectionSetup } from "./connection.ts";
import { desktopFile } from "./files.ts";
import { LocalHost } from "./host.ts";
import { applicationIcon } from "./icons.ts";
import { maintain } from "./maintenance.ts";
import { notificationSchema, notify } from "./notifications.ts";
import { createWindow, prepareInstance, workspaceSource } from "./windows.ts";

let quitting = false;
let current: BrowserWindow | undefined;
let host: LocalHost;
let stack: LocalStack;
let instances: Instance[] = [];
let selected: string | undefined;
let hostingDirectory: string;
let containerDirectory: string;
let tray: Tray;
let busy = false;
let connection: ConnectionSetup;
let active: Awaited<ReturnType<typeof prepareInstance>> | undefined;
let switching: AbortController | undefined;
let transition: Promise<void> = Promise.resolve();
let unread: Record<string, number> = {};
let attentionSave: Promise<unknown> = Promise.resolve();

async function save(nextInstances = instances, nextSelected = selected) {
  await writeConfiguration(join(app.getPath("userData"), "instances.json"), {
    instances: nextInstances,
    selected: nextSelected,
    hostingDirectory,
    containerDirectory,
  });
}

function updateMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Domos",
        submenu: [
          { label: "打开本机 Domos", click: () => void local().catch(failure) },
          { label: "连接其他电脑…", click: () => connection.open() },
          ...instances.map((instance) => ({
            label: instance.name,
            type: "radio" as const,
            checked: instance.id === selected,
            click: () => void connect(instance).catch(failure),
          })),
          { type: "separator" as const },
          { label: "退出 Domos", click: () => app.quit() },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
    ]),
  );
}

function failure(error: unknown) {
  const message =
    error instanceof Error ? error.message : "连接未完成。请重试。";
  if (!active) {
    connection.open(message);
    return;
  }
  void dialog.showMessageBox({
    type: "error",
    message,
  });
}

function connect(
  instance: Instance,
  progress: (value: InstallProgress) => void = () => {},
  signal = new AbortController().signal,
) {
  if (busy) return Promise.reject(new Error("请等待当前操作结束。"));
  switching?.abort(new Error("已选择另一台电脑。"));
  const controller = new AbortController();
  switching = controller;
  const pending = transition
    .catch(() => {})
    .then(() =>
      openWorkspace(
        instance,
        progress,
        AbortSignal.any([
          signal,
          controller.signal,
          AbortSignal.timeout(300_000),
        ]),
      ),
    );
  transition = pending;
  return pending.finally(() => {
    if (switching === controller) switching = undefined;
  });
}

async function openWorkspace(
  instance: Instance,
  progress: (value: InstallProgress) => void,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (active && selected === instance.id) return;
  let session: (() => Promise<{ token: string; expires: number }>) | undefined;
  let url = instance.url;
  if (instance.mode === "local") {
    const target = instance.runtime === "docker" ? stack : host;
    url = (await target.start(progress, signal)).origin;
    session = () => target.pair();
  } else await probeInstance(url, signal);
  signal.throwIfAborted();
  if (!current) {
    current = createWindow("./preload.cjs", undefined, false);
    current.on("closed", () => {
      switching?.abort(new Error("窗口已关闭。"));
      active?.dispose();
      active = undefined;
      current = undefined;
    });
  }
  const window = current;
  const next = await prepareInstance(window, url, session, signal, () =>
    connection.hide(),
  );
  try {
    const saved = { ...instance, url };
    const nextInstances = instances.some((item) => item.id === instance.id)
      ? instances.map((item) => (item.id === instance.id ? saved : item))
      : [...instances, saved];
    signal.throwIfAborted();
    await save(nextInstances, instance.id);
    if (signal.aborted) {
      await save();
      signal.throwIfAborted();
    }
    const previous = active;
    active = next;
    instances = nextInstances;
    selected = instance.id;
    updateMenu();
    if (previous) {
      const contents = previous.view.webContents;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, 1000);
        function done() {
          clearTimeout(timer);
          ipcMain.removeListener("desktop:left", left);
          resolve();
        }
        function left(event: Electron.IpcMainEvent) {
          if (
            event.sender === contents &&
            event.senderFrame === contents.mainFrame
          )
            done();
        }
        ipcMain.on("desktop:left", left);
        contents.send("desktop:leave");
      });
    }
    next.show();
    next.view.webContents.send("desktop:activated");
    previous?.dispose();
  } catch (error) {
    next.dispose();
    if (active) window.focus();
    throw error;
  }
}

async function local(
  runtime: "native" | "docker" = instances.find(
    (item) => item.id === selected && item.mode === "local",
  )?.runtime ?? "native",
  progress?: (value: InstallProgress) => void,
  signal?: AbortSignal,
) {
  let instance = instances.find(
    (item) => item.mode === "local" && (item.runtime ?? "native") === runtime,
  );
  if (!instance) {
    instance = {
      id: crypto.randomUUID(),
      name: runtime === "native" ? "这台电脑" : "这台电脑 · Docker",
      mode: "local",
      runtime,
      url: "http://127.0.0.1",
    };
  }
  await connect(instance, progress, signal);
}

async function remote(url: string, name: string, signal: AbortSignal) {
  const { origin } = await probeInstance(url, signal);
  signal.throwIfAborted();
  let instance = instances.find((item) => item.url === origin);
  if (!instance) {
    instance = { id: crypto.randomUUID(), name, mode: "existing", url: origin };
  }
  await connect(instance, undefined, signal);
}

async function main() {
  if (app.isPackaged) {
    const profile =
      app.commandLine.getSwitchValue("user-data-dir") ||
      join(app.getPath("appData"), "@domos", "desktop");
    await mkdir(profile, { recursive: true });
    app.setPath("userData", profile);
  }
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  if (process.platform === "win32") app.setAppUserModelId("app.domos.desktop");
  await app.whenReady();
  app.dock?.setIcon(applicationIcon);
  const resource = fileURLToPath(new URL(".", import.meta.url));
  const runtime = app.isPackaged
    ? join(process.resourcesPath, "runtime")
    : join(resource, "../runtime");
  const release = releaseSchema.parse(
    JSON.parse(await readFile(join(runtime, "release.json"), "utf8")),
  );
  release.staticDir = join(runtime, release.staticDir);
  if (release.workBuild)
    release.workBuild.context = join(runtime, release.workBuild.context);
  if (release.proxyBuild)
    release.proxyBuild.context = join(runtime, release.proxyBuild.context);
  if (release.serviceBuild)
    release.serviceBuild.context = join(runtime, release.serviceBuild.context);
  hostingDirectory = join(app.getPath("userData"), "hosting");
  containerDirectory = join(app.getPath("userData"), "container");
  try {
    unread = z
      .record(z.uuid(), z.number().int().nonnegative())
      .parse(
        JSON.parse(
          await readFile(
            join(app.getPath("userData"), "attention.json"),
            "utf8",
          ),
        ),
      );
  } catch {
    unread = {};
  }
  try {
    const stored = z
      .object({
        instances: z.array(instanceSchema),
        selected: z.uuid().optional(),
        hostingDirectory: z.string().optional(),
        containerDirectory: z.string().optional(),
      })
      .parse(
        JSON.parse(
          await readFile(
            join(app.getPath("userData"), "instances.json"),
            "utf8",
          ),
        ),
      );
    instances = stored.instances;
    selected = stored.selected;
    hostingDirectory = stored.hostingDirectory ?? hostingDirectory;
    containerDirectory = stored.containerDirectory ?? containerDirectory;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      await dialog.showMessageBox({
        type: "warning",
        message: "连接配置无法读取。请重新连接。",
      });
  }
  host = new LocalHost(hostingDirectory, release, runtime);
  stack = new LocalStack(containerDirectory, release);
  connection = new ConnectionSetup({
    instances: () => instances,
    selected: () => instances.find((item) => item.id === selected),
    local,
    remote,
  });
  tray = new Tray(applicationIcon.resize({ width: 20, height: 20 }));
  tray.setToolTip("Domos");
  const restore = () => {
    if (current) {
      current.show();
      current.focus();
    } else connection.open();
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 Domos", click: restore },
      { label: "退出并停止托管", click: () => app.quit() },
    ]),
  );
  tray.on("click", restore);
  const handle = (
    name: string,
    run: (input: unknown) => Promise<unknown>,
    exclusive = true,
  ) =>
    ipcMain.handle(name, async (event, input) => {
      const instance = instances.find((item) => item.id === selected);
      if (name === "desktop:appearance" && workspaceSource(event)) {
        await run(input);
        return { ok: true };
      }
      if (
        !instance ||
        !current ||
        event.sender !== active?.view.webContents ||
        event.senderFrame !== active.view.webContents.mainFrame ||
        new URL(event.senderFrame.url).origin !== new URL(instance.url).origin
      )
        throw new Error("请求来源无效。");
      if (
        (name === "desktop:prepare" || name === "desktop:maintain") &&
        instance.mode !== "local"
      )
        return { ok: false, error: "请先打开本机 Domos，再管理本机托管。" };
      if (exclusive && (busy || switching))
        return { ok: false, error: "请等待当前操作结束。" };
      if (exclusive) busy = true;
      try {
        return { ok: true, value: await run(input) };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "操作未完成。",
        };
      } finally {
        if (exclusive) busy = false;
      }
    });
  handle(
    "desktop:appearance",
    async (input) => {
      const theme = z.enum(["light", "dark"]).parse(input);
      current?.setBackgroundColor(themes[theme].frame);
      if (process.platform !== "darwin")
        current?.setTitleBarOverlay({
          ...windowOverlay,
          symbolColor: themes[theme].text,
        });
    },
    false,
  );
  handle(
    "desktop:menu",
    async (input) => {
      const scope = z.literal("environment").optional().parse(input);
      const application = Menu.getApplicationMenu();
      const menu =
        scope === "environment" ? application?.items[0]?.submenu : application;
      if (current && menu)
        await new Promise<void>((resolve) =>
          menu.popup({ window: current, callback: resolve }),
        );
    },
    false,
  );
  handle(
    "desktop:file",
    async (input) => {
      const instance = instances.find((item) => item.id === selected);
      if (!current || !instance) throw new Error("窗口不可用。");
      return desktopFile(
        current,
        instance.url,
        input,
        active?.view.webContents,
      );
    },
    false,
  );
  handle("desktop:prepare", async () => {
    await prepareWorkImages(release, () => {});
    return { image: release.workImage, proxyImage: release.proxyImage };
  });
  handle(
    "desktop:state",
    async () => ({
      instances: instances.map(({ id, name, mode }) => ({
        id,
        name,
        mode,
        unread: unread[id] ?? 0,
      })),
      selected,
      running: host.running || stack.running,
      mode: instances.find((item) => item.id === selected)?.mode,
      runtime:
        instances.find((item) => item.id === selected)?.runtime ?? "native",
    }),
    false,
  );
  handle(
    "desktop:unread",
    async (input) => {
      const count = z
        .number()
        .int()
        .nonnegative()
        .max(1_000_000_000)
        .parse(input);
      if (!selected) throw new Error("工作区不可用。");
      unread[selected] = count;
      app.setBadgeCount(
        Object.entries(unread)
          .filter(([id]) => instances.some((item) => item.id === id))
          .reduce((sum, [, count]) => sum + count, 0),
      );
      attentionSave = attentionSave
        .catch(() => {})
        .then(() =>
          writeConfiguration(
            join(app.getPath("userData"), "attention.json"),
            unread,
          ),
        );
      await attentionSave;
    },
    false,
  );
  handle(
    "desktop:notify",
    async (input) => {
      const value = notificationSchema.parse(input);
      const instance = instances.find((item) => item.id === selected);
      if (!instance) throw new Error("工作区不可用。");
      if (current?.isFocused() && current.isVisible() && !current.isMinimized())
        return { shown: false };
      return notify(instance.id, value, () => {
        void (async () => {
          const saved = instances.find((item) => item.id === instance.id);
          if (!saved) throw new Error("电脑连接已移除。");
          await connect(saved);
          current?.show();
          current?.focus();
          active?.view.webContents.send("desktop:chat-target", value);
        })().catch(failure);
      });
    },
    false,
  );
  handle(
    "desktop:connection",
    async (input) => {
      const value = z
        .discriminatedUnion("action", [
          z.object({ action: z.literal("select"), id: z.uuid() }),
          z.object({ action: z.literal("remove"), id: z.uuid() }),
          z.object({ action: z.literal("add") }),
          z.object({ action: z.literal("cancel") }),
        ])
        .parse(input);
      if (value.action === "add") return connection.open("", false, true);
      if (value.action === "cancel")
        return switching?.abort(new Error("连接已取消。"));
      const instance = instances.find((item) => item.id === value.id);
      if (!instance) throw new Error("连接不存在。请刷新后重试。");
      if (value.action === "select") return connect(instance);
      if (instance.id === selected) throw new Error("请先切换到其他电脑。");
      if (instance.mode === "local") throw new Error("本机连接需要保留。");
      if (switching || busy) throw new Error("请等待当前操作结束。");
      if (!current) throw new Error("窗口不可用。");
      busy = true;
      try {
        const confirmed = await dialog.showMessageBox(current, {
          type: "question",
          message: `移除“${instance.name}”的连接？`,
          detail: "这不会删除该电脑上的 Bot、聊天或文件。",
          buttons: ["取消", "移除连接"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (confirmed.response !== 1) return;
        const nextInstances = instances.filter(
          (item) => item.id !== instance.id,
        );
        await save(nextInstances);
        instances = nextInstances;
        updateMenu();
      } finally {
        busy = false;
      }
    },
    false,
  );
  ipcMain.on("desktop:connected", (event) => {
    if (event.sender === active?.view.webContents && workspaceSource(event))
      event.sender.send("desktop:activated");
  });
  handle("desktop:maintain", async (input) => {
    const container =
      instances.find((item) => item.id === selected)?.runtime === "docker";
    const result = await maintain(container ? stack : host, input);
    if (result?.directory) {
      if (container) {
        containerDirectory = result.directory;
        stack = new LocalStack(containerDirectory, release);
      } else {
        hostingDirectory = result.directory;
        host = new LocalHost(hostingDirectory, release, runtime);
      }
      await save();
    }
    return result;
  });
  updateMenu();
  app.on("second-instance", restore);
  app.on("activate", restore);
  app.on("window-all-closed", () => {
    if (!quitting && !host.running && !stack.running) app.quit();
  });
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    tray.destroy();
    void Promise.all([host.stop(), stack.stop()]).finally(() => app.quit());
  });
  const saved = instances.find((item) => item.id === selected);
  if (saved?.mode === "local") connection.open("", true);
  else if (saved) {
    try {
      await connect(saved);
    } catch (error) {
      failure(error);
    }
  } else connection.open();
}

main().catch(() => {
  dialog.showErrorBox("Domos 启动失败", "请检查安装文件和目录权限。");
  app.quit();
});
