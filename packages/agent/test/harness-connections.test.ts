import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { expect, test } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import { EngineConnections } from "../src/harness/connections.ts";
import { EngineExecution } from "../src/harness/execution.ts";
import type { ProcessSpec } from "../src/harness/types.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

function fixture(installed: boolean, exitCode = 0) {
  const launches: ProcessSpec[] = [];
  const requests: string[] = [];
  let computerId = "work-computer";
  const computers = {
    computerId: async () => computerId,
    process: async () => {
      const worker = new ProtocolProcess();
      worker.launch = async (spec) => {
        launches.push(spec);
        if (spec.args.includes("--version")) {
          if (!installed)
            throw Object.assign(new Error("Program missing"), {
              code: "ENOENT",
            });
          worker.output.write("codex-cli 0.159.2\n");
          worker.ended.resolve({ code: exitCode });
        }
      };
      worker.receive = (request) => {
        requests.push(String(request.method));
        worker.response(
          request,
          request.method === "account/read"
            ? { account: { type: "apiKey" } }
            : request.method === "model/list"
              ? { data: [{ id: "fixture-model", displayName: "Fixture" }] }
              : { thread: { id: "domos-check" }, data: [] },
        );
      };
      return worker;
    },
    tools: { catalog: async () => [], finish: () => {} },
  } as unknown as Computers;
  return {
    launches,
    requests,
    move: (id = "another-computer") => {
      computerId = id;
    },
    connections: new EngineConnections(
      new EngineExecution(computers, new InMemoryCredentialStore()),
    ),
  };
}

test("a missing program offers installation without opening an agent session", async () => {
  const { connections, launches } = fixture(false);
  await expect(
    connections.inspect(1, { provider: "codex", model: null }, context),
  ).resolves.toMatchObject({ ready: false, authenticated: false });
  expect(launches.map((spec) => spec.args)).toEqual([["--version"]]);
});

test("catalog reads reuse discovery, merge concurrent requests and follow the work computer", async () => {
  const { connections, launches, requests, move } = fixture(true);
  const config = { provider: "codex" as const, model: null };
  expect(
    (await connections.catalog(1, context)).every(
      (item) => !item.models.length,
    ),
  ).toBe(true);
  expect(launches).toHaveLength(0);
  const results = await Promise.all([
    connections.inspect(1, config, context),
    connections.inspect(1, config, context),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(launches).toHaveLength(2);
  expect(requests).not.toContain("thread/start");
  await connections.inspect(1, config, context);
  expect(launches).toHaveLength(2);
  await connections.inspect(1, config, context, true);
  expect(launches).toHaveLength(4);
  move();
  await connections.inspect(1, config, context);
  expect(launches).toHaveLength(6);
});

test("account installation invalidates catalogs on the same work computer", async () => {
  const { connections, launches } = fixture(true);
  const config = { provider: "codex" as const, model: null };
  await connections.inspect(1, config, context);
  await connections.inspect(2, config, context);
  await connections.install(1, config, context);
  const count = launches.length;
  await connections.inspect(2, config, context);
  expect(launches.length).toBeGreaterThan(count);
});

test("service account changes invalidate catalogs on other work computers", async () => {
  const { connections, launches, move } = fixture(true);
  const config = { provider: "codex" as const, model: null };
  await connections.inspect(1, config, context);
  move();
  await connections.inspect(2, config, context);
  await connections.key(2, config, "fixture-account", context);
  const count = launches.length;
  move("work-computer");
  await connections.catalog(1, context);
  expect(launches).toHaveLength(count);
  await connections.inspect(1, config, context);
  expect(launches).toHaveLength(count + 2);
});

test("an installed engine checks its account and keeps its own configuration", async () => {
  const { connections, launches } = fixture(true);
  await expect(
    connections.inspect(1, { provider: "codex", model: null }, context),
  ).resolves.toMatchObject({
    ready: true,
    authenticated: true,
    version: "0.159.2",
  });
  expect(launches[1]).toMatchObject({
    command: "codex",
    env: { CODEX_HOME: "/work/accounts/codex" },
  });
});

test("installation reuses a program already present on the work computer", async () => {
  const { connections, launches } = fixture(true);
  await connections.install(1, { provider: "codex", model: null }, context);
  expect(launches.map((spec) => spec.command)).toEqual(["codex"]);
  expect(launches[0]?.args).toEqual(["--version"]);
});

test("native discovery uses the work computer account and keeps managed accounts separate", async () => {
  const { connections, launches } = fixture(true);
  const managed = { provider: "codex" as const, model: null };
  const native = { ...managed, accountSource: "native" as const };
  await connections.inspect(1, managed, context);
  expect(
    (await connections.catalog(1, context, native)).find(
      (item) => item.id === "codex",
    )?.models,
  ).toEqual([]);
  await connections.inspect(1, native, context);
  expect(launches).toHaveLength(4);
  expect(launches[2]).toMatchObject({ accountSource: "native" });
  expect(launches[3]).toMatchObject({ accountSource: "native" });
  expect(launches[3]?.env).not.toHaveProperty("CODEX_HOME");
  await expect(
    connections.key(1, native, "fixture-key", context),
  ).rejects.toThrow("原生账号");
  await expect(connections.login(1, native, context)).rejects.toThrow(
    "原生账号",
  );
});

test("a failed program check does not offer or attempt installation", async () => {
  const { connections, launches } = fixture(true, 1);
  await expect(
    connections.inspect(1, { provider: "codex", model: null }, context),
  ).rejects.toThrow("引擎未能启动");
  await expect(
    connections.install(1, { provider: "codex", model: null }, context),
  ).rejects.toThrow("引擎未能启动");
  expect(launches.every((spec) => spec.command === "codex")).toBe(true);
});
