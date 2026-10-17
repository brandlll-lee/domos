import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ComputerDriver } from "@domos/agent/computer/driver";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import {
  Connection,
  localDaemon,
  RemoteExecutionEnv,
} from "@earendil-works/pi-env";
import { expect, onTestFinished, test, vi } from "vitest";
import { controlServer } from "../src/server.ts";

test("computer lifecycles stay independent and controller readiness does not start Docker", async () => {
  const states = new Map<string, "running" | "stopped">();
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const driver = (id: string): ComputerDriver => ({
    config: { id, timeoutSeconds: 30, network: "none" },
    binding: {},
    directory: "/workspace",
    inspect: async () => states.get(id) ?? "stopped",
    checkNetwork: async () => {},
    start: async () => {
      if (id === "slow") await blocked;
      states.set(id, "running");
    },
    stop: async () => {
      states.set(id, "stopped");
    },
    rebuild: async () => {},
    daemon: () => [],
  });
  const create = vi.fn(driver);
  const token = crypto.randomUUID();
  const control = controlServer(driver("team"), token, create);
  control.server.listen(0, "127.0.0.1");
  await once(control.server, "listening");
  const address = control.server.address();
  if (!address || typeof address === "string") throw new Error("Port required");
  const origin = `http://127.0.0.1:${address.port}`;
  const request = (path: string, method = "GET") =>
    fetch(`${origin}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
    });
  onTestFinished(async () => {
    release();
    await control.close();
  });
  expect((await request("/health")).status).toBe(200);
  expect(states.size).toBe(0);
  expect(
    (await fetch(`${origin}/foreign/start`, { method: "POST" })).status,
  ).toBe(401);
  expect(create).not.toHaveBeenCalled();
  const slow = request("/slow/start", "POST");
  await vi.waitFor(() => expect(create).toHaveBeenCalledWith("slow"));
  expect((await request("/fast/start", "POST")).status).toBe(200);
  expect(states.get("fast")).toBe("running");
  release();
  expect((await slow).status).toBe(200);
  await request("/slow/stop", "POST");
  expect(states.get("fast")).toBe("running");
  expect((await request("/bad%20id/start", "POST")).status).toBe(404);
});

test("the authenticated controller preserves the Pi byte stream, binary files and disconnect semantics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-controller-"));
  const token = crypto.randomUUID();
  const tokenFile = join(directory, "token");
  await writeFile(tokenFile, token);
  let state: "running" | "stopped" = "stopped";
  const control = controlServer(
    {
      config: { id: "test", timeoutSeconds: 30, network: "none" },
      binding: {},
      directory,
      inspect: async () => state,
      checkNetwork: async () => {},
      start: async () => {
        state = "running";
      },
      stop: async () => {
        state = "stopped";
      },
      rebuild: async () => {},
      daemon: () => [localDaemon()],
    },
    token,
  );
  await control.start();
  control.server.listen(0, "127.0.0.1");
  await once(control.server, "listening");
  const address = control.server.address();
  if (!address || typeof address === "string") throw new Error("Port required");
  const origin = `http://127.0.0.1:${address.port}`;
  expect((await fetch(`${origin}/test/status`)).status).toBe(401);
  expect(
    (
      await fetch(`${origin}/test/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status,
  ).toBe(200);
  const options = {
    command: [
      process.execPath,
      fileURLToPath(
        new URL(
          "../../../packages/agent/src/computer/bridge.ts",
          import.meta.url,
        ),
      ),
      origin,
      "test",
      tokenFile,
    ],
  };
  const connection = new Connection(options);
  onTestFinished(async () => {
    connection.close();
    await control.close();
    await rm(directory, { recursive: true, force: true });
  });
  const remote = await connection.info();
  expect(remote.os).toBeTruthy();
  const env = new RemoteExecutionEnv({
    connection,
    id: "test",
    cwd: directory,
  });
  const data = crypto.getRandomValues(new Uint8Array(4096));
  const filename = join(directory, "binary.dat");
  getOrThrow(await env.writeFile(filename, data, BACKGROUND_CONTEXT));
  expect(
    getOrThrow(await env.readBinaryFile(filename, BACKGROUND_CONTEXT)),
  ).toEqual(Buffer.from(data));
  connection.close();
  const reopened = new Connection(options);
  try {
    expect((await reopened.info()).os).toBe(remote.os);
    const restored = new RemoteExecutionEnv({
      connection: reopened,
      id: "test",
      cwd: directory,
    });
    expect(
      getOrThrow(await restored.readBinaryFile(filename, BACKGROUND_CONTEXT)),
    ).toEqual(Buffer.from(data));
  } finally {
    reopened.close();
  }
});
