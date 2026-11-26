import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { workspacePage } from "./pages.ts";

test("desktop notification IPC preserves workspace identity and unread counts", async ({
  playwright,
}) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), "domos-notifications-"));
  const servers = await Promise.all(
    ["a", "b"].map(async (name) => {
      const folder = join(directory, name);
      await mkdir(folder);
      const worker = fork(
        fileURLToPath(
          new URL("../../api/test/fixtures/web-server.ts", import.meta.url),
        ),
        [join(folder, "agent.sqlite"), "0", "hosting"],
        { silent: true, execArgv: [] },
      );
      worker.stderr?.resume();
      worker.stdout?.resume();
      const [ready] = await Promise.race([
        once(worker, "message"),
        once(worker, "exit").then(() => {
          throw new Error("Server exited");
        }),
      ]);
      return {
        worker,
        origin: `http://127.0.0.1:${ready.port}`,
        pairing: ready.pairing as string,
      };
    }),
  );
  const a = servers[0],
    b = servers[1];
  assert(a && b);
  const profile = join(directory, "profile");
  await mkdir(profile);
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const instances = servers.map((server, index) => ({
    id: ids[index],
    name: `电脑 ${index ? "B" : "A"}`,
    mode: "existing",
    url: server.origin,
  }));
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
  const desktop = await playwright._electron.launch({
    executablePath: createRequire(new URL("../package.json", import.meta.url))(
      "electron",
    ) as string,
    args: [
      fileURLToPath(new URL("./entry.mjs", import.meta.url)),
      `--test-data-dir=${profile}`,
    ],
    env,
  });
  try {
    let page = await workspacePage(desktop, a.origin);
    await page.getByLabel("配对码", { exact: true }).fill(a.pairing);
    await page.getByRole("button", { name: "确认配对", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeEnabled();
    const receipt = once(a.worker, "message");
    a.worker.send({
      records: [
        {
          id: "report",
          role: "assistant",
          stopped: false,
          content: [{ type: "text", key: "report", text: "报告已整理好" }],
        },
      ],
    });
    await receipt;
    await expect(page.locator('[data-message-id="report"]')).toBeVisible();
    await expect(page.locator(".contact-row .unread-badge")).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(localStorage).some(
            (key) =>
              key.startsWith("domos:attention:") &&
              Object.keys(
                JSON.parse(localStorage.getItem(key) ?? "{}").read ?? {},
              ).length > 0,
          ),
        ),
      )
      .toBe(true);
    const target = await page
      .locator('[data-message-id="report"]')
      .evaluate((node) => ({
        messageId: (node as HTMLElement).dataset.messageId ?? "",
        sessionId: Number((node as HTMLElement).dataset.sessionId),
      }));
    await desktop.evaluate(({ Notification }) => {
      Reflect.set(globalThis, "notices", []);
      Notification.isSupported = () => true;
      Notification.prototype.show = function () {
        Reflect.get(globalThis, "notices").push(this);
        this.emit("show");
      };
    });
    const invalid = await page.evaluate(() =>
      window.domosDesktop?.notify({
        sequence: 1,
        chat: "https://example.com",
        botId: 1,
        sessionId: 1,
        messageId: "report",
        title: "Domos",
        body: "报告",
      }),
    );
    expect(invalid?.ok).toBe(false);
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.minimize(),
    );
    await expect
      .poll(() =>
        desktop.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isMinimized(),
        ),
      )
      .toBe(true);
    const shown = await page.evaluate(
      (target) =>
        window.domosDesktop?.notify({
          ...target,
          botId: target.sessionId,
          chat: `bot/${target.sessionId}`,
          sequence: 99,
          title: "Domos",
          body: "报告已整理好",
        }),
      target,
    );
    expect(shown?.value?.shown).toBe(true);
    await desktop.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.restore();
      BrowserWindow.getAllWindows()[0]?.focus();
    });
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(profile, "attention.json"), "utf8"))[
            String(ids[0])
          ],
      )
      .toBe(0);
    await page.evaluate(() => window.domosDesktop?.unread(7));
    expect(
      JSON.parse(await readFile(join(profile, "attention.json"), "utf8"))[
        String(ids[0])
      ],
    ).toBe(7);
    await page.getByRole("button", { name: /^切换电脑：/ }).click();
    await page.getByRole("menuitem", { name: "电脑 B", exact: true }).click();
    page = await workspacePage(desktop, b.origin);
    await page.getByLabel("配对码", { exact: true }).fill(b.pairing);
    await page.getByRole("button", { name: "确认配对", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeEnabled();
    const state = await page.evaluate(() => window.domosDesktop?.state());
    expect(
      state?.value?.instances.find((item) => item.id === ids[0])?.unread,
    ).toBe(7);
    await expect(page.locator(".environment-trigger .unread-badge")).toHaveText(
      "7",
    );
    await desktop.evaluate(() =>
      Reflect.get(globalThis, "notices")[0].emit("click"),
    );
    page = await workspacePage(desktop, a.origin);
    await expect(page.locator('[data-message-id="report"]')).toBeInViewport();
    expect(
      (await page.evaluate(() => window.domosDesktop?.state()))?.value
        ?.selected,
    ).toBe(ids[0]);
  } finally {
    await desktop.close();
    for (const { worker } of servers) {
      const done = once(worker, "exit");
      worker.kill("SIGKILL");
      await done;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
