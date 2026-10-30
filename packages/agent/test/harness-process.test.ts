import { execFileSync } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, onTestFinished, test, vi } from "vitest";
import { openGateway } from "../src/harness/gateway.mjs";
import { JsonLines } from "../src/harness/json-lines.ts";
import piTools from "../src/harness/pi-tools.mjs";
import { WorkProcess } from "../src/harness/process.ts";
import { callProductTool } from "../src/harness/product-tools.ts";
import type { EngineRuntime } from "../src/harness/task-types.ts";
import type { ProductResult } from "../src/harness/types.ts";

const piCli = join(
  dirname(
    fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
  ),
  "bundle/cli.js",
);

test("CUA text copies retain addresses and images without repeating observation payloads", async () => {
  const tree = "[97] button Play\n".repeat(1200);
  const state = {
    pid: 7,
    window_id: 90,
    snapshot_id: "s1",
    tree,
    elements: [{ element_index: 97, element_token: "s1:97" }],
    coordinates: { x: 37, y: 91 },
    verified: false,
  };
  const raw = {
    content: [
      { type: "text" as const, text: tree },
      { type: "image" as const, mimeType: "image/png", data: "aW1hZ2U=" },
    ],
    structuredContent: { observation: { ok: true, state } },
  };
  const gateway = await openGateway(
    [
      {
        name: "desktop_probe",
        description: "Observe",
        inputSchema: { type: "object" },
      },
    ],
    async () => raw,
  );
  const client = new Client({ name: "compact", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await gateway.close();
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url)));
  const result = (await client.callTool({
    name: "desktop_probe",
  })) as ProductResult;
  expect(result.structuredContent).toEqual(raw.structuredContent);
  expect(result.content.slice(0, 2)).toEqual(raw.content);
  const copy = JSON.parse((result.content.at(-1) as { text: string }).text);
  expect(copy.observation.state).toMatchObject({
    pid: 7,
    window_id: 90,
    snapshot_id: "s1",
    coordinates: { x: 37, y: 91 },
    verified: false,
  });
  expect(JSON.stringify(copy).length).toBeLessThan(600);
  expect(copy.observation.state.elements).toBeUndefined();
});

async function worker(environment?: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), "domos-engine-"));
  const calls: string[] = [];
  const process = new WorkProcess(
    [
      globalThis.process.execPath,
      ...(environment
        ? [
            "--import",
            `data:text/javascript,${encodeURIComponent(`Object.assign(process.env, ${JSON.stringify(environment)})`)}`,
          ]
        : []),
      fileURLToPath(new URL("../src/harness/worker.mjs", import.meta.url)),
    ],
    { cwd: join(directory, "bot"), home: join(directory, "accounts") },
    [
      {
        name: "echo",
        description: "Echo text",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
        },
      },
    ],
    async (_id, _name, args) => {
      calls.push(String(args.text));
      return {
        content: [{ type: "text", text: String(args.text) }],
        structuredContent: { text: String(args.text) },
      };
    },
  );
  onTestFinished(async () => {
    await process.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  });
  return { process, directory, calls };
}

test("workspace MCP routes tools through the authenticated process channel", async () => {
  const { process, calls } = await worker();
  const ready = await process.ready;
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(ready.url)));
  try {
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "echo",
    ]);
    await expect(process.toolsReady()).resolves.toBeNull();
    expect(
      (await client.callTool({ name: "echo", arguments: { text: "你好" } }))
        .content,
    ).toEqual([
      { type: "text", text: "你好" },
      { type: "text", text: '{"text":"你好"}' },
    ]);
    expect(calls).toEqual(["你好"]);
    expect(
      (
        await fetch(ready.url.replace(/\/mcp\/.*/, "/mcp/other"), {
          method: "POST",
        })
      ).status,
    ).toBe(404);
  } finally {
    await client.close();
  }
});

test("a missing work computer command reports a missing program", async () => {
  const { process } = await worker();
  await process
    .launch({ command: `domos-test-${crypto.randomUUID()}`, args: [] })
    .catch(() => {});
  await expect(process.closed).resolves.toMatchObject({
    code: 1,
    error: "ENOENT",
  });
});

