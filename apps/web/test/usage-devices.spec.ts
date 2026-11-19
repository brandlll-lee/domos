import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures/service.ts";

type UsageFixture = {
  id: string;
  taskId: string;
  botId: number;
  harness: string;
  provider: string;
  model: string;
  source: string;
  timestamp: number;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  costUsd: number | null;
  costScope?: string;
  costBasis?: "reported" | "estimated";
  costSource?: string;
  costVersion?: string;
};

async function usageRoutes(
  page: Page,
  read: () => UsageFixture[],
  gate: () => Promise<void> = async () => {},
) {
  await page.route("**/rpc/engines/quota", (route) =>
    route.fulfill({
      json: {
        json: {
          status: "ready",
          source: "native-test",
          observedAt: Date.now(),
          windows: [
            {
              id: "weekly",
              name: "每周",
              usedPercent: 100,
              durationMinutes: 10080,
              resetsAt: Date.now() + 3600000,
            },
          ],
          credits: { available: true, unlimited: false, balance: "0" },
        },
      },
    }),
  );
  await page.route("**/rpc/engines/usage*", async (route) => {
    await gate();
    const input = route.request().postDataJSON()?.json ?? {};
    const rows = read().filter(
      (row) =>
        !input.query ||
        `${row.model} ${row.provider} ${row.source}`.includes(input.query),
    );
    const sum = (items: UsageFixture[], key: string): number | null => {
      const values = items
        .map((row) =>
          key === "cost"
            ? row.costScope === "session"
              ? null
              : row.costUsd
            : row[key as "input"],
        )
        .filter((value): value is number => typeof value === "number");
      return values.length ? values.reduce((a, b) => a + b, 0) : null;
    };
    if (!route.request().url().endsWith("usageSummary")) {
      const current = Math.min(
        input.page ?? 1,
        Math.max(1, Math.ceil(rows.length / 50)),
      );
      await route.fulfill({
        json: {
          json: {
            items: rows.slice((current - 1) * 50, current * 50),
            total: rows.length,
            page: current,
            pageSize: 50,
          },
        },
      });
      return;
    }
    const key = (row: UsageFixture) => String(row[input.dimension as "model"]);
    const value = (items: UsageFixture[]) =>
      input.metric === "tasks"
        ? new Set(items.map((row) => row.taskId)).size
        : sum(items, input.metric);
    const all = [...new Set(rows.map(key))]
      .map((keyValue) => ({
        key: keyValue,
        value: value(rows.filter((row) => key(row) === keyValue)),
      }))
      .sort(
        (a, b) =>
          (b.value ?? -1) - (a.value ?? -1) || a.key.localeCompare(b.key),
      );
    const groups = all.slice(0, input.limit);
    const top = new Set(groups.map((row) => row.key));
    if (all.length > input.limit)
      groups.push({
        key: "other",
        value: value(rows.filter((row) => !top.has(key(row)))),
      });
    const day = (row: UsageFixture) =>
      new Date(row.timestamp).toISOString().slice(0, 10);
    const days = [...new Set(rows.map(day))];
    await route.fulfill({
      json: {
        json: {
          missingUsage: 0,
          coverage: [...new Set(rows.map((row) => row.harness))].map(
            (harness) => ({
              harness,
              tasks: rows.filter((row) => row.harness === harness).length,
              missingUsage: 0,
            }),
          ),
          startedAt: rows[0]?.timestamp ?? null,
          updatedAt: rows.at(-1)?.timestamp ?? null,
          hasSkills: false,
          totals: {
            incomplete: rows.filter((row) =>
              [row.input, row.output, row.cacheRead, row.cacheWrite].some(
                (value) => value === null,
              ),
            ).length,
            historical: 0,
            tokens: rows
              .filter((row) =>
                [row.input, row.output, row.cacheRead, row.cacheWrite].every(
                  (value) => value !== null,
                ),
              )
              .reduce(
                (total, row) =>
                  total +
                  Number(row.input) +
                  Number(row.output) +
                  Number(row.cacheRead) +
                  Number(row.cacheWrite),
                0,
              ),
            records: rows.length,
            tasks: new Set(rows.map((row) => row.taskId)).size,
            unpriced: rows.filter(
              (row) => row.costUsd === null || row.costScope === "session",
            ).length,
            snapshots: rows.filter((row) => row.costScope === "session").length,
            estimated: rows.filter((row) => row.costBasis === "estimated")
              .length,
            cost: sum(rows, "cost"),
            input: sum(rows, "input"),
            output: sum(rows, "output"),
            cacheRead: sum(rows, "cacheRead"),
            cacheWrite: sum(rows, "cacheWrite"),
          },
          groups,
          daily: days.flatMap((date) =>
            groups.map((group) => ({
              day: date,
              key: group.key,
              value: value(
                rows.filter(
                  (row) =>
                    day(row) === date &&
                    (group.key === "other"
                      ? !top.has(key(row))
                      : key(row) === group.key),
                ),
              ),
            })),
          ),
          days: days.map((date) => ({
            day: date,
            cost: sum(
              rows.filter((row) => day(row) === date),
              "cost",
            ),
          })),
          options: rows.map(({ provider, model }) => ({ provider, model })),
        },
      },
    });
  });
}

