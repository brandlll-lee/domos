import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, onTestFinished, test } from "vitest";
import { openGateway } from "../src/harness/gateway.mjs";
import piTools from "../src/harness/pi-tools.mjs";
import { WorkProcess } from "../src/harness/process.ts";
import type { ProductResult } from "../src/harness/types.ts";

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

test("Pi registers product tools directly and retains structured MCP output", async () => {
  const { process, directory, calls } = await worker();
  const ready = await process.ready;
  const manifest = join(directory, "tools.json");
  const client = new Client({ name: "manifest", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(ready.url)));
  await writeFile(
    manifest,
    JSON.stringify({ url: ready.url, tools: (await client.listTools()).tools }),
  );
  await client.close();
  const previous = globalThis.process.env.DOMOS_PI_TOOLS;
  globalThis.process.env.DOMOS_PI_TOOLS = manifest;
  const handlers = new Map<string, (() => Promise<void>)[]>();
  let active: string[] = [];
  const registered: {
    name: string;
    execute(
      id: string,
      args: object,
      signal: AbortSignal,
    ): Promise<ProductResult>;
  }[] = [];
  try {
    piTools({
      registerTool: (value: (typeof registered)[number]) =>
        registered.push(value),
      on: (name: string, handler: () => Promise<void>) =>
        handlers.set(name, [...(handlers.get(name) ?? []), handler]),
      getActiveTools: () => active,
      setActiveTools: (value: string[]) => {
        active = value;
      },
    } as unknown as Parameters<typeof piTools>[0]);
  } finally {
    if (previous === undefined) delete globalThis.process.env.DOMOS_PI_TOOLS;
    else globalThis.process.env.DOMOS_PI_TOOLS = previous;
  }
  try {
    for (const handler of handlers.get("session_start") ?? []) await handler();
    await process.toolsReady();
    expect(active).toContain("mcp__domos__echo");
    const tool = registered[0];
    expect(tool?.name).toBe("mcp__domos__echo");
    expect(
      await tool?.execute(
        "test",
        { text: "你好" },
        new AbortController().signal,
      ),
    ).toMatchObject({
      content: [
        { type: "text", text: "你好" },
        { type: "text", text: '{"text":"你好"}' },
      ],
      structuredContent: { text: "你好" },
      details: { structuredContent: { text: "你好" } },
    });
    expect(calls).toEqual(["你好"]);
  } finally {
    for (const handler of handlers.get("session_shutdown") ?? [])
      await handler();
  }
});

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
