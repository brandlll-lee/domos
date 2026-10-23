import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { expect, onTestFinished, test } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import { engineIds } from "../src/harness/types.ts";
import { messageText } from "../src/messages.ts";
import { openAgent } from "../src/open-agent.ts";
import { ProtocolProcess, type Request } from "./fixtures/engine-process.ts";

test.each(
  engineIds.flatMap((provider) =>
    ["managed", "native"].map((accountSource) => ({
      provider,
      accountSource: accountSource as "managed" | "native",
    })),
  ),
)(
  "$provider $accountSource preserves reply order and settles additional input with usage",
  async ({ provider, accountSource }) => {
    const directory = await mkdtemp(join(tmpdir(), "domos-input-order-"));
    const models = createModels();
    models.setProvider(fauxProvider().provider);
    const workers: ProtocolProcess[] = [];
    const started = Promise.withResolvers<void>();
    const accepted = Promise.withResolvers<void>();
    let complete: () => void = () => {};
    const computers = {
      initialize: async () => {},
      preflight: async () => {},
      computerId: async () => "local",
      tools: { catalog: async () => [], finish: () => {} },
      process: async () => {
        const worker = new ProtocolProcess();
        workers.push(worker);
        let prompt: Request;
        let finished = false;
        const usage = {
          input: 100,
          output: 10,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { total: 0.01 },
        };
        const reply = () => {
          if (provider === "codex")
            worker.frame({
              method: "item/completed",
              params: {
                item: {
                  id: "answer",
                  type: "agentMessage",
                  text: "intermediate",
                },
              },
            });
          else if (provider === "claude")
            worker.frame({
              type: "assistant",
              message: {
                id: "answer",
                content: [{ type: "text", text: "intermediate" }],
              },
            });
          else if (provider === "pi") {
            worker.frame({
              type: "message_start",
              message: { role: "assistant" },
            });
            worker.frame({
              type: "message_end",
              message: {
                role: "assistant",
                provider: "fixture",
                model: "fixture",
                timestamp: 1,
                content: [{ type: "text", text: "intermediate" }],
                usage,
                stopReason: "stop",
              },
            });
          } else {
            worker.frame({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId: "chat",
                update: {
                  sessionUpdate: "agent_message_chunk",
                  messageId: "answer",
                  content: { type: "text", text: "intermediate" },
                },
              },
            });
            worker.frame({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId: "chat",
                update: {
                  sessionUpdate: "tool_call",
                  toolCallId: "read",
                  title: "Read",
                  status: "in_progress",
                },
              },
            });
          }
        };
        const finish = () => {
          finished = true;
          if (provider === "codex") {
            worker.frame({
              method: "thread/tokenUsage/updated",
              params: {
                turnId: "turn",
                tokenUsage: {
                  total: { inputTokens: 100, outputTokens: 10 },
                  last: { inputTokens: 100 },
                },
              },
            });
            worker.frame({
              method: "turn/completed",
              params: { turn: { status: "completed" } },
            });
          } else if (provider === "claude")
            worker.frame({
              type: "result",
              uuid: "result",
              usage: { input_tokens: 100, output_tokens: 10 },
              queued_turn_count: 0,
            });
          else if (provider === "pi") worker.frame({ type: "agent_settled" });
          else worker.response(prompt, { stopReason: "end_turn" });
        };
        const begin = (request: Request) => {
          prompt = request;
          if (workers.length > 1) {
            finish();
            return;
          }
          complete = finish;
          reply();
          started.resolve();
        };
        worker.request = async <T>() =>
          (finished
            ? [
                {
                  info: { id: "answer", role: "assistant", tokens: usage },
                  parts: [
                    {
                      type: "text",
                      text: workers.length === 1 ? "intermediate" : "final",
                    },
                  ],
                },
              ]
            : []) as T;
        worker.receive = (request) => {
          if (provider === "pi") {
            worker.frame({
              type: "response",
              id: request.id,
              success: true,
              data:
                request.type === "get_state"
                  ? { sessionFile: "/work/session.jsonl" }
                  : {},
            });
            if (request.type === "prompt") begin(request);
            if (request.type === "steer") accepted.resolve();
          } else if (provider === "claude") {
            if (request.type === "user") {
              if (!prompt) begin(request);
              else {
                worker.frame({
                  type: "user",
                  uuid: (request as unknown as { uuid: string }).uuid,
                  isReplay: true,
                });
                accepted.resolve();
              }
            }
          } else if (request.method === "initialize")
            worker.response(request, {
              protocolVersion: 1,
              agentCapabilities: { loadSession: true },
            });
          else if (
            ["thread/start", "thread/resume"].includes(request.method ?? "")
          )
            worker.response(request, { thread: { id: "chat" } });
          else if (
            ["session/new", "session/load"].includes(request.method ?? "")
          )
            worker.response(request, { sessionId: "chat" });
          else if (request.method === "turn/start") {
            worker.response(request, { turn: { id: "turn" } });
            begin(request);
          } else if (request.method === "turn/steer") {
            worker.response(request, { turnId: "turn" });
            accepted.resolve();
          } else if (request.method === "session/prompt") begin(request);
          else if (request.id !== undefined) worker.response(request, {});
        };
        return worker;
      },
    } as unknown as Computers;
    const runtime = await openAgent(
      join(directory, "agent.sqlite"),
      { registry: createRegistry(), models, computers },
      {},
      context,
    );
    const engines = runtime.engines;
    if (!engines) throw new Error("Engines are required");
    const botId = runtime.conversation.id;
    onTestFinished(async () => {
      complete();
      await runtime.harness.close(context);
      await Promise.all(workers.map((worker) => worker.close()));
      await rm(directory, { recursive: true, force: true });
    });
    await engines.configure(
      botId,
      {
        config: { provider, model: null, accountSource },
        revision: 0,
        requestId: crypto.randomUUID(),
      },
      context,
    );
    const first = await engines.submit(
      botId,
      { text: "first", requestId: crypto.randomUUID() },
      context,
    );
    await started.promise;
    const texts = async () =>
      (await engines.view(botId, context)).messages
        .filter((message) => !message.pending)
        .map(messageText)
        .filter(Boolean);
    await expect.poll(texts).toContain("intermediate");
    const second = await engines.submit(
      botId,
      { text: "second", requestId: crypto.randomUUID() },
      context,
    );
    if (provider !== "opencode") await accepted.promise;
    const liveOrder = await texts();
    complete();
    await expect
      .poll(async () => (await engines.profile(botId, context)).busy)
      .toBe(false);
    expect(await first.wait(context)).toMatchObject({ status: "done" });
    expect(await second.wait(context)).toMatchObject({ status: "done" });
    expect(workers).toHaveLength(provider === "opencode" ? 2 : 1);
    expect(await engines.usage([botId], {}, context)).not.toHaveLength(0);
    expect(liveOrder).toEqual(["first", "intermediate", "second"]);
    expect((await texts()).slice(0, 3)).toEqual([
      "first",
      "intermediate",
      "second",
    ]);
  },
);
