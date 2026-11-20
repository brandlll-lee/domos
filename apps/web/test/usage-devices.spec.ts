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
  await page.route("**/rpc/engines/quota", (route) => {
    const provider = route.request().postDataJSON()?.json.provider;
    return route.fulfill({
      json: {
        json: {
          status: provider === "codex" ? "ready" : "unsupported",
          computerId: "process",
          accountId: provider === "codex" ? "shared-account" : null,
          accountLabel: provider === "codex" ? "person@example.com" : undefined,
          plan: provider === "codex" ? "Pro" : undefined,
          source: "native-test",
          message: provider === "pi" ? "此引擎尚未接入额度读取。" : undefined,
          observedAt: Date.now(),
          windows:
            provider === "codex"
              ? [
                  {
                    id: "weekly",
                    name: "每周",
                    usedPercent: 100,
                    durationMinutes: 10080,
                    resetsAt: Date.now() + 3600000,
                  },
                ]
              : [],
          credits:
            provider === "codex"
              ? { available: true, unlimited: false, balance: "0" }
              : undefined,
        },
      },
    });
  });
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
          missingDays: [],
          coverage: [...new Set(rows.map((row) => row.harness))].map(
            (harness) => ({
              harness,
              tasks: rows.filter((row) => row.harness === harness).length,
              missingUsage: 0,
            }),
          ),
          startedAt: read().length
            ? Math.min(...read().map((row) => row.timestamp))
            : null,
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
          engineDays: days.flatMap((date) =>
            [
              ...new Set(
                rows
                  .filter((row) => day(row) === date)
                  .map((row) => row.harness),
              ),
            ].map((harness) => ({
              day: date,
              key: harness,
              cost: sum(
                rows.filter(
                  (row) => day(row) === date && row.harness === harness,
                ),
                "cost",
              ),
              tokens: tokenSum(
                rows.filter(
                  (row) => day(row) === date && row.harness === harness,
                ),
              ),
            })),
          ),
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
  await expect(usage.locator(".number-ticker")).toHaveAccessibleName("US$6.78");
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
  await usage.getByRole("radio", { name: "订阅额度", exact: true }).click();
  const quota = usage.getByRole("region", { name: "订阅额度", exact: true });
  await expect(quota).toContainText("剩余 0.0%");
  await expect(quota).toContainText("pe•••@example.com · Pro");
  await expect(quota.getByRole("combobox")).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "订阅额度", exact: true }),
  ).toHaveCount(0);
  await expect.poll(() => quotaReads).toBe(9);
  const codex = quota.getByRole("article", { name: "Codex", exact: true });
  await expect(codex.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await expect(codex).toContainText("1 小时 0 分钟后重置");
  await expect(quota.locator("summary")).toHaveCount(0);
  await expect(quota.getByText("来源与详情", { exact: true })).toHaveCount(0);
  const cardBox = await codex.boundingBox();
  const infoButton = codex.getByRole("button", {
    name: "Codex 额度详情",
    exact: true,
  });
  await infoButton.click();
  await expect(
    page.getByRole("dialog", { name: "Codex 额度详情" }),
  ).toContainText("native-test");
  await expect
    .poll(async () => (await codex.boundingBox())?.height)
    .toBe(cardBox?.height);
  await page.keyboard.press("Escape");
  await expect(infoButton).toBeFocused();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: info.outputPath(`usage-quota-${colorScheme}.png`),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`quota-mobile-${colorScheme}.png`),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1360, height: 900 });
  }
  await page.route("**/rpc/engines/quota", (route) => route.abort());
  await codex
    .getByRole("button", { name: "刷新 Codex 额度", exact: true })
    .click();
  await expect(codex).toContainText("保留上次读数");
  await expect(codex.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await usage.getByRole("radio", { name: "费用", exact: true }).click();
  await expect(usage.locator(".number-ticker")).toHaveAccessibleName("US$6.78");
  const reads = quotaReads;
  await usage.getByRole("radio", { name: "订阅额度", exact: true }).click();
  await expect(quota).toContainText("剩余 0.0%");
  expect(quotaReads).toBe(reads);
  await page.setViewportSize({ width: 1360, height: 650 });
  await page.mouse.move(1000, 500);
  await page.waitForTimeout(500);
  const avatarReads = await page.evaluate(async () => {
    const avatar = document.querySelector<HTMLElement>(".sidebar .bot-avatar");
    const viewport = document.querySelector(".usage-surface .scroll-viewport");
    if (!avatar || !viewport) throw new Error("Usage viewport missing");
    const measure = avatar.getBoundingClientRect.bind(avatar);
    let reads = 0;
    avatar.getBoundingClientRect = () => {
      reads++;
      return measure();
    };
    try {
      viewport.scrollTop = 80;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return { reads, top: viewport.scrollTop };
    } finally {
      delete (avatar as Partial<HTMLElement>).getBoundingClientRect;
    }
  });
  expect(avatarReads.top).toBeGreaterThan(0);
  expect(avatarReads.reads).toBe(0);
  await page.setViewportSize({ width: 1360, height: 900 });
  await expect(
    quota.getByRole("article", { name: "Pi", exact: true }),
  ).toContainText("尚未接入额度读取");
  await expect(
    quota.getByRole("article", { name: "Claude Code", exact: true }),
  ).toContainText("未提供订阅额度");
  await usage.getByRole("radio", { name: "费用", exact: true }).click();
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

test("segmented controls slide between selections and settle after interruption or resize", async ({
  service,
  page,
}) => {
  await usageRoutes(page, () => [usageRecord]);
  const usage = await openUsage(page, service.url);
  const group = usage.getByRole("radiogroup", { name: "统计指标" });
  const aligned = async (label: string, control = group) => {
    await control
      .locator(".segmented-indicator")
      .evaluate((element) =>
        Promise.all(
          element.getAnimations().map((animation) => animation.finished),
        ),
      );
    await expect
      .poll(async () => {
        const marker = await control
          .locator(".segmented-indicator")
          .boundingBox();
        const selected = await control
          .getByRole("radio", { name: label, exact: true })
          .boundingBox();
        return Boolean(
          marker &&
            selected &&
            ["x", "y", "width", "height"].every(
              (key) => Math.abs(marker[key as "x"] - selected[key as "x"]) < 1,
            ),
        );
      })
      .toBe(true);
  };
  await aligned("费用");
  const moving = await group.evaluate(async (element) => {
    element.querySelector<HTMLElement>('[data-value="tokens"]')?.click();
    await new Promise(requestAnimationFrame);
    const marker = element.querySelector<HTMLElement>(".segmented-indicator");
    if (!marker) throw new Error("Selected segment required");
    const animation = marker.getAnimations()[0];
    return {
      running: animation?.playState,
      frames: (animation?.effect as KeyframeEffect)
        ?.getKeyframes()
        .map((frame) => Object.keys(frame)),
      inFlight:
        Math.abs(
          new DOMMatrixReadOnly(getComputedStyle(marker).transform).e -
            new DOMMatrixReadOnly(marker.style.transform).e,
        ) > 1,
    };
  });
  expect(moving.running).toBe("running");
  expect(moving.inFlight).toBe(true);
  expect(
    moving.frames?.every((keys) =>
      keys.every((key) =>
        [
          "transform",
          "offset",
          "computedOffset",
          "easing",
          "composite",
        ].includes(key),
      ),
    ),
  ).toBe(true);
  const pending = await group.evaluate(async (element) => {
    const counts = [];
    for (const value of ["cost", "tokens", "cost", "tokens"]) {
      element.querySelector<HTMLElement>(`[data-value="${value}"]`)?.click();
      await new Promise(requestAnimationFrame);
      counts.push(
        element.querySelector(".segmented-indicator")?.getAnimations().length,
      );
    }
    return counts;
  });
  expect(pending).toEqual([1, 1, 1, 1]);
  await aligned("Token");
  await group.getByRole("radio", { name: "费用", exact: true }).hover();
  await expect(
    group.getByRole("radio", { name: "Token", exact: true }),
  ).toBeChecked();
  await group.getByRole("radio", { name: "Token", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(
    group.getByRole("radio", { name: "费用", exact: true }),
  ).toBeChecked();
  await aligned("费用");
  const breakdown = usage.getByRole("radiogroup", { name: "分组维度" });
  await breakdown.getByRole("radio", { name: "日期", exact: true }).click();
  await aligned("日期", breakdown);
  await page.setViewportSize({ width: 390, height: 844 });
  await aligned("费用");
  await aligned("日期", breakdown);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await group.getByRole("radio", { name: "Token", exact: true }).click();
  expect(
    await group
      .locator(".segmented-indicator")
      .evaluate((element) => element.getAnimations().length),
  ).toBe(0);
  await aligned("Token");
});

test("usage numbers roll in either direction and settle at their formatted value", async ({
  service,
  page,
}, info) => {
  let cost: number | null = 9.99;
  let input = 1200;
  await usageRoutes(page, () => [{ ...usageRecord, costUsd: cost, input }]);
  const usage = await openUsage(page, service.url);
  const ticker = usage.locator(".number-ticker");
  const settle = async (text: string) => {
    await expect(ticker).toHaveAccessibleName(text);
    await ticker.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      );
    });
    const visible = await ticker.locator(":scope > span").evaluate((element) =>
      [...element.childNodes]
        .map((node) => {
          if (!(node instanceof HTMLElement)) return node.textContent;
          const track = node.firstElementChild;
          if (!track) throw new Error("Digit track required");
          const position =
            -new DOMMatrixReadOnly(getComputedStyle(track).transform).f /
            Number.parseFloat(getComputedStyle(element).fontSize);
          return String(Math.round(position) % 10);
        })
        .join(""),
    );
    expect(visible).toBe(text);
    expect(
      await ticker.evaluate((element) => {
        const parent = element.parentElement;
        return (
          parent &&
          element.getBoundingClientRect().right <=
            parent.getBoundingClientRect().right + 1
        );
      }),
    ).toBe(true);
  };
  await expect(ticker).toHaveAccessibleName("US$9.99");
  expect(
    await ticker.evaluate(
      (element) => element.getAnimations({ subtree: true }).length,
    ),
  ).toBeGreaterThan(0);
  await settle("US$9.99");
  for (const [value, text, direction] of [
    [10.01, "US$10.01", -1],
    [1.98, "US$1.98", 1],
  ] as const) {
    cost = value;
    await usage.getByRole("button", { name: "刷新用量" }).click();
    await expect(ticker).toHaveAccessibleName(text);
    const deltas = await ticker.evaluate((element) =>
      element.getAnimations({ subtree: true }).map((animation) => {
        const frames = (animation.effect as KeyframeEffect).getKeyframes();
        return (
          Number.parseFloat(String(frames[1]?.transform).slice(11)) -
          Number.parseFloat(String(frames[0]?.transform).slice(11))
        );
      }),
    );
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.every((delta) => Math.sign(delta) === direction)).toBe(true);
    const width = await ticker.evaluate(
      (element) => element.getBoundingClientRect().width,
    );
    await settle(text);
    expect(
      await ticker.evaluate((element) => element.getBoundingClientRect().width),
    ).toBeCloseTo(width, 1);
  }
  for (const [value, text] of [
    [0, "US$0.00"],
    [0.0015, "<US$0.01"],
    [1234.56, "US$1,234.56"],
    [null, "暂无法估价"],
  ] as const) {
    cost = value;
    await usage.getByRole("button", { name: "刷新用量" }).click();
    await settle(text);
  }
  await usage.getByRole("radio", { name: "Token", exact: true }).click();
  await settle("1.4K");
  for (const value of [2_000_000, 980, 12_000]) {
    input = value;
    await usage.getByRole("button", { name: "刷新用量" }).click();
    await expect(ticker).toHaveAccessibleName(
      new Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value + 150),
    );
    expect(
      await ticker.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      ),
    ).toBeLessThanOrEqual(await ticker.locator(".number-ticker-digit").count());
  }
  await settle("12.2K");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    input += 100;
    await usage.getByRole("button", { name: "刷新用量" }).click();
    await settle(
      new Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(input + 150),
    );
    expect(
      await ticker.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      ),
    ).toBe(0);
    await ticker.screenshot({ path: info.outputPath(`ticker-${theme}.png`) });
  }
});

