import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseSchema, writeConfiguration } from "@domos/hosting/install";
import {
  type Instance,
  instanceSchema,
  probeInstance,
} from "@domos/hosting/instance";
import {
  app,
  type BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  Tray,
} from "electron";
import { z } from "zod";
import { LocalHost } from "./host.ts";
import { maintain } from "./maintenance.ts";
import { openInstance, setupWindow } from "./windows.ts";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "domos-setup",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let quitting = false;
let setup: BrowserWindow | undefined;
let current: BrowserWindow | undefined;
let host: LocalHost;
let installation: AbortController | undefined;
let instances: Instance[] = [];
let selected: string | undefined;
let hostingDirectory: string;
let tray: Tray;

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
          { label: "连接实例", click: () => showSetup() },
          ...instances.map((instance) => ({
            label: instance.name,
            type: "radio" as const,
            checked: instance.id === selected,
            click: () => void connect(instance).catch(() => showSetup()),
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

function showSetup() {
  if (setup && !setup.isDestroyed()) {
    setup.show();
    return;
  }
  setup = setupWindow();
  setup.on("closed", () => {
    setup = undefined;
  });
}

async function connect(instance: Instance, url = instance.url) {
  if (instance.mode === "local") {
    const started = await host.start(
      (value) => setup?.webContents.send("setup:progress", value),
      new AbortController().signal,
    );
    url = started.url;
  } else await probeInstance(instance.url);
  const next = openInstance(url);
  const previous = current;
  current = next;
  next.on("closed", () => {
    if (current === next) current = undefined;
  });
  previous?.close();
  setup?.close();
  selected = instance.id;
  await save();
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
  const assets = new Set(["setup.html", "setup.css", "setup.js", "theme.css"]);
  protocol.handle("domos-setup", (request) => {
    const name = new URL(request.url).pathname.slice(1);
    if (!assets.has(name)) return new Response("Not found", { status: 404 });
    return net.fetch(new URL(name, new URL("./", import.meta.url)).href);
  });
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
  const restoreWindow = () => {
    if (current) {
      current.show();
      current.focus();
    } else showSetup();
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 Domos", click: restoreWindow },
      { label: "退出并停止托管", click: () => app.quit() },
    ]),
  );
  tray.on("click", restoreWindow);
  const handle = (name: string, run: (input: unknown) => Promise<unknown>) =>
    ipcMain.handle(name, async (event, input) => {
      if (
        !setup ||
        event.sender !== setup.webContents ||
        event.senderFrame !== setup.webContents.mainFrame ||
        event.senderFrame.url !== "domos-setup://app/setup.html"
      )
        throw new Error("请求来源无效。");
      try {
        return { ok: true, value: await run(input) };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "操作未完成。",
        };
      }
    });
  handle("setup:state", async () => ({ instances, running: host.running }));
  handle("setup:maintain", async (input) => {
    if (installation) throw new Error("请等待安装结束。");
    installation = new AbortController();
    try {
      const result = await maintain(host, input);
      if (result?.directory) {
        hostingDirectory = result.directory;
        host = new LocalHost(hostingDirectory, release, runtime);
        await save();
      }
      return result;
    } finally {
      installation = undefined;
    }
  });
  handle("setup:cancel", async () => {
    installation?.abort();
  });
  handle("setup:host", async () => {
    if (installation) throw new Error("正在准备托管环境。");
    installation = new AbortController();
    try {
      const started = await host.start(
        (value) => setup?.webContents.send("setup:progress", value),
        installation.signal,
      );
      let instance = instances.find((item) => item.mode === "local");
      if (!instance) {
        instance = {
          id: crypto.randomUUID(),
          name: "这台电脑",
          mode: "local",
          url: started.origin,
        };
        instances.push(instance);
      }
      await connect(instance, started.url);
    } finally {
      installation = undefined;
    }
  });
  handle("setup:connect", async (input) => {
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
  updateMenu();
  app.on("second-instance", () => {
    if (current) {
      current.show();
      current.focus();
    } else showSetup();
  });
  app.on("activate", () => {
    if (current) current.show();
    else showSetup();
  });
  app.on("window-all-closed", () => {
    if (quitting) return;
    if (!host.running) {
      app.quit();
      return;
    }
    void dialog
      .showMessageBox({
        type: "question",
        message: "Domos 仍在这台电脑上托管。",
        detail: "退出会中断 Bot 工作和其他设备的连接。",
        buttons: ["在后台继续托管", "退出并停止托管"],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        if (response === 1) app.quit();
      });
  });
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    tray.destroy();
    installation?.abort();
    void host.stop().finally(() => app.quit());
  });
  const saved = instances.find((item) => item.id === selected);
  if (saved) {
    try {
      await connect(saved);
    } catch {
      showSetup();
    }
  } else showSetup();
}

main().catch(() => {
  void dialog.showErrorBox("Domos 启动失败", "请检查安装文件和目录权限。");
  app.quit();
});
