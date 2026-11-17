import { expect, onTestFinished, test, vi } from "vitest";
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