test("usage curves grow on accepted data and retain their state during pending reads", async ({
  service,
  page,
}) => {
  let cost = 6.78;
  let pending: Promise<void> | undefined;
  await usageRoutes(
    page,
    () => [{ ...usageRecord, costUsd: cost }],
    async () => pending,
  );
  const usage = await openUsage(page, service.url);
  const curves = page.locator(".usage-chart-series");
  const ticker = usage.locator(".number-ticker");
  await expect(ticker).toHaveAccessibleName("US$6.78");
  const initial = await curves.evaluate((element) => ({
    count: element.getAnimations().length,
    duration: element.getAnimations()[0]?.effect?.getTiming().duration,
    scale: new DOMMatrixReadOnly(getComputedStyle(element).transform).d,
  }));
  expect(initial.count).toBe(1);
  expect(initial.duration).toBe(600);
  expect(initial.scale).toBeLessThan(1);
  const settle = () =>
    curves.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished),
      );
    });
  await settle();
  let release = () => {};
  pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const path = await usage.locator(".usage-line").getAttribute("d");
  await usage.getByRole("radio", { name: "Token", exact: true }).click();
  await expect(usage.getByRole("button", { name: "刷新用量" })).toBeDisabled();
  await expect(ticker).toHaveAccessibleName("US$6.78");
  await expect(usage.locator(".usage-line")).toHaveAttribute("d", path ?? "");
  await expect(
    usage.getByRole("heading", { name: "每日费用", exact: true }),
  ).toBeVisible();
  release();
  pending = undefined;
  await expect(ticker).toHaveAccessibleName("1.2K");
  expect(
    await curves.evaluate((element) => element.getAnimations().length),
  ).toBe(1);
  const hidden = await page.evaluate(() => {
    const elements = document.querySelectorAll(
      ".number-ticker, .usage-chart-series",
    );
    const count = () =>
      [...elements].reduce(
        (sum, element) => sum + element.getAnimations({ subtree: true }).length,
        0,
      );
    const before = count();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    const after = count();
    Reflect.deleteProperty(document, "hidden");
    return { before, after };
  });
  expect(hidden.before).toBeGreaterThan(1);
  expect(hidden.after).toBe(0);
  await settle();
  await usage.getByRole("button", { name: "刷新用量" }).click();
  await expect(usage.getByRole("button", { name: "刷新用量" })).toBeEnabled();
  expect(
    await curves.evaluate((element) => element.getAnimations().length),
  ).toBe(0);
  await page.setViewportSize({ width: 980, height: 800 });
  await usage.getByRole("slider").hover();
  await usage.getByRole("button", { name: "数据说明", exact: true }).click();
  expect(
    await curves.evaluate((element) => element.getAnimations().length),
  ).toBe(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭弹窗", exact: true })
    .click();
  await usage.getByRole("combobox", { name: "日期范围" }).click();
  await page.getByRole("option", { name: "近 30 天", exact: true }).click();
  await expect(usage.getByRole("button", { name: "刷新用量" })).toBeEnabled();
  expect(
    await curves.evaluate((element) => element.getAnimations().length),
  ).toBe(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await curves.evaluate((element) => element.getAnimations().length),
  ).toBe(0);
  await usage.getByRole("radio", { name: "费用", exact: true }).click();
  await expect(ticker).toHaveAccessibleName("US$6.78");
  expect(
    await curves.evaluate((element) => element.getAnimations().length),
  ).toBe(0);
  cost = 0;
  await usage.getByRole("button", { name: "刷新用量" }).click();
  await expect(ticker).toHaveAccessibleName("US$0.00");
  expect(
    await curves.evaluate((element) => element.getAnimations().length),
  ).toBe(0);
});

