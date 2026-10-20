import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBashTool,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, onTestFinished, test } from "vitest";
import { seedPiAccount } from "../src/harness/pi-account.mjs";
import { WorkProcess } from "../src/harness/process.ts";
import { piProvider } from "../src/harness/providers/pi.ts";
import type { ProductResult } from "../src/harness/types.ts";

async function worker() {
  const directory = await mkdtemp(join(tmpdir(), "domos-engine-"));
  const calls: string[] = [];
  const process = new WorkProcess(
    [
      globalThis.process.execPath,
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
      return { content: [{ type: "text", text: String(args.text) }] };
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
    expect(
      (await client.callTool({ name: "echo", arguments: { text: "你好" } }))
        .content,
    ).toEqual([{ type: "text", text: "你好" }]);
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
    await process.computer({
      operation: "call",
      service: "desktop",
      name: "launch_app",
      arguments: { path: electron, additional_arguments: [entry] },
    });
    await expect
      .poll(() => readFile(ready, "utf8").catch(() => ""), { timeout: 5000 })
      .toBe("ready");
  },
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
  ).toEqual({ available: true, error: null });
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

test("a work computer prepares the private Codex directory before launch", async () => {
  const { process } = await worker();
  const ready = await process.ready;
  const output: string[] = [];
  process.output.on("data", (data) => output.push(data.toString()));
  await process.launch({
    command: globalThis.process.execPath,
    args: [
      "--input-type=module",
      "-e",
      'import { stat } from "node:fs/promises"; console.log((await stat(process.env.CODEX_HOME)).isDirectory());',
    ],
    env: { CODEX_HOME: join(ready.home, "codex") },
  });
  await expect(process.closed).resolves.toMatchObject({ code: 0 });
  expect(output.join("").trim()).toBe("true");
});

test("native account HTTP stays inside the selected work computer and closes pending calls", async () => {
  const { process } = await worker();
  process.output.resume();
  process.error.resume();
  await process.launch({
    command: globalThis.process.execPath,
    args: [
      "--input-type=module",
      "-e",
      `
      import { createServer } from 'node:http';
      const server = createServer((request, response) => {
        const auth = 'Basic ' + Buffer.from('opencode:' + process.env.OPENCODE_SERVER_PASSWORD).toString('base64');
        if (request.headers.authorization !== auth) { response.writeHead(401).end(); return; }
        if (request.url === '/provider/auth') return;
        let body = '';
        request.on('data', chunk => body += chunk);
        request.on('end', () => response.end(JSON.stringify({ path: request.url, method: request.method, body: body ? JSON.parse(body) : null })));
      });
      server.listen(0, '127.0.0.1', () => {
        const address = 'server listening on http://127.0.0.1:' + server.address().port;
        process.stdout.write(address.slice(0, -1));
        setTimeout(() => console.log(address.slice(-1)), 50);
      });
    `,
    ],
    http: { timeoutMs: 30_000, readyMs: 10_000 },
  });
  await expect(
    process.request("/auth/example", "PUT", {
      type: "api",
      key: "fixture-key",
    }),
  ).resolves.toEqual({
    path: "/auth/example",
    method: "PUT",
    body: { type: "api", key: "fixture-key" },
  });
  await expect(process.request("https://example.com/private")).rejects.toThrow(
    "连接未完成",
  );
  const pending = expect(process.request("/provider/auth")).rejects.toThrow();
  await process.close();
  await pending;
});

test("a work computer allocates its native history endpoint without reading child logs", async () => {
  const { process } = await worker();
  process.output.resume();
  process.error.resume();
  await process.launch({
    command: globalThis.process.execPath,
    args: [
      "--input-type=module",
      "-e",
      `
      import { createServer } from 'node:http';
      createServer((request, response) => response.end(JSON.stringify(request.url === '/global/health' ? { healthy: true } : [{ info: { id: 'saved' } }]))).listen(Number(process.argv[1]), '127.0.0.1');
    `,
      "__DOMOS_PORT__",
    ],
    http: { timeoutMs: 1000, readyMs: 3000, listen: true },
  });
  await expect(
    process.request("/session/native-session/message"),
  ).resolves.toEqual([{ info: { id: "saved" } }]);
  await expect(
    process.request("/session/native-session/message", "POST"),
  ).rejects.toThrow();
});

test("a work computer reads its private Claude transcript through the native SDK", async () => {
  const { process } = await worker();
  const { cwd, home } = await process.ready;
  const sessionId = crypto.randomUUID();
  const project = join(
    home,
    "claude",
    "projects",
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
  );
  await mkdir(project, { recursive: true });
  const user = crypto.randomUUID();
  await writeFile(
    join(project, `${sessionId}.jsonl`),
    `${[
      {
        type: "user",
        uuid: user,
        parentUuid: null,
        sessionId,
        cwd,
        message: { role: "user", content: "Work" },
      },
      {
        type: "assistant",
        uuid: crypto.randomUUID(),
        parentUuid: user,
        sessionId,
        cwd,
        message: {
          id: "answer",
          role: "assistant",
          content: [{ type: "text", text: "Saved" }],
          stop_reason: "end_turn",
        },
      },
    ]
      .map((message) => JSON.stringify(message))
      .join("\n")}\n`,
  );
  await expect(process.history(sessionId)).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "assistant",
        message: expect.objectContaining({
          id: "answer",
          stop_reason: "end_turn",
        }),
      }),
    ]),
  );
});

