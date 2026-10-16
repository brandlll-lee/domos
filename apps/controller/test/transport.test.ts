import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import {
  Connection,
  localDaemon,
  RemoteExecutionEnv,
} from "@earendil-works/pi-env";
import { expect, onTestFinished, test } from "vitest";
import { controlServer } from "../src/server.ts";

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
