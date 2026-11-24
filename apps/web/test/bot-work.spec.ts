import { once } from "node:events";
import { createRequire } from "node:module";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect } from "@playwright/test";
import { codexWork } from "../../../packages/agent/test/fixtures/native-work.ts";
import type { AppRouter } from "../../api/src/router.ts";
import { openDetails } from "./fixtures/chat-ui.ts";
import { test } from "./fixtures/service.ts";

test("Bot readers retain model and skill data while live skill changes reach the composer", async ({
  service,
  page,
}) => {
  const rpc: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const bot = (await rpc.bots.list())[0];
  if (!bot) throw new Error("Bot required");
  const skill = await rpc.work.skills.save({
    botId: bot.id,
    id: crypto.randomUUID(),
    revision: 0,
    requestId: crypto.randomUUID(),
    content:
      "---\nname: shared-report\ndescription: Report\n---\nRead source files",
  });
  await rpc.work.skills.enable({
    botId: bot.id,
    id: skill.id,
    revision: skill.revision,
    enabled: true,
    requestId: crypto.randomUUID(),
  });
  const enabledSkill = (await rpc.work.get({ botId: bot.id })).skills.find(
    (item) => item.id === skill.id,
  );
  if (!enabledSkill) throw new Error("Skill required");
  const reads = { work: 0, model: 0, inspect: 0 };
  page.on("request", (request) => {
    if (request.url().endsWith("/rpc/work/get")) reads.work++;
    if (request.url().endsWith("/rpc/engines/get")) reads.model++;
    if (request.url().endsWith("/rpc/engines/inspect")) reads.inspect++;
  });
  await page.goto(service.url);
  const details = await openDetails(page);
  const model = details.getByRole("combobox", { name: "模型", exact: true });
  await expect(model).toContainText("测试模型一");
  await model.click();
  await expect(
    page.getByRole("option", { name: "Pi · 测试模型二", exact: true }),
  ).toBeVisible();
  const initial = { ...reads };
  await page.keyboard.press("Escape");
  await details
    .getByRole("button", { name: "模型与账号", exact: true })
    .click();
  await expect(
    details.getByRole("combobox", { name: "模型", exact: true }),
  ).toBeVisible();
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  const add = page.getByRole("button", { name: "添加内容", exact: true });
  const open = async () => {
    await add.click();
    await page
      .getByRole("menuitem", { name: "使用技能…", exact: true })
      .click();
  };
  await open();
  const choice = page.getByRole("button", {
    name: "shared-report",
    exact: true,
  });
  await expect(choice).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await open();
  await expect(choice).toBeVisible();
  expect(reads).toEqual(initial);
  expect(reads.model).toBe(1);
  expect(reads.work).toBe(1);
  await rpc.work.skills.enable({
    botId: bot.id,
    id: skill.id,
    revision: enabledSkill.revision,
    enabled: false,
    requestId: crypto.randomUUID(),
  });
  await expect(choice).toHaveCount(0);
  expect(reads.work).toBe(1);
});

test("routine forms share quiet pointer focus and keep actions outside scrolling", async ({
  service,
  page,
}, info) => {
  await page.goto(service.url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const details = page.locator("#bot-details");
  await details.getByRole("button", { name: /^定时(?:\s|$)/ }).click();
  await details
    .getByRole("button", { name: "新建定时任务", exact: true })
    .click();
  const name = details.getByRole("textbox", { name: "任务名称", exact: true });
  await expect(name).toBeVisible();
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await name.click();
    await expect(name).toHaveCSS("outline-style", "none");
    await name.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(name).toBeFocused();
    await expect(name).toHaveCSS("outline-style", "solid");
    await name.click();
    expect(
      await name.evaluate((el) => getComputedStyle(el).borderColor),
    ).not.toBe(
      await name.evaluate((el) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--color-focus)";
        el.appendChild(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      }),
    );
    await expect(details.locator("select")).toHaveCount(0);
    const footer = details.locator(".detail-footer");
    await expect(footer).toBeVisible();
    expect(
      await footer.evaluate((el) => Boolean(el.closest(".scroll-viewport"))),
    ).toBe(false);
    await details
      .getByRole("combobox", { name: "交付方式", exact: true })
      .click();
    await page
      .getByRole("option", { name: "满足条件才通知", exact: true })
      .click();
    await expect(
      details.getByRole("textbox", { name: "通知条件", exact: true }),
    ).toBeVisible();
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() => details.evaluate((el) => el.scrollWidth <= el.clientWidth))
        .toBe(true);
      const before = await footer.boundingBox();
      await details.locator(".detail-content:visible").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      expect(await footer.boundingBox()).toEqual(before);
      await details.screenshot({
        path: info.outputPath(`routine-form-${theme}-${width}.png`),
      });
    }
    await page.setViewportSize({ width: 1360, height: 900 });
  }
});

