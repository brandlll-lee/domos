import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { acquireDataLease } from "../../../packages/agent/src/runtime/lease.ts";

test("the API starts outside the project, releases a failed bind, and closes its data lease", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-startup-"));
  const blocker = createServer();
  blocker.listen(0, "127.0.0.1");
  await once(blocker, "listening");
  const address = blocker.address();
  if (!address || typeof address === "string") throw new Error("Port required");
  const filename = join(directory, "config.json");
  const dataDir = join(directory, "state");
  await writeFile(
    filename,
    JSON.stringify({
      model: { provider: "deepseek", modelId: "deepseek-flash" },
      port: address.port,
      dataDir,
    }),
  );
  const start = () =>
    fork(fileURLToPath(new URL("../src/main.ts", import.meta.url)), [], {
      cwd: directory,
      env: {
        ...process.env,
        DOMOS_CONFIG: filename,
        DOMOS_DATA_DIR: dataDir,
        DOMOS_PORT: String(address.port),
        DOMOS_HOST: "127.0.0.1",
        DOMOS_DEPLOYMENT: "native",
      },
      silent: true,
      execArgv: [],
    });
  let worker = start();
  let exited = once(worker, "exit");
  worker.stderr?.resume();
  worker.stdout?.resume();
  try {
    expect((await exited)[0]).toBe(1);
    await (await acquireDataLease(dataDir))();
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    worker = start();
    exited = once(worker, "exit");
    worker.stderr?.resume();
    const output = worker.stdout;
    if (!output) throw new Error("API output pipe required");
    await Promise.race([
      once(output, "data"),
      exited.then(() => {
        throw new Error("API exited before listening");
      }),
    ]);
    expect(
      (await fetch(`http://127.0.0.1:${address.port}/health`)).status,
    ).toBe(200);
    await expect(acquireDataLease(dataDir)).rejects.toThrow("运行实例");
    worker.kill("SIGTERM");
    const [exitCode] = await exited;
    if (process.platform !== "win32") expect(exitCode).toBe(0);
    await (await acquireDataLease(dataDir))();
  } finally {
    blocker.close();
    if (worker.exitCode === null && worker.signalCode === null) {
      worker.kill("SIGKILL");
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
