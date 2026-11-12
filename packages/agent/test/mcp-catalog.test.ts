import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { assert, expect, onTestFinished, test, vi } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import { EngineExecution } from "../src/harness/execution.ts";
import { mcpCatalog } from "../src/harness/mcp-catalog.ts";
import { WorkProcess } from "../src/harness/process.ts";
import { claudeProvider } from "../src/harness/providers/claude.ts";
import { codexProvider } from "../src/harness/providers/codex.ts";
import { openCodexClient } from "../src/harness/providers/codex-client.ts";
import { engineProvider } from "../src/harness/providers/index.ts";
import { opencodeProvider } from "../src/harness/providers/opencode.ts";
import { piProvider } from "../src/harness/providers/pi.ts";
import type { EngineSession } from "../src/harness/types.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";
import { featureProcess } from "./fixtures/feature-process.ts";

const fixture = JSON.parse(
  await readFile(
    new URL("./fixtures/mcp-catalog.json", import.meta.url),
    "utf8",
  ),
);

test("Codex configuration retains disabled entries and does not claim a connection", async () => {
  const process = new ProtocolProcess("cli");
  process.launch = async (spec) => {
    expect(spec.args).toEqual(["mcp", "list", "--json"]);
    process.output.write(JSON.stringify([...fixture.codex, { enabled: true }]));
    process.ended.resolve({ code: 0 });
  };
  onTestFinished(() => process.close());
  assert(codexProvider.mcp);
  const result = await codexProvider.mcp({
    process,
    config: { provider: "codex", model: null },
  });
  expect(result).toMatchObject({ status: "partial", scope: "configuration" });
  expect(result.items).toEqual([
    expect.objectContaining({
      name: "docs",
      enabled: true,
      status: "unknown",
      authStatus: "unsupported",
    }),
    expect.objectContaining({
      name: "paused",
      enabled: false,
      status: "unknown",
    }),
  ]);
  expect(result.items[0]).not.toHaveProperty("transport");
  expect(result.errors).toHaveLength(1);
});

test.each(["complete", "partial", "unsupported", "cancel"])(
  "Codex reads a bounded paginated session catalog: %s",
  async (mode) => {
    const process = new ProtocolProcess();
    onTestFinished(() => process.close());
    process.receive = (request) => {
      if (request.method !== "mcpServerStatus/list")
        return process.response(request, {});
      expect(request.params?.threadId).toBe("thread");
      expect(request.params?.limit).toBe(100);
      if (mode === "cancel") return;
      if (
        mode === "unsupported" ||
        (mode === "partial" && request.params?.cursor)
      ) {
        process.frame({
          id: request.id,
          error: {
            code: mode === "unsupported" ? -32601 : -32001,
            message: "Read rejected",
          },
        });
      } else
        process.response(
          request,
          request.params?.cursor
            ? {
                data: [{ name: "two", authStatus: "o_auth" }],
                nextCursor: null,
              }
            : {
                data: [{ name: "one", authStatus: "unsupported" }],
                nextCursor: "next",
              },
        );
    };
    const client = await openCodexClient(process, {
      provider: "codex",
      model: null,
    });
    const controller = new AbortController();
    const read = client.mcp("thread", controller.signal);
    if (mode === "cancel") {
      const rejected = expect(read).rejects.toThrow("cancelled");
      controller.abort(new Error("cancelled"));
      await rejected;
      expect(process.input.writableEnded).toBe(false);
      return;
    }
    const result = await read;
    expect(result.status).toBe(mode);
    expect(result.items.map((item) => item.name)).toEqual(
      mode === "complete" ? ["one", "two"] : mode === "partial" ? ["one"] : [],
    );
    if (mode === "partial") expect(result.errors[0]?.code).toBe(-32001);
    if (mode === "complete") expect(result.items[0]?.enabled).toBeNull();
  },
);

test("Claude reads plugin names and changing live states through its control channel", async () => {
  const process = new ProtocolProcess();
  onTestFinished(() => process.close());
  let status = fixture.claude;
  process.receive = (request) => {
    const control = request as unknown as {
      request_id: string;
      request: { subtype: string };
    };
    process.frame({
      type: "control_response",
      response: {
        request_id: control.request_id,
        subtype: "success",
        response: control.request.subtype === "mcp_status" ? status : {},
      },
    });
  };
  const session = await claudeProvider.open({
    process,
    config: { provider: "claude", model: null },
    sessionId: null,
    instructions: "Read MCP",
    emit: async () => {},
  });
  assert(session.mcp);
  const initial = await session.mcp();
  expect(initial.items).toHaveLength(3);
  expect(initial.items[0]).toMatchObject({
    name: "plugin:notes:search",
    status: "pending",
    source: "project",
  });
  status = {
    mcpServers: [{ name: "plugin:notes:search", status: "connected" }],
  };
  expect((await session.mcp()).items[0]?.status).toBe("connected");
  expect(process.requests.some((request) => request.type === "user")).toBe(
    false,
  );
});

test("Pi retains runtime extension identities and partial configuration errors", async () => {
  const process = featureProcess();
  process.mcp = async <T>(input: Record<string, unknown>) => {
    expect(input.action).toBe("pi_catalog");
    return fixture.pi as T;
  };
  onTestFinished(() => process.close());
  assert(piProvider.mcp);
  const result = await piProvider.mcp({
    process,
    config: { provider: "pi", model: null },
  });
  expect(result).toMatchObject({
    status: "partial",
    scope: "configuration",
    errors: fixture.pi.errors,
  });
  expect(result.items).toEqual(fixture.pi.items);
  expect(process.requests.some((request) => request.type === "prompt")).toBe(
    false,
  );
});