test("Work follows a native turn, opens its record and preserves it after stop and reload", async ({
  service,
  page,
}, info) => {
  service.worker.send("gate");
  await once(service.worker, "message");
  await page.goto(service.url);
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByLabel("消息", { exact: true }).fill("检查 Work 工作记录");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const card = page.locator(".work-row").first();
  await expect(
    card.getByRole("button", { name: "停止执行", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "当前工作", exact: true }),
  ).toContainText("检查 Work 工作记录");
  await expect(card.locator(".work-subject")).toHaveText("检查 Work 工作记录");
  await expect(card.locator(".engine-mark, .bot-avatar")).toHaveCount(0);
  await expect(card.locator(".status-dot")).toHaveAttribute(
    "data-tone",
    "positive",
  );
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(card.locator(".status-dot")).toHaveCSS(
      "background-color",
      "rgb(37, 216, 132)",
    );
    await page.screenshot({
      path: info.outputPath(`work-active-${theme}.png`),
    });
  }
  await card.locator(".work-open").hover();
  await page.screenshot({ path: info.outputPath("work-running.png") });
  await card.locator(".work-open").click();
  const detail = page.getByRole("region", { name: "工作记录", exact: true });
  await expect(detail).toContainText("检查 Work 工作记录");
  await expect(
    page.getByRole("dialog", { name: "工作记录", exact: true }),
  ).toHaveCount(0);
  await expect(card).not.toBeVisible();
  await detail
    .getByRole("button", { name: "返回工作列表", exact: true })
    .click();
  await expect(card.locator(".work-open")).toBeFocused();
  await card.locator(".work-open").click();
  const dialog = page.getByRole("region", { name: "工作记录", exact: true });
  await expect(dialog).toContainText("检查 Work 工作记录");
  await dialog
    .getByRole("button", { name: "返回工作列表", exact: true })
    .click();
  await expect(card.locator(".work-open")).toBeFocused();
  await card.getByRole("button", { name: "停止执行", exact: true }).click();
  await expect(card).toContainText("已停止");
  await expect(
    page.getByRole("region", { name: "当前工作", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "今天", exact: true }),
  ).toContainText("检查 Work 工作记录");
  await expect(card.locator("time").first()).toHaveAttribute("datetime", /T/);
  await expect(dialog).not.toBeVisible();
  await expect(card.locator(".status-dot")).toHaveCount(0);
  await page.reload();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await expect(card).toContainText("已停止");
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await card.locator(".work-open").click();
    await expect(
      page.getByRole("dialog", { name: "工作记录", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`work-detail-${theme}.png`),
    });
    await dialog
      .getByRole("button", { name: "返回工作列表", exact: true })
      .click();
    await page.screenshot({ path: info.outputPath(`work-${theme}.png`) });
  }
  await card.locator(".work-open").click();
  await expect(dialog).toContainText("已停止");
  await dialog
    .getByRole("button", { name: "返回工作列表", exact: true })
    .click();
  service.worker.send({
    content: [
      { type: "thinking", thinking: "核对原生记录。" },
      {
        type: "toolCall",
        id: "work-tool",
        name: service.toolName,
        arguments: { text: "原生工具回执" },
      },
    ],
    stopReason: "toolUse",
  });
  await once(service.worker, "message");
  service.worker.send("gate-tool");
  await once(service.worker, "message");
  await page.getByLabel("消息", { exact: true }).fill("检查原生工具");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(card).toContainText("正在使用工具");
  await card.locator(".work-open").click();
  await expect(dialog.locator(".work-entry[data-state=running]")).toHaveCount(
    1,
  );
  service.worker.send("release");
  await once(service.worker, "message");
  await expect(dialog).toContainText("执行已结束", { timeout: info.timeout });
  await expect(
    dialog.locator("summary").filter({ hasText: service.toolName }),
  ).toHaveCount(1);
  await expect(dialog.locator(".work-entry[data-state=running]")).toHaveCount(
    0,
  );
  await expect(dialog.locator(".work-entry").last()).toContainText("已收到");
  await dialog
    .getByRole("button", { name: "返回工作列表", exact: true })
    .click();
  await expect(page.locator(".work-row")).toHaveCount(2);
  await expect(card).toHaveCSS("border-width", "0px");
  await expect(page.locator(".work-list")).toHaveCSS("border-width", "0px");
  const cards = await page.locator(".work-row").all();
  const first = await cards[0]?.boundingBox();
  const second = await cards[1]?.boundingBox();
  if (!first || !second) throw new Error("Work cards missing");
  expect(second.y - first.y - first.height).toBe(4);
  await card.locator(".work-open").click();
  await dialog.locator("summary").filter({ hasText: "原生思考" }).click();
  await expect(dialog).toContainText("核对原生记录。");
  await dialog.locator("summary").filter({ hasText: service.toolName }).click();
  await expect(
    dialog.locator(".work-operation-body").filter({ hasText: "原生工具回执" }),
  ).toBeVisible();
  await expect(dialog.getByRole("list", { name: "执行时间线" })).toBeVisible();
  await expect(dialog.locator(".work-entry[data-state=done]")).toHaveCount(1);
  await expect(
    dialog.locator("summary").filter({ hasText: /^回复/ }),
  ).toHaveCount(1);
  await expect(dialog).not.toContainText("Harness 未提供思考内容");
  await expect(dialog.locator(".work-step-time").first()).toBeVisible();
  await expect(dialog).toContainText("原生工具回执");
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(dialog.locator(".work-node").first()).toHaveCSS(
      "width",
      "32px",
    );
    await page.screenshot({
      path: info.outputPath(`work-timeline-${theme}.png`),
    });
  }
  const recordCount = await dialog.locator(".work-entry").count();
  await dialog
    .getByRole("button", { name: "返回工作列表", exact: true })
    .click();
  await page.reload();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await card.locator(".work-open").click();
  await expect(dialog.locator(".work-entry")).toHaveCount(recordCount);
  await dialog.locator("summary").filter({ hasText: service.toolName }).click();
  await expect(dialog).toContainText("原生工具回执");
  await dialog
    .getByRole("button", { name: "返回工作列表", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await card.boundingBox())?.height).toBeGreaterThanOrEqual(48);
  const label = card.locator(".work-label");
  await expect(label).toHaveCSS("min-width", "0px");
  await expect(label.locator("span").first()).toHaveCSS(
    "text-overflow",
    "ellipsis",
  );
  await page.screenshot({ path: info.outputPath("work-narrow.png") });
});

