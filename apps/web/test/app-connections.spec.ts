import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect } from "@playwright/test";
import { mcpFixture } from "../../../packages/agent/test/fixtures/mcp.mjs";
import type { AppRouter } from "../../api/src/router.ts";
import { test } from "./fixtures/service.ts";

test("connection layout keeps controls compact and the final row readable", async ({
  service,
  page,
}, info) => {
  await page.route("**/rpc/mcp/native", (route) =>
    route.fulfill({
      json: {
        json: {
          provider: "opencode",
          computerId: "pc",
          readonly: true,
          status: "complete",
          scope: "session",
          errors: [],
          observedAt: 1,
          inheritance: "native",
          inherited: true,
          items: Array.from({ length: 30 }, (_, index) => ({
            name: `Service ${index}`,
            source: "opencode",
            enabled: true,
            status: index === 29 ? "unknown" : "connected",
          })),
        },
      },
    }),
  );
  await page.goto(service.url);
  await page.getByRole("button", { name: "应用连接", exact: true }).click();
  const dialog = page.locator(".apps-dialog");
  const body = dialog.locator(".dialog-body");
  const viewport = body.locator(".scroll-viewport");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1360, 768, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const title = dialog.locator(".dialog-title");
      const titleHeight = await title.evaluate((node) =>
        parseFloat(getComputedStyle(node).lineHeight),
      );
      expect((await title.boundingBox())?.height).toBeLessThanOrEqual(
        titleHeight + 1,
      );
      const first = dialog.getByRole("button", {
        name: "查看 Service 0",
        exact: true,
      });
      await first.scrollIntoViewIfNeeded();
      const row = await first.boundingBox();
      const dot = await first
        .getByRole("img", { name: "已连接", exact: true })
        .boundingBox();
      expect(
        row &&
          dot &&
          dot.y >= row.y &&
          dot.y + dot.height <= row.y + row.height,
      ).toBe(true);
      expect(
        (await dialog.locator(".search-field").boundingBox())?.height,
      ).toBeLessThanOrEqual(36);
      await expect(body).toHaveAttribute("data-overflow-y-end", "");
      await expect
        .poll(() =>
          body.evaluate((node) => getComputedStyle(node, "::after").opacity),
        )
        .toBe("1");
      const last = dialog.getByRole("button", {
        name: "查看 Service 29",
        exact: true,
      });
      await last.focus();
      await viewport.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await expect(body).not.toHaveAttribute("data-overflow-y-end");
      const end = await last.boundingBox();
      const frame = await viewport.boundingBox();
      expect(
        end && frame && end.y + end.height <= frame.y + frame.height - 20,
      ).toBe(true);
      await expect(last.getByRole("img")).toHaveAttribute(
        "data-tone",
        "neutral",
      );
      await dialog.screenshot({
        path: info.outputPath(`connections-${theme}-${width}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1360, height: 900 });
  await dialog.getByRole("tab", { name: "发现应用", exact: true }).click();
  const categories = dialog.getByRole("tablist", {
    name: "应用分类",
    exact: true,
  });
  expect((await categories.boundingBox())?.width).toBeLessThan(300);
  await categories.getByRole("tab", { name: "开发", exact: true }).click();
  await expect(dialog.getByText("Context7", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "开发", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "添加 MCP", exact: true }).click();
  await dialog.getByRole("button", { name: "手动配置", exact: true }).click();
  const form = dialog.locator("form");
  expect((await form.boundingBox())?.width).toBeLessThanOrEqual(640);
  const transport = dialog.getByRole("radiogroup", { name: "传输方式" });
  expect((await transport.boundingBox())?.width).toBeLessThan(300);
});

test("native connection cards expand in place and retain source and tool evidence", async ({
  service,
  page,
}, info) => {
  await page.route("**/rpc/mcp/native", (route) =>
    route.fulfill({
      json: {
        json: {
          provider: "opencode",
          computerId: "local",
          readonly: true,
          status: "complete",
          scope: "configuration",
          errors: [],
          observedAt: 1,
          inheritance: "native",
          inherited: true,
          items: ["exa", "tavily"].map((name) => ({
            name,
            source: "opencode",
            enabled: true,
            status: "connected",
            ...(name === "tavily"
              ? {
                  tools: [
                    {
                      name: "search",
                      description: "Search the web",
                      inputSchema: {
                        type: "object",
                        properties: { query: { type: "string" } },
                      },
                    },
                  ],
                }
              : {}),
          })),
        },
      },
    }),
  );
  await page.goto(service.url);
  await page.getByRole("button", { name: "应用连接", exact: true }).click();
  const dialog = page.locator(".apps-dialog");
  const exa = dialog.getByRole("button", { name: "查看 exa", exact: true });
  await expect(exa).toBeVisible();
  await expect(dialog.getByText("尚未添加连接。", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    exa.getByRole("img", { name: "已连接", exact: true }),
  ).toBeVisible();
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await exa.hover();
    await dialog.screenshot({ path: info.outputPath(`native-${theme}.png`) });
  }
  await dialog.getByRole("searchbox").fill("tavily");
  await expect(exa).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "查看 tavily", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("没有找到匹配项。", { exact: false }),
  ).toHaveCount(0);
  await dialog.getByRole("searchbox").fill("");
  await expect(
    dialog.getByRole("combobox", { name: "选择机器人" }),
  ).toHaveCount(0);
  await exa.click();
  await expect(exa).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.getByRole("tab", { name: "我的连接" })).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "应用连接", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("未提供工具目录", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "保存并测试", exact: true }),
  ).toHaveCount(0);
  await exa.click();
  await expect(exa).toHaveAttribute("aria-expanded", "false");
  await expect(exa).toBeFocused();
  const tavily = dialog.getByRole("button", {
    name: "查看 tavily",
    exact: true,
  });
  await expect(tavily).toContainText("1 个工具");
  await tavily.click();
  await dialog.locator("summary").filter({ hasText: "search" }).click();
  await expect(
    dialog.getByText("Search the web", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('"query"', { exact: false })).toBeVisible();
});

test("connection navigation keeps import and confirmation separate", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  await page.getByRole("button", { name: "应用连接", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "应用连接", exact: true });
  await expect(
    dialog.getByRole("tab", { name: "我的连接", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await dialog.getByRole("tab", { name: "发现应用", exact: true }).click();
  await expect(dialog.getByText("Context7", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "添加 MCP", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "添加 MCP", exact: true });
  const paste = editor.getByRole("textbox", {
    name: "MCP 地址或配置",
    exact: true,
  });
  await expect(paste).toBeFocused();
  await editor.screenshot({ path: test.info().outputPath("import.png") });
  const compactFrame = await editor.boundingBox();
  expect(compactFrame?.width).toBeLessThanOrEqual(480);
  expect(compactFrame?.height).toBeLessThanOrEqual(300);
  expect((await paste.boundingBox())?.height).toBeLessThanOrEqual(56);
  const next = await editor
    .getByRole("button", { name: "继续", exact: true })
    .boundingBox();
  const field = await paste.boundingBox();
  expect(next && field && next.y - field.y - field.height).toBeLessThanOrEqual(
    100,
  );

  await expect(
    editor.getByRole("textbox", { name: "名称", exact: true }),
  ).toHaveCount(0);
  await expect(
    editor.getByRole("button", { name: "继续", exact: true }),
  ).toBeDisabled();
  await paste.fill("{broken");
  await editor.getByRole("button", { name: "继续", exact: true }).click();
  await expect(editor.getByRole("alert")).toBeVisible();
  await expect(paste).toHaveValue("{broken");
  await paste.fill(
    JSON.stringify({
      mcpServers: {
        Docs: {
          url: "https://example.com/mcp",
          headers: { Authorization: "private-import-token" },
        },
      },
    }),
  );
  await editor.getByRole("button", { name: "继续", exact: true }).click();
  await expect(paste).toHaveCount(0);
  await expect(
    editor.getByRole("textbox", { name: "名称", exact: true }),
  ).toBeFocused();
  await expect(
    editor.getByRole("button", { name: "手动配置", exact: true }),
  ).toHaveCount(0);
  await expect(
    editor.getByRole("textbox", { name: "名称", exact: true }),
  ).toHaveValue("Docs");
  await expect(
    editor.getByRole("textbox", { name: "MCP 地址", exact: true }),
  ).toHaveValue("https://example.com/mcp");
  await expect(
    editor.getByRole("radio", { name: "HTTP / SSE", exact: true }),
  ).toBeChecked();
  const computer = editor.getByRole("combobox", {
    name: "运行／访问电脑",
    exact: true,
  });
  await editor.locator("summary").filter({ hasText: "高级设置" }).click();
  await expect(
    editor.getByLabel("请求头值 1", { exact: true }),
  ).toHaveAttribute("type", "password");
  await expect(editor.getByLabel("请求头值 1", { exact: true })).toHaveValue(
    "private-import-token",
  );
  await editor
    .getByRole("button", { name: "＋ 添加请求头", exact: true })
    .click();
  const duplicate = editor.getByLabel("请求头名称 2", { exact: true });
  await duplicate.fill("Authorization");
  await expect(duplicate).toHaveJSProperty(
    "validationMessage",
    "名称不能重复。",
  );
  await editor
    .getByRole("button", { name: "删除请求头 2", exact: true })
    .click();
  await expect(
    editor.getByLabel("请求头名称 1", { exact: true }),
  ).toHaveJSProperty("validationMessage", "");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 390, height: 500 });
    await expect(
      editor.getByRole("button", { name: "保存并测试", exact: true }),
    ).toBeInViewport();
    expect(
      await editor.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await editor.screenshot({
      path: test.info().outputPath(`editor-${theme}.png`),
    });
  }
  await page.setViewportSize({ width: 1360, height: 900 });

  await expect(computer).toContainText("选择电脑");
  await computer.click();
  await expect(
    page.getByRole("option", { name: "选择电脑", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await editor.getByRole("button", { name: "返回", exact: true }).click();
  await expect(paste).toHaveValue(/mcpServers/);
  await editor.getByRole("button", { name: "返回", exact: true }).click();
  await expect(
    dialog.getByRole("tab", { name: "发现应用", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    dialog.getByRole("button", { name: "添加 MCP", exact: true }),
  ).toBeFocused();
});

test("saved connections retain failed checks and can be found in My connections", async ({
  service,
  page,
}) => {
  const upstream = await mcpFixture();
  await upstream.close();
  const release = Promise.withResolvers<void>();
  await page.route("**/rpc/mcp/check", async (route) => {
    await release.promise;
    await route.continue();
  });
  try {
    await page.goto(service.url);
    await page.getByRole("button", { name: "应用连接", exact: true }).click();
    const dialog = page.locator(".apps-dialog");
    await dialog.getByRole("button", { name: "添加 MCP", exact: true }).click();
    await dialog.getByRole("button", { name: "手动配置", exact: true }).click();
    await dialog.getByLabel("名称", { exact: true }).fill("Unavailable Docs");
    await dialog.getByLabel("MCP 地址", { exact: true }).fill(upstream.url);
    await dialog
      .getByRole("button", { name: "保存并测试", exact: true })
      .click();
    await expect(
      dialog.getByLabel("运行／访问电脑", { exact: true }),
    ).toBeFocused();
    await dialog
      .getByRole("combobox", { name: "运行／访问电脑", exact: true })
      .click();
    await page.getByRole("option").first().click();
    await dialog
      .getByRole("button", { name: "保存并测试", exact: true })
      .click();
    await expect(
      dialog.getByText("Unavailable Docs", { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByText(/检查中/)).toBeVisible();
    release.resolve();
    await expect(dialog.getByText(/^检查失败/)).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "重试测试", exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "查看 Unavailable Docs", exact: true })
      .click();
    await expect(
      dialog.getByRole("tab", { name: "我的连接", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      dialog.getByText("Unavailable Docs", { exact: true }),
    ).toHaveCount(1);
    await page.reload();
    await page.getByRole("button", { name: "应用连接", exact: true }).click();
    await expect(
      dialog.getByText("Unavailable Docs", { exact: true }),
    ).toHaveCount(1);
    await dialog
      .getByRole("button", { name: "查看 Unavailable Docs", exact: true })
      .click();
    await dialog.getByRole("button", { name: "重试测试", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "重试测试", exact: true }),
    ).toBeEnabled();
    const rpc: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ url: `${service.url}/rpc` }),
    );
    expect(
      (await rpc.mcp.list()).filter((item) => item.name === "Unavailable Docs"),
    ).toHaveLength(1);
  } finally {
    release.resolve();
  }
});

test("local command edits retain their transport and advanced settings stay optional", async ({
  service,
  page,
}) => {
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  await rpc.mcp.save({
    id: crypto.randomUUID(),
    revision: 0,
    name: "Local Tools",
    computerId: "pc",
    enabled: false,
    config: {
      transport: "stdio",
      command: "node",
      args: ["tools.mjs"],
      env: {},
    },
  });
  await page.goto(service.url);
  await page.getByRole("button", { name: "应用连接", exact: true }).click();
  const dialog = page.locator(".apps-dialog");
  await dialog
    .getByRole("button", { name: "查看 Local Tools", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Local Tools的操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
  await expect(
    dialog.getByRole("radio", { name: "本地命令", exact: true }),
  ).toBeChecked();
  await expect(dialog.getByLabel("启动程序", { exact: true })).toHaveValue("");
  await expect(
    dialog.getByText("留空保留已有配置和凭据。填写新配置会替换它们。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "参数（JSON 数组）", exact: true }),
  ).not.toBeVisible();
  await dialog.locator("summary").filter({ hasText: "高级设置" }).click();
  await expect(
    dialog.getByRole("textbox", { name: "参数（JSON 数组）", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "保存并测试", exact: true }).click();
  await expect(dialog.getByText("已禁用", { exact: false })).toBeVisible();
  expect((await rpc.mcp.list())[0]).toMatchObject({
    name: "Local Tools",
    transport: "stdio",
    enabled: false,
  });
});

test("connection overview reads native sources and exposes failures without a Bot filter", async ({
  service,
  page,
}) => {
  await page.route("**/rpc/mcp/native", (route) =>
    route.fulfill({
      status: 503,
      json: {
        json: {
          code: "SERVICE_UNAVAILABLE",
          message: "Native catalog unavailable",
        },
      },
    }),
  );
  await page.goto(service.url);
  await page.getByRole("button", { name: "应用连接", exact: true }).click();
  const dialog = page.locator(".apps-dialog");
  await expect(
    dialog.getByRole("combobox", { name: "选择机器人" }),
  ).toHaveCount(0);
  await expect(dialog.getByRole("alert")).toContainText("原生连接读取失败");
  await expect(dialog.getByText("尚未添加连接。", { exact: true })).toHaveCount(
    0,
  );
  await dialog.getByRole("button", { name: "刷新连接", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("原生连接读取失败");
});

test("service cards retain separate Bot sources and show partial read evidence", async ({
  service,
  page,
}) => {
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const bot = (await rpc.bots.list())[0];
  if (!bot) throw new Error("Missing Bot");
  const peer = await rpc.bots.create({
    name: "Reviewer",
    requestId: crypto.randomUUID(),
  });
  await page.route("**/rpc/mcp/native", async (route) => {
    const request = route.request().postDataJSON();
    const id = request.json.botId;
    await route.fulfill({
      json: {
        json: {
          provider: "opencode",
          computerId: "pc",
          readonly: true,
          inheritance: "selectable",
          inherited: false,
          status: id === peer.id ? "partial" : "complete",
          scope: "configuration",
          observedAt: 1,
          errors:
            id === peer.id ? [{ message: "One directory unavailable" }] : [],
          items: [
            {
              name: "Shared Docs",
              source: `project-${id}`,
              enabled: true,
              status: id === peer.id ? "failed" : "connected",
              tools:
                id === peer.id
                  ? []
                  : [{ name: "read", description: "Read documents" }],
            },
          ],
        },
      },
    });
  });
  await page.goto(service.url);
  await page.getByRole("button", { name: "应用连接", exact: true }).click();
  const dialog = page.locator(".apps-dialog");
  const card = dialog.getByRole("button", {
    name: "查看 Shared Docs",
    exact: true,
  });
  await expect(card).toContainText("2 个来源");
  await expect(card).toHaveCount(1);
  await card.click();
  await expect(
    dialog.getByRole("region", { name: `${bot.name} 的 Shared Docs` }),
  ).toContainText("已连接");
  const other = dialog.getByRole("region", { name: "Reviewer 的 Shared Docs" });
  await expect(other).toContainText("连接失败");
  await expect(other).toContainText("工具目录为空");
  await expect(dialog.getByRole("alert")).toContainText(
    "One directory unavailable",
  );
  await other.locator("summary").filter({ hasText: "来源信息" }).click();
  await expect(other).toContainText(`project-${peer.id}`);
  await dialog.locator("summary").filter({ hasText: "原生连接设置" }).click();
  await expect(
    dialog.getByRole("checkbox", {
      name: "Reviewer · 在下一轮沿用原生连接",
      exact: true,
    }),
  ).not.toBeChecked();
});

test("native inheritance remains available when its catalog is empty", async ({
  service,
  page,
}) => {
  await page.route("**/rpc/mcp/native", async (route) =>
    route.fulfill({
      json: {
        json: {
          provider: "pi",
          computerId: "pc",
          readonly: true,
          inheritance: "selectable",
          inherited: false,
          status: "complete",
          scope: "configuration",
          observedAt: 1,
          errors: [],
          items: [],
        },
      },
    }),
  );
  await page.goto(service.url);
  await page.getByRole("button", { name: "应用连接", exact: true }).click();
  const dialog = page.locator(".apps-dialog");
  await dialog.locator("summary").filter({ hasText: "原生连接设置" }).click();
  await expect(
    dialog.getByRole("checkbox", { name: /在下一轮沿用原生连接/ }),
  ).toBeVisible();
});

test("material pickers show native sources and keep MCP references separate from grants", async ({
  service,
  page,
}) => {
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const bot = (await rpc.bots.list())[0];
  if (!bot) throw new Error("Missing Bot");
  const skill = await rpc.work.skills.save({
    botId: bot.id,
    id: crypto.randomUUID(),
    revision: 0,
    requestId: crypto.randomUUID(),
    content: "---\nname: report\ndescription: Report\n---\nOriginal procedure",
  });
  await rpc.work.skills.enable({
    botId: bot.id,
    id: skill.id,
    revision: skill.revision,
    enabled: true,
    requestId: crypto.randomUUID(),
  });
  const connection = await rpc.mcp.save({
    id: crypto.randomUUID(),
    revision: 0,
    name: "Docs",
    computerId: "pc",
    enabled: false,
    config: { transport: "http", url: "https://example.com/mcp", headers: {} },
  });
  await service.control({
    nativeSkills: [
      { name: "report", path: "/skills/report/SKILL.md", source: "project" },
      { name: "unresolved", source: "user" },
    ],
    skillsNotice: "原生技能目录读取失败：测试提示",
  });
  const nativeReady = Promise.withResolvers<void>();
  await page.route("**/rpc/mcp/native", async (route) => {
    await nativeReady.promise;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      json: {
        json: { code: "SERVICE_UNAVAILABLE", message: "原生目录暂不可用" },
      },
    });
  });
  await page.goto(service.url);
  const add = page.getByRole("button", { name: "添加内容", exact: true });
  await add.click();
  await page.getByRole("menuitem", { name: "使用技能…", exact: true }).click();
  const native = page.getByRole("button", { name: "report", exact: true });
  await expect(native).toHaveCount(1);
  await native.hover();
  await expect(page.getByRole("tooltip")).toContainText("pi · project · 只读");
  await expect(
    page.getByRole("button", { name: "unresolved", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("status").filter({ hasText: "原生技能目录读取失败" }),
  ).toBeVisible();
  await native.click();
  await page.reload();
  const input = page.getByLabel("消息", { exact: true });
  await expect(input.locator("[data-inline-token]")).toHaveText(["report"]);
  await input.press("End");
  await input.press("Backspace");
  await add.click();
  await page.getByRole("menuitem", { name: "引用 MCP…", exact: true }).click();
  try {
    await expect(
      page.getByRole("button", { name: "Docs", exact: true }),
    ).toBeVisible();
  } finally {
    nativeReady.resolve();
  }
  await expect(
    page.getByRole("status").filter({ hasText: "服务暂时不可用" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Docs", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "Domos · 未授权或已停用",
  );
  await page.getByRole("button", { name: "Docs", exact: true }).click();
  await page.reload();
  await expect(input.locator("[data-inline-token]")).toHaveText(["Docs"]);
  await service.control({ content: "已收到服务引用。" });
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("Domos 的回复")).toContainText(
    "已收到服务引用。",
  );
  await page.reload();
  await expect(
    page.getByLabel("你的消息").locator(".message-material-token"),
  ).toHaveText(["Docs"]);
  expect(
    (await rpc.mcp.list()).find((item) => item.id === connection.id),
  ).toMatchObject({ enabled: false, grants: [] });
  await page.unroute("**/rpc/mcp/native");
  await page.route("**/rpc/mcp/native", (route) =>
    route.fulfill({
      json: {
        json: {
          provider: "pi",
          computerId: "pc",
          inherited: true,
          inheritance: "native",
          readonly: true,
          status: "complete",
          scope: "configuration",
          errors: [],
          observedAt: 1,
          items: [
            { name: "Docs", source: "project", enabled: true, status: "ready" },
          ],
        },
      },
    }),
  );
  await page.reload();
  await add.click();
  await page.getByRole("menuitem", { name: "引用 MCP…", exact: true }).click();
  const sources = page.getByRole("button", { name: "Docs", exact: true });
  await expect(sources).toHaveCount(2);
  await sources.first().hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "Domos · 未授权或已停用",
  );
  await sources.last().hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "pi · project · 沿用原生配置",
  );
  await page.screenshot({
    path: test.info().outputPath("material-mcp-sources.png"),
  });
  await sources.last().click();
  await page.reload();
  await expect(input.locator("[data-inline-token]")).toHaveText(["Docs"]);
});

test("MCP readers share pending and retained catalogs across the composer and connection center", async ({
  service,
  page,
}) => {
  let nativeReads = 0;
  let managedReads = 0;
  const release = Promise.withResolvers<void>();
  await page.route("**/rpc/mcp/list", async (route) => {
    managedReads++;
    await route.continue();
  });
  await page.route("**/rpc/mcp/native", async (route) => {
    nativeReads++;
    await release.promise;
    await route.fulfill({
      json: {
        json: {
          provider: "pi",
          computerId: "pc",
          inherited: true,
          inheritance: "native",
          readonly: true,
          status: "complete",
          scope: "configuration",
          errors: [],
          observedAt: 1,
          items: [
            {
              name: "Shared Docs",
              source: "project",
              enabled: true,
              status: "configured",
            },
          ],
        },
      },
    });
  });
  await page.goto(service.url);
  const add = page.getByRole("button", { name: "添加内容", exact: true });
  const open = async () => {
    await add.click();
    await page
      .getByRole("menuitem", { name: "引用 MCP…", exact: true })
      .click();
  };
  const close = async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  };
  try {
    await open();
    await expect.poll(() => nativeReads).toBe(1);
    await close();
    await open();
    await expect(
      page.getByRole("status", { name: "正在读取 MCP", exact: true }),
    ).toBeVisible();
    expect(nativeReads).toBe(1);
    release.resolve();
    await expect(
      page.getByRole("button", { name: "Shared Docs", exact: true }),
    ).toBeVisible();
    await close();
    await open();
    await expect(
      page.getByRole("button", { name: "Shared Docs", exact: true }),
    ).toBeVisible();
    expect(nativeReads).toBe(1);
    expect(managedReads).toBe(1);
    await close();
    await page.getByRole("button", { name: "应用连接", exact: true }).click();
    const center = page.getByRole("dialog");
    await expect(
      center.getByRole("combobox", { name: "选择机器人" }),
    ).toHaveCount(0);
    await expect(
      center.getByRole("button", { name: "查看 Shared Docs", exact: true }),
    ).toBeVisible();
    expect(nativeReads).toBe(1);
    expect(managedReads).toBe(1);
    await center.getByRole("button", { name: "刷新连接", exact: true }).click();
    await expect(
      center.getByRole("button", { name: "刷新连接", exact: true }),
    ).toBeEnabled();
    expect(nativeReads).toBe(2);
    expect(managedReads).toBe(2);
  } finally {
    release.resolve();
  }
});

test("native MCP reads keep partial, failed, unsupported and complete empty states distinct", async ({
  service,
  page,
}) => {
  let state = "partial";
  await page.route("**/rpc/mcp/native", (route) =>
    route.fulfill({
      json: {
        json: {
          provider: "opencode",
          computerId: "pc",
          inherited: true,
          inheritance: "native",
          readonly: true,
          scope: "session",
          sessionId: "private",
          observedAt: 1,
          status: state,
          errors:
            state === "partial" || state === "failed"
              ? [{ message: "Project catalog unavailable", code: 503 }]
              : [],
          items:
            state === "partial"
              ? [
                  {
                    name: "plugin:docs:search",
                    source: "project",
                    enabled: null,
                    status: "unknown",
                  },
                ]
              : [],
        },
      },
    }),
  );
  await page.goto(service.url);
  await page.getByRole("button", { name: "添加内容", exact: true }).click();
  await page.getByRole("menuitem", { name: "引用 MCP…", exact: true }).click();
  await expect(page.getByText("当前私聊会话", { exact: true })).toBeVisible();
  const nativeService = page.getByRole("button", {
    name: "plugin:docs:search",
    exact: true,
  });
  await expect(nativeService).toBeVisible();
  await nativeService.hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "启用状态未知 · 连接状态未知",
  );
  await expect(page.getByRole("tooltip")).toContainText("沿用原生配置");
  const refresh = page.getByRole("button", {
    name: "刷新原生连接",
    exact: true,
  });
  for (const [next, label] of [
    ["failed", "原生目录读取失败"],
    ["unsupported", "此 Harness 尚未提供目录接口"],
    ["complete", "暂无 MCP 连接"],
  ] as const) {
    state = next;
    await refresh.click();
    await expect(nativeService).toHaveCount(0);
    await expect(
      page.getByText(label, { exact: next === "complete" }),
    ).toBeVisible();
    if (next !== "complete")
      await expect(
        page.getByText("暂无 MCP 连接", { exact: true }),
      ).toHaveCount(0);
  }
  await page.screenshot({
    path: test.info().outputPath("native-mcp-empty.png"),
  });
});

test("Apps manages a real MCP connection and Bot grants across reloads and themes", async ({
  service,
  page,
}, info) => {
  test.setTimeout(60_000);
  const upstream = await mcpFixture();
  try {
    await page.goto(service.url);
    await page.getByRole("button", { name: "应用连接", exact: true }).click();
    const dialog = page.locator(".apps-dialog");
    await dialog.getByRole("tab", { name: "发现应用", exact: true }).click();
    await expect(
      dialog.getByText("Microsoft Learn", { exact: true }),
    ).toBeVisible();
    const search = dialog.getByRole("searchbox", { name: "搜索当前页面" });
    await search.fill("Context7");
    await expect(dialog.getByText("Context7", { exact: true })).toBeVisible();
    await expect(
      dialog.getByText("Microsoft Learn", { exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "清除搜索当前页面", exact: true })
      .click();
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await search.fill("不存在的连接");
    await expect(dialog.getByRole("status")).toContainText("没有找到匹配项");
    await dialog.getByRole("button", { name: "清除筛选" }).click();
    for (const theme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      for (const width of [1360, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect
          .poll(() =>
            dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
          )
          .toBe(true);
        const cards = dialog.locator(".apps-catalog-item");
        await expect(cards).toHaveCount(2);
        const initial = await dialog.boundingBox();
        expect(initial).not.toBeNull();
        await search.fill("没有匹配结果");
        expect(await dialog.boundingBox()).toEqual(initial);
        await search.fill("");
        await dialog
          .getByRole("tab", { name: "我的连接", exact: true })
          .click();
        expect(await dialog.boundingBox()).toEqual(initial);
        await dialog
          .getByRole("tab", { name: "发现应用", exact: true })
          .click();
        expect(await dialog.boundingBox()).toEqual(initial);
        await dialog.screenshot({
          path: info.outputPath(`catalog-${theme}-${width}.png`),
        });
      }
    }
    await page.setViewportSize({ width: 1360, height: 900 });
    const frame = await dialog.boundingBox();
    await dialog.getByRole("tab", { name: "我的连接", exact: true }).click();
    await dialog.getByRole("button", { name: "添加 MCP", exact: true }).click();
    expect((await dialog.boundingBox())?.width).toBeLessThanOrEqual(480);
    await expect(dialog.getByRole("button", { name: "继续" })).toBeInViewport();
    await dialog.getByLabel("MCP 地址或配置").fill(
      JSON.stringify({
        mcpServers: {
          "Local Docs": {
            url: upstream.url,
            headers: { "X-Fixture": "private-test-value" },
          },
        },
      }),
    );
    await dialog.getByRole("button", { name: "继续" }).click();
    await expect(
      dialog.getByRole("textbox", { name: "名称", exact: true }),
    ).toHaveValue("Local Docs");
    const computer = dialog.getByRole("combobox", { name: "运行／访问电脑" });
    await computer.click();
    await page.getByRole("option").first().click();
    await dialog.getByRole("button", { name: "保存并测试" }).click();
    const connection = dialog
      .locator(".apps-item")
      .filter({ hasText: "Local Docs" });
    await expect(connection.getByText(/^可用/)).toBeVisible({
      timeout: 20_000,
    });
    expect(await dialog.boundingBox()).toEqual(frame);
    await expect(
      dialog.getByText("private-test-value", { exact: false }),
    ).toHaveCount(0);
    await connection.getByText("机器人权限", { exact: false }).click();
    await connection
      .getByRole("checkbox", { name: "Domos", exact: true })
      .click();
    await expect(
      connection.getByRole("checkbox", { name: "Domos", exact: true }),
    ).toBeChecked();
    await connection.locator("summary").filter({ hasText: "全部工具" }).click();
    await connection
      .getByRole("checkbox", { name: "全部工具", exact: true })
      .click();
    await expect(
      connection.getByRole("checkbox", { name: "全部工具", exact: true }),
    ).not.toBeChecked();
    await connection
      .getByRole("checkbox", { name: "read", exact: true })
      .click();
    await expect(
      connection.getByRole("checkbox", { name: "read", exact: true }),
    ).toBeChecked();
    for (const theme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await dialog.screenshot({ path: info.outputPath(`apps-${theme}.png`) });
    }
    await page.reload();
    await page.getByRole("button", { name: "应用连接", exact: true }).click();
    await dialog
      .getByRole("button", { name: /^查看 (Local Docs|OAuth Docs)$/ })
      .click();
    await expect(connection.getByText(/^可用/)).toBeVisible();
    await connection.getByText("机器人权限", { exact: false }).click();
    await expect(
      connection.getByRole("checkbox", { name: "Domos", exact: true }),
    ).toBeChecked();
    await connection.getByText("已选 1 个工具", { exact: true }).click();
    await expect(
      connection.getByRole("checkbox", { name: "read", exact: true }),
    ).toBeChecked();
    await expect(
      connection.getByRole("checkbox", { name: "write", exact: true }),
    ).not.toBeChecked();
    await connection.getByRole("button", { name: "Local Docs的操作" }).click();
    await page.getByRole("menuitem", { name: "停用", exact: true }).click();
    await expect(connection.getByText(/^已禁用/)).toBeVisible();
    await connection.getByRole("button", { name: "Local Docs的操作" }).click();
    await page.getByRole("menuitem", { name: "启用", exact: true }).click();
    await connection.getByRole("button", { name: "Local Docs的操作" }).click();
    await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
    await dialog
      .getByRole("textbox", { name: "名称", exact: true })
      .fill("Team Docs");
    await expect(
      dialog.getByRole("textbox", { name: "MCP 地址", exact: true }),
    ).toHaveValue("");
    await dialog.getByRole("button", { name: "保存并测试" }).click();
    const renamed = dialog
      .locator(".apps-item")
      .filter({ hasText: "Team Docs" });
    await expect(renamed.getByText(/^可用/)).toBeVisible({ timeout: 20_000 });
    await renamed.getByRole("button", { name: "Team Docs的操作" }).click();
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    const confirmation = page.getByRole("dialog", {
      name: "删除连接",
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    await expect.poll(() => confirmation.boundingBox()).toEqual(frame);
    await expect(
      confirmation
        .locator(".dialog-footer")
        .getByRole("button", { name: "删除", exact: true }),
    ).toBeInViewport();
    await confirmation
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await expect(renamed).toHaveCount(0);
  } finally {
    await upstream.close();
  }
});

test("Apps completes and cancels browser OAuth with stored state", async ({
  service,
  page,
}) => {
  test.setTimeout(90_000);
  const upstream = await mcpFixture({ oauth: true });
  try {
    await page.goto(service.url);
    await page.getByRole("button", { name: "应用连接", exact: true }).click();
    const dialog = page.locator(".apps-dialog");
    await dialog.getByRole("tab", { name: "我的连接", exact: true }).click();
    await dialog.getByRole("button", { name: "添加 MCP", exact: true }).click();
    await dialog.getByRole("button", { name: "手动配置", exact: true }).click();
    await dialog.getByLabel("名称", { exact: true }).fill("OAuth Docs");
    await dialog.getByLabel("MCP 地址", { exact: true }).fill(upstream.url);
    await dialog.getByRole("combobox", { name: "运行／访问电脑" }).click();
    await page.getByRole("option").first().click();
    await dialog.getByRole("button", { name: "保存并测试" }).click();
    const item = dialog.locator(".apps-item").filter({ hasText: "OAuth Docs" });
    await expect(item.getByText(/^待授权/)).toBeVisible({ timeout: 20_000 });
    const login = item.locator(".disclosure").filter({
      has: page.locator("summary", { hasText: /^登录与凭据$/ }),
    });
    await expect(login).toHaveAttribute("open", "");
    const custom = login.locator(".disclosure");
    await custom.locator("summary").click();
    await expect(custom).toHaveAttribute("open", "");
    await expect(login).toHaveAttribute("open", "");
    await custom.locator("summary").click();
    await expect(custom).not.toHaveAttribute("open");
    await expect(login).toHaveAttribute("open", "");
    const popup = page.waitForEvent("popup");
    await item.getByRole("button", { name: "浏览器登录" }).click();
    const authorization = await popup;
    await authorization.getByRole("link", { name: "批准测试授权" }).click();
    await expect(
      authorization.getByText("授权已完成。请返回 Domos 刷新连接。"),
    ).toBeVisible({ timeout: 20_000 });
    await authorization.close();
    await dialog.getByRole("button", { name: "刷新连接" }).click();
    await expect(item.getByText(/^可用/)).toBeVisible();
    await expect(item.getByRole("button", { name: "取消登录" })).toHaveCount(0);
    await item.getByRole("button", { name: "退出登录" }).click();
    const cancelledPopup = page.waitForEvent("popup");
    await item.getByRole("button", { name: "浏览器登录" }).click();
    const cancelled = await cancelledPopup;
    await expect(
      cancelled.getByRole("link", { name: "批准测试授权" }),
    ).toBeVisible();
    await item.getByRole("button", { name: "取消登录" }).click();
    await cancelled.getByRole("link", { name: "批准测试授权" }).click();
    await expect(
      cancelled.getByText("授权失败或已取消。请返回 Domos 重试。"),
    ).toBeVisible();
    await cancelled.close();
    await page.reload();
    await page.getByRole("button", { name: "应用连接", exact: true }).click();
    await dialog
      .getByRole("button", { name: /^查看 (Local Docs|OAuth Docs)$/ })
      .click();
    await item.getByText("登录与凭据", { exact: true }).click();
    await expect(item.getByRole("button", { name: "取消登录" })).toHaveCount(0);
  } finally {
    await upstream.close();
  }
});

test("connection pages distinguish first read, empty search and refreshed native sources", async ({
  service,
  page,
}) => {
  const gate = Promise.withResolvers<void>();
  await page.route("**/rpc/mcp/catalog", async (route) => {
    await gate.promise;
    await route.continue();
  });
  let reads = 0;
  await page.route("**/rpc/mcp/native", async (route) => {
    reads++;
    await route.fulfill({
      json: {
        json: {
          provider: "pi",
          computerId: "local",
          readonly: true,
          status: "complete",
          scope: "configuration",
          errors: [],
          observedAt: 1,
          inheritance: "selectable",
          inherited: false,
          items: [
            {
              name: `原生服务 ${reads}`,
              source: "测试配置",
              enabled: true,
              status: "configured",
            },
          ],
        },
      },
    });
  });
  await page.goto(service.url);
  await page.getByRole("button", { name: "应用连接", exact: true }).click();
  const dialog = page.locator(".apps-dialog");
  await dialog.getByRole("tab", { name: "发现应用", exact: true }).click();
  await expect(
    dialog.getByRole("status", { name: "正在读取连接", exact: true }),
  ).toBeVisible();
  gate.resolve();
  await expect(dialog.getByText("Context7", { exact: true })).toBeVisible();
  await dialog.getByRole("tab", { name: "我的连接", exact: true }).click();
  await expect(
    dialog.getByRole("combobox", { name: "选择机器人" }),
  ).toHaveCount(0);
  await expect(dialog.getByText("原生服务 1", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "刷新连接", exact: true }).click();
  await expect(dialog.getByText("原生服务 2", { exact: true })).toBeVisible();
  await expect(dialog.getByText("原生服务 1", { exact: true })).toHaveCount(0);
});
