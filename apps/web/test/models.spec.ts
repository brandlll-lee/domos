import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { chooseDetail, openDetails, openSettings } from "./fixtures/chat-ui.ts";
import { test } from "./fixtures/service.ts";

test("model selection updates immediately and restores a failed save", async ({
  service,
  page,
}) => {
  const saving = Promise.withResolvers<void>();
  const requested = Promise.withResolvers<void>();
  let requests = 0;
  await page.route("**/rpc/engines/configure", async (route) => {
    requests++;
    if (requests === 1) {
      requested.resolve();
      await saving.promise;
      await route.continue();
    } else await route.abort();
  });
  try {
    await page.goto(service.url);
    const details = await openDetails(page);
    const picker = details.getByRole("combobox", { name: "模型", exact: true });
    await picker.click();
    await page
      .getByRole("option", { name: "Pi · 测试模型二", exact: true })
      .click();
    await requested.promise;
    await expect(picker).toContainText("测试模型二");
    await expect(page.locator(".model-selector-popup")).toHaveCount(0);
    await expect(picker).toBeEnabled();
    saving.resolve();
    await expect(picker).toContainText("测试模型二");
    await picker.click();
    await page
      .getByRole("option", { name: "Pi · 测试模型一", exact: true })
      .click();
    await expect(page.locator(".attention-toast[data-error]")).toBeVisible();
    await expect(picker).toContainText("测试模型二");
    expect(requests).toBe(2);
  } finally {
    saving.resolve();
  }
});

test("model choices load from the server and selection survives a restart", async ({
  service,
  page,
}) => {
  const subscription = Promise.withResolvers<void>();
  await page.route("**/rpc/subscribe", async (route) => {
    await subscription.promise;
    await route.continue();
  });
  await page.goto(service.url);
  const details = await openDetails(page);
  await chooseDetail(details, "运行");
  const picker = page.getByRole("combobox", { name: "模型", exact: true });
  await expect(picker).not.toContainText("DeepSeek");
  subscription.resolve();
  await expect(picker).toBeEnabled();
  await picker.click();
  await page
    .getByRole("option", { name: "Pi · 测试模型二", exact: true })
    .click();
  await expect(picker).toContainText("测试模型二");
  await page.reload();
  await chooseDetail(await openDetails(page), "运行");
  await expect(picker).toContainText("测试模型二");
  const connected = page.getByRole("button", { name: "添加内容", exact: true });
  await expect(connected).toBeEnabled();
  const port = Number(new URL(service.url).port);
  await service.stop();
  await expect(connected).toBeDisabled();
  await service.start(port);
  await expect(connected).toBeEnabled();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(details).toBeHidden();
  await page.getByLabel("消息", { exact: true }).fill("验证模型选择");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("Domos 的回复")).toContainText("faux-2");
});

test("model search and themed popups support keyboard, dismissal, and narrow screens", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  await chooseDetail(await openDetails(page), "运行");
  const model = page.getByRole("combobox", { name: "模型", exact: true });
  const appearance = page.getByRole("combobox", { name: "外观", exact: true });
  await expect(model).toBeEnabled();
  await model.focus();
  await page.keyboard.press("Enter");
  const search = page.getByRole("searchbox", {
    name: "搜索模型…",
    exact: true,
  });
  await expect(search).toBeFocused();
  await expect(
    page.locator(".model-selector-identity .harness-version"),
  ).toHaveText(/^v\d+\.\d+/);
  await search.click();
  await expect(search).toHaveCSS("outline-style", "none");
  await search.fill(crypto.randomUUID());
  await expect(page.getByText("没有找到模型", { exact: true })).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
  await search.fill("测试模型二");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page
    .getByRole("option", { name: "Pi · 测试模型二", exact: true })
    .click();
  await expect(model).toContainText("测试模型二");
  await expect(search).toHaveCount(0);
  await expect(model).toBeFocused();
  await model.click();
  await expect(search).toHaveValue("");
  await search.press("Escape");
  await expect(model).toBeFocused();
  const settings = await openSettings(page);
  await appearance.click();
  await expect(page.getByRole("option")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(appearance).toBeFocused();
  await settings.getByRole("button", { name: "返回对话", exact: true }).click();
  await expect(page.locator("select:visible")).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.locator(".workspace")).toHaveAttribute(
    "data-mobile",
    "true",
  );
  await model.click();
  const popup = page.locator(".model-selector-popup");
  await expect(popup).toBeVisible();
  const bounds = await popup.boundingBox();
  if (!bounds) throw new Error("Popup is not visible");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(568);
  await page.screenshot({ path: "test-results/model-popup-mobile.png" });
  await page.mouse.click(2, 2);
  await expect(popup).toHaveCount(0);
});