test("Work restores list reading and loads tool evidence only when expanded", async ({
  service,
  page,
}, info) => {
  await service.control({ history: 40 });
  await service.control({
    records: [
      {
        id: "lazy-input",
        turnId: "lazy",
        role: "user",
        stopped: false,
        content: [{ type: "text", key: "input", text: "读取工具证据" }],
      },
      {
        id: "lazy-call",
        turnId: "lazy",
        role: "assistant",
        stopped: false,
        timestamp: 1000,
        parentId: "parent",
        content: [
          {
            type: "toolCall",
            id: "lazy-tool",
            key: "call",
            name: "read",
            arguments: { path: "report.txt" },
          },
        ],
      },
      {
        id: "lazy-result",
        turnId: "lazy",
        role: "toolResult",
        toolCallId: "lazy-tool",
        toolStatus: "done",
        stopped: false,
        timestamp: 3000,
        content: [{ type: "text", key: "result", text: "完整的原始工具证据" }],
      },
    ],
  });
  const reads: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/rpc/message")) reads.push(request.url());
  });
  await page.goto(service.url);
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  const source = page.getByRole("button", {
    name: "查看工作记录：历史任务 15",
    exact: true,
  });
  await source.scrollIntoViewIfNeeded();
  const viewport = page.locator(
    ".detail-scroll:not([hidden]) > .scroll-viewport",
  );
  const top = await viewport.evaluate((node) => node.scrollTop);
  expect(top).toBeGreaterThan(0);
  await source.click();
  const detail = page.getByRole("region", { name: "工作记录", exact: true });
  await detail
    .getByRole("button", { name: "返回工作列表", exact: true })
    .click();
  await expect(source).toBeFocused();
  expect(await viewport.evaluate((node) => node.scrollTop)).toBeCloseTo(top, 0);
  await page
    .getByRole("button", { name: "查看工作记录：读取工具证据", exact: true })
    .click();
  const entry = detail.locator(".work-entry");
  await expect(entry).toHaveAttribute("data-parent", "parent");
  await expect(entry).toContainText("2秒");
  await expect(entry.locator(".work-operation-body")).toHaveCount(0);
  expect(reads).toHaveLength(0);
  await entry.locator("summary").click();
  await expect(entry.locator(".work-operation-body")).toContainText(
    "完整的原始工具证据",
  );
  expect(reads).toHaveLength(1);
  await entry.locator("summary").click();
  await expect(entry.locator(".work-operation-body")).toHaveCount(0);
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        detail.evaluate((node) => node.scrollWidth <= node.clientWidth),
      )
      .toBe(true);
    await detail.screenshot({
      path: info.outputPath(`timeline-narrow-${theme}.png`),
      animations: "disabled",
    });
  }
});

