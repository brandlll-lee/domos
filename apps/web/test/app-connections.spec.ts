import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect, type Page } from "@playwright/test";
import { mcpFixture } from "../../../packages/agent/test/fixtures/mcp.mjs";
import type { AppRouter } from "../../api/src/router.ts";
import { openDetails } from "./fixtures/chat-ui.ts";
import { test } from "./fixtures/service.ts";

const surface = (page: Page) => page.locator(".connection-surface");
async function openCenter(page: Page, view = "发现应用") {
  await page.getByRole("button", { name: "应用连接", exact: true }).click();
  await surface(page).getByRole("tab", { name: view, exact: true }).click();
  return surface(page);
}
async function addConnection(page: Page, name: string, url: string) {
  await surface(page)
    .getByRole("button", { name: "添加 MCP", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "添加 MCP", exact: true });
  await editor.getByLabel("名称", { exact: true }).fill(name);
  await editor.getByLabel("MCP 地址", { exact: true }).fill(url);
  await editor.getByRole("button", { name: "保存并测试" }).click();
}

test("connection center opens Discover apps as a workspace page", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  await page.getByLabel("消息", { exact: true }).fill("保留这段草稿");
  const details = await openDetails(page);
  await page.getByRole("button", { name: "应用连接", exact: true }).click();
  const center = page.getByRole("region", { name: "连接中心", exact: true });
  await expect(center).toBeVisible();
  await expect(center.getByRole("tab", { name: "发现应用" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(center.locator('xpath=ancestor::*[@role="dialog"]')).toHaveCount(
    0,
  );
  await expect(details).not.toBeVisible();
  await center.getByRole("button", { name: "返回聊天" }).click();
  await expect(page.getByLabel("消息", { exact: true })).toHaveText(
    "保留这段草稿",
  );
  await expect(details).toBeVisible();
});

test("connection pages keep aligned rows and a readable final row in both themes", async ({
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
  const center = await openCenter(page, "我的连接");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1600, 768, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(center.locator(".connection-list-row")).toHaveCount(30);
      expect(
        await center.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      const rows = center.locator(".connection-list-row");
      const a = await rows.nth(0).boundingBox();
      const b = await rows.nth(1).boundingBox();
      if (width === 1600)
        expect(Math.abs((a?.y ?? 0) - (b?.y ?? 0))).toBeLessThan(1);
      else expect(b?.y).toBeGreaterThan(a?.y ?? 0);
      const last = rows.filter({ hasText: "Service 29" });
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      await expect(last.locator(".status-dot")).toHaveAttribute(
        "data-tone",
        "neutral",
      );
      await center.screenshot({
        path: info.outputPath(`connections-${theme}-${width}.png`),
      });
    }
  }
});

test("native details keep source, status and tool evidence and restore row focus", async ({
  service,
  page,
}) => {
  await page.route("**/rpc/mcp/native", (route) =>
    route.fulfill({
      json: {
        json: {
          provider: "opencode",
          computerId: "pc",
          readonly: true,
          status: "complete",
          scope: "configuration",
          errors: [],
          observedAt: 1,
          inheritance: "native",
          inherited: true,
          items: [
            {
              name: "exa",
              source: "project-config",
              enabled: true,
              status: "connected",
            },
            {
              name: "registry",
              source: "user-config",
              enabled: true,
              status: "needs_client_registration",
            },
            {
              name: "tavily",
              source: "user-config",
              enabled: true,
              status: "connected",
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
            },
          ],
        },
      },
    }),
  );
  await page.goto(service.url);
  const center = await openCenter(page, "我的连接");
  await expect(center.locator('[data-row-id="native:registry"]')).toContainText(
    "需要客户端注册",
  );
  await center.getByRole("searchbox").fill("tavily");
  await expect(center.locator(".connection-list-row")).toHaveCount(1);
  await center.getByRole("searchbox").fill("");
  const exa = center.locator('[data-row-id="native:exa"]');
  await exa.click();
  await expect(
    center.getByRole("heading", { name: "exa", exact: true }),
  ).toBeVisible();
  await expect(
    center.getByText("project-config", { exact: true }),
  ).toBeVisible();
  await expect(
    center.getByText("工作目录配置；不代表当前会话已挂载"),
  ).toBeVisible();
  await center.getByRole("tab", { name: "工具", exact: true }).click();
  await expect(
    center.getByText("未提供工具目录", { exact: true }),
  ).toBeVisible();
  await expect(
    center.getByRole("button", { name: "编辑", exact: true }),
  ).toHaveCount(0);
  await center.getByRole("button", { name: "连接中心", exact: true }).click();
  await expect(exa).toBeFocused();
  await center.locator('[data-row-id="native:tavily"]').click();
  await center.getByRole("tab", { name: "工具", exact: true }).click();
  await center.locator("summary").filter({ hasText: "search" }).click();
  await expect(
    center.getByText("Search the web", { exact: true }),
  ).toBeVisible();
  await expect(center.getByText('"query"', { exact: false })).toBeVisible();
});

test("catalog details and import retain configuration validation and focus", async ({
  service,
  page,
}, info) => {
  await page.goto(service.url);
  const center = await openCenter(page);
  await center
    .locator(".connection-catalog-link")
    .filter({ hasText: "Microsoft Learn" })
    .click();
  await expect(center.locator(".connection-preview-message")).toHaveCount(3);
  await center.getByRole("button", { name: "连接应用", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "添加 MCP", exact: true });
  await expect(editor.getByLabel("名称", { exact: true })).toHaveValue(
    "Microsoft Learn",
  );
  await expect(editor.getByLabel("MCP 地址", { exact: true })).toHaveValue(
    "https://learn.microsoft.com/api/mcp",
  );
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(
    center.getByRole("button", { name: "连接应用", exact: true }),
  ).toBeFocused();
  await center.getByRole("button", { name: "连接中心", exact: true }).click();
  await center.getByRole("button", { name: "添加 MCP", exact: true }).click();
  await expect(editor.getByLabel("名称", { exact: true })).toBeFocused();
  await editor.getByRole("button", { name: "导入配置" }).click();
  const paste = editor.getByRole("textbox", {
    name: "MCP 地址或配置",
    exact: true,
  });
  await expect(paste).toBeFocused();
  await paste.fill("{broken");
  await editor.getByRole("button", { name: "继续", exact: true }).click();
  await expect(editor.getByRole("alert")).toBeVisible();
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
  await expect(editor.getByLabel("名称", { exact: true })).toBeFocused();
  await expect(
    editor.getByRole("radio", { name: "服务地址", exact: true }),
  ).toBeChecked();
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
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 390, height: 500 });
    await expect(
      editor.getByRole("button", { name: "保存并测试" }),
    ).toBeInViewport();
    expect(
      await editor.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await editor.screenshot({ path: info.outputPath(`editor-${theme}.png`) });
  }
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(
    center.getByRole("button", { name: "添加 MCP", exact: true }),
  ).toBeFocused();
});