test("usage reports native task costs and preserves session snapshots across themes", async ({
  service,
  page,
}, info) => {
  const records = Array.from({ length: 8 }, (_, index) => ({
    id: `usage-${index}`,
    taskId: `task-${index}`,
    botId: 1,
    sessionId: "session",
    harness: index < 2 ? "claude" : "pi",
    provider: `provider-${index}`,
    model: `model-${index}`,
    source: "native-test",
    timestamp: Date.now(),
    input: index === 7 ? null : 1000 * (index + 1),
    output: 100,
    cacheRead: null,
    cacheWrite: null,
    costUsd: index < 2 ? 100 + index : index === 7 ? null : 0.5,
    ...(index < 2 ? { costScope: "session" } : {}),
  }));
  let mode = "loading";
  const loaded = Promise.withResolvers<void>();
  await usageRoutes(
    page,
    () => (mode === "empty" ? [] : records),
    async () => {
      await loaded.promise;
    },
  );
  await page.goto(service.url);
  await page.getByRole("button", { name: "用户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "用量", exact: true }).click();
  const usage = page.getByRole("main", { name: "用量", exact: true });
  await expect(usage.getByLabel("正在读取用量")).toBeVisible();
  await expect(usage.getByLabel("每周剩余额度")).toHaveAttribute("value", "0");
  await expect(usage.getByLabel("订阅额度")).toContainText("剩余 0.0%");
  mode = "data";
  loaded.resolve();
  await expect(usage.locator(".usage-hero-value")).toContainText("$2.50");
  await expect(usage.locator(".usage-footer")).toContainText("2 条会话累计");
  await expect(usage.locator(".usage-footer")).toContainText("3 条成本未提供");
  const summary = usage.getByRole("list", { name: "分组用量", exact: true });
  const details = usage.getByRole("table", { name: "用量明细", exact: true });
  const scroll = page.locator(".usage-surface > .scroll-viewport");
  await expect(scroll).toHaveCSS("scrollbar-width", "none");
  await expect(page.locator(".usage-surface > .scroll-bar")).toHaveCount(1);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const search = usage.getByRole("searchbox", { name: "搜索用量记录" });
    await search.click();
    await expect(search).toHaveCSS("outline-style", "none");
    await expect(summary).toContainText("model-2");
    await expect(summary).toContainText("其他");
    await expect(details).toContainText("$101.00");
    await expect(details).toContainText("会话累计");
    await page.screenshot({
      path: info.outputPath(`usage-overview-${colorScheme}.png`),
    });
    await usage.getByRole("radio", { name: "输入用量", exact: true }).click();
    await expect(
      usage.getByRole("heading", { name: "输入用量趋势", exact: true }),
    ).toBeVisible();
    await expect(usage.locator(".usage-hero-value")).toContainText("$2.50");
    await usage.getByRole("radio", { name: "Provider", exact: true }).click();
    await expect(summary).toContainText("provider-2");
    await page.screenshot({
      path: info.outputPath(`usage-explore-${colorScheme}.png`),
    });
    await usage.getByRole("radio", { name: "任务成本", exact: true }).click();
    await usage.getByRole("radio", { name: "模型", exact: true }).click();
    await scroll.evaluate((node) => {
      node.scrollTo({ top: node.scrollHeight });
    });
    await expect(details).toBeInViewport();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`usage-mobile-${colorScheme}.png`),
    });
    await page.setViewportSize({ width: 1360, height: 900 });
    await scroll.evaluate((node) => {
      node.scrollTo({ top: 0 });
    });
  }
  mode = "empty";
  await usage.getByRole("button", { name: "刷新用量", exact: true }).click();
  await expect(
    usage.getByText("此范围还没有用量记录。", { exact: true }),
  ).toBeVisible();
  mode = "error";
  await page.route("**/rpc/engines/quota", (route) =>
    route.fulfill({
      json: {
        json: {
          status: "ready",
          source: "native-test",
          observedAt: Date.now(),
          windows: [
            {
              id: "weekly",
              name: "每周",
              usedPercent: 100,
              durationMinutes: 10080,
              resetsAt: Date.now() + 3600000,
            },
          ],
          credits: { available: true, unlimited: false, balance: "0" },
        },
      },
    }),
  );
  await page.route("**/rpc/engines/usage*", (route) => route.abort());
  await usage.getByRole("button", { name: "刷新用量", exact: true }).click();
  await expect(usage.getByRole("alert")).toBeVisible();
  mode = "data";
  await page.unroute("**/rpc/engines/usage*");
  await usageRoutes(page, () => records);
  await usage.getByRole("button", { name: "重试", exact: true }).click();
  await expect(usage.locator(".usage-hero-value")).toContainText("$2.50");
});

