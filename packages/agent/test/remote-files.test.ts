import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import {
  Connection,
  localDaemon,
  nodePlatform,
  RemoteExecutionEnv,
} from "@earendil-works/pi-env";
import { expect, onTestFinished, test } from "vitest";
import { Files } from "../src/files.ts";

const context = BACKGROUND_CONTEXT;

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "domos-daemon-"));
  const connection = new Connection({ command: [localDaemon()] });
  onTestFinished(async () => {
    connection.close();
    await rm(directory, { recursive: true, force: true });
  });
  const cwd = join(directory, "computer");
  const env = new RemoteExecutionEnv({
    connection,
    id: `test:${directory}`,
    cwd,
  });
  getOrThrow(await env.createDir(cwd, { recursive: true }, context));
  const workspace = Object.assign(env, {
    path: async (path: string) =>
      getOrThrow(await env.absolutePath(path, context)),
  });
  return {
    directory,
    connection,
    env,
    files: new Files(
      join(directory, "service", "agent.sqlite"),
      async () => workspace,
    ),
  };
}

test("the official daemon handles upload, command output, artifact snapshots and reconnects in one file namespace", async () => {
  const { connection, env, files } = await setup();
  expect(nodePlatform(await connection.info()).platform).toBe(process.platform);
  const uploaded = await files.upload(
    1,
    "销量.csv",
    new TextEncoder().encode("value\n3\n5\n"),
  );
  expect(
    await files.upload(
      1,
      "销量.csv",
      new TextEncoder().encode("value\n3\n5\n"),
    ),
  ).toEqual(uploaded);
  getOrThrow(
    await env.exec(
      [
        process.execPath,
        "-e",
        "const fs=require('fs');const values=fs.readFileSync(process.argv[1],'utf8').trim().split('\\n').slice(1).map(Number);fs.writeFileSync('report.txt',String(values.reduce((a,b)=>a+b,0)));process.stdout.write('done')",
        uploaded.path,
      ],
      { timeout: 5 },
      context,
    ),
  );
  const published = await files.publish(1, "report.txt", context);
  expect(await (await files.download(1, published.id)).text()).toBe("8");
  connection.close();
  expect(await (await files.download(1, published.id)).text()).toBe("8");
  const reopened = new Connection({ command: [localDaemon()] });
  try {
    const restored = new RemoteExecutionEnv({
      connection: reopened,
      id: env.id,
      cwd: env.cwd,
    });
    expect(getOrThrow(await restored.readTextFile("report.txt", context))).toBe(
      "8",
    );
  } finally {
    reopened.close();
  }
});

test("daemon timeout and cancellation end one command and preserve other connections", async () => {
  const { env } = await setup();
  const other = await setup();
  const pending = other.env.exec(
    [
      process.execPath,
      "-e",
      "setTimeout(()=>process.stdout.write('complete'),350)",
    ],
    { timeout: 5 },
    context,
  );
  const timeout = await env.exec(
    [process.execPath, "-e", "setTimeout(()=>{},5000)"],
    { timeout: 0.05 },
    context,
  );
  expect(timeout).toMatchObject({ ok: false, error: { code: "timeout" } });
  const controller = new AbortController();
  const started = Promise.withResolvers<void>();
  const command = env.exec(
    [
      process.execPath,
      "-e",
      "process.stdout.write('ready');setTimeout(()=>{},5000)",
    ],
    { onOutput: () => started.resolve() },
    withAbortSignal(controller.signal, context),
  );
  await started.promise;
  controller.abort();
  expect(await command).toMatchObject({
    ok: false,
    error: { code: "aborted" },
  });
  expect(getOrThrow(await pending).exitCode).toBe(0);
});

test("a failed target never creates a successful attachment snapshot", async () => {
  const { directory } = await setup();
  const files = new Files(join(directory, "failed.sqlite"), async () => {
    throw new Error("Target disconnected");
  });
  await expect(
    files.upload(1, "input.txt", new TextEncoder().encode("test")),
  ).rejects.toThrow("Target disconnected");
});