test("Pi registers the product server with its native MCP lifecycle", async () => {
  const manifest = join(
    await mkdtemp(join(tmpdir(), "domos-pi-tools-")),
    "tools.json",
  );
  onTestFinished(() => rm(dirname(manifest), { recursive: true, force: true }));
  await writeFile(manifest, JSON.stringify({ url: "http://127.0.0.1/mcp" }));
  const previous = globalThis.process.env.DOMOS_PI_TOOLS;
  globalThis.process.env.DOMOS_PI_TOOLS = manifest;
  const registerMcpServer = vi.fn();
  try {
    piTools({ registerMcpServer, on: vi.fn() } as unknown as Parameters<
      typeof piTools
    >[0]);
    expect(registerMcpServer).toHaveBeenCalledWith("domos", {
      url: "http://127.0.0.1/mcp",
      exposure: "direct",
      timeout: 600,
    });
  } finally {
    if (previous === undefined) delete globalThis.process.env.DOMOS_PI_TOOLS;
    else globalThis.process.env.DOMOS_PI_TOOLS = previous;
  }
});

test("Pi declares product tools directly and discovers configured MCP tools", async () => {
  const { process, directory } = await worker();
  const ready = await process.ready;
  const account = join(directory, "pi");
  await mkdir(account);
  await writeFile(
    join(account, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        code: { url: ready.url, exposure: "codemode" },
        search: { url: ready.url, exposure: "deferred" },
      },
    }),
  );
  const probe = join(directory, "loadout.mjs");
  await writeFile(
    probe,
    `export default (pi) => pi.registerCommand("loadout", {
      handler: (_args, ctx) => ctx.ui.notify(JSON.stringify({
        active: pi.getActiveTools(),
        tools: pi.getAllTools().map(tool => tool.name)
      }), "info")
    });`,
  );
  const warnings: string[] = [];
  let loadout: { active: string[]; tools: string[] } | undefined;
  const rpc = new JsonLines(process, true);
  rpc.on("frame", (frame) => {
    if (frame.type === "extension_ui_request" && frame.method === "notify") {
      warnings.push(frame.message);
      if (frame.message.startsWith('{"active":'))
        loadout = JSON.parse(frame.message);
    }
  });
  await process.launch({
    command: globalThis.process.execPath,
    args: [
      piCli,
      "--mode",
      "rpc",
      "--session-dir",
      join(directory, "sessions"),
      "--extension",
      probe,
    ],
    env: { PI_CODING_AGENT_DIR: account, DOMOS_PI_MCP_URL: ready.url },
  });
  const state = await rpc.request<{ sessionFile: string }>("get_state");
  expect(state.sessionFile).toBeTruthy();
  await process.toolsReady();
  await vi.waitFor(async () => {
    await rpc.request("prompt", { message: "/loadout" });
    expect(loadout?.active).toContain("mcp__domos__echo");
    expect(loadout?.active).toContain("tool_search");
    expect(loadout?.tools).toContain("mcp__code__echo");
    expect(loadout?.tools).toContain("mcp__search__echo");
  });
  expect(loadout?.tools).not.toContain("codemode");
  expect(
    warnings.filter((message) => message.includes("neither is active")),
  ).toEqual([]);
});

test.each(["timeout", "stop"])(
  "Pi settles a stalled MCP connection (%s)",
  async (mode) => {
    const { process, directory } = await worker();
    const entered = Promise.withResolvers<void>();
    const server = createServer((request) => {
      request.resume();
      entered.resolve();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    onTestFinished(() => {
      server.closeAllConnections();
      server.close();
    });
    const address = server.address() as { port: number };
    const account = join(directory, "pi");
    await mkdir(account);
    await writeFile(
      join(account, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          stalled: {
            url: `http://127.0.0.1:${address.port}/mcp`,
            exposure: "direct",
            timeout: mode === "timeout" ? 1 : 60,
          },
        },
      }),
    );
    const rpc = new JsonLines(process, true);
    const notice = Promise.withResolvers<string>();
    rpc.on("frame", (frame) => {
      if (
        frame.type === "extension_ui_request" &&
        frame.message?.includes("stalled: failed")
      )
        notice.resolve(frame.message);
    });
    await process.launch({
      command: globalThis.process.execPath,
      args: [
        piCli,
        "--mode",
        "rpc",
        "--session-dir",
        join(directory, "sessions"),
      ],
      env: {
        PI_CODING_AGENT_DIR: account,
        DOMOS_PI_MCP_URL: (await process.ready).url,
      },
    });
    await rpc.request("get_state");
    await entered.promise;
    if (mode === "timeout")
      expect(await notice.promise).toMatch(/timed out|timeout/i);
    else {
      const started = performance.now();
      await process.terminate();
      await process.closed;
      expect(performance.now() - started).toBeLessThan(2000);
    }
  },
);

