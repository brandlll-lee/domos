import { expect, test, vi } from "vitest";
import { readClaudeAccount } from "../src/harness/claude-account.ts";
import { engineLimits } from "../src/harness/types.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

test("reads the logged-in status from the selected Claude config directory", async () => {
  const worker = new ProtocolProcess();
  worker.launch = async (spec) => {
    worker.spec = spec;
    worker.output.write('{"loggedIn":true}\n');
    worker.ended.resolve({ code: 0 });
  };

  await expect(
    readClaudeAccount(worker, { ANTHROPIC_API_KEY: "key" }),
  ).resolves.toBe(true);
  expect(worker.spec).toMatchObject({
    command: "claude",
    args: ["auth", "status"],
    env: {
      ANTHROPIC_API_KEY: "key",
      CLAUDE_CONFIG_DIR: "/work/accounts/claude",
    },
  });
});

test("uses an explicit signed-out status with exit code one", async () => {
  const worker = new ProtocolProcess();
  worker.launch = async () => {
    worker.output.write('{"loggedIn":false}\n');
    worker.ended.resolve({ code: 1 });
  };

  await expect(readClaudeAccount(worker)).resolves.toBe(false);
});

test("reports malformed status output as a connection check error", async () => {
  const worker = new ProtocolProcess();
  worker.launch = async () => {
    worker.output.write("not json\n");
    worker.ended.resolve({ code: 0 });
  };

  await expect(readClaudeAccount(worker)).rejects.toThrow("连接检查未完成");
});

test("reports a status command timeout as a connection check error", async () => {
  vi.useFakeTimers();
  try {
    const worker = new ProtocolProcess();
    const result = readClaudeAccount(worker);
    const rejected = expect(result).rejects.toThrow("连接检查未完成");
    await vi.advanceTimersByTimeAsync(engineLimits.handshakeMs);
    await rejected;
  } finally {
    vi.useRealTimers();
  }
});
