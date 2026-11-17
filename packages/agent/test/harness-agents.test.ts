import { expect, onTestFinished, test, vi } from "vitest";
import { antigravityProvider } from "../src/harness/providers/antigravity.ts";
import { devinProvider } from "../src/harness/providers/devin.ts";
import { grokProvider } from "../src/harness/providers/grok.ts";
import type { EngineEvent, EngineProvider } from "../src/harness/types.ts";
import { ProtocolProcess, type Request } from "./fixtures/engine-process.ts";

function agent(provider: EngineProvider, initialization: object = {}) {
  const process = new ProtocolProcess();
  const events: EngineEvent[] = [];
  const prompts: Request[] = [];
  process.receive = (request) => {
    if (request.method === "session/prompt") prompts.push(request);
    else
      process.response(
        request,
        request.method === "initialize"
          ? {
              protocolVersion: 1,
              agentCapabilities: {
                loadSession: true,
                mcpCapabilities: { http: true },
                promptCapabilities: { image: true },
              },
              ...initialization,
            }
          : request.method === "session/new" ||
              request.method === "session/load"
            ? {
                sessionId: "native",
                modes: {
                  currentModeId: "default",
                  availableModes: [
                    { id: "default", name: "Default" },
                    { id: "accept-edits", name: "Accept edits" },
                  ],
                },
                configOptions: [
                  {
                    id: "model",
                    name: "Model",
                    category: "model",
                    type: "select",
                    currentValue: "native/model",
                    options: [{ value: "native/model", name: "Native model" }],
                  },
                ],
              }
            : {},
      );
  };
  onTestFinished(() => process.close());
  return {
    process,
    events,
    prompts,
    open: () =>
      provider.open({
        process,
        config: { provider: provider.id, model: "native/model" },
        sessionId: null,
        instructions: "Domos rules",
        emit: async (event) => {
          events.push(event);
        },
      }),
  };
}

test("Grok uses the installed CLI, native models and stable interjection identities", async () => {
  const { process, prompts, events, open } = agent(grokProvider);
  const session = await open();
  expect(process.spec).toMatchObject({
    command: "grok",
    args: ["--permission-mode", "default", "agent", "stdio"],
  });
  expect(await session.models()).toEqual([
    { id: "native/model", name: "Native model" },
  ]);
  const run = session.prompt("First");
  await vi.waitFor(() => expect(prompts).toHaveLength(1));
  const images = [
    { type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" },
  ];
  expect(await session.steer?.("Second", images, "message-2")).toBe("accepted");
  expect(await session.steer?.("Third", [], "message-3")).toBe("accepted");
  const steers = process.requests.filter(
    (request) => request.method === "_x.ai/interject",
  );
  expect(steers.map((request) => request.params)).toEqual([
    {
      sessionId: "native",
      text: "Second",
      content: [{ type: "text", text: "Second" }, ...images],
      interjectionId: "message-2",
    },
    {
      sessionId: "native",
      text: "Third",
      content: [{ type: "text", text: "Third" }],
      interjectionId: "message-3",
    },
  ]);
  process.frame({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "native",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Saved" },
      },
    },
  });
  process.response(prompts[0] as Request, { stopReason: "end_turn" });
  await run;
  expect(events).toContainEqual(
    expect.objectContaining({ type: "message", text: "Saved" }),
  );
  expect(await session.steer?.("Late")).toBe("refused");
});

test("Antigravity keeps the task open across two prompt replacements", async () => {
  const { process, prompts, open } = agent(antigravityProvider, {
    agentInfo: { name: "Antigravity", version: "1.5.9" },
  });
  const session = await open();
  expect(process.spec?.args).toEqual(["acp"]);
  let completed = false;
  const run = session.prompt("First").then(() => {
    completed = true;
  });
  await vi.waitFor(() => expect(prompts).toHaveLength(1));
  const second = session.steer?.("Second");
  await vi.waitFor(() => expect(prompts).toHaveLength(2));
  process.response(prompts[0] as Request, { stopReason: "end_turn" });
  expect(await second).toBe("accepted");
  expect(completed).toBe(false);
  const third = session.steer?.("Third");
  await vi.waitFor(() => expect(prompts).toHaveLength(3));
  process.response(prompts[1] as Request, { stopReason: "end_turn" });
  expect(await third).toBe("accepted");
  expect(completed).toBe(false);
  process.response(prompts[2] as Request, { stopReason: "end_turn" });
  await run;
  expect(completed).toBe(true);
});

test("Antigravity retains queued input when the CLI version does not confirm steering", async () => {
  const { open } = agent(antigravityProvider, {
    agentInfo: { name: "Antigravity", version: "1.4.5" },
  });
  const session = await open();
  expect(session.steer).toBeUndefined();
});

test("Devin admits echoed mid-turn messages and records repeated terminal usage once", async () => {
  const { process, prompts, events, open } = agent(devinProvider, {
    agentCapabilities: {
      loadSession: true,
      mcpCapabilities: { http: true },
      promptCapabilities: { image: true },
      _meta: { "cognition.ai/midTurnPrompts": true },
    },
  });
  const session = await open();
  const run = session.prompt("First");
  await vi.waitFor(() => expect(prompts).toHaveLength(1));
  const second = session.steer?.("Second");
  await vi.waitFor(() => expect(prompts).toHaveLength(2));
  process.frame({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "native",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "Second" },
      },
    },
  });
  expect(await second).toBe("accepted");
  const outcome = {
    stopReason: "end_turn",
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
  };
  process.response(prompts[0] as Request, outcome);
  process.response(prompts[1] as Request, outcome);
  await run;
  expect(events.filter((event) => event.type === "usage")).toHaveLength(1);
});

test("Devin keeps mid-turn inputs queued when the native capability is absent", async () => {
  const { open } = agent(devinProvider);
  expect((await open()).steer).toBeUndefined();
});

test.each([-32601, -32602, -32603])(
  "Grok preserves refused and uncertain interjections (%s)",
  async (code) => {
    const { process, prompts, open } = agent(grokProvider);
    const receive = process.receive;
    process.receive = (request) =>
      request.method === "_x.ai/interject"
        ? process.frame({
            jsonrpc: "2.0",
            id: request.id,
            error: { code, message: "Native rejection" },
          })
        : receive(request);
    const session = await open();
    const run = session.prompt("First");
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    expect(await session.steer?.("Second")).toBe(
      code === -32603 ? "uncertain" : "refused",
    );
    process.response(prompts[0] as Request, { stopReason: "end_turn" });
    await run;
    expect(prompts).toHaveLength(1);
  },
);
