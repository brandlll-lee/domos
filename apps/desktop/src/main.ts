import { readFile } from "node:fs/promises";
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
import { LocalHost } from "./host.ts";
import { applicationIcon } from "./icons.ts";
import { maintain } from "./maintenance.ts";
import { openInstance } from "./windows.ts";

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

async function save() {
  await writeConfiguration(join(app.getPath("userData"), "instances.json"), {
    instances,
    selected,
    hostingDirectory,
    containerDirectory,
  });
  updateMenu();
}

function updateMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Domos",
        submenu: [
          { label: "打开本机 Domos", click: () => void local().catch(failure) },
          { label: "连接其他 Domos…", click: () => connection.open() },
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
  if (!current) {
    connection.open(message);
    return;
  }
  void dialog.showMessageBox({
    type: "error",
    message,
  });
}

async function connect(
  instance: Instance,
  progress: (value: InstallProgress) => void = () => {},
  signal = new AbortController().signal,
) {
  let session: { token: string; expires: number } | undefined;
  let url = instance.url;
  if (instance.mode === "local") {
    const target = instance.runtime === "docker" ? stack : host;
    url = (await target.start(progress, signal)).origin;
    session = await target.pair();
  } else await probeInstance(url, signal);
  signal.throwIfAborted();
  const next = await openInstance(url, session);
  const previous = current;
  current = next;
  next.on("closed", () => {
    if (current === next) current = undefined;
  });
  previous?.close();
  selected = instance.id;
  instance.url = url;
  await save();
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
    instances.push(instance);
  }
  await connect(instance, progress, signal);
}

async function remote(url: string, name: string, signal: AbortSignal) {
  const { origin } = await probeInstance(url, signal);
  signal.throwIfAborted();
  let instance = instances.find((item) => item.url === origin);
  if (!instance) {
    instance = { id: crypto.randomUUID(), name, mode: "existing", url: origin };
    instances.push(instance);
  }
  await connect(instance, undefined, signal);
}

async function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
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
      if (
        !instance ||
        !current ||
        event.sender !== current.webContents ||
        event.senderFrame !== current.webContents.mainFrame ||
        new URL(event.senderFrame.url).origin !== new URL(instance.url).origin
      )
        throw new Error("请求来源无效。");
      if (
        (name === "desktop:prepare" || name === "desktop:maintain") &&
        instance.mode !== "local"
      )
        return { ok: false, error: "请先打开本机 Domos，再管理本机托管。" };
      if (exclusive && busy)
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
  handle("desktop:prepare", async () => {
    await prepareWorkImages(release, () => {});
    return { image: release.workImage, proxyImage: release.proxyImage };
  });
  handle("desktop:state", async () => ({
    instances,
    selected,
    running: host.running || stack.running,
    mode: instances.find((item) => item.id === selected)?.mode,
    runtime:
      instances.find((item) => item.id === selected)?.runtime ?? "native",
  }));
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
