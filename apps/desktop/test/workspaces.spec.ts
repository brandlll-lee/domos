import { execFile, fork } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { workspacePage } from "./pages.ts";

test("workspaces switch in one window and preserve identity, authorization and reading state", async ({
  playwright,
}, info) => {
  test.setTimeout(150_000);
  const directory = await mkdtemp(join(tmpdir(), "domos-workspaces-"));
  const servers = await Promise.all(
    ["a", "b"].map(async (name) => {
      const serverDirectory = join(directory, name);
      await mkdir(serverDirectory);
      const worker = fork(
        fileURLToPath(
          new URL("../../api/test/fixtures/web-server.ts", import.meta.url),
        ),
        [join(serverDirectory, "agent.sqlite"), "0", "hosting"],
        { silent: true, execArgv: [] },
      );
      worker.stdout?.resume();
      worker.stderr?.on("data", (data) => console.error(String(data)));
      const [ready] = (await once(worker, "message")) as [
        { port: number; pairing: string },
      ];
      return { worker, ...ready, origin: `http://127.0.0.1:${ready.port}` };
    }),
  );
  const [a, b] = servers;
  if (!a || !b) throw new Error("Servers missing");
  const profile = join(directory, "profile");
  await mkdir(profile);
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const instances = [
    { id: ids[0], name: "电脑 A", mode: "existing", url: a.origin },
    { id: ids[1], name: "电脑 B", mode: "existing", url: b.origin },
    {
      id: ids[2],
      name: "离线电脑",
      mode: "existing",
      url: "http://127.0.0.1:1",
    },
  ];
  await writeFile(
    join(profile, "instances.json"),
    JSON.stringify({ instances, selected: ids[0] }),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
    ),
  );
  const launch = () =>
    playwright._electron.launch({
      executablePath: createRequire(
        new URL("../package.json", import.meta.url),
      )("electron") as string,
      args: [
        fileURLToPath(new URL("./entry.mjs", import.meta.url)),
        `--test-data-dir=${profile}`,
      ],
      env,
    });
  let desktop = await launch();
  const selected = async () =>
    JSON.parse(await readFile(join(profile, "instances.json"), "utf8"))
      .selected;
  const pair = async (page: Page, code: string) => {
    await page.getByLabel("配对码", { exact: true }).fill(code);
    await page.getByRole("button", { name: "确认配对", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Bot详情", exact: true }),
    ).toBeVisible();
  };
  const choose = async (page: Page, name: string) => {
    await page.getByRole("button", { name: /^切换电脑：/ }).click();
    await page
      .getByRole("menuitem", { name, exact: true })
      .click()
      .catch((error) => {
        if (!page.isClosed()) throw error;
      });
  };
  try {
    let pageA = await workspacePage(desktop, a.origin);
    await pair(pageA, a.pairing);
    const windowId = await desktop.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.id,
    );
    await expect.poll(selected).toBe(ids[0]);
    const state = await pageA.evaluate(() => window.domosDesktop?.state());
    expect(state?.value?.instances.every((item) => !("url" in item))).toBe(
      true,
    );
    await choose(pageA, "离线电脑");
    await expect(
      pageA.getByRole("alert", { name: "fetch failed", exact: true }),
    ).toBeVisible();
    expect(await selected()).toBe(ids[0]);
    await expect(
      pageA.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeEnabled();
    await choose(pageA, "电脑 B");
    let pageB = await workspacePage(desktop, b.origin);
    await expect(pageB.getByLabel("配对码", { exact: true })).toBeVisible();
    expect(await selected()).toBe(ids[0]);
    await pageB
      .getByRole("button", { name: "返回", exact: true })
      .click()
      .catch((error) => {
        if (!pageB.isClosed()) throw error;
      });
    await expect.poll(() => pageB.isClosed()).toBe(true);
    await expect(
      pageA.getByRole("button", { name: /^切换电脑：/ }),
    ).toContainText("电脑 A");
    await choose(pageA, "电脑 B");
    pageB = await workspacePage(desktop, b.origin);
    await pair(pageB, b.pairing);
    await expect.poll(() => pageA.isClosed()).toBe(true);
    expect(await selected()).toBe(ids[1]);
    await pageB
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("B 的草稿");
    await choose(pageB, "电脑 A");
    pageA = await workspacePage(desktop, a.origin);
    await expect(
      pageA.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeEmpty();
    await expect.poll(() => pageB.isClosed()).toBe(true);
    await desktop.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setBounds({ x: 40, y: 40, width: 1200, height: 800 });
      window?.setAlwaysOnTop(true);
      window?.show();
      window?.focus();
    });
    await expect.poll(() => pageA.evaluate(() => innerWidth)).toBe(1200);
    const seeded = once(a.worker, "message");
    a.worker.send({ history: 60 });
    await seeded;
    await expect(pageA.getByLabel("你的消息").last()).toContainText(
      "历史任务 60",
    );
    await pageA
      .locator("#bot-details")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await pageA
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("A 的草稿");
    expect(
      await pageA.evaluate(() => window.domosDesktop!.maintain("compact")),
    ).toMatchObject({
      ok: false,
      error: "请先打开本机 Domos，再管理本机托管。",
    });

    await pageA.locator(".transcript").evaluate((node) => {
      node.scrollTop = node.scrollHeight / 2;
    });
    const anchor = await pageA.locator(".transcript").evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const row = Array.from(
        node.querySelectorAll<HTMLElement>("[data-transcript-key]"),
      ).find((row) => row.getBoundingClientRect().bottom > bounds.top + 2);
      if (!row) throw new Error("Reading anchor missing");
      return {
        key: row.dataset.transcriptKey,
        offset: row.getBoundingClientRect().top - bounds.top,
      };
    });
    for (const theme of ["light", "dark"] as const) {
      await pageA.emulateMedia({ colorScheme: theme });
      const trigger = pageA.getByRole("button", { name: /^切换电脑：/ });
      await trigger.click();
      const menu = pageA.getByRole("menu", { name: "切换电脑", exact: true });
      await expect(menu).toHaveCSS("width", "340px");
      const current = menu.getByRole("menuitem", {
        name: "电脑 A",
        exact: true,
      });
      await expect(current).toHaveAttribute("aria-current", "page");
      await expect(current).toHaveCSS("opacity", "1");
      await expect(current).toBeEnabled();
      if (process.platform === "win32") {
        const native = await desktop.evaluate(({ BrowserWindow }, url) => {
          const window = BrowserWindow.getAllWindows().find((window) =>
            window.contentView.children.some(
              (view) =>
                "webContents" in view &&
                (
                  view.webContents as import("electron").WebContents
                ).getURL() === url,
            ),
          );
          if (!window) throw new Error("Workspace window missing");
          const view = window.contentView.children.find(
            (view) =>
              "webContents" in view &&
              (view.webContents as import("electron").WebContents).getURL() ===
                url,
          );
          return {
            handle: window.getNativeWindowHandle().readBigUInt64LE().toString(),
            view: view?.getBounds() ?? { x: 0, y: 0 },
          };
        }, pageA.url());
        const points = await menu.getByRole("menuitem").evaluateAll(
          (items, offset) =>
            items.map((item) => {
              const box = item.getBoundingClientRect();
              return {
                x: Math.round(
                  (offset.x + box.x + box.width / 2) * devicePixelRatio,
                ),
                y: Math.round(
                  (offset.y + box.y + box.height / 2) * devicePixelRatio,
                ),
              };
            }),
          native.view,
        );
        const invoke = async (click = false) => {
          const { stdout } = await promisify(execFile)(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-File",
              fileURLToPath(
                new URL("./fixtures/menu-input.ps1", import.meta.url),
              ),
              "-Window",
              native.handle,
              "-Points",
              JSON.stringify(points),
              ...(click ? ["-Click"] : []),
            ],
            { windowsHide: true },
          );
          return JSON.parse(stdout) as { hit: number }[];
        };
        const probes = await invoke();
        expect(probes.every((point) => point.hit === 1)).toBe(true);
        await expect(current).toHaveAttribute("data-highlighted");
        await invoke(true);
        await expect(menu).toBeHidden();
      } else await current.click();
      expect(await selected()).toBe(ids[0]);
      await trigger.click();
      await expect(
        pageA.getByRole("menuitem", { name: "电脑 B", exact: true }),
      ).toBeVisible();
      await expect(menu).toHaveCSS("opacity", "1");
      await pageA.screenshot({
        path: info.outputPath(`workspace-menu-${theme}.png`),
      });
      await pageA.keyboard.press("Escape");
    }
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setAlwaysOnTop(false),
    );
    await choose(pageA, "电脑 B");
    pageB = await workspacePage(desktop, b.origin);
    await expect(
      pageB.getByRole("textbox", { name: "消息", exact: true }),
    ).toHaveText("B 的草稿");
    await desktop.context().addInitScript(() => {
      const times: number[] = [];
      Reflect.set(window, "workspaceFrames", times);
      const sample = (time: number) => {
        if (document.querySelector(".workspace") && !document.hidden)
          times.push(time);
        if (times.length < 31) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const started = performance.now();
    await choose(pageB, "电脑 A");
    pageA = await workspacePage(desktop, a.origin);
    await expect(
      pageA.getByRole("textbox", { name: "消息", exact: true }),
    ).toHaveText("A 的草稿");
    const switchMs = performance.now() - started;
    await pageA.waitForFunction(
      () => Reflect.get(window, "workspaceFrames")?.length === 31,
    );
    const frames = await pageA.evaluate(() => {
      const times: number[] = Reflect.get(window, "workspaceFrames");
      const gaps = times
        .slice(1)
        .map((time, index) => time - (times[index] ?? time))
        .sort((a, b) => a - b);
      return {
        count: gaps.length,
        p95: gaps[Math.floor(gaps.length * 0.95)] ?? 0,
        max: gaps.at(-1) ?? 0,
      };
    });
    await info.attach("workspace-timing", {
      body: JSON.stringify({ switchMs, frames }),
      contentType: "application/json",
    });
    console.log(
      `Workspace switch timing: ${JSON.stringify({ switchMs, frames })}`,
    );
    expect(switchMs).toBeLessThan(5000);
    expect(frames.p95).toBeLessThan(50);
    expect(frames.max).toBeLessThan(250);
    await expect(pageA.locator("#bot-details")).toBeHidden();
    await expect
      .poll(async () =>
        pageA
          .locator(`[data-transcript-key="${anchor.key}"]`)
          .evaluate(
            (row) =>
              row.getBoundingClientRect().top -
              (row.closest(".transcript")?.getBoundingClientRect().top ?? 0),
          ),
      )
      .toBeCloseTo(anchor.offset, 0);
    expect(
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((window) => ({
          id: window.id,
          views: window.contentView.children.length,
        })),
      ),
    ).toEqual([{ id: windowId, views: 1 }]);
    const delayed = Promise.withResolvers<void>();
    const requested = Promise.withResolvers<void>();
    await desktop
      .context()
      .route(`${b.origin}/hosting/session`, async (route) => {
        requested.resolve();
        await delayed.promise;
        await route.continue().catch(() => {});
      });
    await choose(pageA, "电脑 B");
    await requested.promise;
    await choose(pageA, "离线电脑");
    delayed.resolve();
    await expect(
      pageA.getByRole("alert", { name: "fetch failed", exact: true }),
    ).toBeVisible();
    expect(await selected()).toBe(ids[0]);
    await desktop.context().unroute(`${b.origin}/hosting/session`);
    const before = await selected();
    const config = join(profile, "instances.json");
    await rename(config, `${config}.saved`);
    await mkdir(config);
    await choose(pageA, "电脑 B");
    await expect(
      pageA.getByRole("alert").filter({ hasText: "instances.json" }),
    ).toBeVisible();
    await expect(
      pageA.getByRole("textbox", { name: "消息", exact: true }),
    ).toHaveText("A 的草稿");
    await rm(config, { recursive: true });
    await rename(`${config}.saved`, config);
    expect(await selected()).toBe(before);
    await pageA.getByRole("button", { name: "用户菜单", exact: true }).click();
    await expect(
      pageA.getByRole("menuitem", { name: "切换电脑", exact: true }),
    ).toHaveCount(0);
    await pageA.getByRole("menuitem", { name: "设置", exact: true }).click();
    const settings = pageA.getByRole("main", { name: "设置", exact: true });
    await expect(settings.getByRole("tab")).toHaveText([
      "通用",
      "AI 服务",
      "当前电脑",
    ]);
    await settings.getByRole("tab", { name: "当前电脑", exact: true }).click();
    await expect(
      settings.getByRole("button", { name: /^设备访问/ }),
    ).toBeVisible();
    await pageA.screenshot({ path: info.outputPath("current-computer.png") });
    await pageA.getByRole("button", { name: "关闭设置", exact: true }).click();
    await pageA.getByRole("button", { name: /^切换电脑：/ }).click();
    await pageA
      .getByRole("menuitem", { name: "管理连接", exact: true })
      .click();
    await desktop.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    const connections = pageA.getByRole("dialog", {
      name: "电脑连接",
      exact: true,
    });
    await connections
      .locator(".setting-row")
      .filter({ hasText: "电脑 B" })
      .getByRole("button", { name: "移除连接", exact: true })
      .click();
    await expect(connections.getByText("电脑 B", { exact: true })).toHaveCount(
      0,
    );
    await connections
      .getByRole("button", { name: "完成", exact: true })
      .click();
    expect(await selected()).toBe(ids[0]);
    const opening = desktop.waitForEvent("window");
    await pageA.getByRole("button", { name: /^切换电脑：/ }).click();
    await pageA
      .getByRole("menuitem", { name: "连接其他电脑…", exact: true })
      .click();
    const setup = await opening;
    await setup.getByLabel("电脑地址", { exact: true }).fill(b.origin);
    await setup.getByRole("button", { name: "连接电脑", exact: true }).click();
    pageB = await workspacePage(desktop, b.origin);
    await expect.poll(() => setup.isClosed()).toBe(true);
    await expect(
      pageB.getByRole("textbox", { name: "消息", exact: true }),
    ).toHaveText("B 的草稿");
    await choose(pageB, "电脑 A");
    pageA = await workspacePage(desktop, a.origin);
    await expect(
      pageA.getByRole("textbox", { name: "消息", exact: true }),
    ).toHaveText("A 的草稿");
    await desktop.close();
    desktop = await launch();
    pageA = await workspacePage(desktop, a.origin);
    await expect(
      pageA.getByRole("textbox", { name: "消息", exact: true }),
    ).toHaveText("A 的草稿");
    expect(await selected()).toBe(ids[0]);
    await desktop.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(420, 760);
    });
    await pageA.getByRole("button", { name: "联系人", exact: true }).click();
    const compactMenu = pageA.getByRole("button", { name: /^切换电脑：/ });
    await compactMenu.focus();
    await compactMenu.press("Enter");
    await expect(
      pageA.getByRole("menuitem", { name: "我的 Domos", exact: true }),
    ).toBeVisible();
    const narrowMenu = pageA.getByRole("menu", {
      name: "切换电脑",
      exact: true,
    });
    const bounds = await narrowMenu.boundingBox();
    expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 420).toBe(
      true,
    );
    await pageA.screenshot({ path: info.outputPath("workspace-narrow.png") });
    await pageA.keyboard.press("Escape");
    await expect(compactMenu).toBeFocused();
    expect(
      await pageA.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await desktop.close();
    for (const { worker } of servers) {
      if (worker.exitCode !== null || worker.signalCode !== null) continue;
      const exited = once(worker, "exit");
      worker.disconnect();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