test("program resolution and execution use the same absolute native entry", async () => {
  const { process, directory } = await worker();
  const executable = join(
    directory,
    "工具 with spaces" +
      (globalThis.process.platform === "win32" ? ".cmd" : ""),
  );
  await writeFile(
    executable,
    globalThis.process.platform === "win32"
      ? "@echo DOMOS_PROGRAM_OK\r\n"
      : "#!/bin/sh\necho DOMOS_PROGRAM_OK\n",
  );
  await chmod(executable, 0o700);
  expect(await process.resolve(executable)).toBe(executable);
  if (globalThis.process.platform === "win32")
    expect(await process.resolve(executable.slice(0, -4))).toBe(executable);
  else {
    const link = join(directory, "linked-cli");
    await symlink(executable, link);
    expect(await process.resolve(link)).toBe(link);
  }
  let output = "";
  process.output.on("data", (data) => {
    output += data;
  });
  await process.launch({ command: executable, args: [] });
  expect((await process.closed).code).toBe(0);
  expect(output).toContain("DOMOS_PROGRAM_OK");
});

test.runIf(globalThis.process.platform !== "win32")(
  "a file without execution permission is an access error",
  async () => {
    const { process, directory } = await worker();
    const path = join(directory, "restricted");
    await writeFile(path, "#!/bin/sh\n", { mode: 0o600 });
    await expect(process.resolve(path)).rejects.toThrow("EACCES");
    expect(await process.resolve(join(directory, "absent"))).toBeNull();
  },
);

test("a work computer discovers desktop tools from its own runtime", async () => {
  const { process } = await worker();
  const tools = await process.computer({
    operation: "catalog",
    service: "desktop",
  });
  expect(tools).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "get_desktop_state",
        inputSchema: {
          type: "object",
          properties: expect.any(Object),
          additionalProperties: false,
        },
      }),
    ]),
  );
});

test.runIf(globalThis.process.platform === "win32")(
  "desktop launches an Electron application in its GUI runtime",
  async () => {
    const { process, directory } = await worker();
    const entry = join(directory, "application.cjs");
    const ready = join(directory, "application-ready.txt");
    await writeFile(
      entry,
      `const { app } = require("electron");
app.whenReady().then(() => {
  require("node:fs").writeFileSync(${JSON.stringify(ready)}, "ready");
  app.quit();
});`,
    );
    const electron = createRequire(
      new URL("../../../apps/desktop/package.json", import.meta.url),
    )("electron") as string;
    const elevated =
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
        ],
        { encoding: "utf8", windowsHide: true },
      ).trim() === "True";
    const launched = await process.computer<ProductResult>({
      operation: "call",
      service: "desktop",
      name: "launch_app",
      arguments: {
        path: electron,
        additional_arguments: [entry],
        start_minimized: elevated,
      },
    });
    expect(launched.isError, JSON.stringify(launched.content)).not.toBe(true);
    await expect
      .poll(() => readFile(ready, "utf8").catch(() => ""), { timeout: 20000 })
      .toBe("ready");
  },
  60000,
);

test("a work computer discovers browser tools from its own runtime", async () => {
  const { process } = await worker();
  const tools = await process.computer({
    operation: "catalog",
    service: "browser",
  });
  expect(tools.some((tool) => tool.name === "agent_browser_screenshot")).toBe(
    true,
  );
});

