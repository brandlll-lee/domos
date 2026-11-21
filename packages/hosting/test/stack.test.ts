import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test, vi } from "vitest";
import type { Release, runCommand } from "../src/install.ts";
import { LocalStack } from "../src/stack.ts";
import { StackUpgrade } from "../src/stack-upgrade.ts";

const release: Release = {
  version: "test",
  serviceImage: `registry/service@sha256:${"a".repeat(64)}`,
  workImage: `registry/work@sha256:${"b".repeat(64)}`,
  controllerEntry: "controller",
  serverEntry: "server",
  bridgeEntry: "bridge",
  staticDir: "web",
};

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "domos-stack-"));
  onTestFinished(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
    await rm(`${directory}.upgrade`, { recursive: true, force: true });
  });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
  const run = vi.fn<typeof runCommand>(async (_command, args, options) => {
    options?.signal?.throwIfAborted();
    if (args[0] === "info") return '"linux"';
    if (args.includes("--quiet")) return "container-id";
    if (args.includes("--format")) return "sha256:installed";
    return "";
  });
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
  expect(spec.services.controller.user).toBe("0:0");
  expect(spec.services.controller.cap_drop).toEqual(["ALL"]);
  expect(spec.services.controller.cap_add).toEqual(["DAC_READ_SEARCH"]);
  expect(spec.services.app.cap_add).toBeUndefined();
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
  const configuration = join(directory, "domos.config.json");
  const saved = JSON.parse(await readFile(configuration, "utf8"));
  await writeFile(
    configuration,
    JSON.stringify({ ...saved, publicUrl: "https://domos.test" }),
  );
  const resumed = new LocalStack(directory, release, run, ready);
  expect(await resumed.start(() => {}, signal)).toEqual(first);
  const service = JSON.parse(
    await readFile(join(directory, "service.json"), "utf8"),
  );
  expect(service.publicUrl).toBe("https://domos.test");
  expect(service.desktopUrl).toBe(first.origin);
  expect(
    JSON.parse(await readFile(join(directory, "compose.json"), "utf8")).services
      .app.environment.DOMOS_PUBLIC_URL,
  ).toBeUndefined();
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

test("upgrades hold admission before backup and preserve bindings and data", async () => {
  const { stack, directory, run, ready } = await fixture();
  const signal = new AbortController().signal;
  await stack.start(() => {}, signal);
  await stack.stop();
  const config = await readFile(join(directory, "controller.json"), "utf8");
  await writeFile(join(directory, "data/record"), "saved");
  const next = {
    ...release,
    serviceImage: `registry/service@sha256:${"c".repeat(64)}`,
  };
  const upgraded = new LocalStack(directory, next, run, ready);
  const fetcher = vi.mocked(fetch);
  fetcher.mockClear();
  await upgraded.start(() => {}, signal);
  expect(
    fetcher.mock.calls.map(
      ([, options]) => JSON.parse(String(options?.body)).maintenance,
    ),
  ).toEqual([true, false]);
  expect(
    await readFile(join(`${directory}.upgrade`, "data/record"), "utf8"),
  ).toBe("saved");
  expect(await readFile(join(directory, "controller.json"), "utf8")).toBe(
    config,
  );
  expect(
    JSON.parse(await readFile(join(directory, "compose.json"), "utf8")).services
      .app.image,
  ).toBe(next.serviceImage);
  await upgraded.stop();
});

test("a failed new backend restores its snapshot and retains the failed data", async () => {
  const { stack, directory, run, ready } = await fixture();
  const signal = new AbortController().signal;
  await stack.start(() => {}, signal);
  await stack.stop();
  await writeFile(join(directory, "data/record"), "saved");
  ready.mockImplementationOnce(async () => {
    await writeFile(join(directory, "data/record"), "migrated");
    throw new Error("Migration failed");
  });
  const next = new LocalStack(
    directory,
    { ...release, serviceImage: `registry/service@sha256:${"c".repeat(64)}` },
    run,
    ready,
  );
  await expect(next.start(() => {}, signal)).rejects.toThrow(
    "Migration failed",
  );
  expect(await readFile(join(directory, "data/record"), "utf8")).toBe("saved");
  expect(
    await readFile(join(`${directory}.upgrade`, "failed-data/record"), "utf8"),
  ).toBe("migrated");
  expect(
    JSON.parse(await readFile(join(directory, "compose.json"), "utf8")).services
      .app.image,
  ).toBe(release.serviceImage);
});

test("busy work and download failures leave the running installation intact", async () => {
  const { stack, directory, run, ready } = await fixture();
  const signal = new AbortController().signal;
  await stack.start(() => {}, signal);
  const previous = await readFile(join(directory, "compose.json"), "utf8");
  run.mockClear();
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: "Bot 仍有任务" }, { status: 409 }),
  );
  const next = new LocalStack(
    directory,
    { ...release, serviceImage: `registry/service@sha256:${"c".repeat(64)}` },
    run,
    ready,
  );
  await expect(next.start(() => {}, signal)).rejects.toThrow("Bot 仍有任务");
  expect(run.mock.calls.some(([, args]) => args.includes("stop"))).toBe(false);
  expect(await readFile(join(directory, "compose.json"), "utf8")).toBe(
    previous,
  );
  run.mockRejectedValueOnce(new Error("Registry unavailable"));
  await expect(next.start(() => {}, signal)).rejects.toThrow();
  expect(await readFile(join(directory, "compose.json"), "utf8")).toBe(
    previous,
  );
});

test("an interrupted upgrade restores the old backend before allowing another attempt", async () => {
  const { stack, directory, run, ready } = await fixture();
  const signal = new AbortController().signal;
  await stack.start(() => {}, signal);
  await stack.stop();
  await writeFile(join(directory, "data/record"), "saved");
  const snapshot = new StackUpgrade(directory);
  await snapshot.save(true);
  await snapshot.phase("starting");
  await writeFile(join(directory, "data/record"), "partial migration");
  const reopened = new LocalStack(directory, release, run, ready);
  await expect(reopened.start(() => {}, signal)).rejects.toThrow(
    "已恢复原后台",
  );
  expect(await readFile(join(directory, "data/record"), "utf8")).toBe("saved");
  expect(
    await readFile(join(`${directory}.upgrade`, "failed-data/record"), "utf8"),
  ).toBe("partial migration");
  await reopened.start(() => {}, signal);
  await reopened.stop();
});

test("failed upgrades of a stopped backend restore data without requiring its maintenance endpoint", async () => {
  const { stack, directory, run, ready } = await fixture();
  const signal = new AbortController().signal;
  await stack.start(() => {}, signal);
  await stack.stop();
  await writeFile(join(directory, "data/record"), "saved");
  const execute: typeof runCommand = async (command, args, options) =>
    args.includes("--quiet") && args.includes("app") && !args.includes("up")
      ? ""
      : run(command, args, options);
  ready.mockRejectedValueOnce(new Error("Migration failed"));
  vi.mocked(fetch).mockClear();
  const next = new LocalStack(
    directory,
    { ...release, serviceImage: `registry/service@sha256:${"c".repeat(64)}` },
    execute,
    ready,
  );
  await expect(next.start(() => {}, signal)).rejects.toThrow(
    "Migration failed",
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(await readFile(join(directory, "data/record"), "utf8")).toBe("saved");
});
