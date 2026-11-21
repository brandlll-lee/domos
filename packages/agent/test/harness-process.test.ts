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
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, onTestFinished, test, vi } from "vitest";
import { openGateway } from "../src/harness/gateway.mjs";
import { JsonLines } from "../src/harness/json-lines.ts";
import { openOpenCodeAccount } from "../src/harness/opencode-account.ts";
import piTools from "../src/harness/pi-tools.mjs";
import { WorkProcess } from "../src/harness/process.ts";
import {
  callProductTool,
  recordToolResult,
} from "../src/harness/product-tools.ts";
import {
  customAcpProvider,
  opencodeProvider,
} from "../src/harness/providers/opencode.ts";
import type { EngineRuntime } from "../src/harness/task-types.ts";
import type { ProductResult } from "../src/harness/types.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

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
  expect(result.content).toContainEqual(raw.content[1]);
  expect(JSON.stringify(result.content).length).toBeLessThan(10000);
  const copy = JSON.parse((result.content.at(-2) as { text: string }).text);
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

test("a held app catalog can be searched after structural trimming", async () => {
  const apps = Array.from({ length: 280 }, (_, i) => ({
    name: i === 279 ? "Target Music" : `Application ${i}`,
    pid: i,
    running: false,
    active: false,
    launch_path: `C:/Programs/${i}/player.exe`,
    detail: "metadata ".repeat(40),
  }));
  const invoke = vi.fn(async () => ({
    content: [{ type: "text" as const, text: "280 installed applications" }],
    structuredContent: { apps },
  }));
  const gateway = await openGateway(
    [
      {
        name: "list_apps",
        description: "Apps",
        inputSchema: { type: "object" },
      },
    ],
    invoke,
  );
  const client = new Client({ name: "query", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await gateway.close();
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url)));
  const first = await client.callTool({ name: "list_apps" });
  const preview = JSON.parse(
    (first.content as { text: string }[])[1]?.text ?? "",
  );
  expect(preview.apps.length).toBeLessThan(280);
  expect(first.structuredContent).toEqual({ apps });
  const notice = (first.content as { text: string }[]).at(-1)?.text ?? "";
  expect(notice).toContain("apps: 280 items");
  const example = notice.match(/Example: (.+?)\. Use query_result/)?.[1];
  expect(example).toBeTruthy();
  const sample = await client.callTool({
    name: "query_result",
    arguments: { result: "r1", query: example },
  });
  expect(
    JSON.parse((sample.content as { text: string }[])[0]?.text ?? ""),
  ).toHaveLength(20);
  const found = await client.callTool({
    name: "query_result",
    arguments: {
      result: "r1",
      query:
        "apps[?contains(name, 'Target Music')].{name:name, launch_path:launch_path}",
    },
  });
  expect(
    JSON.parse((found.content as { text: string }[])[0]?.text ?? ""),
  ).toEqual([{ name: "Target Music", launch_path: apps[279]?.launch_path }]);
  const invalid = await client.callTool({
    name: "query_result",
    arguments: { result: "r1", query: "apps[?" },
  });
  expect(invalid.isError).toBe(true);
  expect(JSON.stringify(invalid.content)).toContain("Shape:");
  expect(invoke).toHaveBeenCalledTimes(1);
  await expect(
    client.callTool({
      name: "query_result",
      arguments: { result: "r1", search: "Target Music" },
    }),
  ).rejects.toThrow();
});