test("Work renders native search, file and terminal details in both themes", async ({
  service,
  page,
}, info) => {
  const turnId = "native-work";
  service.worker.send({
    records: [
      {
        id: "native-request",
        turnId,
        role: "user",
        content: [
          { type: "text", key: "request", text: "检查搜索、文件和命令" },
        ],
        stopped: false,
      },
      ...codexWork
        .filter((item) => item.type !== "agentMessage")
        .flatMap((item) => [
          {
            id: `native:${item.id}`,
            turnId,
            role: "assistant",
            content: [
              {
                type: "toolCall",
                key: item.id,
                id: item.id,
                name: item.type,
                arguments: {
                  ...(item.command ? { command: item.command } : {}),
                  ...(item.query ? { query: item.query } : {}),
                },
              },
            ],
            stopped: false,
          },
          {
            id: `native:${item.id}:result`,
            turnId,
            role: "toolResult",
            toolCallId: item.id,
            content: [],
            native: {
              ...item,
              ...(item.type === "commandExecution" ? { durationMs: 2300 } : {}),
            },
            toolStatus: "done",
            stopped: false,
          },
        ]),
    ],
  });
  await once(service.worker, "message");
  await page.goto(service.url);
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.locator(".work-open").first().click();
  const dialog = page.getByRole("region", { name: "工作记录", exact: true });
  const entries = dialog.locator(".work-entry");
  await expect(entries).toHaveCount(4);
  await expect(entries.filter({ hasText: "commandExecution" })).toContainText(
    "2.3秒",
  );
  await expect(dialog.locator(".work-terminal")).toHaveCount(0);
  await expect(entries.first()).toContainText("耗时未知");
  await expect(entries.first().locator(".work-node")).toHaveCSS(
    "width",
    "32px",
  );
  await dialog
    .locator("summary")
    .filter({ hasText: "commandExecution" })
    .click();
  await expect(dialog.locator(".work-terminal")).toContainText(
    "node --version",
  );
  await expect(dialog.locator(".work-terminal")).toContainText("v24.16.0");
  await expect(
    dialog.locator(".work-terminal-line").first().locator("span"),
  ).toHaveText("IN");
  await expect(
    dialog.locator(".work-terminal-line").nth(1).locator("span"),
  ).toHaveText("OUT");
  await expect(dialog).toContainText("退出码 0");
  await dialog.locator("summary").filter({ hasText: "webSearch" }).click();
  await expect(dialog).toContainText("example assets source");
  await dialog.locator("summary").filter({ hasText: "fileChange" }).click();
  await expect(dialog.locator(".work-file")).toContainText("note.md");
  await expect(dialog.locator(".work-file")).toContainText("+confirmed");
  await expect(entries.locator(":scope > time")).toHaveCount(0);
  await dialog.getByRole("button", { name: "诊断信息", exact: true }).click();
  await expect(page.locator(".work-diagnostics")).toContainText(
    "历史记录未保存",
  );
  await page.keyboard.press("Escape");
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    const line = await entries.first().evaluate((el) => {
      const line = getComputedStyle(el, "::before");
      const node = el.querySelector(".work-node");
      if (!node) throw new Error("Timeline node required");
      return {
        line: line.width,
        node: getComputedStyle(node).width,
        position: line.left,
      };
    });
    expect(line).toEqual({ line: "1px", node: "32px", position: "15.5px" });
    await expect(entries.last()).toHaveCSS("padding-bottom", "0px");
    await page.screenshot({
      path: info.outputPath(`work-native-${theme}.png`),
    });
  }
});

