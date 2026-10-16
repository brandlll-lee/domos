import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareWorkImages,
  releaseSchema,
  writeConfiguration,
} from "@domos/hosting/install";
import {
  type Instance,
  instanceSchema,
  probeInstance,
} from "@domos/hosting/instance";
import { app, type BrowserWindow, dialog, ipcMain, Menu, Tray } from "electron";
import { z } from "zod";
import { LocalHost } from "./host.ts";
import { maintain } from "./maintenance.ts";
import { openInstance } from "./windows.ts";

let quitting = false;
let current: BrowserWindow | undefined;
let host: LocalHost;
let instances: Instance[] = [];
let selected: string | undefined;
let hostingDirectory: string;
let tray: Tray;
let busy = false;

async function save() {
  await writeConfiguration(join(app.getPath("userData"), "instances.json"), {
    instances,
    selected,
    hostingDirectory,
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

function failure() {
  void dialog.showMessageBox({
    type: "error",
    message: "无法连接 Domos。请检查后台和实例地址。",
  });
}

async function connect(instance: Instance) {
  let session: { token: string; expires: number } | undefined;
  let url = instance.url;
  if (instance.mode === "local") {
    url = (await host.start(() => {}, new AbortController().signal)).origin;
    session = await host.pair();
  } else await probeInstance(url);
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

async function local() {
  let instance = instances.find((item) => item.mode === "local");
  if (!instance) {
    instance = {
      id: crypto.randomUUID(),
      name: "本机 Domos",
      mode: "local",
      url: "http://127.0.0.1",
    };
    instances.push(instance);
  }
  await connect(instance);
}

async function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();
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
  hostingDirectory = join(app.getPath("userData"), "hosting");
  try {
    const stored = z
      .object({
        instances: z.array(instanceSchema),
        selected: z.uuid().optional(),
        hostingDirectory: z.string().optional(),
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
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      await dialog.showMessageBox({
        type: "warning",
        message: "实例配置无法读取。请重新连接。",
      });
  }
  host = new LocalHost(hostingDirectory, release, runtime);
  tray = new Tray(await app.getFileIcon(process.execPath, { size: "small" }));
  tray.setToolTip("Domos");
  const restore = () => {
    if (current) {
      current.show();
      current.focus();
    } else void local().catch(failure);
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 Domos", click: restore },
      { label: "退出并停止托管", click: () => app.quit() },
    ]),
  );
  tray.on("click", restore);
  const handle = (name: string, run: (input: unknown) => Promise<unknown>) =>
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
      if (busy) return { ok: false, error: "请等待当前操作结束。" };
      busy = true;
      try {
        return { ok: true, value: await run(input) };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "操作未完成。",
        };
      } finally {
        busy = false;
      }
    });
  handle("desktop:prepare", async () => {
    await prepareWorkImages(release, () => {});
    return { image: release.workImage, proxyImage: release.proxyImage };
  });
  handle("desktop:state", async () => ({
    instances,
    selected,
    running: host.running,
  }));
  handle("desktop:local", local);
  handle("desktop:select", async (input) => {
    const { id } = z.object({ id: z.uuid() }).parse(input);
    const instance = instances.find((item) => item.id === id);
    if (!instance) throw new Error("实例不存在。");
    await connect(instance);
  });
  handle("desktop:connect", async (input) => {
    const value = z
      .object({ url: z.string(), name: z.string().trim().min(1).max(80) })
      .parse(input);
    const { origin } = await probeInstance(value.url);
    let instance = instances.find((item) => item.url === origin);
    if (!instance) {
      instance = {
        id: crypto.randomUUID(),
        name: value.name,
        mode: "existing",
        url: origin,
      };
      instances.push(instance);
    }
    await connect(instance);
  });
  handle("desktop:maintain", async (input) => {
    const result = await maintain(host, input);
    if (result?.directory) {
      hostingDirectory = result.directory;
      host = new LocalHost(hostingDirectory, release, runtime);
      await save();
    }
    return result;
  });
  updateMenu();
  app.on("second-instance", restore);
  app.on("activate", restore);
  app.on("window-all-closed", () => {
    if (!quitting && !host.running) app.quit();
  });
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    tray.destroy();
    void host.stop().finally(() => app.quit());
  });
  const saved = instances.find((item) => item.id === selected);
  if (saved) {
    try {
      await connect(saved);
    } catch {
      await local();
    }
  } else await local();
}

main().catch(() => {
  dialog.showErrorBox("Domos 启动失败", "请检查安装文件和目录权限。");
  app.quit();
});
