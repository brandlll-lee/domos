import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { releaseSchema } from "@domos/hosting/install";
import { expect, test } from "@playwright/test";
import { JsonLines } from "../../../packages/agent/src/harness/json-lines.ts";
import { WorkProcess } from "../../../packages/agent/src/harness/process.ts";

test("desktop runtime starts its worker and discovers computer tools", async () => {
  const runtime = fileURLToPath(new URL("../runtime/", import.meta.url));
  const release = releaseSchema.parse(
    JSON.parse(await readFile(join(runtime, "release.json"), "utf8")),
  );
  if (!release.workBuild) throw new Error("Work build context required");
  const work = join(runtime, release.workBuild.context);
  const workBrowser = join(work, "packages/agent/src/harness");
  const { browserObserve, browserNativeTools } = await import(
    pathToFileURL(join(workBrowser, "browser-tools.mjs")).href
  );
  expect(browserObserve.name).toBe("agent_browser_observe");
  expect(browserNativeTools.has("agent_browser_batch")).toBe(true);
  for (const name of ["browser-command.mjs"])
    expect(await readFile(join(workBrowser, name), "utf8")).not.toBe("");
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
    const ready = await worker.ready;
    expect(ready).toMatchObject({
      cwd: await realpath(join(directory, "workspace")),
      home: await realpath(join(directory, "home")),
    });
    const browser = await worker.computer({
      operation: "catalog",
      service: "browser",
    });
    expect(browser).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "agent_browser_screenshot" }),
        expect.objectContaining({ name: "agent_browser_observe" }),
        expect.objectContaining({ name: "agent_browser_batch" }),
        expect.objectContaining({ name: "agent_browser_hover" }),
        expect.objectContaining({ name: "agent_browser_drag" }),
        expect.objectContaining({ name: "agent_browser_upload" }),
        expect.objectContaining({ name: "agent_browser_frame_switch" }),
        expect.objectContaining({ name: "agent_browser_wait_for_selector" }),
      ]),
    );
    expect(browser).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "agent_browser_install" }),
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
    const cli = fileURLToPath(
      new URL(
        "../../../packages/agent/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
        import.meta.url,
      ),
    );
    const rpc = new JsonLines(worker, true);
    await worker.launch({
      command: process.execPath,
      args: [
        cli,
        "--mode",
        "rpc",
        "--session-dir",
        join(directory, "sessions"),
      ],
      env: {
        PI_CODING_AGENT_DIR: join(directory, "pi"),
        DOMOS_PI_MCP_URL: ready.url,
      },
    });
    expect(await rpc.request("get_state")).toHaveProperty("sessionFile");
    await worker.toolsReady();
  } finally {
    await worker.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
});