test("bundled Pi opens a native session in the selected work directory", async () => {
  const { process, directory } = await worker();
  const session = await piProvider.open({
    process,
    config: { provider: "pi", model: null },
    sessionId: null,
    instructions: "Use short replies.",
    emit: async () => {},
  });
  expect(session.id.replaceAll("\\", "/")).toContain(
    `${directory.replaceAll("\\", "/")}/accounts/pi/sessions/`,
  );
  await process.close();
  await expect(process.closed).resolves.toMatchObject({
    code: expect.any(Number),
  });
}, 40_000);

test.each([false, true])(
  "Pi executes the native command declared to the model (restored: %s)",
  async (restored) => {
    const { process, directory } = await worker();
    const ready = await process.ready;
    const command =
      globalThis.process.platform === "win32" ? "powershell" : "bash";
    const { requests, extension } = await commandModel(directory, command);
    const launch = process.launch.bind(process);
    process.launch = (spec) =>
      launch({ ...spec, args: [...spec.args, "--extension", extension] });
    const results: { text: string; failed: boolean }[] = [];
    const session = await piProvider.open({
      process,
      config: { provider: "pi", model: "command-test/command-model" },
      sessionId: restored ? commandSession(ready.cwd, directory) : null,
      instructions: "Use the native command tool.",
      emit: async (event) => {
        if (event.type === "tool_result")
          results.push({ text: event.text, failed: event.failed });
      },
    });
    await session.prompt("Run echo domos-native-command.");
    expect(requests).toHaveLength(3);
    expect(requests[0]?.tools?.map((tool) => tool.function.name)).toContain(
      command,
    );
    if (globalThis.process.platform === "win32")
      expect(
        requests[0]?.tools?.map((tool) => tool.function.name),
      ).not.toContain("bash");
    expect(results).toEqual([
      { text: expect.stringContaining("not found"), failed: true },
      { text: expect.stringContaining("domos-native-command"), failed: false },
    ]);
    expect(requests[1]?.messages.at(-1)?.content).toContain(command);
  },
  40_000,
);

type CommandRequest = {
  tools?: { function: { name: string } }[];
  messages: { role: string; content: string }[];
};

