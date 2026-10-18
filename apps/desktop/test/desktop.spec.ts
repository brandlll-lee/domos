import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("native setup starts and resumes with Docker unavailable", async ({
  playwright,
}, testInfo) => {
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
      setup.getByRole("heading", { name: "欢迎使用 Domos" }),
    ).toBeVisible();
    await desktop.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "dark";
    });
    await setup.emulateMedia({ colorScheme: "dark" });
    await expect(setup.locator("body")).toHaveCSS(
      "background-color",
      "rgb(12, 12, 13)",
    );
    await setup.screenshot({
      path: testInfo.outputPath("service-choice-dark.png"),
    });
    await desktop.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "light";
    });
    await setup.emulateMedia({ colorScheme: "light" });
    await expect(setup.locator("body")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await setup.screenshot({
      path: testInfo.outputPath("service-choice-light.png"),
    });
    await setup.getByLabel("在 Docker 中运行", { exact: false }).check();
    await setup.getByRole("button", { name: "继续", exact: true }).click();
    await expect(setup.getByRole("alert")).toContainText("Docker Desktop");
    await setup.getByLabel("直接运行", { exact: false }).check();
    const opened = desktop.waitForEvent("window");
    await setup.getByRole("button", { name: "继续", exact: true }).click();
    const page = await opened;
    await expect(
      page.getByRole("heading", { name: "认识你的第一个 Bot" }),
    ).toBeVisible();
    const origin = new URL(page.url()).origin;
    await desktop.close();
    desktop = await playwright._electron.launch({ executablePath, args, env });
    const resumed = await desktop.waitForEvent("window", {
      predicate: (window) => window.url().startsWith(origin),
    });
    await expect(
      resumed.getByRole("heading", { name: "认识你的第一个 Bot" }),
    ).toBeVisible();
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
      setup.getByRole("heading", { name: "欢迎使用 Domos" }),
    ).toBeVisible();
    await setup.getByLabel("连接已有 Domos", { exact: false }).check();
    await setup.getByLabel("服务器地址").fill(`http://127.0.0.1:${ready.port}`);
    const opened = desktop.waitForEvent("window");
    await setup.getByRole("button", { name: "继续", exact: true }).click();
    const page = await opened;
    await expect(
      page.getByRole("heading", { name: "连接这个 Domos" }),
    ).toBeVisible();
    await page.getByLabel("配对码", { exact: true }).fill(ready.pairing);
    await page.getByRole("button", { name: "连接", exact: true }).click();
    await expect(page.getByRole("button", { name: "Bot详情" })).toBeVisible();
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
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("main", { name: "设置", exact: true });
    await expect(settings.getByRole("tab")).toHaveCount(2);
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
      await expect(page.locator(".app-titlebar")).toHaveCSS(
        "background-color",
        `rgb(${rgb?.join(", ")})`,
      );
    }
    const nativeMenu = await desktop.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.items[0]?.submenu?.items.map(
        (item) => item.label,
      ),
    );
    expect(nativeMenu).toContain("连接其他 Domos…");
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(2),
    );
    await expect(settings.getByRole("tablist")).toHaveAttribute(
      "data-orientation",
      "horizontal",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("settings-zoom.png") });
    await desktop.close();
    desktop = await playwright._electron.launch({ executablePath, args, env });
    const reopened = await desktop.firstWindow();
    await expect(
      reopened.getByRole("button", { name: "Bot详情" }),
    ).toBeVisible();
    expect(reopened.url()).toBe(`http://127.0.0.1:${ready.port}/`);
    const choosing = desktop.waitForEvent("window");
    await desktop.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()
        ?.items[0]?.submenu?.items.find(
          (item) => item.label === "连接其他 Domos…",
        )
        ?.click(),
    );
    const chooser = await choosing;
    await expect(
      chooser.getByRole("heading", { name: "欢迎使用 Domos" }),
    ).toBeVisible();
  } finally {
    await desktop.close();
    const exited = once(worker, "exit");
    worker.disconnect();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