test("Work locates a failed native tool and copies bounded diagnostics", async ({
  service,
  page,
  context,
}, info) => {
  await service.control({
    records: [
      {
        id: "request",
        turnId: "failure",
        role: "user",
        content: [{ type: "text", key: "request", text: "检查工具失败" }],
        stopped: false,
      },
      {
        id: "call",
        turnId: "failure",
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "tool",
            key: "tool",
            name: "image_generate",
            arguments: { prompt: "private-input" },
          },
          {
            type: "toolCall",
            id: "pending",
            key: "pending",
            name: "read",
            arguments: {},
          },
        ],
        stopped: false,
      },
      {
        id: "result",
        turnId: "failure",
        role: "toolResult",
        toolCallId: "tool",
        toolStatus: "failed",
        content: [
          {
            type: "text",
            key: "error",
            text: "tool image_generate is not enabled for server domos",
          },
        ],
        stopped: false,
      },
    ],
    run: {
      turnId: "failure",
      provider: "antigravity",
      model: "fixture",
      startedAt: 1,
      endedAt: 2,
      status: "ended",
      evidence: {
        taskId: "17545",
        nativeSessionId: "fixture-session",
        version: "1.5.9",
        usage: "failed",
        toolCalls: 2,
        missingResults: 1,
        counters: { inputTokens: 100, cachedReadTokens: 900 },
      },
    },
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(service.url);
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await expect(page.locator(".work-row").first()).toContainText(
    "执行已结束 · 用量入账失败",
  );
  const attention = page.getByRole("region", { name: "需要关注", exact: true });
  await expect(attention).toContainText("检查工具失败");
  await expect(
    attention.getByRole("img", { name: "执行失败", exact: true }),
  ).toBeVisible();
  await page.locator(".work-open").first().click();
  const dialog = page.getByRole("region", { name: "工作记录", exact: true });
  await expect(dialog.locator(".work-operation-body")).toHaveCount(0);
  await dialog.getByRole("button", { name: "定位问题", exact: true }).click();
  await expect(dialog).toContainText(
    "tool image_generate is not enabled for server domos",
  );
  await expect(dialog.locator(".work-entry[data-state=failed]")).toBeFocused();
  await dialog.getByRole("button", { name: "诊断信息", exact: true }).click();
  const diagnostic = page.locator(".work-diagnostics");
  await expect(diagnostic).toContainText("1 / 2");
  await expect(diagnostic).toContainText("入账失败，执行结果保留");
  await diagnostic
    .getByRole("button", { name: "复制诊断信息", exact: true })
    .click();
  await expect(diagnostic).toContainText("已复制");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(copied)).toMatchObject({
    taskId: "17545",
    nativeSessionId: "fixture-session",
    status: "ended",
    counters: { inputTokens: 100 },
  });
  expect(copied).not.toContain("private-input");
  expect(copied).not.toContain("检查工具失败");
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({
      path: info.outputPath(`diagnostics-${theme}.png`),
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await diagnostic.boundingBox();
  if (!bounds) throw new Error("Diagnostic popup required");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("diagnostics-narrow.png") });
  await page.keyboard.press("Escape");
  await expect(
    dialog.getByRole("button", { name: "诊断信息", exact: true }),
  ).toBeFocused();
});

