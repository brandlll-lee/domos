import { expect, onTestFinished, test } from "vitest";
import { engineProvider } from "../src/harness/providers/index.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

test("Pi clears queued work before it aborts", async () => {
  const process = new ProtocolProcess();
  onTestFinished(() => process.close());
  process.receive = (request) =>
    process.frame({
      type: "response",
      id: request.id,
      success: true,
      data:
        request.type === "get_state"
          ? { sessionFile: "/work/session.jsonl" }
          : {},
    });
  const session = await engineProvider("pi").open({
    process,
    config: { provider: "pi", model: null },
    sessionId: null,
    instructions: "Test",
    emit: async () => {},
  });
  await session.interrupt();
  expect(process.requests.slice(-2).map((request) => request.type)).toEqual([
    "clear_queue",
    "abort",
  ]);
});

test("Claude interrupts the native turn through its control channel", async () => {
  const process = new ProtocolProcess();
  onTestFinished(() => process.close());
  process.receive = (request) => {
    const frame = request as unknown as { type: string; request_id: string };
    if (frame.type === "control_request")
      process.frame({
        type: "control_response",
        response: { subtype: "success", request_id: frame.request_id },
      });
  };
  const session = await engineProvider("claude").open({
    process,
    config: { provider: "claude", model: null },
    sessionId: null,
    instructions: "Test",
    emit: async () => {},
  });
  await session.interrupt();
  expect(process.requests).toContainEqual(
    expect.objectContaining({
      type: "control_request",
      request: { subtype: "interrupt" },
    }),
  );
});

test("OpenCode cancels a pending permission when the user stops", async () => {
  const process = new ProtocolProcess();
  onTestFinished(() => process.close());
  const permission = Promise.withResolvers<void>();
  let promptId: string | number | undefined;
  process.receive = (request) => {
    if (request.method === "initialize")
      process.response(request, { protocolVersion: 1, agentCapabilities: {} });
    else if (request.method === "session/new")
      process.response(request, { sessionId: "native" });
    else if (request.method === "session/prompt") {
      promptId = request.id;
      process.frame({
        jsonrpc: "2.0",
        id: "permission",
        method: "session/request_permission",
        params: {
          sessionId: "native",
          toolCall: { toolCallId: "click", title: "Click" },
          options: [],
        },
      });
    } else if (request.method === "session/cancel")
      process.frame({
        jsonrpc: "2.0",
        id: promptId,
        result: { stopReason: "cancelled" },
      });
  };
  const session = await engineProvider("opencode").open({
    process,
    config: { provider: "opencode", model: null },
    sessionId: null,
    instructions: "Test",
    emit: async (event) => {
      if (event.type === "approval") permission.resolve();
    },
  });
  const turn = session.prompt("Work").catch((error: Error) => error.message);
  await permission.promise;
  await session.interrupt();
  expect(await turn).toContain("停止");
  await expect
    .poll(
      () =>
        process.requests.find((request) => request.id === "permission")?.result,
    )
    .toEqual({ outcome: { outcome: "cancelled" } });
});
