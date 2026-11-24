import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect } from "@playwright/test";
import { mcpFixture } from "../../../packages/agent/test/fixtures/mcp.mjs";
import type { AppRouter } from "../../api/src/router.ts";
import { test } from "./fixtures/service.ts";

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
      mcpServers: { Docs: { url: "https://example.com/mcp" } },
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
    await dialog.getByRole("button", { name: "返回", exact: true }).click();
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

test("native connections require explicit Bot context and keep read failures visible", async ({
  service,
  page,
}) => {
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const bot = (await rpc.bots.list())[0];
  if (!bot) throw new Error("Missing Bot");
  const id = crypto.randomUUID();
  await rpc.teams.create({
    id,
    name: "Review Team",
    purpose: "Review",
    owner: bot.id,
    members: [bot.id],
  });
  let reads = 0;
  await page.route("**/rpc/mcp/native", async (route) => {
    reads++;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      json: {
        json: {
          code: "SERVICE_UNAVAILABLE",
          message: "Native catalog unavailable",
        },
      },
    });
  });
  await page.goto(`${service.url}/#team/${id}`);
  await expect(
    page.getByRole("button", { name: "团队详情", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "应用连接", exact: true }).click();
  const dialog = page.locator(".apps-dialog");
  const picker = dialog.getByRole("combobox", {
    name: "选择机器人",
    exact: true,
  });
  await expect(picker).toHaveText("选择机器人");
  expect(reads).toBe(0);
  await picker.click();
  await expect(
    page.getByRole("option", { name: "选择机器人", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("option", { name: bot.name, exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("原生连接读取失败");
  const native = dialog.getByRole("button", {
    name: "引擎原生连接",
    exact: false,
  });
  await expect(native).toHaveAttribute("aria-expanded", "true");
  await native.click();
  await expect(native).toHaveAttribute("aria-expanded", "false");
  await expect(dialog.getByRole("alert")).toContainText("原生连接读取失败");
  expect(reads).toBe(1);
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
      center.getByRole("combobox", { name: "选择机器人", exact: true }),
    ).toContainText("Domos");
    await center
      .getByRole("button", { name: "引擎原生连接", exact: false })
      .click();
    await expect(center.locator(".apps-native-row")).toContainText(
      "Shared Docs",
    );
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
    expect(await dialog.boundingBox()).toEqual(frame);
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
  ).toContainText("Domos");
  await dialog
    .getByRole("button", { name: "引擎原生连接", exact: false })
    .click();
  await expect(dialog.getByText("原生服务 1", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "刷新连接", exact: true }).click();
  await expect(dialog.getByText("原生服务 2", { exact: true })).toBeVisible();
  await expect(dialog.getByText("原生服务 1", { exact: true })).toHaveCount(0);
});
