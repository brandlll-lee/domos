import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { expect, test, vi } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import { EngineConnections } from "../src/harness/connections.ts";
import { EngineExecution } from "../src/harness/execution.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

function fixture() {
  const workers: ProtocolProcess[] = [];
  const computers = {
    computerId: async () => "shared-computer",
    process: async () => {
      const worker = new ProtocolProcess("cli");
      workers.push(worker);
      worker.launch = async (spec) => {
        worker.spec = spec;
        if (spec.args.includes("status")) {
          worker.output.write('{"loggedIn":true}');
          worker.ended.resolve({ code: 0 });
        } else
          worker.output.write(
            "https://claude.com/cai/oauth/authorize?state=fixture\nPaste code here: ",
          );
      };
      return worker;
    },
    tools: { catalog: async () => [], finish: () => {} },
  } as unknown as Computers;
  return {
    workers,
    connections: new EngineConnections(new EngineExecution(computers)),
  };
}

test("Claude login uses the original CLI and confirms the account before it is ready", async () => {
  const { workers, connections } = fixture();
  await expect(
    connections.login(1, { provider: "claude", model: null }, context),
  ).resolves.toMatchObject({
    state: "waiting",
    url: "https://claude.com/cai/oauth/authorize?state=fixture",
    prompt: "粘贴登录页面显示的代码",
  });
  const worker = workers[0];
  expect(worker?.spec).toMatchObject({
    command: "claude",
    args: ["auth", "login"],
    env: { CLAUDE_CONFIG_DIR: "/work/accounts/claude" },
  });
  const received: string[] = [];
  worker?.input.on("data", (data) => received.push(data.toString()));
  await connections.answerLogin(1, "fixture-code");
  expect(received).toEqual(["fixture-code\n"]);
  worker?.ended.resolve({ code: 0 });
  await vi.waitFor(() => expect(connections.loginState(1)?.state).toBe("done"));
  expect(workers[1]?.spec?.args).toEqual(["auth", "status"]);
  expect(connections.busy(1)).toBe(false);
});

test("shared accounts allow one login at a time and cancellation releases the account", async () => {
  const { connections } = fixture();
  const config = { provider: "claude" as const, model: null };
  await connections.login(1, config, context);
  await expect(connections.login(2, config, context)).rejects.toThrow(
    "正在连接此账号",
  );
  await connections.cancelLogin(1);
  expect(connections.loginState(1)).toBeNull();
  await expect(connections.login(2, config, context)).resolves.toMatchObject({
    state: "waiting",
  });
  await connections.cancelLogin(2);
});

test("a cancelled login cannot finish a later login for the same Bot", async () => {
  const { workers, connections } = fixture();
  const config = { provider: "claude" as const, model: null };
  await connections.login(1, config, context);
  await connections.cancelLogin(1);
  await connections.login(1, config, context);
  workers[0]?.ended.resolve({ code: 0 });
  await Promise.resolve();
  expect(connections.loginState(1)?.state).toBe("waiting");
  await connections.cancelLogin(1);
});

test("a failed CLI login stays failed and does not report an account", async () => {
  const { workers, connections } = fixture();
  await connections.login(1, { provider: "claude", model: null }, context);
  workers[0]?.ended.resolve({ code: 1 });
  await vi.waitFor(() =>
    expect(connections.loginState(1)?.state).toBe("failed"),
  );
  expect(workers).toHaveLength(1);
});

test.each(["auto", "code"])(
  "OpenCode completes %s login with the native callback before a fresh connection check",
  async (method) => {
    const worker = new ProtocolProcess("cli");
    worker.request = async <T>(path: string) =>
      (path === "/provider"
        ? {
            all: [{ id: "first", name: "First", models: {} }],
            connected: [],
          }
        : path === "/provider/auth"
          ? { first: [{ type: "oauth", label: "Sign in" }] }
          : path.endsWith("/authorize")
            ? {
                url: "https://example.com/login",
                method,
                instructions: "Sign in",
              }
            : true) as T;
    const computers = {
      computerId: async () => "shared-computer",
      process: async () => worker,
      tools: { catalog: async () => [], finish: () => {} },
    } as unknown as Computers;
    const connections = new EngineConnections(new EngineExecution(computers));
    await connections.login(1, { provider: "opencode", model: null }, context, {
      providerId: "first",
      method: 0,
    });
    if (method === "code") await connections.answerLogin(1, "fixture-code");
    await vi.waitFor(() =>
      expect(connections.loginState(1)?.state).toBe("done"),
    );
    await expect(worker.closed).resolves.toEqual({ code: 0 });
    expect(connections.busy(1)).toBe(false);
  },
);
