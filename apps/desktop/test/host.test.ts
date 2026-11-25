import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Release } from "@domos/hosting/install";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fork: vi.fn(),
  ready: vi.fn(),
  controller: false,
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  mocks.fork.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      pid: 123,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      postMessage: vi.fn((message: string) => {
        if (message === "shutdown") queueMicrotask(() => child.emit("exit", 0));
      }),
      kill: vi.fn(() => {
        queueMicrotask(() => child.emit("exit", 1));
        return true;
      }),
    });
    return child;
  });
  return { utilityProcess: { fork: mocks.fork } };
});
vi.mock("@domos/agent/config", () => ({
  parseConfig: () => ({
    host: "127.0.0.1",
    port: 9000,
    staticDir: "web",
    workComputer: {},
    computer: { kind: mocks.controller ? "controller" : "local" },
  }),
}));
vi.mock("@domos/hosting/install", () => ({
  prepareLocalInstallation: async () => ({
    config: {},
    configFile: "config.json",
  }),
  waitForService: mocks.ready,
  writeConfiguration: vi.fn(),
  workComputer: vi.fn(),
}));

import { diagnostics, errorTrace } from "../src/diagnostics.ts";
import { LocalHost, type ServiceState } from "../src/host.ts";

const roots: string[] = [];
const hosts: LocalHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  mocks.fork.mockClear();
  mocks.ready.mockReset();
  mocks.controller = false;
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "domos-host-"));
  roots.push(root);
  const states: ServiceState[] = [];
  const host = new LocalHost(
    root,
    {
      staticDir: "web",
      serverEntry: "server.mjs",
      controllerEntry: "controller.mjs",
      bridgeEntry: "bridge.mjs",
    } as Release,
    root,
    (state) => states.push(state),
  );
  hosts.push(host);
  return {
    root,
    states,
    host,
    start: () => host.start(() => {}, new AbortController().signal),
  };
}
const child = (index = mocks.fork.mock.results.length - 1) =>
  mocks.fork.mock.results[index]?.value;

test("service exit clears identity, recovers within budget and retains diagnostics", async () => {
  const { root, states, host, start } = await fixture();
  await start();
  child().stderr.write(
    "Private conversation with token=secret\nTypeError: token=secret\n    at readPublic (file:///app/preview.ts:234:21)\n",
  );
  child().emit("exit", 1);
  expect(host.running).toBe(false);
  expect(states.at(-1)).toBe("recovering");
  await vi.waitFor(() => expect(mocks.fork).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(host.running).toBe(true));
  child().emit("exit", 1);
  await vi.waitFor(() => expect(mocks.fork).toHaveBeenCalledTimes(3));
  await vi.waitFor(() => expect(host.running).toBe(true));
  child().emit("exit", 1);
  await vi.waitFor(() => expect(host.state).toBe("failed"));
  expect(mocks.fork).toHaveBeenCalledTimes(3);
  const log = await readFile(join(root, "diagnostics", "service.log"), "utf8");
  expect(log).toContain('"code":1');
  expect(log).toContain("preview.ts:234:21");
  expect(log).not.toContain("secret");
  expect(log).not.toContain("Private conversation");
  await start();
  expect(host.running).toBe(true);
});

test("early exit rejects readiness and pairing without waiting for their deadlines", async () => {
  mocks.ready.mockImplementation(
    (_origin, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        queueMicrotask(() => child().emit("exit", 1));
      }),
  );
  const { host, start } = await fixture();
  await expect(start()).rejects.toThrow("进程已退出");
  expect(host.state).toBe("failed");
  expect(mocks.fork).toHaveBeenCalledTimes(1);
  mocks.ready.mockResolvedValue(undefined);
  await start();
  const paired = host.pair({ installationId: crypto.randomUUID() });
  child().emit("exit", 1);
  await expect(paired).rejects.toThrow("本机后台请求未完成");
});

test("intentional stop cancels startup and does not recover remaining controller children", async () => {
  mocks.controller = true;
  const entered = Promise.withResolvers<void>();
  mocks.ready.mockImplementation(
    (_origin, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        entered.resolve();
      }),
  );
  const { host, start } = await fixture();
  const starting = start();
  const rejected = expect(starting).rejects.toThrow("已停止");
  await entered.promise;
  expect(host.running).toBe(false);
  await host.stop();
  await rejected;
  expect(host.state).toBe("stopped");
  expect(mocks.fork).toHaveBeenCalledTimes(2);
  await expect(
    host.pair({ installationId: crypto.randomUUID() }),
  ).rejects.toThrow("未启动");
});

test("stderr evidence contains error types and code locations only", () => {
  expect(errorTrace("Error: Authorization Bearer secret")).toBe("Error");
  expect(errorTrace("user said secret")).toBeUndefined();
  expect(errorTrace("    at read (file:///app/read.ts:10:3)")).toBe(
    "file:///app/read.ts:10:3",
  );
});

test("startup cancellation and simultaneous child exits settle once", async () => {
  const { host, start } = await fixture();
  const starting = start();
  const assertion = expect(starting).rejects.toThrow("已停止");
  await host.stop();
  await assertion;
  expect(mocks.fork).not.toHaveBeenCalled();
  mocks.controller = true;
  await start();
  const controller = child(0);
  const server = child(1);
  server.postMessage.mockImplementation(() =>
    queueMicrotask(() => {
      controller.emit("exit", 0);
      server.emit("exit", 0);
    }),
  );
  await host.stop();
  expect(host.state).toBe("stopped");
  expect(mocks.fork).toHaveBeenCalledTimes(2);
});

test("failed recoveries stop after two attempts and workspace changes disable recovery", async () => {
  const { host, start } = await fixture();
  await start();
  mocks.ready.mockRejectedValue(new Error("Data lease unavailable"));
  child().emit("exit", 1);
  await vi.waitFor(() => expect(host.state).toBe("failed"));
  expect(mocks.fork).toHaveBeenCalledTimes(3);
  mocks.ready.mockResolvedValue(undefined);
  await start();
  host.recoveryEnabled = false;
  child().emit("exit", 1);
  expect(host.state).toBe("stopped");
  expect(mocks.fork).toHaveBeenCalledTimes(4);
});

test("pairing failure settles the active request and keeps the service available", async () => {
  const { host, start } = await fixture();
  await start();
  const paired = host.pair({ installationId: crypto.randomUUID() });
  const request = child().postMessage.mock.lastCall?.[0];
  child().emit("message", {
    type: "desktop-response",
    id: request.id,
    error: "配对未完成",
  });
  await expect(paired).rejects.toThrow("配对未完成");
  expect(host.running).toBe(true);
});

test("diagnostic rotation retains two bounded files", async () => {
  const { root } = await fixture();
  const directory = join(root, "diagnostics");
  await mkdir(directory);
  const file = join(directory, "service.log");
  const record = diagnostics(root);
  for (let index = 0; index < 2; index++) {
    await writeFile(file, "x".repeat(1024 * 1024));
    record({ event: "exit", code: index });
    expect((await readFile(file)).byteLength).toBeLessThan(200);
    expect((await readFile(`${file}.1`)).byteLength).toBe(1024 * 1024);
  }
  expect((await readdir(directory)).sort()).toEqual([
    "service.log",
    "service.log.1",
  ]);
});