test("quota tracks retain their remaining length at warning and critical thresholds", async ({
  service,
  page,
}, info) => {
  let usedPercent = 0;
  await usageRoutes(page, () => [usageRecord]);
  await page.route("**/rpc/engines/quota", (route) =>
    route.request().postDataJSON()?.json.provider !== "codex"
      ? route.fallback()
      : route.fulfill({
          json: {
            json: {
              status: "ready",
              computerId: "process",
              accountId: "quota-color",
              source: "native-test",
              observedAt: Date.now(),
              windows: [
                {
                  id: "weekly",
                  name: "每周",
                  usedPercent,
                  durationMinutes: 10080,
                  resetsAt: Date.now() + 3600000,
                },
              ],
            },
          },
        }),
  );
  const usage = await openUsage(page, service.url);
  await usage.getByRole("radio", { name: "订阅额度", exact: true }).click();
  const card = usage.getByRole("article", { name: "Codex", exact: true });
  const bar = card.getByRole("progressbar");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const colors = new Map<string, string>();
    for (const used of [0, 79.9, 80, 89.9, 90, 100]) {
      usedPercent = used;
      await card
        .getByRole("button", { name: "刷新 Codex 额度", exact: true })
        .click();
      const tone =
        used >= 90 ? "negative" : used >= 80 ? "warning" : "positive";
      await expect(bar).toHaveAttribute("aria-valuenow", String(100 - used));
      await expect(bar).toHaveAttribute("data-tone", tone);
      const fill = bar.locator("span");
      await fill.evaluate((element) =>
        Promise.all(
          element.getAnimations().map((animation) => animation.finished),
        ),
      );
      const track = await bar.boundingBox();
      const filled = await fill.boundingBox();
      expect(
        track &&
          filled &&
          Math.abs((filled.width / track.width) * 100 - (100 - used)) < 0.1,
      ).toBe(true);
      colors.set(
        tone,
        await fill.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      );
    }
    expect(new Set(colors.values()).size).toBe(3);
    usedPercent = 85;
    await card
      .getByRole("button", { name: "刷新 Codex 额度", exact: true })
      .click();
    await expect(bar).toHaveAttribute("data-tone", "warning");
    await card.screenshot({
      path: info.outputPath(`quota-warning-${colorScheme}.png`),
      animations: "disabled",
    });
  }
});

