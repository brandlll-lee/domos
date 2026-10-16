import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("the Windows distribution contains its server dependencies and starts its packaged backend", async () => {
  const runtime = resolve(
    import.meta.dirname,
    "../release/win-unpacked/resources/runtime",
  );
  const entry = join(runtime, "server.mjs");
  for (const dependency of [
    "@earendil-works/pi-ai/models",
    "@earendil-works/pi-env",
    "@earendil-works/pi-durable",
    "@earendil-works/chord/context",
    "@hono/node-server",
    "@orpc/server/fetch",
    "hono",
    "zod",
  ]) {
    const manifest = findPackageJSON(dependency, pathToFileURL(entry));
    assert.ok(manifest);
    const path = relative(runtime, await realpath(manifest));
    assert.ok(
      !isAbsolute(path) && !path.startsWith(".."),
      `${dependency} must be inside the distribution`,
    );
  }
  const directory = await mkdtemp(join(tmpdir(), "domos-package-"));
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolve) => listener.close(resolve));
  const filename = join(directory, "config.json");
  await writeFile(
    filename,
    JSON.stringify({
      port: address.port,
      dataDir: join(directory, "data"),
      staticDir: join(runtime, "web"),
    }),
  );
  const worker = fork(entry, [], {
    cwd: directory,
    env: { ...process.env, DOMOS_CONFIG: filename },
    execArgv: [],
    silent: true,
  });
  const exited = once(worker, "exit");
  worker.stdout.resume();
  worker.stderr.resume();
  try {
    const signal = AbortSignal.timeout(15_000);
    while (true) {
      signal.throwIfAborted();
      try {
        const response = await fetch(
          `http://127.0.0.1:${address.port}/hosting/info`,
          { signal },
        );
        assert.equal((await response.json()).product, "domos");
        break;
      } catch {
        assert.equal(
          worker.exitCode,
          null,
          "Packaged backend exited during startup",
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(await readFile(join(directory, "data/owner-code"), "utf8"));
  } finally {
    if (worker.exitCode === null) worker.send("shutdown");
    const timer = setTimeout(() => worker.kill(), 5000);
    await exited;
    clearTimeout(timer);
    await rm(directory, { recursive: true, force: true });
  }
});
