import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("desktop starts locally, pairs and restores a saved instance", async ({
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
  let desktop = await playwright._electron.launch({
    executablePath,
    args,
    env,
  });
  try {
    const local = await desktop.firstWindow();
    await expect(local.getByRole("button", { name: "Bot详情" })).toBeVisible();
    expect(new URL(local.url()).hostname).toBe("127.0.0.1");
    expect(new URL(local.url()).hash).toBe("");
    await expect(
      local.getByText("暂不分配电脑", { exact: true }),
    ).toBeVisible();
    expect(
      await desktop.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window) throw new Error("Desktop window missing");
        const cookies = await window.webContents.session.cookies.get({
          name: "domos_session",
        });
        return cookies.some((cookie) => cookie.httpOnly);
      }),
    ).toBe(true);
    await local.getByRole("button", { name: "新建 Bot" }).first().click();
    await local
      .getByRole("textbox", { name: "名字", exact: true })
      .fill("Local Writer");
    await local.getByRole("button", { name: "创建", exact: true }).click();
    await expect(local.getByRole("button", { name: "Bot详情" })).toContainText(
      "Local Writer",
    );
    await local
      .getByRole("button", { name: "设置", exact: true })
      .first()
      .click();
    const settings = local.getByRole("complementary", {
      name: "设置",
      exact: true,
    });
    await settings.getByRole("button", { name: "实例", exact: true }).click();
    await settings
      .getByLabel("服务器地址")
      .fill(`http://127.0.0.1:${ready.port}`);
    const opened = desktop.waitForEvent("window");
    await settings
      .getByRole("button", { name: "连接已有 Domos", exact: true })
      .click();
    const page = await opened;
    await expect(
      page.getByRole("heading", { name: "连接这个 Domos" }),
    ).toBeVisible();
    await page.getByLabel("配对码", { exact: true }).fill(ready.pairing);
    await page.getByRole("button", { name: "连接", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "设置", exact: true }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(() => ({
        require: typeof Reflect.get(window, "require"),
        ipc: typeof Reflect.get(window, "domosDesktop"),
      })),
    ).toEqual({ require: "undefined", ipc: "object" });
    await page.screenshot({ path: testInfo.outputPath("connected.png") });
    await desktop.close();
    desktop = await playwright._electron.launch({ executablePath, args, env });
    const reopened = await desktop.firstWindow();
    await expect(
      reopened.getByRole("button", { name: "设置", exact: true }).first(),
    ).toBeVisible();
    expect(reopened.url()).toBe(`http://127.0.0.1:${ready.port}/`);
  } finally {
    await desktop.close();
    worker.disconnect();
    await once(worker, "exit");
    await rm(directory, { recursive: true, force: true });
  }
});