test("usage totals distinguish unknown costs and include recorded zero-cost days", async ({
  service,
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-03T12:00:00Z"));
  const record = {
    id: "usage-1",
    taskId: "task-1",
    botId: 1,
    sessionId: "session",
    harness: "pi",
    provider: "provider",
    model: "model",
    source: "native-test",
    timestamp: Date.parse("2026-10-01T12:00:00Z"),
    input: 10,
    output: 1,
    cacheRead: null,
    cacheWrite: null,
    costUsd: null as number | null,
  };
  let records: (typeof record & { costScope?: "session" })[] = [record];
  await usageRoutes(page, () => records);
  await page.goto(service.url);
  await page.getByRole("button", { name: "用户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "用量", exact: true }).click();
  const usage = page.getByRole("main", { name: "用量", exact: true });
  const total = usage.locator(".usage-breakdown-total");
  await expect(usage.locator(".usage-hero-value")).toHaveText("未提供");
  await expect(total).toContainText("未提供");
  records = [{ ...record, costUsd: 100, costScope: "session" }];
  await usage.getByRole("button", { name: "刷新用量", exact: true }).click();
  await expect(usage.locator(".usage-footer")).toContainText("1 条会话累计");
  await expect(usage.locator(".usage-hero-value")).toHaveText("未提供");
  await expect(total).toContainText("未提供");
  records = [
    { ...record, costUsd: 1 },
    {
      ...record,
      id: "usage-2",
      taskId: "task-2",
      timestamp: Date.parse("2026-10-02T12:00:00Z"),
      costUsd: 0,
    },
  ];
  await usage.getByRole("button", { name: "刷新用量", exact: true }).click();
  await expect(usage.locator(".usage-facts")).toContainText(
    "日均（有记录 2 天）$0.50",
  );
  records = [{ ...record, costUsd: 0 }];
  await usage.getByRole("button", { name: "刷新用量", exact: true }).click();
  await expect(usage.locator(".usage-facts")).toContainText(
    "峰值日10月1日$0.00",
  );
  await expect(usage.locator(".usage-facts")).toContainText(
    "日均（有记录 1 天）$0.00",
  );
  await expect(usage.getByText("该指标为零。", { exact: true })).toBeVisible();
});

test("usage pages keep totals and search the full record set", async ({
  service,
  page,
}, info) => {
  const records: UsageFixture[] = Array.from({ length: 123 }, (_, index) => ({
    id: `usage-${index}`,
    taskId: `task-${index}`,
    botId: 1,
    harness: "codex",
    provider: "openai",
    model: index === 122 ? "needle-model" : "gpt-6.1-terra",
    source: "native",
    timestamp: Date.now() - index * 1000,
    input: 1000,
    output: 100,
    cacheRead: 0,
    cacheWrite: 0,
    costUsd: 0.0015,
    costBasis: "estimated",
    costSource: "https://developers.openai.com/api/docs/pricing",
    costVersion: "2026-11-13 · standard API · short context · 30m cache",
  }));
  let summaries = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("usageSummary")) summaries++;
  });
  await usageRoutes(page, () => records);
  await page.goto(service.url);
  await page.getByRole("button", { name: "用户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "用量", exact: true }).click();
  const usage = page.getByRole("main", { name: "用量", exact: true });
  const table = usage.getByRole("table", { name: "用量明细", exact: true });
  const navigation = usage.getByRole("navigation", { name: "用量翻页" });
  await expect(table.locator("tbody tr")).toHaveCount(50);
  await expect(navigation).toContainText("1–50 / 123");
  await expect(usage.locator(".usage-hero-value")).toHaveText("$0.1845");
  const count = summaries;
  await navigation.getByRole("button", { name: "下一页" }).click();
  await expect(navigation).toContainText("51–100 / 123");
  await expect(table.locator("tbody tr")).toHaveCount(50);
  expect(summaries).toBe(count);
  await expect(usage.locator(".usage-hero-value")).toHaveText("$0.1845");
  await navigation.getByRole("button", { name: "下一页" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(23);
  await expect(table.getByText("价格估算", { exact: true })).toHaveCount(23);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await navigation.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`usage-pages-${colorScheme}.png`),
    });
  }
  await usage
    .getByRole("searchbox", { name: "搜索用量记录" })
    .fill("needle-model");
  await expect(navigation).toContainText("1–1 / 1");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("needle-model");
});

