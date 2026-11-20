import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { expect, onTestFinished, test, vi } from "vitest";
import { BotDirectory } from "../src/bots.ts";
import { EngineConnections } from "../src/harness/connections.ts";
import type { EngineExecution } from "../src/harness/execution.ts";
import { openChat } from "../src/open-chat.ts";
import { parseConfig } from "../src/runtime/config.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

test("quota coalesces shared accounts, retains failed reads and invalidates after usage", async () => {
  let reads = 0;
  let fail = false;
  let account = "shared-account";
  let computerId = "process";
  let program: string | null = "/native/codex";
  const gate = Promise.withResolvers<void>();
  const execution = {
    usageRevision: 0,
    quota: () => undefined,
    computers: {
      computerId: async () => computerId,
      process: async () => {
        const process = new ProtocolProcess();
        process.account = async () => account;
        Object.assign(process, { resolve: async () => program });
        process.receive = (request) => {
          if (request.method === "account/read")
            process.response(request, {
              account: {
                type: "chatgpt",
                email: "person@example.com",
                planType: "pro",
              },
            });
          else if (request.method === "account/rateLimits/read") {
            reads++;
            void gate.promise.then(() => {
              if (fail)
                process.frame({
                  jsonrpc: "2.0",
                  id: request.id,
                  error: { code: -32001, message: "Native unavailable" },
                });
              else
                process.response(request, {
                  rateLimits: {
                    primary: {
                      usedPercent: 25,
                      windowDurationMins: 300,
                      resetsAt: 2000000000,
                    },
                  },
                });
            });
          } else process.response(request, {});
        };
        return process;
      },
    },
  };
  Object.assign(execution.computers, {
    accountProcess: execution.computers.process,
  });
  const connections = new EngineConnections(
    execution as unknown as EngineExecution,
  );
  const config = { provider: "codex" as const, model: null };
  const first = connections.quota(1, config, context);
  const second = connections.quota(2, config, context);
  await expect.poll(() => reads).toBe(1);
  gate.resolve();
  expect((await first).status).toBe("ready");
  expect((await second).status).toBe("ready");
  await connections.quota(2, config, context);
  expect(reads).toBe(1);
  expect(await connections.quota(null, config, context)).toMatchObject({
    status: "ready",
    computerId: "process",
    accountLabel: "person@example.com",
    plan: "pro",
  });
  expect(reads).toBe(1);
  fail = true;
  const failed = await connections.quota(1, config, context, true);
  expect(failed).toMatchObject({
    status: "failed",
    message: expect.stringContaining("Native unavailable"),
    windows: [{ usedPercent: 25 }],
  });
  fail = false;
  execution.usageRevision++;
  expect((await connections.quota(2, config, context)).status).toBe("ready");
  expect(reads).toBe(3);
  account = "other-account";
  await connections.quota(2, config, context);
  expect(reads).toBe(4);
  computerId = "other-computer";
  await connections.quota(2, config, context);
  expect(reads).toBe(5);
  program = "/other/codex";
  await connections.quota(null, config, context);
  expect(reads).toBe(6);
  program = null;
  expect((await connections.quota(null, config, context)).status).toBe(
    "not-installed",
  );
  expect(reads).toBe(6);
  expect(
    (await connections.quota(2, { provider: "pi", model: null }, context))
      .status,
  ).toBe("unsupported");
});

test("computer account reads require authorization and work without a Bot workspace", async () => {
  vi.stubEnv("DEVIN_BEARER_TOKEN", "");
  vi.stubEnv("DEVIN_AUTHORIZATION", "");
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const directory = await mkdtemp(join(tmpdir(), "domos-account-quota-"));
  const config = parseConfig(
    { dataDir: directory },
    join(directory, "config.json"),
  );
  const runtime = await openChat(context, config);
  onTestFinished(async () => {
    await runtime.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  });
  await runtime.harness.commit(async (tx) => {
    (await tx.doc(BotDirectory)).items = [];
  }, context);
  expect(await runtime.bots.list(context)).toHaveLength(0);
  await expect(runtime.computer.accountProcess(context)).rejects.toThrow(
    "授权此电脑",
  );
  await runtime.computer.authorize("process", true, context);
  const worker = await runtime.computer.accountProcess(context);
  try {
    expect((await worker.ready).cwd).toBe(directory);
    expect(
      await worker.resolve?.("domos-quota-uninstalled-fixture"),
    ).toBeNull();
    expect(await runtime.bots.list(context)).toHaveLength(0);
    expect(await worker.quota?.("devin", "devin")).toMatchObject({
      status: "signed-out",
      source: "devin.billing/quota/usage",
    });
  } finally {
    await worker.close();
  }
});

test.each(["cursor", "antigravity", "devin"] as const)(
  "%s reads through the owning worker and retains its last quota after failure",
  async (provider) => {
    let fail = false;
    let reads = 0;
    let installed = provider === "antigravity";
    const execution = {
      usageRevision: 0,
      computers: {
        computerId: async () => "computer",
        accountProcess: async () =>
          Object.assign(new ProtocolProcess(), {
            resolve: async () => (installed ? "/native/agent" : null),
            quota: async (id: string) => {
              expect(id).toBe(provider);
              reads++;
              return {
                source: provider,
                observedAt: 1234,
                status: fail ? "failed" : "ready",
                message: fail ? "offline" : undefined,
                windows: fail
                  ? []
                  : [
                      {
                        id: "primary",
                        name: "Quota",
                        usedPercent: 20,
                        durationMinutes: null,
                        resetsAt: null,
                      },
                    ],
              };
            },
          }),
      },
    };
    const connections = new EngineConnections(
      execution as unknown as EngineExecution,
    );
    const config = { provider, model: null };
    expect(await connections.quota(null, config, context)).toMatchObject({
      status: "ready",
      windows: [{ usedPercent: 20 }],
    });
    expect(await connections.quota(null, config, context)).toMatchObject({
      status: "ready",
    });
    expect(reads).toBe(1);
    fail = true;
    expect(await connections.quota(null, config, context, true)).toMatchObject({
      status: "failed",
      observedAt: 1234,
      message: "offline",
      windows: [{ usedPercent: 20 }],
    });
    if (provider === "antigravity") {
      installed = false;
      expect(
        await connections.quota(null, config, context, true),
      ).toMatchObject({ status: "not-installed" });
    }
  },
);