function commandSession(cwd: string, directory: string) {
  const native = SessionManager.create(cwd, join(directory, "sessions"));
  const bash = createBashTool(cwd);
  native.appendMessage({
    role: "system",
    content: "Use the command tool.",
    toolsAdded: [
      {
        name: bash.name,
        description: bash.description,
        parameters: bash.parameters,
      },
    ],
    timestamp: Date.now(),
  });
  native.appendMessage({
    role: "user",
    content: "Test",
    timestamp: Date.now(),
  });
  return native.getSessionFile() ?? null;
}

function commandReply(payload: CommandRequest, command: string) {
  const result = payload.messages
    .filter((message) => message.role === "tool")
    .at(-1);
  const completed = result?.content.includes("domos-native-command");
  const canRetry = result?.content.includes(command);
  const done = completed || (result && !canRetry);
  return {
    id: "native-command",
    object: "chat.completion.chunk",
    created: 0,
    model: "command-model",
    choices: [
      {
        index: 0,
        delta: done
          ? { content: "Command completed." }
          : {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: canRetry ? "native-shell" : "previous-shell",
                  type: "function",
                  function: {
                    name: canRetry ? command : "previous_command",
                    arguments: JSON.stringify({
                      command: "echo domos-native-command",
                      timeout: 10,
                    }),
                  },
                },
              ],
            },
        finish_reason: done ? "stop" : "tool_calls",
      },
    ],
  };
}

async function commandModel(directory: string, command: string) {
  const requests: CommandRequest[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload: CommandRequest = JSON.parse(body);
    requests.push(payload);
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify(commandReply(payload, command))}\n\ndata: [DONE]\n\n`,
    );
  });
  onTestFinished(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Server address required");
  const provider = {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    api: "openai-completions",
    apiKey: "fixture-key",
    models: [
      {
        id: "command-model",
        name: "Command model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32000,
        maxTokens: 1000,
      },
    ],
  };
  const extension = join(directory, "provider.mjs");
  await writeFile(
    extension,
    `export default function(pi) { pi.registerProvider("command-test", ${JSON.stringify(provider)}); }`,
  );
  return { requests, extension };
}

test("Pi account seeding keeps native refreshes and merges a second provider", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-account-test-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const original = {
    type: "oauth",
    access: "test-access",
    refresh: "test-refresh",
    expires: 10,
  };
  await seedPiAccount(directory, { example: original });
  const path = join(directory, "auth.json");
  const refreshed = { ...original, access: "test-refreshed", expires: 20 };
  await writeFile(path, JSON.stringify({ example: refreshed }));
  await Promise.all([
    seedPiAccount(directory, { example: original }),
    seedPiAccount(directory, { another: { type: "api_key", key: "test-key" } }),
  ]);
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
    example: refreshed,
    another: { type: "api_key", key: "test-key" },
  });
  await seedPiAccount(directory, {
    example: { type: "api_key", key: "test-replacement" },
  });
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
    example: { type: "api_key", key: "test-replacement" },
  });
});

test("Bots on one work computer keep separate native Pi sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-shared-engines-"));
  const workers: WorkProcess[] = [];
  onTestFinished(async () => {
    await Promise.all(workers.map((worker) => worker.close()));
    await rm(directory, { recursive: true, force: true });
  });
  async function open(botId: number) {
    const process = new WorkProcess(
      [
        globalThis.process.execPath,
        fileURLToPath(new URL("../src/harness/worker.mjs", import.meta.url)),
      ],
      {
        cwd: join(directory, "bots", String(botId)),
        home: join(directory, ".domos", "engines"),
      },
      [],
      async () => ({ content: [] }),
    );
    workers.push(process);
    return piProvider.open({
      process,
      config: { provider: "pi", model: null },
      sessionId: null,
      instructions: "Test Bot",
      emit: async () => {},
    });
  }
  const [first, second] = await Promise.all([open(1), open(2)]);
  expect(first.id).not.toBe(second.id);
  expect(first.id.replaceAll("\\", "/")).toContain(
    "/.domos/engines/pi/sessions/",
  );
  expect(second.id.replaceAll("\\", "/")).toContain(
    "/.domos/engines/pi/sessions/",
  );
}, 40_000);