test("query_result pages complete UTF-8 text through the original handle", async () => {
  const text = `开头🙂${"中文🙂".repeat(2400)}TAIL-9010`;
  const invoke = vi.fn(async () => ({
    content: [
      { type: "text" as const, text: JSON.stringify({ report: text }) },
    ],
  }));
  const gateway = await openGateway(
    [
      {
        name: "report",
        description: "Report",
        inputSchema: { type: "object" },
      },
    ],
    invoke,
  );
  const client = new Client({ name: "pages", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await gateway.close();
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url)));
  await client.callTool({ name: "report" });
  let offset: number | null = 0;
  let read = "";
  while (offset !== null) {
    const result = await client.callTool({
      name: "query_result",
      arguments: { result: "r1", query: "report", offset },
    });
    const page = JSON.parse(
      (result.content as { text: string }[])[0]?.text ?? "",
    );
    expect(page).toMatchObject({
      result: "r1",
      query: "report",
      offset,
      encoding: "utf8",
      totalBytes: Buffer.byteLength(text),
    });
    expect(Buffer.byteLength(page.text)).toBeLessThanOrEqual(8000);
    expect(page.text).not.toContain("�");
    read += page.text;
    offset = page.nextOffset;
  }
  expect(read).toBe(text);
  for (let i = 0; i < 22; i++) {
    const result = await client.callTool({
      name: "query_result",
      arguments: {
        result: "r1",
        query: "report",
        offset: Buffer.byteLength(text) - 9,
      },
    });
    expect(JSON.stringify(result.content)).toContain("TAIL-9010");
  }
  expect(invoke).toHaveBeenCalledTimes(1);
  await expect(
    client.callTool({
      name: "query_result",
      arguments: { result: "r1", query: "report", offset: 1 },
    }),
  ).rejects.toThrow("偏移");
});

test("an expired result points to its persisted tool record", async () => {
  const locator = 42;
  const gateway = await openGateway(
    [
      {
        name: "report",
        description: "Report",
        inputSchema: { type: "object" },
      },
    ],
    async () => ({
      content: [{ type: "text", text: "report".repeat(2000) }],
      _meta: { "domos/result": locator },
    }),
  );
  const client = new Client({ name: "expiry", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await gateway.close();
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url)));
  const first = await client.callTool({ name: "report" });
  const handle = `r1:${locator}`;
  expect(JSON.stringify(first.content)).toContain(handle);
  for (let i = 0; i < 20; i++) await client.callTool({ name: "report" });
  const result = await client.callTool({
    name: "query_result",
    arguments: { result: handle, query: "@" },
  });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result.content)).toContain("conversation_read");
  expect((result.content as { text: string }[])[0]?.text).toContain(
    JSON.stringify({ entryId: locator, offset: 0 }),
  );
});