test("skill packages preview changes and restore resources across reload", async ({
  service,
  page,
}, info) => {
  const { zipSync, strToU8 } = createRequire(
    new URL("../../../packages/agent/package.json", import.meta.url),
  )("fflate");
  const content =
    "---\nname: weekly-report\ndescription: Prepare a weekly report\n---\nRead references/guide.md. Run scripts/report.py.";
  const bundle = (script: string) =>
    Buffer.from(
      zipSync({
        "weekly-report/SKILL.md": strToU8(content),
        "weekly-report/references/guide.md": strToU8("Report guide"),
        "weekly-report/scripts/report.py": strToU8(script),
      }),
    );
  await page.goto(service.url);
  const details = page.locator("#bot-details");
  await details.getByRole("button", { name: /^技能(?:\s|$)/ }).click();
  const upload = async (script: string) => {
    await expect(details.getByLabel("导入技能包")).toBeEnabled();
    await details.getByLabel("导入技能包").setInputFiles({
      name: "weekly-report.zip",
      mimeType: "application/zip",
      buffer: bundle(script),
    });
    await expect(
      details
        .getByLabel("编辑 SKILL.md")
        .or(details.getByLabel("新建 SKILL.md")),
    ).toHaveValue(content);
    await details
      .getByRole("button", { name: "保存技能", exact: true })
      .click();
    await expect(
      details.getByRole("region", { name: "技能差异" }),
    ).toContainText("scripts/report.py");
    await details
      .getByRole("button", { name: "保存技能", exact: true })
      .click();
    await expect(
      details.getByRole("heading", { name: "weekly-report", exact: true }),
    ).toBeVisible();
  };
  await upload("print('v1')");
  let releaseEnable!: () => void;
  const enabling = page.waitForRequest("**/rpc/work/skills/enable");
  const enableGate = new Promise<void>((resolve) => {
    releaseEnable = resolve;
  });
  await page.route("**/rpc/work/skills/enable", async (route) => {
    await enableGate;
    await route.continue();
  });
  await details
    .getByRole("switch", { name: "为此 Bot 启用 weekly-report" })
    .click();
  await enabling;
  await expect(details.getByLabel("导入技能包")).toBeDisabled();
  releaseEnable();
  await upload("print('v2')");
  await page.reload();
  await expect(
    details.getByRole("heading", { name: "技能", exact: true }),
  ).toBeVisible();
  await details
    .getByRole("button")
    .filter({
      has: page.getByRole("heading", { name: "weekly-report", exact: true }),
    })
    .click();
  await details.getByText("版本历史", { exact: true }).click();
  await details.getByRole("button", { name: /^预览 v1/ }).click();
  const diff = details.getByRole("region", { name: "技能差异" });
  await diff.getByText("修改 · scripts/report.py", { exact: true }).click();
  await expect(diff).toContainText("print('v1')");
  await expect(diff).toContainText("print('v2')");
  await details.screenshot({
    path: info.outputPath("skill-version-preview.png"),
  });
  await details.getByRole("button", { name: "保存技能", exact: true }).click();
  await expect(details.getByText("user · v3", { exact: true })).toBeVisible();
  await expect(
    details.getByRole("switch", { name: "为此 Bot 启用 weekly-report" }),
  ).toBeChecked();
});

test("chat routine changes require confirmation and link runs to Work", async ({
  service,
  page,
}, info) => {
  test.setTimeout(60_000);
  await page.goto(service.url);
  const details = page.locator("#bot-details");
  const sendTool = async (name: string, args: Record<string, unknown>) => {
    const ready = once(service.worker, "message");
    service.worker.send({
      content: [
        { type: "toolCall", id: crypto.randomUUID(), name, arguments: args },
      ],
      stopReason: "toolUse",
    });
    await ready;
    await page.getByLabel("消息", { exact: true }).fill(name);
    await page.getByRole("button", { name: "发送", exact: true }).click();
  };
  await sendTool("routine_create", {
    title: "Daily report",
    instructions: "Read the daily report",
    schedule: {
      type: "cron",
      expression: "0 8 * * *",
      timeZone: "Asia/Shanghai",
    },
    executionMs: 60_000,
  });
  const create = page.getByRole("region", {
    name: "创建定时：Daily report",
    exact: true,
  });
  await expect(create).toBeVisible();
  await expect(create).toContainText("每天 08:00");
  await expect(create).not.toContainText('"schedule"');
  expect(
    await create
      .locator(".approval-detail")
      .evaluate((node) => getComputedStyle(node).overflowY),
  ).toBe("visible");
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await create.screenshot({
      path: info.outputPath(`routine-approval-${theme}.png`),
    });
  }
  await details.getByRole("button", { name: /^定时(?:\s|$)/ }).click();
  await expect(
    details.getByText("暂无定时任务", { exact: true }),
  ).toBeVisible();
  await create.getByRole("button", { name: "创建任务", exact: true }).click();
  await expect(
    details.getByRole("switch", { name: "启用 Daily report" }),
  ).toBeChecked();
  await expect(create.getByRole("status")).toHaveText("已批准");
  await expect(
    page.getByText("已创建定时　◷　Daily report", { exact: true }),
  ).toBeVisible();
  await expect(create.locator(".interaction-card")).toHaveCount(0);
  await create.getByRole("button").click();
  const approvalDetails = page.getByRole("dialog", {
    name: "创建定时：Daily report",
    exact: true,
  });
  await expect(approvalDetails).toContainText("每天 08:00");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(create.getByRole("status")).toHaveText("已批准");
  await expect(
    page.getByText("已创建定时　◷　Daily report", { exact: true }),
  ).toHaveCount(1);
  await expect(
    details.getByRole("heading", { name: "定时", exact: true }),
  ).toBeVisible();
  await details.getByRole("button", { name: "Daily report的操作" }).click();
  await page.getByRole("menuitem", { name: "试跑", exact: true }).click();
  await details.locator("summary").filter({ hasText: "运行记录" }).click();
  await expect(details.locator(".run-list")).toContainText("已完成");
  await expect(details.locator(".run-list")).not.toContainText("等人");
  await details
    .getByRole("button", { name: "查看工作记录：Daily report", exact: true })
    .click();
  const record = page.getByRole("region", { name: "工作记录", exact: true });
  await expect(details.locator(".run-list")).not.toBeVisible();
  await record.locator("summary").filter({ hasText: "任务输入" }).click();
  await expect(record).toContainText("试跑：Daily report");
  await expect(record).toContainText("Read the daily report");
  await expect(record).toContainText("等人");
  await expect(record).toContainText("计划时间");
  await page.screenshot({ path: info.outputPath("routine-work-record.png") });
  await record
    .getByRole("button", { name: "返回工作列表", exact: true })
    .click();
  await expect(
    details.getByRole("button", {
      name: "查看工作记录：Daily report",
      exact: true,
    }),
  ).toBeFocused();
});