test("authorized devices use compact pages and retain the current device", async ({
  service,
  page,
}, info) => {
  await page.route("**/hosting/info", (route) =>
    route.fulfill({ json: { product: "domos", version: "1" } }),
  );
  await page.route("**/hosting/session", (route) =>
    route.fulfill({ json: { device: { id: "current", scope: "admin" } } }),
  );
  const items = Array.from({ length: 23 }, (_, index) => ({
    id: index === 0 ? "current" : `device-${index}`,
    label: index === 0 ? "Domos 桌面" : `电脑 ${index}`,
    scope: "admin",
    created: Date.now() - index * 1000,
    expires: Date.now() + 86400_000,
  }));
  await page.route("**/hosting/devices?*", (route) => {
    const current = Math.min(
      Number(new URL(route.request().url()).searchParams.get("page") ?? 1),
      Math.ceil(items.length / 10),
    );
    return route.fulfill({
      json: {
        items: items.slice((current - 1) * 10, current * 10),
        page: current,
        total: items.length,
        pageSize: 10,
      },
    });
  });
  await page.goto(service.url);
  await page.getByRole("button", { name: "用户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  const settings = page.getByRole("main", { name: "设置", exact: true });
  await settings.getByRole("tab", { name: "当前电脑", exact: true }).click();
  const devices = settings.getByRole("region", {
    name: "访问设备",
    exact: true,
  });
  await expect(devices.getByText("当前设备", { exact: true })).toBeVisible();
  const navigation = devices.getByRole("navigation", { name: "授权翻页" });
  await expect(navigation).toContainText("1–10 / 23");
  await expect(devices.getByRole("button", { name: /^撤销/ })).toHaveCount(9);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await navigation.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`device-pages-${colorScheme}.png`),
    });
  }
  await navigation.getByRole("button", { name: "下一页" }).click();
  await expect(navigation).toContainText("11–20 / 23");
  await expect(devices.getByRole("button", { name: /^撤销/ })).toHaveCount(10);
  await navigation.getByRole("button", { name: "下一页" }).click();
  await expect(navigation).toContainText("21–23 / 23");
  await expect(
    navigation.getByRole("button", { name: "下一页" }),
  ).toBeDisabled();
});
