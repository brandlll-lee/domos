import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("first use pairs, authorizes, logs in, saves a model and enters chat", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), "domos-onboarding-web-"));
  const worker = fork(
    fileURLToPath(
      new URL("../../api/test/fixtures/onboarding-server.ts", import.meta.url),
    ),
    [join(directory, "data")],
    { silent: true, execArgv: [] },
  );
  worker.stdout?.resume();
  worker.stderr?.resume();
  try {
    const [ready] = (await once(worker, "message")) as [
      { port: number; code: string; clientCode: string },
    ];
    await page.route("**/rpc/engines/{get,configure}", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.json.prepared = false;
      await route.fulfill({ response, json: body });
    });
    await page.goto(`http://127.0.0.1:${ready.port}`);
    await expect(
      page.getByRole("heading", { name: "确认要连接的电脑" }),
    ).toBeVisible();
    await expect(page.locator(".remote-computer")).toBeVisible();
    await page.getByLabel("配对码", { exact: true }).fill(ready.code);
    await page.route("**/hosting/exchange", (route) => route.abort());
    await page.getByRole("button", { name: "确认配对", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("配对码", { exact: true })).toHaveValue(
      ready.code,
    );
    await page.unroute("**/hosting/exchange");
    await page.getByRole("button", { name: "确认配对", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "让伙伴在这台电脑工作" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeHidden();
    const deferred = await browser.newContext({
      storageState: await page.context().storageState(),
    });
    try {
      const second = await deferred.newPage();
      await second.goto(page.url());
      await second
        .getByRole("button", { name: "稍后设置", exact: true })
        .click();
      await expect(
        second.getByRole("textbox", { name: "消息", exact: true }),
      ).toBeVisible();
      await second.reload();
      await expect(
        second.getByRole("textbox", { name: "消息", exact: true }),
      ).toBeVisible();
    } finally {
      await deferred.close();
    }
    await page.route("**/rpc/computer/authorize", (route) => route.abort());
    await page.getByRole("button", { name: "授权并继续", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.unroute("**/rpc/computer/authorize");
    await page.getByRole("button", { name: "授权并继续", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "接入你使用的 AI" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "让伙伴在这台电脑工作" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "授权并继续", exact: true }).click();
    await expect(page.locator(".harness-card")).toHaveCount(8);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const width of [1200, 360]) {
        await page.setViewportSize({ width, height: 820 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath(`ai-${colorScheme}-${width}.png`),
        });
      }
    }
    await page.setViewportSize({ width: 1200, height: 820 });
    const connection = {
      ready: false,
      authenticated: false,
      models: [],
      version: null,
      path: null,
      message: "需要下载程序",
    };
    await page.route("**/rpc/engines/inspect", (route) =>
      route.request().postDataJSON().json.config?.provider === "codex"
        ? route.fulfill({ json: { json: connection } })
        : route.continue(),
    );
    await page.getByRole("button", { name: /^Codex/ }).click();
    await expect(page.locator(".remote-harness .engine-mark")).toHaveAttribute(
      "data-provider",
      "codex",
    );
    await page.route("**/rpc/engines/install", (route) => route.abort());
    await page.getByRole("button", { name: "下载并继续", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.unroute("**/rpc/engines/install");
    connection.ready = true;
    await page.route("**/rpc/engines/install", (route) =>
      route.fulfill({
        json: {
          json: { config: { provider: "codex", model: null }, connection },
        },
      }),
    );
    await page.getByRole("button", { name: "下载并继续", exact: true }).click();
    const login = {
      state: "waiting",
      url: null,
      code: null,
      prompt: null,
      instructions: "请在浏览器中完成登录。",
    };
    await page.route("**/rpc/engines/{login,loginState}", (route) =>
      route.fulfill({ json: { json: login } }),
    );
    await page.route("**/rpc/engines/cancelLogin", (route) =>
      route.fulfill({ json: { json: null } }),
    );
    await page.getByRole("button", { name: "打开登录", exact: true }).click();
    await expect(page.getByText("等待登录…", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await page.getByRole("button", { name: /^Pi/ }).click();
    await expect(
      page.getByRole("heading", { name: "选择第一个模型" }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("combobox", { name: "使用模型", exact: true }).click();
    await page.getByRole("option", { name: "Faux Model", exact: true }).click();
    await page.route("**/rpc/engines/configure", (route) => route.abort());
    await page.getByRole("button", { name: "保存并继续", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "选择第一个模型" }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "使用模型", exact: true }),
    ).toContainText("Faux Model");
    await page.unroute("**/rpc/engines/configure");
    await page.getByRole("button", { name: "保存并继续", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "你的伙伴准备好了" }),
    ).toBeVisible();
    await expect(page.locator(".ready-computer")).toBeVisible();
    await expect(
      page.locator(".ready-foreground .character-body"),
    ).toBeVisible();
    await page.getByRole("button", { name: "开始聊天", exact: true }).click();
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("开始工作");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByRole("log", { name: "聊天记录" })).toContainText(
      "模型已回复。",
    );
    await page.reload();
    await expect(page.getByRole("log", { name: "聊天记录" })).toContainText(
      "开始工作",
    );
    await expect(page.locator(".startup-pages")).toHaveCount(0);
  } finally {
    const exited = once(worker, "exit");
    worker.disconnect();
    await exited;
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
});