test("permission choices match the Harness, persist and retain keyboard access", async ({
  service,
  page,
}, info) => {
  await page.goto(service.url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const picker = page.getByRole("combobox", { name: "操作审批", exact: true });
  await expect(picker).toContainText("按需询问");
  await picker.click();
  await expect(
    page.getByRole("option", { name: "智能审批", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("option", { name: "自动接受编辑", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("option", { name: "完全访问", exact: true }).click();
  await expect(picker).toBeEnabled();
  await expect(picker).toContainText("完全访问");
  await page.reload();
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await expect(picker).toContainText("完全访问");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({
      width: colorScheme === "light" ? 1360 : 390,
      height: 700,
    });
    await picker.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("option", { name: "完全访问", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.screenshot({
      path: info.outputPath(`permissions-${colorScheme}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(picker).toBeFocused();
  }
  await page.setViewportSize({ width: 1360, height: 700 });
  await picker.click();
  await page.getByRole("option", { name: "按需询问", exact: true }).click();
  await expect(picker).toContainText("按需询问");
  await expect(picker).toBeEnabled();
  const rpc = async (method: string, json: object) =>
    (
      await (
        await page.request.post(`${service.url}/rpc/${method}`, {
          data: { json },
        })
      ).json()
    ).json;
  const profile = await rpc("engines/get", { botId: 1 });
  await rpc("engines/configure", {
    botId: 1,
    config: { provider: "claude", model: null },
    revision: profile.revision,
    requestId: crypto.randomUUID(),
  });
  await page.reload();
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await picker.click();
  await expect(
    page.getByRole("option", { name: "智能审批", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "自动接受编辑", exact: true }),
  ).toBeVisible();
  await page.getByRole("option", { name: "智能审批", exact: true }).click();
  await expect(picker).toBeEnabled();
  const claude = await rpc("engines/get", { botId: 1 });
  expect(claude.config.approvalMode).toBe("auto");
  await rpc("engines/configure", {
    botId: 1,
    config: { provider: "pi", model: null },
    revision: claude.revision,
    requestId: crypto.randomUUID(),
  });
  await page.reload();
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await expect(picker).toContainText("按需询问");
  await expect(
    page.getByText("此运行方式不支持原权限模式，已改为按需询问。", {
      exact: true,
    }),
  ).toBeVisible();
  const notice = page.getByRole("group", { name: "操作审批", exact: true });
  await expect(notice).toContainText(
    "此运行方式不支持原权限模式，已改为按需询问。",
  );
  const alignment = await notice.evaluate((node) => {
    const caption = node.querySelector(".setting-caption");
    const message = node.querySelector(".inline-notice-content");
    if (!caption || !message) throw new Error("审批说明不可见");
    return Math.abs(
      caption.getBoundingClientRect().left -
        message.getBoundingClientRect().left,
    );
  });
  expect(alignment).toBeLessThan(1);
});

test("Bot model selection saves choices and fits both themes", async ({
  service,
  page,
}, info) => {
  await page.goto(service.url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const trigger = page.getByRole("combobox", {
    name: "模型",
    exact: true,
  });
  await trigger.click();
  const selector = page.locator(".model-selector-popup");
  const search = selector.getByRole("searchbox", {
    name: "搜索模型…",
    exact: true,
  });
  await expect(selector.getByRole("alert")).toHaveCount(0);
  await search.fill("模型二");
  const choice = selector.getByRole("option", { name: /测试模型二/ });
  await expect(choice).toBeVisible();
  await expect(
    selector.getByRole("option", { name: /测试模型一/ }),
  ).toHaveCount(0);
  await page.route("**/rpc/engines/configure", (route) => route.abort(), {
    times: 1,
  });
  await choice.click();
  await expect(selector).toBeHidden();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /fetch|network|请求|Failed/i })
      .first(),
  ).toBeVisible();
  await expect(trigger).toContainText("测试模型一");
  await trigger.click();
  await choice.click();
  await expect(selector).toBeHidden();
  await expect(trigger).toContainText("测试模型二");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const response = await fetch("/rpc/engines/get", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: { botId: 1 } }),
        });
        return (await response.json()).json.config.model;
      }),
    )
    .toBe("faux/faux-2");
  await page.reload();
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await expect(trigger).toContainText("测试模型二");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 600 });
      await trigger.click();
      await expect(choice).toHaveAttribute("aria-selected", "true");
      const box = await selector.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(600);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`selector-${colorScheme}-${width}.png`),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
    }
  }
});

test("native Harness controls persist and client accounts retain model access", async ({
  service,
  page,
  browser,
}, info) => {
  await service.stop();
  await service.start(0, "hosting");
  const ready = { pairing: service.pairing };
  await page.goto(service.url);
  await page.getByLabel("配对码", { exact: true }).fill(ready.pairing);
  await page.getByRole("button", { name: "连接", exact: true }).click();
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const trigger = page.getByRole("combobox", { name: "模型", exact: true });
  const popup = page.locator(".model-selector-popup");
  const captions = await page
    .locator(".engine-choices > .setting-row .setting-caption")
    .evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().x)),
    );
  expect(captions.length).toBe(3);
  expect(new Set(captions).size).toBe(1);
  await trigger.click();
  await expect(popup.getByRole("tab")).toHaveCount(9);
  const choice = popup.getByRole("option", {
    name: "Pi · 测试模型二",
    exact: true,
  });
  await expect(choice).toBeVisible();
  expect(
    await popup
      .locator(".model-selector-rail")
      .evaluate((node) => node.scrollWidth === node.clientWidth),
  ).toBe(true);
  await page.keyboard.press("Escape");
  const resumed = Promise.withResolvers<void>();
  await page.route("**/rpc/engines/inspect", async (route) => {
    await resumed.promise;
    await route.continue();
  });
  try {
    for (let index = 0; index < 2; index++) {
      await trigger.click();
      await expect(choice).toBeVisible({ timeout: 500 });
      await expect(popup).not.toContainText("还未安装");
      await expect(popup).not.toContainText("加载中");
      await page.keyboard.press("Escape");
    }
    await trigger.click();
    await popup.getByRole("tab", { name: "Codex", exact: true }).click();
    await popup.getByRole("tab", { name: "Pi", exact: true }).click();
    await expect(choice).toBeVisible({ timeout: 500 });
  } finally {
    resumed.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
  const saveGate = Promise.withResolvers<void>();
  let saves = 0;
  let sends = 0;
  await page.route("**/rpc/send", async (route) => {
    sends++;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        json: { code: "CONFLICT", message: "测试发送结束", status: 409 },
      }),
    });
  });
  await page.route("**/rpc/engines/configure", async (route) => {
    saves++;
    await saveGate.promise;
    await route.continue();
  });
  const effort = popup.getByRole("radiogroup", { name: "推理强度" });
  try {
    await choice.click();
    await expect(trigger).toContainText("测试模型二", { timeout: 200 });
    await expect(popup).toBeHidden();
    await trigger.click();
    await expect(
      effort.getByRole("radio", { name: "高", exact: true }),
    ).toBeEnabled();
    await effort.getByRole("radio", { name: "高", exact: true }).click();
    await expect(
      effort.getByRole("radio", { name: "高", exact: true }),
    ).toBeChecked();
    expect(saves).toBe(1);
    await page.keyboard.press("Escape");
    await page.getByLabel("消息", { exact: true }).fill("等待配置保存后发送");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByLabel("你的消息").last()).toContainText(
      "等待配置保存后发送",
    );
    expect(sends).toBe(0);
  } finally {
    saveGate.resolve();
    await page.unroute("**/rpc/engines/configure");
  }
  await expect.poll(() => sends).toBe(1);
  await page.unroute("**/rpc/send");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const response = await fetch("/rpc/engines/get", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: { botId: 1 } }),
        });
        return (await response.json()).json.config.options?.thinkingLevel;
      }),
    )
    .toBe("high");
  await page.reload();
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await trigger.click();
  await expect(
    effort.getByRole("radio", { name: "高", exact: true }),
  ).toBeChecked();
  await popup.getByRole("tab", { name: "自定义 ACP", exact: true }).click();
  await expect(popup.getByLabel("程序路径", { exact: true })).toBeVisible();
  await popup.getByLabel("程序路径", { exact: true }).fill("example-acp");
  await popup.getByLabel("启动参数", { exact: true }).fill("invalid");
  await popup.getByRole("button", { name: "检查连接", exact: true }).click();
  await expect(popup.getByRole("alert")).toContainText("JSON");
  await expect(trigger).toContainText("测试模型二");
  for (const width of [1360, 390]) {
    await page.setViewportSize({ width, height: 600 });
    await page.screenshot({
      path: info.outputPath(`native-connection-${width}.png`),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  const response = await page.request.post(`${service.url}/hosting/pairing`, {
    data: { scope: "client" },
    headers: { Origin: service.url },
  });
  const pairing = await response.json();
  const client = await browser.newContext();
  try {
    const paired = await client.newPage();
    await paired.goto(service.url);
    await paired.getByLabel("配对码", { exact: true }).fill(pairing.code);
    await paired.getByRole("button", { name: "连接", exact: true }).click();
    await paired.getByRole("button", { name: "Bot详情", exact: true }).click();
    await paired.getByRole("combobox", { name: "模型", exact: true }).click();
    await expect(
      paired.getByRole("tab", { name: "Pi", exact: true }),
    ).toBeVisible();
    await expect(
      paired.getByRole("button", { name: "配置连接", exact: true }),
    ).toHaveCount(0);
    await paired
      .getByRole("option", { name: "Pi · 测试模型一", exact: true })
      .click();
    await expect(
      paired.getByRole("combobox", { name: "模型", exact: true }),
    ).toContainText("测试模型一");
    expect(
      (await paired.request.get(`${service.url}/hosting/models`)).status(),
    ).toBe(403);
    expect(
      (
        await paired.request.post(`${service.url}/rpc/engines/install`, {
          data: { json: { botId: 1, config: { provider: "pi", model: null } } },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await client.close();
  }
});

test("AI services share connection reads and keep Bot model selection separate", async ({
  service,
  page,
}, info) => {
  const reads = new Map<string, number>();
  const mutations: string[] = [];
  let claudeReady = false;
  const inspection = Promise.withResolvers<void>();
  page.on("request", (request) => {
    if (/\/rpc\/engines\/(configure|select)$/.test(request.url()))
      mutations.push(request.url());
  });
  await page.route("**/rpc/engines/inspect", async (route) => {
    const provider = route.request().postDataJSON().json.config.provider;
    reads.set(provider, (reads.get(provider) ?? 0) + 1);
    if (provider === "opencode" && reads.get(provider) === 1)
      await inspection.promise;
    if (provider === "claude" && !claudeReady) return route.abort("failed");
    await route.fulfill({
      json: {
        json: {
          ready: provider !== "codex",
          authenticated: provider === "pi" || provider === "claude",
          path: provider === "codex" ? null : `C:/tools/${provider}`,
          version:
            provider === "codex" ? null : claudeReady ? "1.1.0" : "1.0.0",
          message: provider === "codex" ? "尚未安装" : "连接状态已读取",
          models:
            provider === "pi"
              ? [
                  { id: "faux/faux-1", name: "测试模型一" },
                  { id: "faux/faux-2", name: "测试模型二" },
                ]
              : [],
          ...(provider === "opencode"
            ? {
                accounts: {
                  providers: [
                    {
                      id: "test",
                      name: "测试提供方",
                      methods: [{ type: "api", label: "API key" }],
                    },
                  ],
                },
              }
            : {}),
        },
      },
    });
  });
  await page.goto(service.url);
  await page.getByRole("button", { name: "用户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  const settings = page.getByRole("main", { name: "设置", exact: true });
  await settings.getByRole("tab", { name: "AI 服务", exact: true }).click();
  await expect(
    settings.getByRole("tab", { name: "Providers", exact: true }),
  ).toHaveCount(0);
  await expect(
    settings.getByRole("tab", { name: "Models", exact: true }),
  ).toHaveCount(0);
  await expect(
    settings.getByRole("group", { name: "工作电脑", exact: true }),
  ).toContainText("此电脑");
  await expect(
    settings.getByRole("group", { name: "工作目录", exact: true }),
  ).toBeVisible();
  const checking = settings.locator(".ai-service-row").filter({
    has: page.getByRole("group", { name: "OpenCode", exact: true }),
  });
  await expect(checking.getByRole("status")).toHaveAccessibleName(
    "正在检查连接",
  );
  await expect(checking.locator(".status-dot")).toHaveCount(0);
  inspection.resolve();
  for (const [name, status, tone] of [
    ["Codex", "未安装", "negative"],
    ["Claude Code", "读取失败", "negative"],
    ["OpenCode", "待登录", "warning"],
    ["Pi", "可用", "positive"],
  ] as const) {
    const row = settings.getByRole("group", { name, exact: true });
    await expect(row.getByRole("status")).toContainText(status);
    await expect(row.locator(".button")).toHaveCount(1);
    const badge = settings
      .locator(".ai-service-row")
      .filter({ has: page.getByRole("group", { name, exact: true }) })
      .locator(".status-dot");
    await expect(badge).toHaveAttribute("data-tone", tone);
    await expect(badge).toHaveAccessibleName(status);
  }
  await expect(
    settings.getByRole("group", { name: "Codex", exact: true }),
  ).toContainText("版本未提供");
  const snapshot = Object.fromEntries(reads);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      colorScheme,
    );
    for (const provider of ["pi", "opencode"]) {
      const mark = settings.locator(
        `.engine-mark[data-provider="${provider}"]`,
      );
      const paint = await mark.evaluate((node) => ({
        fill: getComputedStyle(node).fill,
        color: getComputedStyle(node).color,
      }));
      expect(paint.fill).toBe(paint.color);
      expect(paint.fill).toBe(
        colorScheme === "dark" ? "rgb(239, 239, 240)" : "rgb(32, 33, 35)",
      );
    }
    for (const provider of [
      "codex",
      "claude",
      "grok",
      "antigravity",
      "devin",
      "cursor",
    ]) {
      const mark = settings.locator(
        `.engine-mark[data-provider="${provider}"]`,
      );
      await expect
        .poll(() =>
          mark.evaluate(async (node) => {
            if (node instanceof HTMLImageElement) return node.naturalWidth;
            const source = getComputedStyle(node).maskImage.match(
              /^url\(["']?(.*?)["']?\)$/,
            )?.[1];
            if (!source) return 0;
            const image = new Image();
            image.src = source;
            await image.decode();
            return image.naturalWidth;
          }),
        )
        .toBeGreaterThan(0);
      await expect(mark).toHaveCSS("width", "24px");
    }
    for (const [tone, color] of [
      ["positive", "rgb(37, 216, 132)"],
      ["warning", "rgb(255, 190, 50)"],
      ["negative", "rgb(255, 82, 101)"],
    ] as const) {
      const badge = settings
        .locator(`.status-dot[data-tone="${tone}"]`)
        .first();
      await expect(badge).toHaveCSS("background-color", color);
      const aligned = await badge.evaluate((node) => {
        const icon = node.parentElement
          ?.querySelector(".engine-mark")
          ?.getBoundingClientRect();
        const dot = node.getBoundingClientRect();
        return Boolean(
          icon &&
            Math.abs(dot.right - icon.right) < 1 &&
            Math.abs(dot.bottom - icon.bottom) < 1,
        );
      });
      expect(aligned).toBe(true);
    }
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          settings.evaluate((node) => node.scrollWidth <= node.clientWidth),
        )
        .toBe(true);
      await settings.screenshot({
        path: info.outputPath(`ai-services-${colorScheme}-${width}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1360, height: 900 });
  await settings.getByRole("button", { name: "管理 Pi", exact: true }).click();
  await expect(
    settings.getByRole("combobox", { name: "模型", exact: true }),
  ).toHaveCount(0);
  const models = settings.locator(".model-catalog");
  await models.locator("summary").click();
  const visible = models.getByRole("switch", {
    name: "Pi · 测试模型二",
    exact: true,
  });
  await visible.click();
  await expect(visible).toBeEnabled();
  await expect(visible).not.toBeChecked();
  await models
    .getByRole("searchbox", { name: "搜索模型", exact: true })
    .fill("一");
  await expect(models.getByRole("switch")).toHaveCount(1);
  await expect(
    settings.getByRole("group", { name: "版本", exact: true }),
  ).toBeHidden();
  await settings.getByText("高级配置", { exact: true }).click();
  await expect(
    settings.getByRole("group", { name: "版本", exact: true }),
  ).toContainText(/\d+\.\d+\.\d+/);
  await settings.screenshot({ path: info.outputPath("ai-service-detail.png") });
  await settings
    .getByRole("button", { name: "返回 AI 服务", exact: true })
    .click();
  await settings.getByRole("button", { name: "返回对话", exact: true }).click();
  await page.getByRole("button", { name: "用户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await settings.getByRole("tab", { name: "AI 服务", exact: true }).click();
  await expect(
    settings
      .getByRole("group", { name: "Claude Code", exact: true })
      .getByRole("status"),
  ).toContainText("读取失败");
  expect(Object.fromEntries(reads)).toEqual(snapshot);
  claudeReady = true;
  await settings.getByRole("button", { name: "重新检查", exact: true }).click();
  await expect(
    settings
      .getByRole("group", { name: "Claude Code", exact: true })
      .getByRole("status"),
  ).toContainText("可用");
  await expect(
    settings.getByRole("group", { name: "Claude Code", exact: true }),
  ).toContainText("v1.1.0");
  expect(reads.get("claude")).toBe(2);
  await page.route("**/rpc/engines/login", (route) =>
    route.fulfill({ json: { json: { state: "waiting", prompt: "登录代码" } } }),
  );
  await page.route("**/rpc/engines/loginState", (route) =>
    route.fulfill({ json: { json: { state: "waiting", prompt: "登录代码" } } }),
  );
  let cancelled = false;
  await page.route("**/rpc/engines/cancelLogin", (route) => {
    cancelled = true;
    return route.fulfill({ json: { json: null } });
  });
  await settings
    .getByRole("button", { name: "设置 OpenCode", exact: true })
    .click();
  await settings
    .getByRole("combobox", { name: "模型提供方", exact: true })
    .click();
  await page.getByRole("option", { name: "测试提供方", exact: true }).click();
  await settings.getByRole("button", { name: "登录", exact: true }).click();
  await expect(settings.getByText("等待登录…", { exact: true })).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "返回 AI 服务", exact: true }),
  ).toBeDisabled();
  await settings.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    settings.getByRole("button", { name: "返回 AI 服务", exact: true }),
  ).toBeEnabled();
  expect(cancelled).toBe(true);
  await settings
    .getByRole("button", { name: "返回 AI 服务", exact: true })
    .click();
  const binding = (
    await (
      await page.request.post(`${service.url}/rpc/computer/get`, {
        data: { json: { botId: 1 } },
      })
    ).json()
  ).json;
  const project = join(service.directory, "AI project");
  await mkdir(project);
  const changed = await page.request.post(
    `${service.url}/rpc/computer/directory`,
    {
      data: {
        json: {
          botId: 1,
          directory: project,
          revision: binding.revision,
          requestId: crypto.randomUUID(),
        },
      },
    },
  );
  expect(changed.ok()).toBe(true);
  await expect(
    settings.getByRole("group", { name: "工作目录", exact: true }),
  ).toContainText(project);
  expect(mutations).toEqual([]);
});