test("usage distinguishes unknown, zero and sub-cent amounts and retains refresh results", async ({
  service,
  page,
}) => {
  let records: UsageFixture[] = [{ ...usageRecord, costUsd: null }];
  await usageRoutes(page, () => records);
  const usage = await openUsage(page, service.url);
  await expect(usage.locator(".number-ticker")).toHaveAccessibleName(
    "暂无法估价",
  );
  await expect(usage.locator(".usage-chart-empty")).toBeVisible();
  records = [{ ...usageRecord, costUsd: 0 }];
  await usage.getByRole("button", { name: "刷新用量" }).click();
  await expect(usage.locator(".number-ticker")).toHaveAccessibleName("US$0.00");
  await expect(usage.locator(".usage-chart-empty")).toHaveCount(0);
  records = [{ ...usageRecord, costUsd: 0.0015 }];
  await usage.getByRole("button", { name: "刷新用量" }).click();
  await expect(usage.locator(".number-ticker")).toHaveAccessibleName(
    "<US$0.01",
  );
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
  await expect(usage.locator(".usage-line")).toHaveCount(1);
  await expect
    .poll(
      async () =>
        (await usage.locator(".usage-line").getAttribute("d"))?.match(/M/g)
          ?.length,
    )
    .toBe(2);
  await expect(usage.locator(".number-ticker")).toHaveAccessibleName("US$1.00");
  await page.route("**/rpc/engines/usageSummary", (route) => route.abort());
  await usage.getByRole("button", { name: "刷新用量" }).click();
  await expect(usage.getByRole("alert")).toBeVisible();
  await expect(usage.locator(".number-ticker")).toHaveAccessibleName("US$1.00");
});

