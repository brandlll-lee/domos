import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test, vi } from "vitest";
import type { Release, runCommand } from "../src/install.ts";
import { LocalStack } from "../src/stack.ts";

const release: Release = {
  version: "test",
  serviceImage: "domos-service:test",
  workImage: "domos-work:test",
  controllerEntry: "controller",
  serverEntry: "server",
  bridgeEntry: "bridge",
  staticDir: "web",
};

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "domos-stack-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const run = vi.fn<typeof runCommand>(async (_command, args) =>
    args[0] === "info" ? '"linux"' : "",
  );
  const ready = vi.fn(async (_origin: string, signal: AbortSignal) => {
    signal.throwIfAborted();
  });
  return {
    directory,
    run,
    ready,
    stack: new LocalStack(directory, release, run, ready),
  };
}

test("container hosting starts only on selection and resumes its owned installation", async () => {
  const { directory, run, ready, stack } = await fixture();
  expect(run).not.toHaveBeenCalled();
  const signal = new AbortController().signal;
  const [first, repeated] = await Promise.all([
    stack.start(() => {}, signal),
    stack.start(() => {}, signal),
  ]);
  expect(first).toEqual(repeated);
  expect(ready).toHaveBeenCalledOnce();
  expect(stack.running).toBe(true);
  const spec = JSON.parse(
    await readFile(join(directory, "compose.json"), "utf8"),
  );
  expect(spec.services.app.ports).toEqual([
    `127.0.0.1:${new URL(first.origin).port}:4310`,
  ]);
  expect(spec.services.app.depends_on.controller.condition).toBe(
    "service_healthy",
  );
  expect(
    spec.services.app.volumes.some((item: { source: string }) =>
      item.source.includes("docker.sock"),
    ),
  ).toBe(false);
  expect(
    spec.services.controller.volumes.some(
      (item: { source: string }) => item.source === "/var/run/docker.sock",
    ),
  ).toBe(true);
  await stack.stop();
  expect(stack.running).toBe(false);
  const resumed = new LocalStack(directory, release, run, ready);
  expect(await resumed.start(() => {}, signal)).toEqual(first);
  expect(
    JSON.parse(await readFile(join(directory, "compose.json"), "utf8")).name,
  ).toBe(spec.name);
  await resumed.stop();
});

test("failed readiness stops the selected stack and can be retried", async () => {
  const { stack, run, ready } = await fixture();
  ready.mockRejectedValueOnce(new Error("Service interrupted"));
  await expect(
    stack.start(() => {}, new AbortController().signal),
  ).rejects.toThrow("Service interrupted");
  expect(stack.running).toBe(false);
  expect(run.mock.calls.some(([, args]) => args.includes("stop"))).toBe(true);
  await stack.start(() => {}, new AbortController().signal);
  await stack.stop();
  expect(run.mock.calls.flatMap(([, args]) => args)).not.toContain("down");
});

test("an aborted choice does not start a service or prepare a replacement", async () => {
  const { stack, run } = await fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(stack.start(() => {}, controller.signal)).rejects.toThrow();
  await stack.stop();
  expect(run).not.toHaveBeenCalled();
});
