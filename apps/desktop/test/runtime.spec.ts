import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseSchema } from "@domos/hosting/install";
import { expect, test } from "@playwright/test";
import { WorkProcess } from "../../../packages/agent/src/harness/process.ts";
import { piProvider } from "../../../packages/agent/src/harness/providers/pi.ts";

test("desktop runtime starts its worker and discovers computer tools", async () => {
  const runtime = fileURLToPath(new URL("../runtime/", import.meta.url));
  const release = releaseSchema.parse(
    JSON.parse(await readFile(join(runtime, "release.json"), "utf8")),
  );
  const directory = await mkdtemp(join(tmpdir(), "domos-runtime-"));
  const executable = createRequire(new URL("../package.json", import.meta.url))(
    "electron",
  ) as string;
  const worker = new WorkProcess(
    [executable, join(runtime, release.workerEntry ?? "worker.mjs")],
    { cwd: join(directory, "workspace"), home: join(directory, "home") },
    [],
    async () => ({ content: [] }),
  );
  try {
    await expect(worker.ready).resolves.toMatchObject({
      cwd: join(directory, "workspace"),
      home: join(directory, "home"),
    });
    const browser = await worker.computer({
      operation: "catalog",
      service: "browser",
    });
    expect(browser).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "agent_browser_screenshot" }),
      ]),
    );
    const desktop = await worker.computer({
      operation: "catalog",
      service: "desktop",
    });
    expect(desktop).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "get_desktop_state" }),
      ]),
    );
    const session = await piProvider.open({
      process: worker,
      config: { provider: "pi", model: null },
      sessionId: null,
      instructions: "Use short replies.",
      emit: async () => {},
    });
    expect(session.id.replaceAll("\\", "/")).toContain(
      `${directory.replaceAll("\\", "/")}/home/pi/sessions/`,
    );
  } finally {
    await worker.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
});
