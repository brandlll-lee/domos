import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { expect, test } from "vitest";
import { EngineConnections } from "../src/harness/connections.ts";
import type { EngineExecution } from "../src/harness/execution.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

test("quota coalesces shared accounts, retains failed reads and invalidates after usage", async () => {
  let reads = 0;
  let fail = false;
  let account = "shared-account";
  const gate = Promise.withResolvers<void>();
  const execution = {
    usageRevision: 0,
    quota: () => undefined,
    computers: {
      computerId: async () => "local",
      process: async () => {
        const process = new ProtocolProcess();
        process.account = async () => account;
        Object.assign(process, { resolve: async () => "/native/codex" });
        process.receive = (request) => {
          if (request.method === "account/read")
            process.response(request, { account: { type: "chatgpt" } });
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
  expect(
    (await connections.quota(2, { provider: "pi", model: null }, context))
      .status,
  ).toBe("unsupported");
});
