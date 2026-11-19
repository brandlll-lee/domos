import { execFile, fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  type ElectronApplication,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { workspacePage } from "./pages.ts";

async function captureWindow(
  desktop: ElectronApplication,
  page: Page,
  path: string,
) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  const png = await desktop.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(
      (window) =>
        window.webContents.getURL() === url ||
        window.contentView.children.some(
          (view) =>
            "webContents" in view &&
            (view.webContents as import("electron").WebContents).getURL() ===
              url,
        ),
    );
    if (!window) throw new Error("Window not found");
    return (await window.capturePage()).toPNG().toString("base64");
  }, page.url());
  await writeFile(path, Buffer.from(png, "base64"));
}

test("native setup starts and resumes with Docker unavailable", async ({
  playwright,
}, testInfo) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), "domos-native-"));
  const executablePath = createRequire(
    new URL("../package.json", import.meta.url),
  )("electron") as string;
  const args = [
    fileURLToPath(new URL("./entry.mjs", import.meta.url)),
    `--test-data-dir=${directory}`,
  ];
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.PATH = directory;
  let desktop = await playwright._electron.launch({
    executablePath,
    args,
    env,
  });
  try {
    const setup = await desktop.firstWindow();
    await expect(
      setup.getByRole("heading", { name: "你的 Bot 在哪台电脑？" }),
    ).toBeVisible();
    if (process.platform === "win32") {
      const handle = await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]
          ?.getNativeWindowHandle()
          .readBigUInt64LE()
          .toString(),
      );
      if (!handle) throw new Error("Native window required");
      const { stdout } = await promisify(execFile)(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-File",
          fileURLToPath(
            new URL("./fixtures/window-identity.ps1", import.meta.url),
          ),
          "-Window",
          handle,
        ],
        { windowsHide: true },
      );
      expect(JSON.parse(stdout).appId).toBe("app.domos.desktop.development");
    }
    await expect(
      setup.getByRole("button", { name: "随机变身", exact: true }),
    ).toBeVisible();
    for (const theme of ["dark", "light"] as const) {
      await desktop.evaluate(({ nativeTheme }, theme) => {
        nativeTheme.themeSource = theme;
      }, theme);
      await setup.emulateMedia({ colorScheme: theme });
      const background =
        theme === "dark" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)";
      for (const selector of ["body", ".setup-window", ".startup-guide"])
        await expect(setup.locator(selector)).toHaveCSS(
          "background-color",
          background,
        );
      expect(
        await desktop.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.getBackgroundColor(),
        ),
      ).toMatch(theme === "dark" ? /^#000000$/i : /^#ffffff$/i);
      const header = setup.locator(".startup-guide > header");
      await expect(header).toHaveCSS("-webkit-app-region", "drag");
      expect(
        await header.locator("span").evaluate((logo) => {
          const box = logo.getBoundingClientRect();
          const style = getComputedStyle(document.documentElement);
          const reserved =
            parseFloat(style.getPropertyValue("--window-controls-width")) *
            parseFloat(style.fontSize);
          return (
            box.top < 24 && box.left < 100 && box.right < innerWidth - reserved
          );
        }),
      ).toBe(true);
      const bot = setup.getByRole("button", { name: "随机变身", exact: true });
      await expect(bot.locator(".character-body > image")).toBeVisible();
      await expect(bot.locator(".character")).not.toHaveAttribute(
        "data-entering",
        "true",
      );
      await bot.hover();
      await expect(bot).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await captureWindow(
        desktop,
        setup,
        testInfo.outputPath(`service-choice-${theme}.png`),
      );
      await bot.focus();
      await setup.keyboard.press("Tab");
      await setup.keyboard.press("Shift+Tab");
      await expect(bot).toBeFocused();
      await expect(bot).not.toHaveCSS("outline-style", "none");
      await bot.press("Enter");
      await expect(bot.locator(".character")).not.toHaveAttribute(
        "data-entering",
        "true",
      );
      await bot.press("Tab");
    }
    await expect(setup.getByRole("progressbar")).toBeHidden();
    await desktop.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setSize(420, 640);
      window?.webContents.setZoomFactor(1.25);
    });
    await expect.poll(() => setup.evaluate(() => innerWidth)).toBeLessThan(400);
    await expect
      .poll(() =>
        setup
          .locator("main")
          .evaluate((main) => main.scrollWidth <= main.clientWidth),
      )
      .toBe(true);
    const next = setup.getByRole("button", { name: "在本机开始", exact: true });
    await next.scrollIntoViewIfNeeded();
    await expect(next).toBeInViewport({ ratio: 0.99 });
    await captureWindow(
      desktop,
      setup,
      testInfo.outputPath("service-choice-zoom.png"),
    );
    await desktop.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setSize(680, 760);
      window?.webContents.setZoomFactor(1);
    });
    await expect(
      setup.getByRole("menuitem", { name: "在 Docker 中运行", exact: true }),
    ).toBeHidden();
    await desktop.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "dark";
    });
    await setup.emulateMedia({ colorScheme: "dark" });
    await setup.getByRole("button", { name: "高级", exact: true }).click();
    await setup
      .getByRole("menuitem", { name: "在 Docker 中运行", exact: true })
      .click();
    await setup
      .getByRole("button", { name: "在本机开始", exact: true })
      .click();
    await expect(setup.getByRole("alert")).toContainText("Docker Desktop");
    await expect(
      setup.getByRole("button", { name: "重试", exact: true }),
    ).toHaveCSS("opacity", "1");
    await expect(
      setup.getByRole("button", { name: "安装 Docker Desktop", exact: true }),
    ).toBeVisible();
    expect(
      await setup.locator(".setup-error").evaluate((notice) => {
        const alert = notice
          .querySelector("[role=alert]")
          ?.getBoundingClientRect();
        const button = notice.querySelector("button")?.getBoundingClientRect();
        return alert && button && button.top >= alert.bottom;
      }),
    ).toBe(true);
    await setup.screenshot({ path: testInfo.outputPath("docker-missing.png") });
    const errorText = await setup.getByRole("alert").textContent();
    await setup.getByRole("alert").evaluate((alert) => {
      alert.textContent = `${alert.textContent} 请检查 Docker Desktop 的安装目录与运行状态，然后重试连接。`;
    });
    for (const size of [
      [1120, 820, 1],
      [680, 540, 1],
      [420, 640, 1.25],
    ] as const) {
      await desktop.evaluate(({ BrowserWindow }, [width, height, zoom]) => {
        const window = BrowserWindow.getAllWindows()[0];
        window?.setSize(width, height);
        window?.webContents.setZoomFactor(zoom);
      }, size);
      await expect
        .poll(() =>
          setup.locator(".setup-error").evaluate((notice) => {
            const box = notice.getBoundingClientRect();
            const footer = document
              .querySelector(".startup-footer")
              ?.getBoundingClientRect();
            if (!footer) throw new Error("Startup footer missing");
            return (
              box.left >= 0 &&
              box.right <= innerWidth &&
              box.top >= 0 &&
              box.bottom <= footer.top &&
              footer.bottom <= innerHeight
            );
          }),
        )
        .toBe(true);
      await expect(
        setup.getByRole("button", { name: "安装 Docker Desktop", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await captureWindow(
        desktop,
        setup,
        testInfo.outputPath(`docker-missing-${size.join("-")}.png`),
      );
    }
    await setup.getByRole("alert").evaluate((alert, text) => {
      alert.textContent = text;
    }, errorText);
    await desktop.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setSize(680, 760);
      window?.webContents.setZoomFactor(1);
    });
    await setup.getByRole("button", { name: "高级", exact: true }).click();
    await setup
      .getByRole("menuitem", { name: "直接运行", exact: true })
      .click();

    await setup.getByRole("button", { name: "重试", exact: true }).click();
    await expect(setup.getByRole("main", { name: "Domos 启动" })).toBeVisible();
    await expect(
      setup.locator(".startup-pixel-bot [data-work=working]"),
    ).toBeVisible();
    await captureWindow(
      desktop,
      setup,
      testInfo.outputPath("local-readiness.png"),
    );
    const page = await workspacePage(desktop);
    await expect(
      page.getByRole("heading", { name: "连接你的 AI" }),
    ).toBeVisible();
    await expect(page.getByText("桌面状态读取失败。")).toBeHidden();
    await desktop.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((window) =>
        window.contentView.children.some(
          (view) =>
            "webContents" in view &&
            (view.webContents as import("electron").WebContents)
              .getURL()
              .startsWith("http"),
        ),
      );
      window?.setSize(640, 680);
      for (const view of window?.contentView.children ?? [])
        if ("webContents" in view)
          (view.webContents as import("electron").WebContents).setZoomFactor(
            1.25,
          );
    });
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(600);
    expect(
      await page
        .locator("main")
        .evaluate((main) => main.scrollWidth <= main.clientWidth),
    ).toBe(true);
    await page.getByRole("button", { name: "Pi", exact: true }).click();
    const continueSetup = page.getByRole("button", {
      name: "允许访问并继续",
      exact: true,
    });
    await continueSetup.scrollIntoViewIfNeeded();
    await expect(continueSetup).toBeInViewport({ ratio: 0.99 });
    await captureWindow(
      desktop,
      page,
      testInfo.outputPath("computer-setup-zoom.png"),
    );
    const origin = new URL(page.url()).origin;
    const authorized = () =>
      page.evaluate(async () => {
        const result = await (await fetch("/hosting/devices")).json();
        return { total: result.total, id: result.items[0].id };
      });
    const firstGrant = await authorized();
    expect(firstGrant.total).toBe(1);

    await desktop.close();
    desktop = await playwright._electron.launch({ executablePath, args, env });
    const resumed = await workspacePage(desktop, origin);
    expect(
      await resumed.evaluate(async () => {
        const result = await (await fetch("/hosting/devices")).json();
        return { total: result.total, id: result.items[0].id };
      }),
    ).toEqual(firstGrant);

    await expect(
      resumed.getByRole("heading", { name: "连接你的 AI" }),
    ).toBeVisible();
    await resumed.getByRole("button", { name: "Pi", exact: true }).click();
    await resumed
      .getByRole("button", { name: "允许访问并继续", exact: true })
      .click();
    await expect(
      resumed.getByRole("heading", { name: "给 Bot 选一个模型" }),
    ).toBeVisible();
    await resumed.evaluate(async () => {
      const rpc = async (name: string, json: unknown) => {
        const response = await fetch(`/rpc/${name}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ json }),
        });
        if (!response.ok) throw new Error(`RPC ${name}: ${response.status}`);
        return (await response.json()).json;
      };
      const [bot] = await rpc("bots/list", {});
      const profile = await rpc("engines/get", { botId: bot.id });
      await rpc("engines/configure", {
        botId: bot.id,
        config: { provider: "pi", model: null },
        revision: profile.revision,
        requestId: crypto.randomUUID(),
      });
    });
    await resumed.reload();
    await expect(
      resumed.getByRole("button", { name: "添加内容", exact: true }),
    ).toBeEnabled();
    const draft = resumed.getByRole("textbox", { name: "消息", exact: true });
    await draft.fill("服务恢复后保留这份草稿");
    const identity = await resumed.evaluate(() => window.location.href);
    const service = () =>
      resumed.evaluate(
        async () => (await window.domosDesktop?.state())?.value?.service,
      );
    const terminate = () =>
      desktop.evaluate(({ app }) => {
        const process = app
          .getAppMetrics()
          .find((item) => item.name === "Domos server.mjs");
        if (!process) throw new Error("Domos service required");
        globalThis.process.kill(process.pid);
        return process.pid;
      });
    for (let attempt = 0; attempt < 3; attempt++) {
      const previous = await terminate();
      if (attempt < 2) {
        await expect
          .poll(() =>
            desktop.evaluate(({ app }, previous) => {
              const current = app
                .getAppMetrics()
                .find((item) => item.name === "Domos server.mjs");
              return Boolean(current && current.pid !== previous);
            }, previous),
          )
          .toBe(true);
        await expect.poll(service).toBe("ready");
        await expect(
          resumed.getByRole("button", { name: "添加内容", exact: true }),
        ).toBeEnabled();
      } else await expect.poll(service).toBe("failed");
    }
    const stoppedNotice = resumed.getByRole("alert", {
      name: "本机服务已停止",
      exact: true,
    });
    await expect(stoppedNotice).toHaveCount(1);
    await expect(
      resumed
        .locator('.sidebar-empty[role="status"]')
        .filter({ hasText: "正在连接…" }),
    ).toHaveCount(0);
    await expect(draft).toHaveText("服务恢复后保留这份草稿");
    expect(resumed.url()).toBe(identity);
    expect(
      await stoppedNotice.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth;
      }),
    ).toBe(true);
    for (const theme of ["light", "dark"] as const) {
      await resumed.emulateMedia({ colorScheme: theme });
      await resumed.screenshot({
        path: testInfo.outputPath(`service-stopped-${theme}.png`),
        fullPage: true,
        scale: "css",
        animations: "disabled",
      });
    }
    await resumed
      .getByRole("button", { name: "恢复服务", exact: true })
      .click();
    await expect.poll(service).toBe("ready");
    await expect(stoppedNotice).toHaveCount(0);
    await expect(draft).toHaveText("服务恢复后保留这份草稿");
    expect(
      await resumed.evaluate(
        async () => (await (await fetch("/hosting/devices")).json()).total,
      ),
    ).toBe(1);
    await draft.fill("");
    await resumed
      .getByRole("button", { name: "添加内容", exact: true })
      .click();
    const chooser = resumed.waitForEvent("filechooser");
    await resumed
      .getByRole("menuitem", { name: "添加文件", exact: true })
      .click();
    await (await chooser).setFiles([
      {
        name: "image.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=",
          "base64",
        ),
      },
      {
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Desktop upload"),
      },
      {
        name: "data.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: await readFile(
          new URL(
            "../../../packages/agent/test/fixtures/office/data.xlsx",
            import.meta.url,
          ),
        ),
      },
      {
        name: "report.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: await readFile(
          new URL(
            "../../../packages/agent/test/fixtures/office/report.docx",
            import.meta.url,
          ),
        ),
      },
    ]);
    await expect(
      resumed.locator(".composer-attachments .attachment"),
    ).toHaveCount(4);
    await expect(resumed.locator(".attachment-image img")).toBeVisible();
    await expect
      .poll(() =>
        resumed
          .locator(".attachment-image img")
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBe(1);
    await expect(
      resumed
        .locator(".composer-attachments")
        .getByRole("button", { name: "重试", exact: true }),
    ).toHaveCount(0);
    const previews = await resumed.evaluate(async () => {
      const draftKey = Object.keys(localStorage).find((key) =>
        key.startsWith("domos:composer:v2:"),
      );
      const files = JSON.parse(localStorage.getItem(draftKey ?? "") ?? "{}")
        .attachments as { id: string; name: string }[];
      const bots = await fetch("/rpc/bots/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: {} }),
      });
      const botId = (await bots.json()).json[0].id as number;
      const results = [];
      for (const name of ["data.xlsx", "report.docx"]) {
        const file = files.find((file) => file.name === name);
        if (!file) throw new Error("Native attachment missing");
        const response = await fetch(
          `/files/${botId}/${file.id}${name === "data.xlsx" ? "/preview" : "?download=1"}`,
        );
        if (!response.ok) throw new Error(await response.text());
        results.push(
          name === "data.xlsx"
            ? await response.json()
            : { size: (await response.arrayBuffer()).byteLength },
        );
      }
      return results;
    });
    expect(previews[0]).toMatchObject({
      kind: "xlsx",
      sheets: ["汇总", "明细"],
    });
    expect(previews[1]).toEqual({
      size: (
        await readFile(
          new URL(
            "../../../packages/agent/test/fixtures/office/report.docx",
            import.meta.url,
          ),
        )
      ).length,
    });
    await captureWindow(
      desktop,
      resumed,
      testInfo.outputPath("native-uploads.png"),
    );
  } finally {
    await desktop.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("desktop opens setup, pairs a remote Domos and restores the connection", async ({
  playwright,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "domos-desktop-"));
  const worker = fork(
    fileURLToPath(
      new URL("../../api/test/fixtures/web-server.ts", import.meta.url),
    ),
    [join(directory, "agent.sqlite"), "0", "hosting"],
    { silent: true, execArgv: [] },
  );
  worker.stdout?.resume();
  worker.stderr?.resume();
  const [ready] = (await once(worker, "message")) as [
    { port: number; pairing: string },
  ];
  const executablePath = createRequire(
    new URL("../package.json", import.meta.url),
  )("electron") as string;
  const args = [
    fileURLToPath(new URL("./entry.mjs", import.meta.url)),
    `--test-data-dir=${join(directory, "profile")}`,
  ];
  await mkdir(join(directory, "profile"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.PATH = directory;
  let desktop = await playwright._electron.launch({
    executablePath,
    args,
    env,
  });
  try {
    const setup = await desktop.firstWindow();
    await expect(
      setup.getByRole("heading", { name: "你的 Bot 在哪台电脑？" }),
    ).toBeVisible();
    await setup
      .getByRole("button", { name: "连接另一台电脑", exact: true })
      .click();
    await expect(setup.locator(".startup-viewport")).not.toHaveAttribute(
      "data-travelling",
      "",
    );
    await setup.getByLabel("Domos 地址").fill(`http://127.0.0.1:${ready.port}`);
    await setup.getByRole("button", { name: "返回", exact: true }).click();
    await setup
      .getByRole("button", { name: "连接另一台电脑", exact: true })
      .click();
    await expect(setup.getByLabel("Domos 地址")).toHaveValue(
      `http://127.0.0.1:${ready.port}`,
    );

    await setup.getByRole("button", { name: "连接", exact: true }).click();
    const page = await workspacePage(desktop);
    await expect(
      page.getByRole("heading", { name: "连接这个 Domos" }),
    ).toBeVisible();
    await page.getByLabel("配对码", { exact: true }).fill(ready.pairing);
    await page.getByRole("button", { name: "连接", exact: true }).click();
    await expect(page.getByRole("button", { name: "Bot详情" })).toBeVisible();
    await expect(page.locator(".app-titlebar, .app-rail")).toHaveCount(0);
    await expect(page.locator("#bot-details")).toBeVisible();
    await expect(page.locator(".chat-identity .engine-mark")).toBeVisible();
    expect(
      await page.evaluate(() => {
        const platform = window.domosDesktop?.platform;
        const style = getComputedStyle(document.documentElement);
        const width =
          parseFloat(style.fontSize) *
          parseFloat(
            style.getPropertyValue(
              platform === "darwin"
                ? "--mac-controls-width"
                : "--window-controls-width",
            ),
          );
        const height = parseFloat(style.getPropertyValue("--titlebar-height"));
        return Array.from(
          document.querySelectorAll(
            ".environment-trigger, .sidebar-toolbar button, .chat-header button, .bot-details > .panel-header button",
          ),
        )
          .filter((node) => {
            const box = node.getBoundingClientRect();
            return (
              box.width > 0 &&
              box.height > 0 &&
              box.top < height &&
              (platform === "darwin"
                ? box.left < width
                : box.right > innerWidth - width)
            );
          })
          .map((node) => node.getAttribute("aria-label"));
      }),
    ).toEqual([]);
    await captureWindow(
      desktop,
      page,
      testInfo.outputPath("workspace-native.png"),
    );
    await page.getByRole("combobox", { name: "模型", exact: true }).click();
    const selector = page.locator(".model-selector-popup");
    await selector.getByRole("tab", { name: "OpenCode", exact: true }).click();
    await expect(
      selector.getByRole("button", { name: "配置连接", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".chat-identity .engine-mark")).toHaveAttribute(
      "data-provider",
      "pi",
    );
    await captureWindow(
      desktop,
      page,
      testInfo.outputPath("model-provider-native.png"),
    );
    await selector
      .getByRole("button", { name: "关闭模型选择", exact: true })
      .click();
    const original = await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getBounds(),
    );
    await page.getByRole("button", { name: "Bot详情", exact: true }).click();
    await page.getByRole("tab", { name: "Browser", exact: true }).click();
    await page.getByRole("button", { name: "启用浏览器", exact: true }).click();
    await expect(page.getByRole("img", { name: "工作电脑画面" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "全屏", exact: true }).click();
    await expect
      .poll(() =>
        desktop.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isFullScreen(),
        ),
      )
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.className))
      .toBe("computer-viewer");
    await captureWindow(
      desktop,
      page,
      testInfo.outputPath("browser-native-fullscreen.png"),
    );
    await page.keyboard.press("Escape");
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement === null))
      .toBe(true);
    await expect
      .poll(() =>
        desktop.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.getBounds(),
        ),
      )
      .toEqual(original);
    await expect(
      page.getByRole("tab", { name: "Browser", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page
      .locator("#bot-details")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await expect(page.locator("#bot-details")).toBeHidden();
    const environment = page.getByRole("button", {
      name: "用户菜单",
      exact: true,
    });
    await expect(environment).toBeVisible();
    const left = (await environment.boundingBox())?.x;
    const resize = page.getByRole("separator", { name: "调整联系人宽度" });
    await resize.focus();
    await resize.press("End");
    expect((await environment.boundingBox())?.x).toBe(left);
    const plus = await page
      .getByRole("button", { name: "新建", exact: true })
      .boundingBox();
    const environmentBox = await environment.boundingBox();
    expect(environmentBox && plus && plus.y < environmentBox.y).toBe(true);
    await resize.press("Home");
    await expect(resize).toHaveAttribute("aria-valuenow", "96");
    await expect
      .poll(async () => {
        const sidebar = await page
          .locator('.workspace-panel[data-side="sidebar"]')
          .boundingBox();
        const trigger = await environment.boundingBox();
        if (!sidebar || !trigger) throw new Error("Environment menu missing");
        return Math.abs(
          trigger.x + trigger.width / 2 - sidebar.x - sidebar.width / 2,
        );
      })
      .toBeLessThan(1);
    const computerMenu = page.getByRole("button", { name: /^切换电脑：/ });
    await computerMenu.focus();
    await computerMenu.press("Enter");
    await expect(
      page.getByRole("menuitem", { name: "连接其他电脑…", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(computerMenu).toBeFocused();
    for (const theme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator(".chat-identity-label")).toHaveCSS(
        "background-color",
        theme === "dark" ? "rgb(20, 20, 22)" : "rgb(255, 255, 255)",
      );
      await captureWindow(
        desktop,
        page,
        testInfo.outputPath(`environment-${theme}.png`),
      );
    }
    expect(
      await page.evaluate(() => ({
        require: typeof Reflect.get(window, "require"),
        setup: typeof Reflect.get(window, "domosSetup"),
      })),
    ).toEqual({ require: "undefined", setup: "undefined" });
    const restricted = await page.evaluate(() =>
      window.domosDesktop?.prepare(),
    );
    expect(restricted?.ok).toBe(false);
    await page.getByRole("button", { name: "用户菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "设置", exact: true }).click();
    const settings = page.getByRole("main", { name: "设置", exact: true });
    await expect(settings.getByRole("tab")).toHaveText([
      "通用",
      "AI 服务",
      "当前电脑",
    ]);
    for (const label of ["深色", "浅色"]) {
      await settings
        .getByRole("combobox", { name: "外观", exact: true })
        .click();
      await page.getByRole("option", { name: label, exact: true }).click();
      const background = await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.getBackgroundColor(),
      );
      const rgb = background
        ?.match(/[a-f0-9]{2}/gi)
        ?.slice(0, 3)
        .map((part) => Number.parseInt(part, 16));
      await expect(
        page.locator('.workspace-panel[data-side="sidebar"]'),
      ).toHaveCSS("background-color", `rgb(${rgb?.join(", ")})`);
    }
    const nativeMenu = await desktop.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.items[0]?.submenu?.items.map(
        (item) => item.label,
      ),
    );
    expect(nativeMenu).toContain("连接其他电脑…");
    await desktop.evaluate(({ BrowserWindow }) => {
      for (const view of BrowserWindow.getAllWindows()[0]?.contentView
        .children ?? [])
        if ("webContents" in view)
          (view.webContents as import("electron").WebContents).setZoomFactor(2);
    });
    await expect(settings.getByRole("tablist")).toHaveAttribute(
      "data-orientation",
      "horizontal",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await captureWindow(
      desktop,
      page,
      testInfo.outputPath("settings-zoom.png"),
    );
    await desktop.close();
    desktop = await playwright._electron.launch({ executablePath, args, env });
    const reopened = await workspacePage(desktop);
    await desktop.evaluate(({ webContents }, url) => {
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL() === url)
        ?.setZoomFactor(1);
    }, reopened.url());
    await expect(
      reopened.getByRole("dialog", { name: "Bot详情", exact: true }),
    ).toBeHidden();
    await expect(
      reopened.getByRole("button", { name: "Bot详情" }),
    ).toBeVisible();
    expect(reopened.url()).toBe(`http://127.0.0.1:${ready.port}/`);
    await reopened
      .getByRole("button", { name: "用户菜单", exact: true })
      .click();
    await reopened.getByRole("menuitem", { name: "用量", exact: true }).click();
    await expect(
      reopened.getByRole("main", { name: "用量", exact: true }),
    ).toContainText("此范围还没有用量记录。");
    await reopened
      .getByRole("button", { name: "用户菜单", exact: true })
      .click();
    await reopened.getByRole("menuitem", { name: "用量", exact: true }).click();
    await expect(
      reopened.getByRole("button", { name: "Bot详情" }),
    ).toBeVisible();
    await reopened.locator('input[type="file"]').setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(
      reopened.locator(".composer-attachments .attachment"),
    ).toHaveCount(1);
    await reopened.getByLabel("消息", { exact: true }).fill("图片查看");
    await reopened.getByRole("button", { name: "发送", exact: true }).click();
    await reopened
      .getByLabel("你的消息", { exact: true })
      .getByRole("button", { name: "查看图片 photo.png", exact: true })
      .click();
    const viewer = reopened.getByRole("dialog", { name: "photo.png" });
    await expect(viewer).toBeVisible();
    await expect(viewer).toHaveCSS("scale", "1");
    const frame = await viewer.boundingBox();
    const viewport = await reopened.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    const bounds = {
      x: 0,
      y: 0,
      width: expect.closeTo(viewport.width, 0),
      height: expect.closeTo(viewport.height, 0),
    };
    expect(frame).toEqual(bounds);
    expect(
      await reopened.locator(".image-viewer-backdrop").boundingBox(),
    ).toEqual(bounds);
    const close = await viewer
      .getByRole("button", { name: "关闭弹窗", exact: true })
      .boundingBox();
    if (process.platform === "darwin") {
      expect(close?.x).toBeGreaterThan(80);
    } else {
      expect(close && close.x + close.width).toBeLessThanOrEqual(
        viewport.width - 144,
      );
    }
    await captureWindow(
      desktop,
      reopened,
      testInfo.outputPath("image-viewer-titlebar.png"),
    );
    await reopened.keyboard.press("Escape");
    const choosing = desktop.waitForEvent("window");
    await desktop.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()
        ?.items[0]?.submenu?.items.find(
          (item) => item.label === "连接其他电脑…",
        )
        ?.click(),
    );
    const chooser = await choosing;
    await expect(
      chooser.getByRole("heading", { name: "你的 Bot 在哪台电脑？" }),
    ).toBeVisible();
    await chooser
      .getByRole("button", { name: "连接另一台电脑", exact: true })
      .click();
    await chooser
      .getByRole("button", { name: "我的 Domos", exact: true })
      .click();
    await expect(chooser.getByLabel("Domos 地址")).toHaveValue(
      `http://127.0.0.1:${ready.port}`,
    );
  } finally {
    await desktop.close();
    const exited = once(worker, "exit");
    worker.disconnect();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
