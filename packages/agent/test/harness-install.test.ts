import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { expect, test } from "vitest";
import { EngineConnections } from "../src/harness/connections.ts";
import type { EngineExecution } from "../src/harness/execution.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

test("native installation reuses existing programs and serializes downloads on one computer", async () => {
  let installed = true;
  const started = Promise.withResolvers<ProtocolProcess>();
  const workers: ProtocolProcess[] = [];
  const connections = new EngineConnections({
    computers: {
      computerId: async () => "work",
      process: async () => {
        const worker = Object.assign(new ProtocolProcess(), {
          resolve: async (command: string) => (installed ? command : null),
        });
        worker.launch = async (spec) => {
          worker.spec = spec;
          started.resolve(worker);
        };
        workers.push(worker);
        return worker;
      },
    },
  } as unknown as EngineExecution);
  const config = { provider: "codex", model: null };
  const existing = await connections.install(1, config, context);
  expect(existing.command).toMatch(
    /runtime\/codex\/[^/]+\/node_modules\/\.bin\/codex$/,
  );
  expect(workers[0]?.spec).toBeUndefined();
  expect(await workers[0]?.closed).toEqual({ code: 0 });
  installed = false;
  const installing = connections.install(1, config, context);
  const worker = await started.promise;
  await expect(connections.install(2, config, context)).rejects.toThrow(
    "正在安装",
  );
  expect(worker.spec?.command).toBe("npm");
  expect(worker.spec?.args).toContain(
    existing.command.slice(0, existing.command.indexOf("/node_modules")),
  );
  worker.ended.resolve({ code: 1 });
  await expect(installing).rejects.toThrow("安装未完成");
  installed = true;
  await expect(connections.install(2, config, context)).resolves.toEqual(
    existing,
  );
});
