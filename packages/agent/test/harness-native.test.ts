import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, onTestFinished, test } from "vitest";
import { WorkProcess } from "../src/harness/process.ts";
import { permissionTool } from "../src/harness/product-tools.ts";
import { claudePermission } from "../src/harness/providers/claude-approval.ts";
import { engineProvider } from "../src/harness/providers/index.ts";
import type { EngineSession, ProductResult } from "../src/harness/types.ts";

test
  .skipIf(process.env.DOMOS_NATIVE_SMOKE !== "1")
  .each(["pi", "codex", "claude", "opencode"])(
  "%s discovers and calls a Domos tool on this work computer",
  async (id) => {
    const directory = await mkdtemp(join(tmpdir(), "domos-native-smoke-"));
    const worker = new WorkProcess(
      [
        process.execPath,
        fileURLToPath(new URL("../src/harness/worker.mjs", import.meta.url)),
      ],
      { cwd: directory, home: directory },
      [
        ...(id === "claude" ? [permissionTool] : []),
        {
          name: "computer_probe",
          description: "Read the Domos work computer status.",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      async (_callId, name, args) => {
        if (name === "approve") {
          const result = claudePermission(args, {
            allow: args.tool_name === "mcp__domos__computer_probe",
          });
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }
        expect(name).toBe("computer_probe");
        const result = await worker.computer<ProductResult>({
          operation: "call",
          service: "desktop",
          name: "list_windows",
          arguments: {},
        });
        expect(result.isError).not.toBe(true);
        calls++;
        return { content: [{ type: "text", text: marker }] };
      },
    );
    onTestFinished(async () => {
      await worker.close();
      await rm(directory, { recursive: true, force: true, maxRetries: 10 });
    });
    const replies: string[] = [];
    const marker = `DOMOS_${crypto.randomUUID()}`;
    let calls = 0;
    let session: EngineSession | undefined;
    session = await engineProvider(id).open({
      process: worker,
      config: {
        provider: id,
        model: process.env[`DOMOS_NATIVE_${id.toUpperCase()}_MODEL`] ?? null,
      },
      sessionId: null,
      instructions:
        "Call the Domos computer_probe tool once. Reply with its returned text. Do not change files or operate the desktop.",
      approve: async () => ({ allow: false }),
      emit: async (event) => {
        if (event.type === "message") replies.push(event.text);
        if (event.type === "approval")
          await session?.answer(event.approval.id, {
            allow: event.approval.detail.includes("computer_probe"),
          });
      },
    });
    await session.ready?.();
    await worker.toolsReady();
    await session.prompt(
      "Read the work computer status with computer_probe. Return its text.",
    );
    expect(calls, replies.join("\n")).toBe(1);
    expect(replies.join("\n")).toContain(marker);
  },
  90_000,
);