test("OpenCode uses GET /mcp and preserves partial records and connection errors", async () => {
  const process = new ProtocolProcess("cli");
  process.output.resume();
  process.request = async <T>(path: string, method?: string) => {
    expect([path, method]).toEqual(["/mcp", "GET"]);
    return { ...fixture.opencode, invalid: {} } as T;
  };
  onTestFinished(() => process.close());
  assert(opencodeProvider.mcp);
  const result = await opencodeProvider.mcp({
    process,
    config: { provider: "opencode", model: null },
  });
  expect(result.status).toBe("partial");
  expect(result.items).toContainEqual(
    expect.objectContaining({
      name: "offline",
      status: "failed",
      error: "Service unavailable",
    }),
  );
  expect(result.items).toHaveLength(4);
});

test("directory failures and unsupported providers stay distinct from a complete empty result", async () => {
  const process = featureProcess();
  onTestFinished(() => process.close());
  const computers = { process: async () => process } as unknown as Computers;
  const execution = new EngineExecution(computers);
  expect(
    await execution.nativeCatalog(1, { provider: "acp", model: null }, context),
  ).toMatchObject({ status: "unsupported", items: [] });
  const probe = vi
    .spyOn(piProvider, "mcp")
    .mockRejectedValueOnce(
      Object.assign(new Error("Read failed"), { code: 500 }),
    )
    .mockResolvedValueOnce(mcpCatalog([], "configuration"));
  onTestFinished(() => probe.mockRestore());
  expect(
    await execution.nativeCatalog(1, { provider: "pi", model: null }, context),
  ).toMatchObject({
    status: "failed",
    errors: [{ code: 500, message: "Read failed" }],
  });
  expect(
    await execution.nativeCatalog(1, { provider: "pi", model: null }, context),
  ).toMatchObject({ status: "complete", items: [], errors: [] });
});

test("session catalog reads use the requested execution, hide mounted names and preserve cancellation", async () => {
  const process = featureProcess();
  onTestFinished(() => process.close());
  const computers = { process: vi.fn() } as unknown as Computers;
  const execution = new EngineExecution(computers);
  const controller = new AbortController();
  const mcp = vi.fn(async () =>
    mcpCatalog(
      [
        { name: "docs", source: "native", enabled: true, status: "connected" },
        {
          name: "domos_saved",
          source: "native",
          enabled: true,
          status: "connected",
        },
      ],
      "session",
    ),
  );
  execution.active.set(7, {
    process,
    controller,
    memoryReview: false,
    session: { id: "private-7", mcp } as unknown as EngineSession,
    managed: new Map([
      [
        "saved",
        { generation: 1, computerId: "pc", worker: process, tools: [] },
      ],
    ]),
  });
  expect(
    await execution.nativeCatalog(
      7,
      { provider: "codex", model: null },
      context,
    ),
  ).toMatchObject({
    scope: "session",
    sessionId: "private-7",
    items: [{ name: "docs" }],
  });
  const abort = new AbortController();
  mcp.mockImplementationOnce(
    async (...[signal]: unknown[]) =>
      new Promise((_resolve, reject) => {
        (signal as AbortSignal).addEventListener(
          "abort",
          () => reject((signal as AbortSignal).reason),
          { once: true },
        );
      }),
  );
  const read = execution.nativeCatalog(
    7,
    { provider: "codex", model: null },
    context,
    abort.signal,
  );
  const rejected = expect(read).rejects.toThrow("Cancelled read");
  abort.abort(new Error("Cancelled read"));
  await rejected;
  expect(controller.signal.aborted).toBe(false);
  expect(process.input.writableEnded).toBe(false);
  expect(computers.process).not.toHaveBeenCalled();
});

test
  .skipIf(process.env.DOMOS_MCP_CATALOG_SMOKE !== "1")
  .each(["codex", "claude", "pi", "opencode"])(
  "%s reads its installed native catalog without a model turn",
  async (id) => {
    const directory = await mkdtemp(join(tmpdir(), "domos-mcp-catalog-"));
    const worker = new WorkProcess(
      [
        process.execPath,
        fileURLToPath(new URL("../src/harness/worker.mjs", import.meta.url)),
      ],
      { cwd: directory, home: directory },
      [],
      async () => {
        throw new Error("Catalog reads do not call tools");
      },
    );
    onTestFinished(async () => {
      await worker.close();
      await rm(directory, { recursive: true, force: true });
    });
    const startedAt = Date.now();
    const provider = engineProvider(id);
    assert(provider.mcp);
    const catalog = await provider.mcp({
      process: worker,
      config: { provider: id, model: null },
    });
    expect(["complete", "partial"]).toContain(catalog.status);
    expect(
      catalog.items.every(
        (item) =>
          typeof item.name === "string" && typeof item.status === "string",
      ),
    ).toBe(true);
    await mkdir("test-results", { recursive: true });
    await writeFile(
      `test-results/mcp-catalog-${id}.json`,
      JSON.stringify(
        {
          harness: id,
          elapsedMs: Date.now() - startedAt,
          status: catalog.status,
          scope: catalog.scope,
          count: catalog.items.length,
          errors: catalog.errors.length,
          modelCalls: 0,
        },
        null,
        2,
      ),
    );
  },
  90_000,
);
