import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("desktop startup waits for the test connection before exposing readiness", {
  timeout: 30_000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-startup-check-"));
  const observer = join(directory, "observer.cjs");
  await writeFile(
    observer,
    `
const { app } = require('electron');
app.whenReady().then(() => {
  setImmediate(() => process.send({ phase: 'native-ready', ready: app.isReady() }));
});
process.on('message', async (message) => {
  if (message === 'start') {
    await globalThis.__playwright_run();
    process.send({ phase: 'connected', ready: app.isReady() });
  }
  if (message === 'close') app.exit(0);
});
`,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = createRequire(
    new URL("../apps/desktop/package.json", import.meta.url),
  )("electron");
  const child = spawn(
    executable,
    [
      "-r",
      observer,
      "--inspect=0",
      "--remote-debugging-port=0",
      fileURLToPath(new URL("../apps/desktop/test/entry.mjs", import.meta.url)),
      `--test-data-dir=${directory}`,
    ],
    { env, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true },
  );
  child.stdout.resume();
  child.stderr.resume();
  const exited = once(child, "exit");
  const next = () =>
    Promise.race([
      once(child, "message", { signal: AbortSignal.timeout(10_000) }).then(
        ([message]) => message,
      ),
      exited.then(([code, signal]) => {
        throw new Error(`Electron exited before readiness: ${signal ?? code}`);
      }),
    ]);
  try {
    assert.deepEqual(await next(), { phase: "native-ready", ready: false });
    const connected = next();
    child.send("start");
    assert.deepEqual(await connected, { phase: "connected", ready: true });
  } finally {
    if (child.connected) child.send("close");
    else child.kill();
    await exited;
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});
