import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect } from "@playwright/test";
import type { AppRouter } from "../../api/src/router.ts";
import { test } from "./fixtures/service.ts";

test.use({ trace: "off" });

test("seven Bots and thirty-five conversations retain drafts within the chat cache budget", async ({
  service,
  page,
}, info) => {
  test.setTimeout(360_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const client = createORPCClient<RouterClient<AppRouter>>(
    new RPCLink({ url: `${service.url}/rpc` }),
  );
  const chats: { botId: number; id: number }[] = [];
  for (let bot = 0; bot < 7; bot++) {
    const owner = bot
      ? await client.bots.create({
          name: `压力 Bot ${bot}`,
          requestId: crypto.randomUUID(),
        })
      : (await client.bots.list())[0]!;
    for (let session = 0; session < 5; session++) {
      const id = session
        ? (
            await client.conversations.create({
              botId: owner.id,
              source: owner.id,
              requestId: crypto.randomUUID(),
            })
          ).id
        : owner.id;
      chats.push({ botId: owner.id, id });
      await service.control({
        sessionId: id,
        records: Array.from({ length: 240 }, (_, index) => ({
          id: `load:${id}:${index}`,
          role: "assistant",
          content: [
            {
              type: "text",
              text: `会话 ${id} 记录 ${index}。${"历史内容用于缓存压力验证。".repeat(240)}`,
              key: `load:${id}:${index}`,
            },
          ],
          timestamp: Date.now() + index,
          stopped: false,
        })),
      });
    }
  }
  let backendErrors = "";
  service.worker.stderr?.on("data", (value) => {
    backendErrors = (backendErrors + value).slice(-12000);
  });
  const pending = new Set<string>();
  page.on("request", (request) => pending.add(request.url()));
  page.on("requestfinished", (request) => pending.delete(request.url()));
  page.on("requestfailed", (request) => pending.delete(request.url()));
  await page.goto(service.url);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const system = await page.context().browser()!.newBrowserCDPSession();
  const samples: {
    step: number;
    heapMiB: number;
    rssMiB: number;
    rendererPrivateMiB: number | null;
    browserProcesses: number;
    cacheMiB: number;
    entries: number;
    evictions: number;
    latencyMs: number;
  }[] = [];
  const latencies: number[] = [];
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const [index, chat] of chats.entries()) {
      const started = performance.now();
      await page.evaluate(({ botId, id }) => {
        location.hash = `bot/${botId}/${id}`;
      }, chat);
      const composer = page.getByRole("textbox", { name: "消息", exact: true });
      await expect(
        page
          .locator(".messages")
          .getByText(`会话 ${chat.id} 记录 239。`, { exact: false })
          .last(),
      )
        .toBeVisible({ timeout: 12000 })
        .catch((error) => {
          console.log(
            JSON.stringify({ backendErrors, pending: [...pending], samples }),
          );
          throw error;
        });
      if (cycle) {
        await expect
          .poll(() =>
            composer.evaluate((node) =>
              "value" in node ? node.value : node.textContent,
            ),
          )
          .toBe(`草稿 ${chat.id}`);
      } else {
        await composer.fill(`草稿 ${chat.id}`);
        await page.waitForTimeout(150);
      }
      latencies.push(performance.now() - started);
      if (index % 5 === 4) {
        const metrics = await cdp.send("Performance.getMetrics");
        const cache = await page.evaluate(
          () =>
            (
              performance.getEntriesByName("domos.chat-cache").at(-1) as
                | PerformanceMark
                | undefined
            )?.detail as {
              estimatedBytes: number;
              protectedBytes: number;
              budgetBytes: number;
              entries: number;
              evictions: number;
            },
        );
        expect(cache.estimatedBytes).toBeLessThanOrEqual(
          Math.max(cache.budgetBytes, cache.protectedBytes),
        );
        console.log(
          `Resource sample ${samples.length}: cycle ${cycle + 1}, conversation ${index + 1}`,
        );
        const backend = await service.control({ metrics: true });
        const processes = (await system.send("SystemInfo.getProcessInfo"))
          .processInfo;
        const rendererIds = processes
          .filter((item) => item.type === "renderer")
          .map((item) => item.id);
        let rendererPrivateMiB: number | null = null;
        if (process.platform === "win32") {
          const { stdout } = await promisify(execFile)(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `(Get-Process -Id ${rendererIds.join(",")} -ErrorAction SilentlyContinue | Measure-Object -Property PrivateMemorySize64 -Sum).Sum`,
            ],
            { windowsHide: true },
          );
          rendererPrivateMiB = Number(stdout.trim()) / 1024 ** 2;
        }
        samples.push({
          step: samples.length,
          heapMiB:
            (metrics.metrics.find((metric) => metric.name === "JSHeapUsedSize")
              ?.value ?? 0) /
            1024 ** 2,
          rssMiB: backend.memory.rss / 1024 ** 2,
          rendererPrivateMiB,
          browserProcesses: processes.length,
          cacheMiB: cache.estimatedBytes / 1024 ** 2,
          entries: cache.entries,
          evictions: cache.evictions,
          latencyMs: latencies.at(-1)!,
        });
      }
    }
  }
  const frameDelays = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const delays: number[] = [];
        let previous = performance.now();
        const sample = (now: number) => {
          delays.push(now - previous);
          previous = now;
          if (delays.length === 60) resolve(delays);
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  await page.evaluate(() => {
    const now = Date.now() + 11 * 60_000;
    Date.now = () => now;
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              performance.getEntriesByName("domos.chat-cache").at(-1) as
                | PerformanceMark
                | undefined
            )?.detail.entries,
        ),
      { timeout: 65000 },
    )
    .toBe(1);
  const p95 = (values: number[]) =>
    values.toSorted((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
  await cdp.send("HeapProfiler.collectGarbage");
  const afterIdle = (await cdp.send("Performance.getMetrics")).metrics;
  const postGcHeapMiB =
    (afterIdle.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0) /
    1024 ** 2;
  const report = {
    bots: 7,
    conversations: 35,
    switches: 70,
    messages: 8400,
    postGcHeapMiB,
    p95SwitchMs: p95(latencies),
    p95FrameMs: p95(frameDelays),
    samples,
    backendPid: service.worker.pid,
    workload:
      "isolated persisted history; model generation and native CLI lifecycle tested separately",
  };
  await writeFile(
    info.outputPath("resource-stress.json"),
    JSON.stringify(report, null, 2),
  );
  const max = Math.max(
    ...samples.flatMap((sample) => [sample.heapMiB, sample.rssMiB]),
    32,
  );
  const line = (field: "heapMiB" | "rssMiB" | "cacheMiB", color: string) =>
    `<polyline fill="none" stroke="${color}" stroke-width="2" points="${samples.map((sample, index) => `${40 + index * 50},${280 - (sample[field] / max) * 240}`).join(" ")}"/>`;
  await writeFile(
    info.outputPath("resource-stress.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="330" viewBox="0 0 760 330"><rect width="760" height="330" fill="white"/><text x="40" y="24">35 conversations × 2 cycles · MiB · peak ${max.toFixed(1)}</text>${line("heapMiB", "#3559b8")}${line("rssMiB", "#b84236")}${line("cacheMiB", "#2b8562")}<text x="40" y="315">Blue: JS heap · Red: backend RSS · Green: retained chat estimate · samples every 5 switches</text></svg>`,
  );
  await info.attach("resource-stress", {
    path: info.outputPath("resource-stress.json"),
    contentType: "application/json",
  });
  expect(samples.at(-1)!.evictions).toBeGreaterThan(0);
  expect(postGcHeapMiB).toBeLessThan(
    Math.max(...samples.map((sample) => sample.heapMiB)),
  );
  expect(report.p95SwitchMs).toBeLessThan(3000);
  expect(report.p95FrameMs).toBeLessThan(100);
});
