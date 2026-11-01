import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { expect, test, vi } from "vitest";
import { EngineProjection } from "../src/harness/projection.ts";
import type {
  EngineRuntime,
  StoredMessage,
} from "../src/harness/task-types.ts";

function fixture() {
  const old: StoredMessage = {
    id: "old",
    role: "assistant",
    content: [],
    stopped: false,
    timestamp: 1,
  };
  const doc = {
    activeId: 1,
    drafts: [old],
    runtime: {},
    dispatch: "sending",
    sessionKey: "pi",
    sessions: { pi: { id: "native", through: null } },
  };
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const commit = vi.fn(async (change) => {
    entered.resolve();
    await released.promise;
    await change({ doc: async () => doc }, { input: { entryId: "entry" } });
  });
  const projection = new EngineProjection(
    { conversationId: 7, taskId: 1, commit } as unknown as EngineRuntime,
    "turn",
    context,
    doc.drafts,
  );
  return { projection, doc, old, commit, entered, released };
}

test("slow storage does not block events; terminal flush drains changes and keeps receipt times", async () => {
  const f = fixture();
  try {
    await f.projection.emit({
      type: "thinking",
      id: "m1",
      text: "read",
      receivedAt: 100,
    });
    await f.projection.emit({
      type: "tool",
      id: "t1",
      name: "get_window_state",
      input: {},
      receivedAt: 200,
    });
    await f.entered.promise;
    await f.projection.emit({
      type: "tool_result",
      id: "t1",
      name: "get_window_state",
      text: "native",
      failed: false,
      receivedAt: 250,
    });
    for (let i = 0; i < 100; i++)
      await f.projection.emit({
        type: "text",
        id: "m2",
        text: "x",
        receivedAt: 300 + i,
      });
    const done = f.projection.flush();
    expect(f.commit).toHaveBeenCalledOnce();
    f.released.resolve();
    await done;
    expect(f.doc.drafts[0]).toBe(f.old);
    expect(
      f.doc.drafts.find((m) => m.id === "turn:t1:message")?.receivedAt,
    ).toBe(200);
    expect(f.doc.drafts.find((m) => m.toolCallId === "t1")?.endedAt).toBe(250);
    expect(f.doc.drafts.find((m) => m.id === "turn:m1:thinking")?.endedAt).toBe(
      200,
    );
    expect(
      f.doc.drafts.find((m) => m.id === "turn:m2:message")?.content[0],
    ).toMatchObject({ text: "x".repeat(100) });
    expect(f.commit.mock.calls.length).toBeLessThanOrEqual(3);
  } finally {
    f.released.resolve();
    await f.projection.flush();
  }
});

test("native acceptance waits for durable receipt and advances the handoff cursor", async () => {
  const f = fixture();
  let accepted = false;
  const receipt = f.projection
    .emit({ type: "accepted", id: "native-turn" })
    .then(() => {
      accepted = true;
    });
  await f.entered.promise;
  expect(accepted).toBe(false);
  f.released.resolve();
  await receipt;
  expect(f.doc.dispatch).toBe("accepted");
  expect(f.doc.sessions.pi.through).toBe("entry");
});

test("stopped projections cannot update a later turn", async () => {
  const f = fixture();
  await f.projection.emit({ type: "tool", id: "t1", name: "click", input: {} });
  await f.entered.promise;
  f.doc.activeId = 2;
  f.released.resolve();
  await f.projection.flush();
  expect(f.doc.drafts).toEqual([f.old]);
});

test("storage failures reach terminal flush", async () => {
  const f = fixture();
  f.commit.mockRejectedValue(new Error("storage failed"));
  await f.projection.emit({ type: "tool", id: "t1", name: "click", input: {} });
  await expect(f.projection.flush()).rejects.toThrow("storage failed");
});

test("partial results update one record; recovery preserves identities and known times", async () => {
  const f = fixture();
  f.released.resolve();
  await f.projection.emit({
    type: "tool",
    id: "command",
    name: "commandExecution",
    input: { command: "node --version" },
    receivedAt: 100,
  });
  await f.projection.emit({
    type: "tool_result",
    id: "command",
    name: "commandExecution",
    text: "v24",
    failed: false,
    partial: true,
    append: true,
    receivedAt: 110,
  });
  await f.projection.flush();
  expect(
    f.doc.drafts.find((message) => message.toolCallId === "command"),
  ).toMatchObject({
    toolStatus: "running",
    updatedAt: 110,
    content: [{ text: "v24" }],
  });
  await f.projection.emit({
    type: "tool_result",
    id: "command",
    name: "commandExecution",
    text: ".16",
    failed: false,
    partial: true,
    append: true,
    receivedAt: 120,
  });
  const native = {
    type: "commandExecution",
    exitCode: 0,
    aggregatedOutput: "v24.16",
  };
  await f.projection.emit({
    type: "tool_result",
    id: "command",
    name: "commandExecution",
    text: "v24.16",
    failed: false,
    native,
    receivedAt: 130,
  });
  await f.projection.flush();
  const count = f.doc.drafts.length;
  const restored = new EngineProjection(
    {
      conversationId: 7,
      taskId: 1,
      commit: f.commit,
    } as unknown as EngineRuntime,
    "turn",
    context,
    f.doc.drafts,
  );
  await restored.emit({
    type: "tool",
    id: "command",
    name: "commandExecution",
    input: { command: "node --version" },
    recovered: true,
  });
  await restored.emit({
    type: "tool_result",
    id: "command",
    name: "commandExecution",
    text: "v24.16",
    failed: false,
    native,
    recovered: true,
  });
  await restored.emit({
    type: "tool",
    id: "search",
    name: "webSearch",
    input: { query: "example source" },
    recovered: true,
  });
  await restored.flush();
  expect(f.doc.drafts).toHaveLength(count + 1);
  expect(
    f.doc.drafts.find((message) => message.id === "turn:command:message")
      ?.receivedAt,
  ).toBe(100);
  expect(
    f.doc.drafts.find((message) => message.toolCallId === "command"),
  ).toMatchObject({
    toolStatus: "done",
    endedAt: 130,
    native,
    content: [{ text: "v24.16" }],
  });
  const search = f.doc.drafts.find(
    (message) => message.id === "turn:search:message",
  );
  expect(search?.timestamp).toBeUndefined();
  expect(search?.receivedAt).toBeUndefined();
});