test.runIf(globalThis.process.platform === "win32")(
  "a prepared desktop returns an actual screenshot as an MCP image",
  async () => {
    const { process } = await worker();
    expect(
      await process.computer({ operation: "prepare", service: "desktop" }),
    ).toEqual({ available: true, error: null });
    const result = await process.computer<ProductResult>({
      operation: "call",
      service: "desktop",
      name: "get_desktop_state",
      arguments: { max_image_dimension: 320 },
    });
    expect(result.isError).toBe(false);
    const image = result.content.find((part) => part.type === "image");
    expect(
      image?.type === "image" &&
        Buffer.from(image.data, "base64").subarray(0, 8).toString("hex"),
    ).toBe("89504e470d0a1a0a");
  },
);

test("a browser preparation opens a real page and returns an MCP screenshot", async () => {
  const { process } = await worker();
  expect(
    await process.computer({ operation: "install", service: "browser" }),
  ).toEqual({ available: true, error: null });
  expect(
    await process.computer({ operation: "prepare", service: "browser" }),
  ).toMatchObject({ available: true, error: null });
  const result = await process.computer<ProductResult>({
    operation: "call",
    service: "browser",
    name: "agent_browser_screenshot",
    arguments: {},
  });
  expect(result.isError).not.toBe(true);
  expect(
    result.content.some(
      (part) => part.type === "image" && part.mimeType === "image/png",
    ),
  ).toBe(true);
}, 180_000);

test("a work computer forwards MCP cancellation to its active product call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-cancel-"));
  const entered = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const process = new WorkProcess(
    [
      globalThis.process.execPath,
      fileURLToPath(new URL("../src/harness/worker.mjs", import.meta.url)),
    ],
    { cwd: directory, home: join(directory, "accounts") },
    [{ name: "wait", description: "Wait", inputSchema: { type: "object" } }],
    async (_id, _name, _args, signal) => {
      entered.resolve();
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            cancelled.resolve();
            resolve();
          },
          { once: true },
        ),
      );
      return { content: [{ type: "text", text: "Stopped" }] };
    },
  );
  const client = new Client({ name: "test", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await process.close();
    await rm(directory, { recursive: true, force: true });
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL((await process.ready).url)),
  );
  const controller = new AbortController();
  const call = expect(
    client.callTool({ name: "wait" }, undefined, { signal: controller.signal }),
  ).rejects.toThrow();
  await entered.promise;
  controller.abort();
  await call;
  await cancelled.promise;
  expect((await client.listTools()).tools[0]?.name).toBe("wait");
});

test("stopping a desktop observation settles before its worker returns", async () => {
  const process = new WorkProcess(
    [
      globalThis.process.execPath,
      "--input-type=module",
      "-e",
      `
      import { createInterface } from "node:readline";
      const send = (frame) => console.log(JSON.stringify(frame));
      createInterface({ input: process.stdin }).on("line", (line) => {
        const frame = JSON.parse(line);
        if (frame.type === "configure") send({ type: "ready" });
        if (frame.type === "computer") send({ type: "stdout", data: "entered" });
        if (frame.type === "close") process.exit();
      });`,
    ],
    { cwd: tmpdir(), home: tmpdir() },
    [],
    async () => ({ content: [] }),
  );
  onTestFinished(() => process.close());
  await process.ready;
  const entered = once(process.output, "data");
  const controller = new AbortController();
  const result = expect(
    process.computer(
      {
        operation: "call",
        service: "desktop",
        name: "get_window_state",
        arguments: {},
      },
      controller.signal,
    ),
  ).rejects.toThrow("Stopped");
  await entered;
  controller.abort(new Error("Stopped"));
  await result;
});