test("archive failure preserves the delivered native result", async () => {
  const runtime = {
    commit: async () => {
      throw new Error("Storage unavailable");
    },
  } as unknown as EngineRuntime;
  const native: ProductResult = {
    content: [{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" }],
    structuredContent: { executed: true },
  };
  const result = await recordToolResult(
    runtime,
    "call",
    "desktop_action",
    native,
    BACKGROUND_CONTEXT,
  );
  expect(result.content).toContainEqual(native.content[0]);
  expect(result.structuredContent).toEqual(native.structuredContent);
  expect(JSON.stringify(result.content)).toContain("archive failed");
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

test("OpenCode reads native skills through the authenticated work-process bridge", async () => {
  const requests: { path: string; method: string; authenticated: boolean }[] =
    [];
  let skills = [
    {
      name: "report",
      description: "Prepare report",
      location: "/work/.opencode/skills/report/SKILL.md",
      content: "Private skill body",
    },
  ];
  let status = 200;
  let holdMcp = false;
  const mcpStarted = Promise.withResolvers<void>();
  const mcpCancelled = Promise.withResolvers<void>();
  const server = createServer((request, response) => {
    requests.push({
      path: request.url ?? "",
      method: request.method ?? "",
      authenticated:
        request.headers.authorization?.startsWith("Basic ") ?? false,
    });
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/mcp" && holdMcp) {
      response.once("close", () => mcpCancelled.resolve());
      mcpStarted.resolve();
      return;
    }
    const result =
      request.url === "/mcp"
        ? { docs: { status: "connected" } }
        : request.url === "/skill"
          ? skills
          : request.url === "/provider"
            ? {
                all: [{ id: "example", name: "Example", models: {} }],
                connected: [],
              }
            : request.url === "/provider/auth"
              ? { example: [{ type: "oauth", label: "Sign in" }] }
              : request.url === "/provider/example/oauth/authorize"
                ? {
                    url: "https://example.com/login",
                    method: "code",
                    instructions: "Sign in",
                  }
                : request.url?.startsWith("/session/")
                  ? [
                      {
                        parts: [
                          {
                            type: "file",
                            url: "data:image/png;base64,aW1hZ2U=",
                          },
                        ],
                      },
                    ]
                  : true;
    response.end(JSON.stringify(result));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  const { process } = await worker();
  await process.launch({
    command: globalThis.process.execPath,
    args: [
      "-e",
      `console.log("http://127.0.0.1:${address.port}"); process.stdin.resume();`,
    ],
    http: { readyMs: 3000, timeoutMs: 3000 },
  });
  const native = new ProtocolProcess();
  onTestFinished(() => native.close());
  native.request = process.request.bind(process);
  native.receive = (request) =>
    native.response(
      request,
      request.method === "initialize"
        ? {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: true,
              mcpCapabilities: { http: true },
            },
          }
        : {},
    );
  const session = await opencodeProvider.open({
    process: native,
    config: { provider: "opencode", model: null },
    sessionId: "session-1",
    instructions: "Role",
    emit: async () => {},
  });
  expect(await session.skills?.()).toEqual([
    {
      name: "report",
      description: "Prepare report",
      path: "/work/.opencode/skills/report/SKILL.md",
      source: "opencode",
    },
  ]);
  expect(requests).toEqual([
    { path: "/skill", method: "GET", authenticated: true },
  ]);
  skills = [];
  expect(await session.skills?.()).toEqual([]);
  expect(await session.mcp?.()).toMatchObject({
    status: "complete",
    scope: "session",
    items: [{ name: "docs", status: "connected", enabled: true }],
  });
  status = 404;
  await expect(session.mcp?.()).rejects.toMatchObject({ code: 404 });
  status = 503;
  await expect(session.skills?.()).rejects.toThrow("HTTP 503");
  status = 200;
  holdMcp = true;
  const cancelledRead = new AbortController();
  const pendingMcp = process.request(
    "/mcp",
    "GET",
    undefined,
    cancelledRead.signal,
  );
  const rejectedMcp = expect(pendingMcp).rejects.toThrow(
    "Cancelled catalog read",
  );
  await mcpStarted.promise;
  cancelledRead.abort(new Error("Cancelled catalog read"));
  await rejectedMcp;
  await mcpCancelled.promise;
  holdMcp = false;
  expect(await session.mcp?.()).toMatchObject({ status: "complete" });
  expect(await process.request("/session/session-1/message?limit=256")).toEqual(
    [{ parts: [{ type: "text", text: "[Image retained in native session]" }] }],
  );
  const account = await openOpenCodeAccount(native);
  expect((await account.catalog()).providers).toMatchObject([
    { id: "example" },
  ]);
  expect(await account.login("example", 0)).toMatchObject({ method: "code" });
  await account.complete("example", 0, "test-only-code");
  await account.key("example", "test-only-key");
  await account.key("example", null);
  expect(requests).toEqual(
    expect.arrayContaining([
      {
        path: "/provider/example/oauth/authorize",
        method: "POST",
        authenticated: true,
      },
      {
        path: "/provider/example/oauth/callback",
        method: "POST",
        authenticated: true,
      },
      { path: "/auth/example", method: "PUT", authenticated: true },
      { path: "/auth/example", method: "DELETE", authenticated: true },
    ]),
  );
  const count = requests.length;
  for (const [path, method] of [
    ["/skill", "POST"],
    ["/mcp", "POST"],
    ["/skill/extra", "GET"],
    ["/provider", "DELETE"],
    ["/provider/example/extra", "POST"],
    ["/auth/example", "GET"],
    ["/session/session-1/message?limit=257", "GET"],
    ["/session/session-1/message?limit=256", "POST"],
    ["/provider/../oauth/authorize", "POST"],
    ["/provider/%2e%2e/oauth/authorize", "POST"],
    ["http://example.com/skill", "GET"],
  ] as const) {
    await expect(process.request(path, method)).rejects.toThrow(
      "路径或方法不受支持",
    );
  }
  expect(requests).toHaveLength(count);
});

test("workspace MCP routes tools through the authenticated process channel", async () => {
  const { process, calls } = await worker();
  const ready = await process.ready;
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(ready.url)));
  try {
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "echo",
      "query_result",
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

test("an ACP stdio agent discovers and calls the work computer's MCP", async () => {
  const { process, calls } = await worker();
  const events: string[] = [];
  const session = await customAcpProvider.open({
    process,
    config: {
      provider: "acp",
      model: null,
      command: globalThis.process.execPath,
      args: [
        fileURLToPath(new URL("./fixtures/acp-stdio.mjs", import.meta.url)),
      ],
    },
    sessionId: null,
    instructions: "Role",
    emit: async (event) => {
      if (event.type === "text") events.push(event.text);
    },
  });
  await session.prompt("Use the available tool");
  expect(calls).toEqual(["stdio"]);
  expect(events.join("")).toContain("stdio");
});

test("the deferred MCP bridge retains schemas and calls the original allowed tool", async () => {
  const { process, calls } = await worker();
  const ready = await process.ready;
  const client = new Client({ name: "deferred-test", version: "1" });
  onTestFinished(() => client.close());
  if (!ready.mcpStdio) throw new Error("Stdio transport required");
  await client.connect(
    new StdioClientTransport({
      command: ready.mcpStdio.command,
      args: [...ready.mcpStdio.args, ready.url, "--deferred"],
      env: { ELECTRON_RUN_AS_NODE: "1" },
      stderr: "pipe",
    }),
  );
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
    "call_tool",
  ]);
  const schema = await client.callTool({
    name: "call_tool",
    arguments: { name: "echo" },
  });
  expect(
    JSON.parse((schema.content as { text: string }[])[0]?.text ?? ""),
  ).toMatchObject({ name: "echo", inputSchema: { type: "object" } });
  expect(calls).toEqual([]);
  const result = await client.callTool({
    name: "call_tool",
    arguments: { name: "echo", arguments: { text: "deferred" } },
  });
  expect(result.content).toContainEqual({ type: "text", text: "deferred" });
  expect(calls).toEqual(["deferred"]);
  await expect(
    client.callTool({
      name: "call_tool",
      arguments: { name: "other", arguments: {} },
    }),
  ).rejects.toThrow("工具不可用");
  expect(calls).toEqual(["deferred"]);
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
    piTools({
      registerMcpServer,
      registerTool: vi.fn(),
      on: vi.fn(),
    } as unknown as Parameters<typeof piTools>[0]);
    expect(registerMcpServer).toHaveBeenCalledWith("domos", {
      url: "http://127.0.0.1/mcp",
      exposure: "deferred",
      timeout: 600,
    });
  } finally {
    if (previous === undefined) delete globalThis.process.env.DOMOS_PI_TOOLS;
    else globalThis.process.env.DOMOS_PI_TOOLS = previous;
  }
});

test("Pi discovers product and configured MCP tools through native search", async () => {
  const { process, directory } = await worker();
  const ready = await process.ready;
  const account = join(directory, "pi");
  await mkdir(account);
  const settings = '{"quietStartup":true}';
  await writeFile(join(account, "settings.json"), settings);
  await mkdir(join(account, "extensions"));
  await writeFile(
    join(account, "extensions", "ordinary.js"),
    `export default pi => pi.registerCommand("ordinary", { handler: (_args, ctx) => ctx.ui.notify("ordinary-ready", "info") });`,
  );
  await writeFile(
    join(account, "extensions", "mcp-owner.js"),
    `export default pi => { pi.registerCommand("mcp", { handler: async () => {} }); pi.on("session_start", (_event, ctx) => ctx.ui.notify("replacement-started", "info")); };`,
  );
  await writeFile(
    join(account, "extensions", "servers.js"),
    `export default pi => pi.registerMcpServer("addon", { url: ${JSON.stringify(ready.url)}, exposure: "deferred" });`,
  );
  await mkdir(join(directory, "bot", ".pi", "extensions"), { recursive: true });
  await writeFile(
    join(directory, "bot", ".pi", "extensions", "project.js"),
    `export default pi => pi.on("session_start", (_event, ctx) => ctx.ui.notify("project-started", "info"));`,
  );
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
  const catalog = await process.mcp<{
    items: { name: string; enabled: boolean; status: string; source: string }[];
    errors: unknown[];
  }>({ action: "pi_catalog" });
  expect(catalog.errors).toEqual([]);
  expect(catalog.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "code",
        enabled: true,
        status: "unknown",
      }),
      expect.objectContaining({
        name: "search",
        enabled: true,
        status: "unknown",
      }),
      expect.objectContaining({
        name: "addon",
        source: expect.stringContaining("servers.js"),
        status: "unknown",
      }),
    ]),
  );
  await rpc.request("prompt", { message: "/ordinary" });
  expect(warnings).toContain("ordinary-ready");
  expect(warnings).not.toContain("replacement-started");
  await process.toolsReady();
  await vi.waitFor(async () => {
    await rpc.request("prompt", { message: "/loadout" });
    expect(loadout?.active).not.toContain("mcp__domos__echo");
    expect(loadout?.tools).toContain("mcp__domos__echo");
    expect(loadout?.active).toContain("tool_search");
    expect(loadout?.tools).toContain("mcp__code__echo");
    expect(loadout?.tools).toContain("mcp__search__echo");
    expect(loadout?.tools).toContain("mcp__addon__echo");
  });
  expect(loadout?.tools).toContain("codemode");
  const switched = await rpc.request<{ cancelled?: boolean }>(
    "switch_session",
    {
      sessionPath: state.sessionFile,
    },
  );
  expect(switched.cancelled).not.toBe(true);
  await rpc.request("prompt", { message: "/ordinary" });
  expect(
    warnings.filter((message) => message === "ordinary-ready"),
  ).toHaveLength(2);
  expect(warnings).not.toContain("replacement-started");
  expect(warnings).not.toContain("project-started");
  await process.toolsReady();
  expect(await readFile(join(account, "settings.json"), "utf8")).toBe(settings);
  const original = await worker();
  const nativeRpc = new JsonLines(original.process, true);
  const nativeNotices: string[] = [];
  nativeRpc.on("frame", (frame) => {
    if (frame.type === "extension_ui_request" && frame.method === "notify")
      nativeNotices.push(frame.message);
  });
  await original.process.launch({
    command: globalThis.process.execPath,
    args: [
      piCli,
      "--mode",
      "rpc",
      "--session-dir",
      join(original.directory, "sessions"),
    ],
    env: { PI_CODING_AGENT_DIR: account },
  });
  await nativeRpc.request("get_state");
  await vi.waitFor(() =>
    expect(nativeNotices).toContain("replacement-started"),
  );
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
    expect(result.isError).not.toBe(true);
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

test.each(["", "Partial output"])(
  "product errors retain diagnostics with output %j",
  async (output) => {
    const runtime = {
      taskId: 1,
      conversationId: 1,
      agent: async () => ({ callable: [{ name: "attach_file" }] }),
      registry: {
        tools: () => [
          {
            extension: { name: "domos-files" },
            tool: {
              name: "attach_file",
              description: "Attach",
              parameters: { type: "object" },
            },
          },
        ],
      },
      commit: async (change: (tx: object) => Promise<void>) =>
        change({
          doc: async () => ({ taskId: 7 }),
          task: async () => ({
            input: { call: { name: "attach_file", arguments: {} } },
          }),
        }),
      waitForTask: async () => {},
      snapshot: async () => ({
        result: {
          isError: true,
          structuredOutput: output,
          diagnostics: [{ message: "Screenshot id does not exist" }],
        },
      }),
    } as unknown as EngineRuntime;
    const result = await callProductTool(
      runtime,
      "attach",
      "attach_file",
      {},
      BACKGROUND_CONTEXT,
      new AbortController().signal,
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContainEqual({
      type: "text",
      text: [output, "Screenshot id does not exist"].filter(Boolean).join("\n"),
    });
  },
);

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