test("monitoring stays quiet, delivers one result and opens the native Work record", async ({
  service,
  page,
}, info) => {
  test.setTimeout(60_000);
  await page.goto(service.url);
  const sendTool = async (name: string, args: object) => {
    const ready = once(service.worker, "message");
    service.worker.send({
      content: [
        { type: "toolCall", id: crypto.randomUUID(), name, arguments: args },
      ],
      stopReason: "toolUse",
    });
    await ready;
  };
  await sendTool("routine_create", {
    title: "版本监控",
    instructions: "Check releases",
    schedule: { type: "cron", expression: "0 * * * *", timeZone: "UTC" },
    delivery: "conditional",
    condition: "新版本时通知",
  });
  await page.getByLabel("消息", { exact: true }).fill("监控版本");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const approval = page.getByRole("region", { name: "创建定时：版本监控" });
  await approval.getByRole("button", { name: "创建任务", exact: true }).click();
  await expect(approval.getByRole("status")).toHaveText("已批准");
  const details = page.locator("#bot-details");
  await details.getByRole("button", { name: /^定时(?:\s|$)/ }).click();
  await details.locator("summary").filter({ hasText: "运行记录" }).click();
  await page.mouse.move(0, 0);
  await expect(page.locator(".attention-toast")).toHaveCount(0, {
    timeout: 10000,
  });
  for (const notify of [false, true]) {
    await sendTool("routine_report", {
      notify,
      text: notify ? "发布了新版本 v2" : "",
      summary: notify ? "v2" : "v1",
      ...(notify ? { key: "release/v2" } : {}),
    });
    await details.getByRole("button", { name: "版本监控的操作" }).click();
    await page.getByRole("menuitem", { name: "试跑", exact: true }).click();
    await expect(details.locator(".run-list")).toContainText(
      notify ? "已交付" : "静默完成",
      { timeout: 20_000 },
    );
    await expect(page.getByLabel("你的消息")).toHaveCount(1);
    await expect(page.locator(".typing-dots")).toHaveCount(0);
  }
  await expect(page.locator(".routine-source")).toHaveCount(1);
  await expect(
    page
      .getByRole("log", { name: "聊天记录" })
      .getByText("发布了新版本 v2", { exact: true }),
  ).toBeVisible();
  await page.locator(".routine-source").getByRole("button").click();
  const record = page.getByRole("region", { name: "工作记录", exact: true });
  await expect(record).toBeVisible();
  await expect(record).toContainText("routine_report");
  await record.getByRole("button", { name: "返回工作列表" }).click();
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({ path: info.outputPath(`monitor-${theme}.png`) });
  }
  await page.reload();
  await expect(page.locator(".routine-source")).toHaveCount(1);
  await expect(page.getByLabel("你的消息")).toHaveCount(1);
});
