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
        (!input.harness || row.harness === input.harness) &&
        (!input.provider || row.provider === input.provider) &&
        (!input.model || row.model === input.model) &&
        (!input.botId || row.botId === input.botId) &&
        (!input.from || row.timestamp >= input.from) &&
        (!input.to || row.timestamp <= input.to) &&
        (!input.query ||
          `${row.model} ${row.provider} ${row.source}`.includes(input.query)),
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
    const tokenSum = (items: UsageFixture[]) => {
      const complete = items.filter((row) =>
        [row.input, row.output, row.cacheRead, row.cacheWrite].every(
          (value) => value !== null,
        ),
      );
      return complete.length
        ? complete.reduce(
            (sum, row) =>
              sum +
              Number(row.input) +
              Number(row.output) +
              Number(row.cacheRead) +
              Number(row.cacheWrite),
            0,
          )
        : null;
    };
    const key = (row: UsageFixture) =>
      input.dimension === "day"
        ? new Date(row.timestamp).toISOString().slice(0, 10)
        : String(
            row[
              input.dimension === "bot" ? "botId" : (input.dimension as "model")
            ],
          );
    const value = (items: UsageFixture[]) =>
      input.metric === "tasks"
        ? new Set(items.map((row) => row.taskId)).size
        : input.metric === "tokens"
          ? tokenSum(items)
          : sum(items, input.metric);
    const all = [...new Set(rows.map(key))]
      .map((keyValue) => ({
        key: keyValue,
        cost: sum(
          rows.filter((row) => key(row) === keyValue),
          "cost",
        ),
        tokens: tokenSum(rows.filter((row) => key(row) === keyValue)),
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
        cost: sum(
          rows.filter((row) => !top.has(key(row))),
          "cost",
        ),
        tokens: tokenSum(rows.filter((row) => !top.has(key(row)))),
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
          engines: [...new Set(rows.map((row) => row.harness))].map((key) => ({
            key,
            cost: sum(
              rows.filter((row) => row.harness === key),
              "cost",
            ),
            tokens: tokenSum(rows.filter((row) => row.harness === key)),
          })),
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
            tokens: tokenSum(rows.filter((row) => day(row) === date)),
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

const usageRecord: UsageFixture = {
  id: "u",
  taskId: "t",
  botId: 1,
  harness: "claude",
  provider: "anthropic",
  model: "claude-model",
  source: "native",
  timestamp: Date.now(),
  input: 1000,
  output: 50,
  cacheRead: 100,
  cacheWrite: 0,
  costUsd: 6.7808,
};
async function openUsage(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole("button", { name: "用户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "用量", exact: true }).click();
  return page.getByRole("main", { name: "用量", exact: true });
}

test("usage overview keeps the hero visible and reads details on demand", async ({
  service,
  page,
}, info) => {
  const records = [
    { ...usageRecord, model: "a-model-with-a-very-long-name-".repeat(4) },
    {
      ...usageRecord,
      id: "u2",
      taskId: "t2",
      harness: "pi",
      model: "unknown",
      input: null,
      costUsd: null,
    },
  ];
  let detailReads = 0;
  let quotaReads = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/usage")) detailReads++;
    if (request.url().endsWith("/quota")) quotaReads++;
  });
  await usageRoutes(page, () => records);
  const usage = await openUsage(page, service.url);
  await expect(usage.locator(".usage-hero-value")).toHaveText("US$6.78");
  expect(detailReads).toBe(0);
  expect(quotaReads).toBe(0);
  await expect(usage.getByRole("slider")).toBeInViewport();
  const table = usage.getByRole("table", { name: "用量构成" });
  await expect(table.locator("thead th")).toHaveCount(3);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: info.outputPath(`usage-overview-${colorScheme}.png`),
    });
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
  }
  await usage.getByRole("button", { name: "查看详情", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Token 字段不完整");
  await dialog.getByRole("button", { name: "关闭弹窗" }).click();
  await usage.getByRole("button", { name: "订阅额度", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("剩余 0.0%");
  expect(quotaReads).toBe(1);
  await dialog.getByRole("button", { name: "关闭弹窗" }).click();
  await table
    .getByRole("button", { name: records[0]?.model, exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("table", { name: "用量明细" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog").locator("tbody tr")).toHaveCount(1);
  expect(detailReads).toBeGreaterThan(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭弹窗" })
    .click();
  await usage.getByRole("radio", { name: "Bot", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("US$6.78");
  await usage.getByRole("radio", { name: "日期", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText(
    new Date(usageRecord.timestamp).toISOString().slice(0, 10),
  );
  await usage.getByRole("button", { name: "更多分析", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("table").locator("tbody tr")).toHaveCount(2);
  await dialog.getByRole("button", { name: "关闭弹窗" }).click();
  await expect(
    usage.getByRole("radio", { name: "日期", exact: true }),
  ).toBeChecked();
  await expect(table).toContainText(
    new Date(usageRecord.timestamp).toISOString().slice(0, 10),
  );
});

test("usage distinguishes unknown, zero and sub-cent amounts and retains refresh results", async ({
  service,
  page,
}) => {
  let records: UsageFixture[] = [{ ...usageRecord, costUsd: null }];
  await usageRoutes(page, () => records);
  const usage = await openUsage(page, service.url);
  await expect(usage.locator(".usage-hero-value")).toHaveText("暂无法估价");
  await expect(usage.locator(".usage-chart-empty")).toBeVisible();
  records = [{ ...usageRecord, costUsd: 0 }];
  await usage.getByRole("button", { name: "刷新用量" }).click();
  await expect(usage.locator(".usage-hero-value")).toHaveText("US$0.00");
  await expect(usage.locator(".usage-chart-empty")).toHaveCount(0);
  records = [{ ...usageRecord, costUsd: 0.0015 }];
  await usage.getByRole("button", { name: "刷新用量" }).click();
  await expect(usage.locator(".usage-hero-value")).toHaveText("<US$0.01");
  await usage.getByRole("combobox", { name: "日期范围" }).click();
  await page.getByRole("option", { name: "近 30 天", exact: true }).click();
  records = [
    {
      ...usageRecord,
      id: "before",
      taskId: "before",
      timestamp: usageRecord.timestamp - 3 * 86400000,
      costUsd: 1,
    },
    {
      ...usageRecord,
      id: "gap",
      taskId: "gap",
      timestamp: usageRecord.timestamp - 2 * 86400000,
      costUsd: null,
    },
    {
      ...usageRecord,
      id: "zero",
      taskId: "zero",
      timestamp: usageRecord.timestamp - 86400000,
      costUsd: 0,
    },
    { ...usageRecord, costUsd: 0.0015 },
  ];
  await usage.getByRole("button", { name: "刷新用量" }).click();
  await expect(usage.locator(".usage-line")).toHaveCount(2);
  await expect(usage.locator(".usage-hero-value")).toHaveText("US$1.00");
  await page.route("**/rpc/engines/usageSummary", (route) => route.abort());
  await usage.getByRole("button", { name: "刷新用量" }).click();
  await expect(usage.getByRole("alert")).toBeVisible();
  await expect(usage.locator(".usage-hero-value")).toHaveText("US$1.00");
});

test("usage records retain pagination, precision and search without changing overview", async ({
  service,
  page,
}) => {
  const records = Array.from({ length: 123 }, (_, index) => ({
    ...usageRecord,
    id: `u-${index}`,
    taskId: `t-${index}`,
    model: index === 122 ? "needle-model" : "model",
    costUsd: 0.0015,
  }));
  await usageRoutes(page, () => records);
  const usage = await openUsage(page, service.url);
  await expect(usage.locator(".usage-hero-value")).toHaveText("US$0.18");
  await usage.getByRole("button", { name: "查看记录", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const table = dialog.getByRole("table", { name: "用量明细" });
  await expect(table.locator("tbody tr")).toHaveCount(50);
  await expect(table).toContainText("US$0.0015");
  const navigation = dialog.getByRole("navigation", { name: "用量翻页" });
  await navigation.getByRole("button", { name: "下一页" }).click();
  await expect(navigation).toContainText("51–100 / 123");
  await dialog.getByRole("searchbox").fill("needle-model");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await dialog.getByRole("button", { name: "关闭弹窗" }).click();
  await expect(usage.locator(".usage-hero-value")).toHaveText("US$0.18");
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
