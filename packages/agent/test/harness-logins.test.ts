import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { expect, onTestFinished, test } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import { EngineExecution } from "../src/harness/execution.ts";
import { EngineLogins } from "../src/harness/logins.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

function setup(worker: ProtocolProcess) {
  const execution = new EngineExecution({
    computerId: async () => "work",
    process: async () => worker,
  } as unknown as Computers);
  const logins = new EngineLogins(execution);
  onTestFinished(() => logins.cancel(1));
  return logins;
}

test("Pi login preserves a new prompt while answering the previous one and clears secrets", async () => {
  const worker = new ProtocolProcess();
  const logins = setup(worker);
  worker.receive = (request) => {
    if (request.type === "extension_ui_response") {
      if (request.id === "provider") {
        worker.frame({
          type: "extension_ui_request",
          method: "notify",
          message: 'domos-auth:{"secret":true}',
        });
        worker.frame({
          type: "extension_ui_request",
          method: "input",
          id: "key",
          title: "API Key",
        });
      } else
        worker.frame({
          type: "extension_ui_request",
          method: "notify",
          message: 'domos-auth:{"state":"done"}',
        });
      return;
    }
    worker.frame({
      type: "response",
      id: request.id,
      success: true,
      data:
        request.type === "get_commands"
          ? { commands: [{ name: "domos-auth" }] }
          : {},
    });
    if (request.type === "prompt")
      worker.frame({
        type: "extension_ui_request",
        method: "select",
        id: "provider",
        title: "Provider",
        options: ["example"],
      });
  };
  await logins.start(
    1,
    { provider: "pi", model: null, command: "/native/pi" },
    {},
    context,
  );
  await expect.poll(() => logins.state(1)?.options).toEqual(["example"]);
  expect(worker.spec?.command).toBe("/native/pi");
  await logins.answer(1, "example");
  expect(logins.state(1)).toMatchObject({ prompt: "API Key", secret: true });
  await logins.answer(1, "test-only-key");
  await expect.poll(() => logins.state(1)?.state).toBe("done");
  expect(JSON.stringify(logins.state(1))).not.toContain("test-only-key");
  expect(logins.busy(1)).toBe(false);
});

test("OpenCode writes API credentials only through its native work-computer service", async () => {
  const worker = new ProtocolProcess();
  const writes: { path: string; method?: string; body?: unknown }[] = [];
  worker.request = async <T>(path: string, method?: string, body?: unknown) => {
    if (path === "/provider")
      return {
        all: [{ id: "example", name: "Example", models: {} }],
        connected: [],
      } as T;
    if (path === "/provider/auth")
      return { example: [{ type: "api", label: "API Key" }] } as T;
    writes.push({ path, method, body });
    return true as T;
  };
  const logins = setup(worker);
  expect(
    await logins.start(
      1,
      { provider: "opencode", model: null, command: "/native/opencode" },
      { providerId: "example", method: 0 },
      context,
    ),
  ).toMatchObject({ prompt: "API Key", secret: true });
  await expect(
    logins.start(2, { provider: "opencode", model: null }, {}, context),
  ).rejects.toThrow("正在连接");
  await logins.answer(1, "test-only-key");
  expect(writes).toEqual([
    {
      path: "/auth/example",
      method: "PUT",
      body: { type: "api", key: "test-only-key" },
    },
  ]);
  expect(logins.state(1)?.state).toBe("done");
  expect(worker.spec?.command).toBe("/native/opencode");
});
