import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    await rm(directory, { recursive: true, force: true });
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

test("Pi applies native command tools when it restores a session", async () => {
  const { process, directory } = await worker();
  const ready = await process.ready;
  const probe = join(directory, "probe.mjs");
  const result = join(directory, "tools.json");
  await writeFile(
    probe,
    `import { writeFileSync } from "node:fs";
export default function(pi) {
  pi.registerCommand("probe", { handler: async () => {
    writeFileSync(${JSON.stringify(result)}, JSON.stringify(pi.getActiveTools()));
  }});
}`,
  );
  const native = SessionManager.create(ready.cwd, join(directory, "sessions"));
  const bash = createBashTool(ready.cwd);
  native.appendMessage({
    role: "system",
    content: "Test",
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
  const launch = process.launch.bind(process);
  process.launch = (spec) =>
    launch({ ...spec, args: [...spec.args, "--extension", probe] });
  const session = await piProvider.open({
    process,
    config: { provider: "pi", model: null },
    sessionId: native.getSessionFile() ?? null,
    instructions: "Test",
    emit: async () => {},
  });
  await session.prompt("/probe");
  const tools: string[] = JSON.parse(await readFile(result, "utf8"));
  expect(tools).toContain(
    globalThis.process.platform === "win32" ? "powershell" : "bash",
  );
  if (globalThis.process.platform === "win32")
    expect(tools).not.toContain("bash");
}, 40_000);

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
