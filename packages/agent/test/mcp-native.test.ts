import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, onTestFinished, test } from "vitest";
import { WorkProcess } from "../src/harness/process.ts";
import { permissionTool } from "../src/harness/product-tools.ts";
import { claudePermission } from "../src/harness/providers/claude-approval.ts";
import { engineProvider } from "../src/harness/providers/index.ts";
import type {
  EngineEvent,
  EngineSession,
  ProductResult,
} from "../src/harness/types.ts";

test.skipIf(process.env.DOMOS_NATIVE_SMOKE !== "1")(
  "Antigravity calls a large product tool through its native registration",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "domos-agy-tools-"));
    const marker = crypto.randomUUID();
    const calls: string[] = [];
    const replies: string[] = [];
    const events: EngineEvent[] = [];
    const worker = new WorkProcess(
      [
        process.execPath,
        fileURLToPath(new URL("../src/harness/worker.mjs", import.meta.url)),
      ],
      { cwd: directory, home: directory },
      [
        ...Array.from({ length: 30 }, (_, index) => ({
          name: `catalog_${index}`,
          description: "Read catalog metadata. ".repeat(80),
          inputSchema: { type: "object" },
        })),
        {
          name: "image_generate",
          description:
            "Return the image test receipt. This is a local test fixture. ".repeat(
              160,
            ),
          inputSchema: {
            type: "object",
            properties: { prompt: { type: "string" } },
            required: ["prompt"],
          },
        },
      ],
      async (_id, name, args) => {
        expect(name).toBe("image_generate");
        expect(args).toEqual({ prompt: "receipt" });
        calls.push(name);
        return { content: [{ type: "text", text: marker }] };
      },
    );
    onTestFinished(async () => {
      await worker.close();
      await rm(directory, { recursive: true, force: true, maxRetries: 10 });
    });
    const session = await engineProvider("antigravity").open({
      process: worker,
      config: { provider: "antigravity", model: "claude-opus-4-6-thinking" },
      sessionId: null,
      instructions:
        "Call the domos image_generate test fixture with prompt receipt. It returns a local receipt, not an image. Do not use native image generation, subagents, files or commands.",
      approve: async () => ({ allow: true }),
      emit: async (event) => {
        events.push(event);
        if (event.type === "message") replies.push(event.text);
      },
    });
    await session.ready?.();
    await worker.toolsReady();
    await session.prompt(
      'Call domos image_generate with {"prompt":"receipt"} and report the exact receipt. Use no other capabilities.',
    );
    expect(calls, replies.join("\n")).toEqual(["image_generate"]);
    expect(replies.join("\n")).toContain(marker);
    expect(
      events.find((event) => event.type === "accepted")?.native?.version,
    ).toMatch(/^\d+\.\d+/);
    const usage = events.findLast((event) => event.type === "usage");
    expect(usage?.type === "usage" && usage.usage.nativeUsage).toEqual(
      expect.objectContaining({
        inputTokens: expect.any(Number),
        totalTokens: expect.any(Number),
      }),
    );
  },
  150_000,
);

test
  .skipIf(process.env.DOMOS_NATIVE_SMOKE !== "1")
  .each([
    "codex",
    "claude",
    "pi",
    "opencode",
    "grok",
    "antigravity",
    "devin",
    "cursor",
  ])(
  "%s calls a managed stdio MCP through its native session",
  async (provider) => {
    const directory = await mkdtemp(join(tmpdir(), "domos-mcp-native-"));
    const marker = crypto.randomUUID();
    const replies: string[] = [];
    let calls = 0;
    const worker = new WorkProcess(
      [
        process.execPath,
        fileURLToPath(new URL("../src/harness/worker.mjs", import.meta.url)),
      ],
      { cwd: directory, home: directory },
      provider === "claude" ? [permissionTool] : [],
      async (_id, name, args, signal) => {
        if (name === "approve")
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(claudePermission(args, { allow: true })),
              },
            ],
          };
        expect(name).toBe("mcp_call");
        if (args.method === "tools/call") calls++;
        const response = await worker.mcp<{ result: ProductResult }>(
          {
            action: "request",
            id: "acceptance",
            method: args.method,
            params: args.params,
          },
          signal,
        );
        return args.method === "tools/call"
          ? response.result
          : { content: [], structuredContent: { result: response.result } };
      },
    );
    onTestFinished(async () => {
      await worker.close();
      await rm(directory, { recursive: true, force: true, maxRetries: 10 });
    });
    const connected = await worker.mcp<{
      tools: unknown[];
      capabilities: Record<string, unknown>;
    }>({
      action: "connect",
      id: "acceptance",
      config: {
        transport: "stdio",
        command: process.execPath,
        args: [
          fileURLToPath(new URL("./fixtures/mcp-stdio.mjs", import.meta.url)),
        ],
        env: { MCP_FIXTURE_TEXT: marker },
      },
    });
    const mounted = await worker.mcp<{ url: string }>({
      action: "mount",
      id: "acceptance",
      name: "acceptance",
      tools: connected.tools,
      capabilities: connected.capabilities,
    });
    let session: EngineSession;
    session = await engineProvider(provider).open({
      process: worker,
      config: {
        provider,
        model: provider === "opencode" ? "deepseek/deepseek-flash" : null,
      },
      sessionId: null,
      mcp: {
        servers: [{ name: "acceptance", url: mounted.url }],
        inheritNative: false,
      },
      instructions:
        "Call the acceptance MCP echo tool once with empty arguments. Report its exact result. Use no other tools.",
      approve: async () => ({ allow: true }),
      emit: async (event) => {
        if (event.type === "message") replies.push(event.text);
        if (event.type === "approval")
          await session?.answer(event.approval.id, { allow: true });
      },
    });
    await session.ready?.();
    await worker.toolsReady();
    await session.prompt("Call acceptance echo and report its exact result.");
    expect(calls, replies.join("\n")).toBeGreaterThan(0);
    expect(replies.join("\n")).toContain(marker);
  },
  150_000,
);
