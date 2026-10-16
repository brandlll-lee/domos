import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("desktop connects, pairs and restores a saved instance with isolated browser permissions", async ({
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
    const setup = await desktop.firstWindow();
    await expect(
      setup.getByRole("heading", { name: "让 Bot 开始工作" }),
    ).toBeVisible();
    const listener = createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const address = listener.address();
    if (!address || typeof address === "string")
      throw new Error("Port required");
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    const config = join(directory, "runtime.json");
    await writeFile(
      config,
      JSON.stringify({
        port: address.port,
        dataDir: join(directory, "runtime-data"),
      }),
    );
    await desktop.evaluate(
      ({ utilityProcess }, { entry, config }) => {
        const child = utilityProcess.fork(entry, [], {
          env: { ...process.env, DOMOS_CONFIG: config },
          stdio: "pipe",
        });
        child.stdout?.resume();
        child.stderr?.resume();
        Reflect.set(globalThis, "runtimeUnderTest", child);
      },
      {
        entry: fileURLToPath(new URL("../runtime/server.mjs", import.meta.url)),
        config,
      },
    );
    await expect
      .poll(async () => {
        try {
          return (await fetch(`http://127.0.0.1:${address.port}/hosting/info`))
            .status;
        } catch {
          return 0;
        }
      })
      .toBe(200);
    await desktop.evaluate(async () => {
      const child = Reflect.get(globalThis, "runtimeUnderTest");
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.postMessage("shutdown");
      });
    });
    await setup.getByRole("radio", { name: /连接已有 Domos/ }).check();
    await setup.getByLabel("服务器地址").fill(`http://127.0.0.1:${ready.port}`);
    const opened = desktop.waitForEvent("window");
    await setup.getByRole("button", { name: "继续", exact: true }).click();
    const page = await opened;
    await expect(
      page.getByRole("heading", { name: "连接这个 Domos" }),
    ).toBeVisible();
    await page.getByLabel("配对码", { exact: true }).fill(ready.pairing);
    await page.getByRole("button", { name: "连接", exact: true }).click();
    await expect(page.getByRole("button", { name: "管理实例" })).toBeVisible();
    expect(
      await page.evaluate(() => ({
        require: typeof Reflect.get(window, "require"),
        ipc: typeof Reflect.get(window, "domos"),
      })),
    ).toEqual({ require: "undefined", ipc: "undefined" });
    await page.screenshot({ path: testInfo.outputPath("connected.png") });
    await desktop.close();
    desktop = await playwright._electron.launch({ executablePath, args, env });
    const reopened = await desktop.firstWindow();
    await expect(
      reopened.getByRole("button", { name: "管理实例" }),
    ).toBeVisible();
    expect(reopened.url()).toBe(`http://127.0.0.1:${ready.port}/`);
  } finally {
    await desktop.close();
    worker.disconnect();
    await once(worker, "exit");
    await rm(directory, { recursive: true, force: true });
  }
});