test("saved connections retain failed checks and support retry after reload", async ({
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
    const center = await openCenter(page);
    await addConnection(page, "Unavailable Docs", upstream.url);
    await expect(center).toContainText("检查中");
    release.resolve();
    await expect(center).toContainText("检查失败");
    await center.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(
      center.getByRole("button", { name: "测试连接", exact: true }),
    ).toBeEnabled();
    await page.reload();
    await openCenter(page, "我的连接");
    await expect(
      center
        .locator(".connection-list-row")
        .filter({ hasText: "Unavailable Docs" }),
    ).toHaveCount(1);
    await center
      .locator(".connection-list-row")
      .filter({ hasText: "Unavailable Docs" })
      .click();
    await expect(center).toContainText("检查失败");
  } finally {
    release.resolve();
  }
});

test("local command edits retain transport and stored credentials", async ({
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
  const center = await openCenter(page, "我的连接");
  await center
    .locator(".connection-list-row")
    .filter({ hasText: "Local Tools" })
    .click();
  await center.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑连接", exact: true });
  await expect(
    editor.getByRole("radio", { name: "本地命令", exact: true }),
  ).toBeChecked();
  await expect(editor.getByLabel("启动程序", { exact: true })).toHaveValue("");
  await expect(
    editor.getByText("留空保留已有配置和凭据。填写新配置会替换它们。"),
  ).toBeVisible();
  await expect(
    editor.getByRole("textbox", { name: "参数（JSON 数组）", exact: true }),
  ).not.toBeVisible();
  await editor.locator("summary").filter({ hasText: "高级设置" }).click();
  await expect(
    editor.getByRole("textbox", { name: "参数（JSON 数组）", exact: true }),
  ).toBeVisible();
  await editor.getByRole("button", { name: "保存并测试" }).click();
  await expect(center).toContainText("已禁用");
  expect((await rpc.mcp.list())[0]?.transport).toBe("stdio");
});

test("native source failures stay distinct from empty catalogs and can be retried", async ({
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
  const center = await openCenter(page, "我的连接");
  await expect(center.getByRole("alert")).toContainText("原生连接读取失败");
  await expect(center.getByText("还没有应用连接", { exact: true })).toHaveCount(
    0,
  );
  await center.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(center.getByRole("alert")).toContainText("原生连接读取失败");
});

test("shared native service details retain separate statuses, tools and inheritance", async ({
  service,
  page,
}) => {
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const peer = await rpc.bots.create({
    name: "Reviewer",
    requestId: crypto.randomUUID(),
  });
  await page.route("**/rpc/mcp/native", (route) => {
    const id = route.request().postDataJSON().json.botId;
    return route.fulfill({
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
  const center = await openCenter(page, "我的连接");
  const row = center
    .locator(".connection-list-row")
    .filter({ hasText: "Shared Docs" });
  await expect(row).toContainText("2 个来源");
  await expect(row).toContainText("状态不一");
  await expect(center.getByRole("alert")).toContainText(
    "One directory unavailable",
  );
  await row.click();
  const reviewer = center
    .locator(".connection-source-card")
    .filter({ hasText: "Reviewer" });
  await expect(reviewer).toContainText("连接失败");
  await expect(reviewer).toContainText(`project-${peer.id}`);
  await center.getByRole("tab", { name: "工具", exact: true }).click();
  await expect(center.getByText("工具目录为空", { exact: true })).toBeVisible();
  await center.getByRole("button", { name: "连接中心", exact: true }).click();
  await center
    .getByRole("button", { name: "原生连接设置", exact: true })
    .click();
  await expect(
    center.getByRole("switch", { name: "Reviewer沿用原生连接", exact: true }),
  ).not.toBeChecked();
});

test("empty native catalogs retain supported inheritance controls", async ({
  service,
  page,
}) => {
  await page.route("**/rpc/mcp/native", (route) =>
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
  const center = await openCenter(page);
  await center
    .getByRole("button", { name: "原生连接设置", exact: true })
    .click();
  await expect(
    center.getByRole("switch", { name: /沿用原生连接/ }),
  ).toBeVisible();
});

test("managed connections retain tool grants, enablement, editing and deletion", async ({
  service,
  page,
}, info) => {
  test.setTimeout(60_000);
  const upstream = await mcpFixture();
  try {
    await page.goto(service.url);
    const center = await openCenter(page);
    const search = center.getByRole("searchbox", { name: "搜索应用" });
    await search.fill("Context7");
    await expect(center.locator(".connection-catalog-row")).toHaveCount(1);
    await center
      .getByRole("button", { name: "清除搜索应用", exact: true })
      .click();
    await expect(search).toBeFocused();
    await search.fill("不存在");
    await expect(
      center.getByText("没有找到匹配的应用", { exact: true }),
    ).toBeVisible();
    await center.getByRole("button", { name: "清除筛选" }).click();
    for (const theme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      for (const width of [1360, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect
          .poll(() =>
            center.evaluate((node) => node.scrollWidth <= node.clientWidth),
          )
          .toBe(true);
        await center.screenshot({
          path: info.outputPath(`catalog-${theme}-${width}.png`),
        });
      }
    }
    await page.setViewportSize({ width: 1360, height: 900 });
    await addConnection(page, "Local Docs", upstream.url);
    await expect(center.locator(".connection-page-head")).toContainText(
      "可用",
      { timeout: 20_000 },
    );
    await center.getByRole("tab", { name: "伙伴权限" }).click();
    await center
      .getByRole("checkbox", { name: "Domos允许使用", exact: true })
      .click();
    await expect(
      center.getByRole("checkbox", { name: "全部工具", exact: true }),
    ).toBeChecked();
    await center
      .getByRole("checkbox", { name: "全部工具", exact: true })
      .click();
    await center.getByRole("checkbox", { name: "read", exact: true }).click();
    await expect(
      center.getByRole("checkbox", { name: "read", exact: true }),
    ).toBeChecked();
    await page.reload();
    await openCenter(page, "我的连接");
    await center
      .locator(".connection-list-row")
      .filter({ hasText: "Local Docs" })
      .click();
    await center.getByRole("tab", { name: "伙伴权限" }).click();
    await expect(
      center.getByRole("checkbox", { name: "read", exact: true }),
    ).toBeChecked();
    await expect(
      center.getByRole("checkbox", { name: "write", exact: true }),
    ).not.toBeChecked();
    await center.getByRole("button", { name: "连接操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "停用", exact: true }).click();
    await expect(center.locator(".connection-page-head")).toContainText(
      "已禁用",
    );
    await center.getByRole("button", { name: "连接操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "启用", exact: true }).click();
    await expect(center.locator(".connection-page-head")).not.toContainText(
      "已禁用",
    );
    await center.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑连接", exact: true });
    await editor.getByLabel("名称", { exact: true }).fill("Team Docs");
    await expect(editor.getByLabel("MCP 地址", { exact: true })).toHaveValue(
      "",
    );
    await editor.getByRole("button", { name: "保存并测试" }).click();
    await expect(
      center.getByRole("heading", { name: "Team Docs", exact: true }),
    ).toBeVisible();
    await expect(center.locator(".connection-page-head")).toContainText(
      "可用",
      { timeout: 20_000 },
    );
    await center.getByRole("button", { name: "连接操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "删除连接", exact: true }).click();
    await expect(
      center.getByRole("heading", { name: "Team Docs", exact: true }),
    ).toBeVisible();
    await center.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(
      center.getByRole("heading", { name: "连接中心", exact: true }),
    ).toBeVisible();
    const rpc: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ url: `${service.url}/rpc` }),
    );
    expect(await rpc.mcp.list()).toHaveLength(0);
  } finally {
    await upstream.close();
  }
});

test("managed connections complete and cancel browser OAuth with stored state", async ({
  service,
  page,
}) => {
  test.setTimeout(90_000);
  const upstream = await mcpFixture({ oauth: true });
  try {
    await page.goto(service.url);
    const center = await openCenter(page);
    await addConnection(page, "OAuth Docs", upstream.url);
    await expect(center.locator(".connection-page-head")).toContainText(
      "待授权",
      { timeout: 20_000 },
    );
    const login = center
      .locator(".disclosure")
      .filter({ has: page.locator("summary", { hasText: /^登录与凭据$/ }) });
    await expect(login).toHaveAttribute("open", "");
    const custom = login.locator(".disclosure");
    await custom.locator("summary").click();
    await expect(custom).toHaveAttribute("open", "");
    await custom.locator("summary").click();
    await expect(login).toHaveAttribute("open", "");
    const popup = page.waitForEvent("popup");
    await center.getByRole("button", { name: "浏览器登录" }).click();
    const authorization = await popup;
    await authorization.getByRole("link", { name: "批准测试授权" }).click();
    await expect(
      authorization.getByText("授权已完成。请返回 Domos 刷新连接。"),
    ).toBeVisible({ timeout: 20_000 });
    await authorization.close();
    await center.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(center.locator(".connection-page-head")).toContainText(
      "可用",
      { timeout: 20_000 },
    );
    await center.getByRole("button", { name: "退出登录" }).click();
    const cancelledPopup = page.waitForEvent("popup");
    await center.getByRole("button", { name: "浏览器登录" }).click();
    const cancelled = await cancelledPopup;
    await expect(
      cancelled.getByRole("link", { name: "批准测试授权" }),
    ).toBeVisible();
    await center.getByRole("button", { name: "取消登录" }).click();
    await cancelled.getByRole("link", { name: "批准测试授权" }).click();
    await expect(
      cancelled.getByText("授权失败或已取消。请返回 Domos 重试。"),
    ).toBeVisible();
    await cancelled.close();
    await page.reload();
    await openCenter(page, "我的连接");
    await center
      .locator(".connection-list-row")
      .filter({ hasText: "OAuth Docs" })
      .click();
    await expect(center.getByRole("button", { name: "取消登录" })).toHaveCount(
      0,
    );
  } finally {
    await upstream.close();
  }
});

test("connection pages retain first-read and refresh states", async ({
  service,
  page,
}) => {
  const gate = Promise.withResolvers<void>();
  await page.route("**/rpc/mcp/catalog", async (route) => {
    await gate.promise;
    await route.continue();
  });
  let reads = 0;
  await page.route("**/rpc/mcp/native", (route) => {
    reads++;
    return route.fulfill({
      json: {
        json: {
          provider: "pi",
          computerId: "pc",
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
  try {
    await page.goto(service.url);
    const center = await openCenter(page);
    await expect(
      center.getByRole("status", { name: "正在读取连接", exact: true }),
    ).toBeVisible();
    gate.resolve();
    await expect(center.getByText("Context7", { exact: true })).toBeVisible();
    await center.getByRole("tab", { name: "我的连接", exact: true }).click();
    await expect(center.getByText("原生服务 1", { exact: true })).toBeVisible();
    await center.getByRole("button", { name: "刷新连接", exact: true }).click();
    await expect(center.getByText("原生服务 2", { exact: true })).toBeVisible();
    await expect(center.getByText("原生服务 1", { exact: true })).toHaveCount(
      0,
    );
  } finally {
    gate.resolve();
  }
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
    const center = surface(page);
    await center.getByRole("tab", { name: "我的连接", exact: true }).click();
    await expect(
      center.getByRole("combobox", { name: "选择机器人" }),
    ).toHaveCount(0);
    await expect(
      center.locator(".connection-list-row").filter({ hasText: "Shared Docs" }),
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
