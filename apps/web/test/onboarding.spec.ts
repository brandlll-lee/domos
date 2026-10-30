import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

async function capture(page: Page, info: TestInfo, name: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      const frame = page.locator(".setup-window");
      if (await frame.count()) {
        const box = await frame.boundingBox();
        expect(box?.y).toBe(0);
        expect(box?.height).toBe(900);
        await expect(page.locator(".setup-page")).toHaveCSS(
          "overflow-y",
          "auto",
        );
      }
      await page.screenshot({
        path: info.outputPath(`${name}-${colorScheme}-${width}.png`),
        animations: "disabled",
      });
    }
  }
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
}

test("first use prepares the default Bot with a computer and model before shared chat", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
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
      page.getByRole("heading", { name: "连接这个 Domos" }),
    ).toBeVisible();
    await capture(page, testInfo, "pairing");
    await page.getByLabel("配对码", { exact: true }).fill(ready.code);
    await page.route("**/hosting/exchange", (route) => route.abort());
    await page.getByRole("button", { name: "连接", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("配对码", { exact: true })).toHaveValue(
      ready.code,
    );
    await page.unroute("**/hosting/exchange");
    await page.getByRole("button", { name: "连接", exact: true }).click();
    const setup = page.getByRole("main", { name: "首次设置" });
    await expect(
      setup.getByRole("heading", { name: "Bot 在哪里工作？" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeHidden();
    await expect(
      setup.getByRole("textbox", { name: "名字", exact: true }),
    ).toHaveCount(0);
    await expect(
      setup.getByRole("textbox", { name: "职责与长期指令" }),
    ).toHaveCount(0);
    await expect(setup).toContainText("第 1 步，共 2 步");
    await capture(page, testInfo, "computer-setup");
    await page.setViewportSize({ width: 390, height: 600 });
    const next = setup.getByRole("button", { name: "授权并继续", exact: true });
    await next.scrollIntoViewIfNeeded();
    await expect(next).toBeInViewport();
    await page.setViewportSize({ width: 1360, height: 900 });
    const service = setup.getByRole("radio", { name: /^使用服务所在电脑/ });
    const title = await service.locator("strong").boundingBox();
    const description = await service
      .locator(".choice-description")
      .boundingBox();
    expect(description?.y).toBeGreaterThan(
      (title?.y ?? 0) + (title?.height ?? 0),
    );
    await page.screenshot({
      path: testInfo.outputPath("work-environment.png"),
    });
    await expect(
      setup.getByRole("heading", { name: "Bot 在哪里工作？" }),
    ).toBeVisible();
    await expect(
      setup.getByRole("radio", { name: /^共用一台隔离电脑/ }),
    ).toBeDisabled();
    await expect(
      setup.getByRole("button", { name: "返回", exact: true }),
    ).toHaveCount(0);
    await expect(service).toBeChecked();
    await page.route("**/rpc/computer/configure", (route) => route.abort());
    await setup
      .getByRole("button", { name: "授权并继续", exact: true })
      .click();
    await expect(setup.getByRole("alert")).toBeVisible();
    await expect(setup).toBeVisible();
    await page.unroute("**/rpc/computer/configure");
    await setup
      .getByRole("button", { name: "授权并继续", exact: true })
      .click();
    await expect(
      setup.getByRole("heading", { name: "选择对话模型" }),
    ).toBeVisible();
    await expect(
      setup.getByRole("button", { name: "开始", exact: true }),
    ).toBeDisabled();
    await setup.getByRole("button", { name: "返回", exact: true }).click();
    await expect(service).toBeChecked();
    await setup
      .getByRole("button", { name: "授权并继续", exact: true })
      .click();
    await setup.getByRole("combobox", { name: "模型", exact: true }).click();
    await page
      .getByRole("option", { name: "Pi · Faux Model", exact: true })
      .click();
    await capture(page, testInfo, "model-setup");
    await setup.getByRole("button", { name: "开始", exact: true }).click();
    await expect(setup).toBeHidden();
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("开始工作");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByRole("log", { name: "聊天记录" })).toContainText(
      "模型已回复。",
    );
    await page.reload();
    await expect(setup).toBeHidden();
    await expect(page.getByRole("log", { name: "聊天记录" })).toContainText(
      "开始工作",
    );
    const remote = await browser.newContext();
    try {
      const second = await remote.newPage();
      await second.goto(`http://127.0.0.1:${ready.port}`);
      await second.getByLabel("配对码", { exact: true }).fill(ready.clientCode);
      await second.getByRole("button", { name: "连接", exact: true }).click();
      await expect(second.getByRole("log", { name: "聊天记录" })).toContainText(
        "模型已回复。",
      );
      await second
        .getByRole("button", { name: "新建 Bot", exact: true })
        .click();
      const create = second.getByRole("dialog", {
        name: "新建 Bot",
        exact: true,
      });
      await create.getByLabel("名字", { exact: true }).fill("资料伙伴");
      await create.getByRole("button", { name: "创建", exact: true }).click();
      await create
        .getByRole("button", { name: "授权并继续", exact: true })
        .click();
      await create.getByRole("combobox", { name: "模型", exact: true }).click();
      await second
        .getByRole("option", { name: "Pi · Faux Model", exact: true })
        .click();
      await create.getByRole("button", { name: "开始", exact: true }).click();
      await expect(create).toBeHidden();
      await expect(second.getByLabel("消息", { exact: true })).toHaveAttribute(
        "placeholder",
        "发送消息给 资料伙伴…",
      );
    } finally {
      await remote.close();
    }
    await page.screenshot({ path: testInfo.outputPath("configured.png") });
  } finally {
    const exited = once(worker, "exit");
    worker.disconnect();
    await exited;
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
});