test("MCP abandonment cancels an admitted Durable product task", async () => {
  const admitted = Promise.withResolvers<void>();
  const settled = Promise.withResolvers<void>();
  const nested: { taskId?: number } = {};
  const abortOwned = vi.fn(async () => settled.resolve());
  const runtime = {
    taskId: 1,
    conversationId: 1,
    agent: async () => ({ callable: [{ name: "wait" }] }),
    registry: {
      tools: () => [
        {
          extension: { name: "domos-memory" },
          tool: {
            name: "wait",
            description: "Wait",
            parameters: { type: "object" },
          },
        },
      ],
    },
    snapshot: async () => ({ result: { details: { content: [] } } }),
    commit: async (change: (tx: object) => Promise<void>) =>
      change({
        doc: async () => nested,
        createTask: async () => {
          admitted.resolve();
          return 7;
        },
      }),
    waitForTask: () => settled.promise,
    abortOwned,
  } as unknown as EngineRuntime;
  const gateway = await openGateway(
    [{ name: "wait", description: "Wait", inputSchema: { type: "object" } }],
    (id, name, args, signal) =>
      callProductTool(runtime, id, name, args, BACKGROUND_CONTEXT, signal),
  );
  const client = new Client({ name: "test", version: "1" });
  onTestFinished(async () => {
    settled.resolve();
    await client.close();
    await gateway.close();
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url)));
  const controller = new AbortController();
  const result = expect(
    client.callTool({ name: "wait" }, undefined, { signal: controller.signal }),
  ).rejects.toThrow();
  await admitted.promise;
  controller.abort();
  await result;
  await expect
    .poll(() => abortOwned.mock.calls.length, { timeout: 250 })
    .toBe(1);
  expect(abortOwned).toHaveBeenCalledWith(7, BACKGROUND_CONTEXT);
});

test("Stop terminates the native process tree while its protocol is silent", async () => {
  const { process: workerProcess } = await worker();
  const entered = once(workerProcess.output, "data");
  await workerProcess.launch({
    command: globalThis.process.execPath,
    args: [
      "--input-type=module",
      "-e",
      `
      import { spawn } from "node:child_process";
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "ignore" });
      child.once("spawn", () => console.log(JSON.stringify([process.pid, child.pid])));
      setInterval(() => {}, 1000);
    `,
    ],
  });
  const [data] = await entered;
  const pids: number[] = JSON.parse(String(data));
  const exists = (pid: number) => {
    try {
      globalThis.process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  expect(pids.every(exists)).toBe(true);
  const started = performance.now();
  await workerProcess.terminate();
  await expect.poll(() => pids.some(exists), { timeout: 2000 }).toBe(false);
  await workerProcess.closed;
  expect(performance.now() - started).toBeLessThan(2000);
});

test("computer deadlines cancel observation and preserve an in-flight action", async () => {
  const workerProcess = new WorkProcess(
    [
      globalThis.process.execPath,
      "--input-type=module",
      "-e",
      `
      import { createInterface } from "node:readline";
      const send = (value) => console.log(JSON.stringify(value));
      createInterface({ input: process.stdin }).on("line", (line) => {
        const frame = JSON.parse(line);
        if (frame.type === "configure") send({type:"ready"});
        if (frame.type === "computer") send({type:"stdout",data:"started"});
        if (frame.type === "computer_cancel") send({type:"stdout",data:"cancelled"});
        if (frame.type === "close") process.exit();
      });
    `,
    ],
    { cwd: tmpdir(), home: tmpdir() },
    [],
    async () => ({ content: [] }),
  );
  onTestFinished(async () => {
    vi.useRealTimers();
    await workerProcess.close();
  });
  await workerProcess.ready;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let entered = once(workerProcess.output, "data");
  const observation = expect(
    workerProcess.computer({
      operation: "call",
      service: "desktop",
      name: "get_window_state",
      arguments: {},
    }),
  ).rejects.toThrow("超时");
  await entered;
  let cancelled = once(workerProcess.output, "data");
  await vi.advanceTimersByTimeAsync(30_000);
  await cancelled;
  await observation;
  entered = once(workerProcess.output, "data");
  let settled = false;
  const action = workerProcess
    .computer({
      operation: "call",
      service: "desktop",
      name: "run_steps",
      arguments: {},
    })
    .catch(() => {})
    .finally(() => {
      settled = true;
    });
  await entered;
  cancelled = once(workerProcess.output, "data");
  await vi.advanceTimersByTimeAsync(120_000);
  await cancelled;
  expect(settled).toBe(false);
  vi.useRealTimers();
  await workerProcess.close();
  await action;
});