test("usage chart selects dates and keeps engine details inside the plot", async ({
  service,
  page,
}, info) => {
  const records = Array.from({ length: 7 }, (_, index) => [
    {
      ...usageRecord,
      id: `c-${index}`,
      taskId: `c-${index}`,
      timestamp: usageRecord.timestamp - (6 - index) * 86400000,
      costUsd: index === 3 ? 0.5 : index / 10,
    },
    {
      ...usageRecord,
      id: `p-${index}`,
      taskId: `p-${index}`,
      harness: "pi",
      timestamp: usageRecord.timestamp - (6 - index) * 86400000,
      costUsd: index === 6 ? null : 0,
    },
    ...[
      "codex",
      "opencode",
      "grok",
      "antigravity",
      "devin",
      "cursor",
      "acp",
    ].map((harness) => ({
      ...usageRecord,
      id: `${harness}-${index}`,
      taskId: `${harness}-${index}`,
      harness,
      timestamp: usageRecord.timestamp - (6 - index) * 86400000,
      costUsd: 0,
    })),
  ]).flat();
  await usageRoutes(page, () => records);
  const usage = await openUsage(page, service.url);
  await usage.getByRole("combobox", { name: "日期范围" }).click();
  await page.getByRole("option", { name: "近 7 天", exact: true }).click();
  const slider = usage.getByRole("slider");
  await slider.focus();
  await slider.press("End");
  const tip = usage.getByRole("tooltip");
  await expect(tip).toContainText(
    new Date(usageRecord.timestamp).toISOString().slice(0, 10),
  );
  await expect(tip).toContainText("Claude Code");
  await expect(tip).toContainText("Pi");
  await expect(tip).toContainText("未返回数据");
  await expect(tip).toContainText("已知合计");
  await expect(usage.locator(".usage-active-point")).toHaveCount(8);
  await expect(usage.locator(".usage-crosshair")).toHaveCount(1);
  const paths = await usage
    .locator(".usage-line")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("d")),
    );
  expect(paths.some((path) => path?.includes("C"))).toBe(true);
  expect(
    new Set(
      await usage
        .locator(".usage-line")
        .evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).stroke),
        ),
    ).size,
  ).toBe(9);
  const inside = async () => {
    await tip.evaluate((element) =>
      Promise.all(
        element.getAnimations().map((animation) => animation.finished),
      ),
    );
    const panel = await usage.locator(".usage-plot").boundingBox();
    const box = await tip.boundingBox();
    expect(
      box &&
        panel &&
        box.x >= panel.x - 1 &&
        box.x + box.width <= panel.x + panel.width + 1 &&
        box.y >= panel.y - 1 &&
        box.y + box.height <= panel.y + panel.height + 1,
    ).toBe(true);
    expect(
      await tip.evaluate(
        (element) => element.scrollHeight <= element.clientHeight,
      ),
    ).toBe(true);
  };
  await inside();
  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: info.outputPath(`usage-chart-${colorScheme}.png`),
    });
  }
  await slider.press("Home");
  await expect(tip).toContainText("US$0.00");
  await expect(tip).not.toContainText("未返回数据");
  await expect(usage.locator(".usage-active-point")).toHaveCount(9);
  await inside();
  await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "1");
  await slider.press("Escape");
  await expect(tip).toHaveCount(0);
  const box = await slider.boundingBox();
  if (!box) throw new Error("Chart required");
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
  await expect(slider).toHaveAttribute("aria-valuenow", "6");
  await inside();
  const tipBox = await tip.boundingBox();
  if (!tipBox) throw new Error("Chart tooltip required");
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.classList.contains("usage-chart-hit"),
      { x: tipBox.x + tipBox.width / 2, y: tipBox.y + tipBox.height / 2 },
    ),
  ).toBe(true);
  await page.mouse.move(
    tipBox.x + tipBox.width / 2,
    tipBox.y + tipBox.height / 2,
  );
  await expect(tip).toBeVisible();
  await slider.dispatchEvent("pointerdown", {
    pointerType: "touch",
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
  });
  await expect(slider).toHaveAttribute("aria-valuenow", "3");
  expect(
    await usage
      .locator(".usage-line")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("d")),
      ),
  ).toEqual(paths);
  await usage.getByRole("radio", { name: "Token", exact: true }).click();
  await slider.focus();
  await slider.press("End");
  await expect(tip).not.toContainText("US$");
  await page.setViewportSize({ width: 390, height: 844 });
  await slider.scrollIntoViewIfNeeded();
  await slider.focus();
  await slider.press("End");
  await inside();
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
  await expect(usage.locator(".number-ticker")).toHaveAccessibleName("US$0.18");
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
  await expect(usage.locator(".number-ticker")).toHaveAccessibleName("US$0.18");
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
