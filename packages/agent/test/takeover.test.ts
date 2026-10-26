import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, defineExtension } from "@earendil-works/pi-durable";
import { expect, onTestFinished, test, vi } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import { takeoverTool } from "../src/computer/takeover.ts";
import { EngineExecution, Engines, engineTask } from "../src/harness/index.ts";
import { engineProvider } from "../src/harness/providers/index.ts";
import { EngineDoc } from "../src/harness/state.ts";
import { engineIds, type ProductResult } from "../src/harness/types.ts";
import { openAgent } from "../src/open-agent.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

test.each([
  ...engineIds.map((provider) => ({ provider, ending: "complete" })),
  { provider: "pi" as const, ending: "stop" },
])(
  "$provider holds a durable takeover card through $ending",
  async ({ provider, ending }) => {
    const directory = await mkdtemp(join(tmpdir(), "domos-takeover-state-"));
    const models = createModels();
    models.setProvider(fauxProvider().provider);
    let invoke!: (
      id: string,
      name: string,
      args: Record<string, unknown>,
      signal: AbortSignal,
    ) => Promise<ProductResult>;
    let taken = false;
    let revision = 0;
    const drain = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<void>();
    const finishing = vi.fn(async () => {
      if (!taken) throw new Error("take first");
      await drain.promise;
      taken = false;
    });
    const computer = {
      preflight: async () => {},
      computerId: async () => "pc",
      binding: async () => ({ computerId: "pc", revision }),
      serviceTarget: async () => ({
        enabled: { browser: true, desktop: true },
      }),
      tools: { catalog: async () => [takeoverTool], finish: () => {} },
      views: {
        capture: async () => ({
          type: "image",
          mimeType: "image/png",
          data: "eA==",
        }),
        takeRequest: async () => {
          taken = true;
          return { controlling: true };
        },
        finishRequest: finishing,
      },
      process: async (
        _id: number,
        _tools: unknown,
        callback: typeof invoke,
      ) => {
        invoke = callback;
        return new ProtocolProcess();
      },
    } as unknown as Computers;
    const execution = new EngineExecution(computer);
    const registry = createRegistry();
    registry.install(
      defineExtension({
        name: "domos-engines",
        tasks: [engineTask(execution)],
      }),
    );
    const opened = vi
      .spyOn(engineProvider(provider), "open")
      .mockImplementation(async (options) => ({
        id: provider,
        prompt: async () => {
          await options.emit({ type: "accepted", id: "turn" });
          const result = await invoke(
            "handoff",
            takeoverTool.name,
            { service: "browser", reason: "请完成登录" },
            new AbortController().signal,
          );
          expect(result.isError).toBe(ending === "stop");
          await options.emit({
            type: "message",
            id: "answer",
            text: "Observed fresh state",
          });
          completed.resolve();
        },
        answer: async () => {},
        interrupt: async () => {},
        models: async () => [],
      }));
    const runtime = await openAgent(
      join(directory, "data.sqlite"),
      { registry, models },
      {},
      context,
    );
    onTestFinished(async () => {
      drain.resolve();
      await execution.stop(runtime.conversation.id);
      await runtime.harness.close(context);
      opened.mockRestore();
      await rm(directory, { recursive: true, force: true });
    });
    const engines = new Engines(runtime.harness, execution);
    const botId = runtime.conversation.id;
    await runtime.harness.commit(async (tx) => {
      (await tx.doc(EngineDoc, botId)).config = { provider, model: null };
    }, context);
    await engines.submit(
      botId,
      { text: "需要我接管", requestId: crypto.randomUUID() },
      context,
    );
    const state = () => runtime.harness.snapshot(EngineDoc, botId, context);
    await expect.poll(async () => (await state())?.approvals.length).toBe(1);
    const id = (await state())?.approvals[0]?.id;
    if (!id) throw new Error("Request required");
    expect(
      (await state())?.drafts.find((message) => message.takeover)?.takeover
        ?.state,
    ).toBe("waiting");
    await expect(
      invoke(
        "duplicate",
        takeoverTool.name,
        { service: "browser", reason: "Another request" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("等待用户");
    if (ending === "stop") {
      await engines.stop(botId, context);
      await expect.poll(async () => (await state())?.activeId).toBe(null);
      const entries = await runtime.conversation.viewState(context);
      expect(JSON.stringify(entries.value)).toContain('"state":"expired"');
      expect(JSON.stringify(entries.value)).not.toContain('"state":"done"');
      return;
    }
    revision++;
    await expect(
      engines.takeRequest(botId, id, crypto.randomUUID(), context),
    ).rejects.toThrow("配置已改变");
    revision--;
    await expect(
      engines.answer(botId, id, { allow: true }, context),
    ).rejects.toThrow("take first");
    await engines.takeRequest(botId, id, crypto.randomUUID(), context);
    const answer = engines.answer(botId, id, { allow: true }, context);
    await expect.poll(() => finishing.mock.calls.length).toBe(2);
    expect(
      (await state())?.drafts.find((message) => message.takeover)?.takeover
        ?.state,
    ).toBe("waiting");
    drain.resolve();
    await answer;
    await completed.promise;
    await expect.poll(async () => (await state())?.activeId).toBe(null);
    const entries = await runtime.conversation.viewState(context);
    expect(JSON.stringify(entries.value)).toContain('"state":"done"');
    await expect(
      engines.takeRequest(botId, id, crypto.randomUUID(), context),
    ).rejects.toThrow("失效");
  },
);
