import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { expect, onTestFinished, test } from "vitest";
import { WorkProcess } from "../src/harness/process.ts";
import { permissionTool } from "../src/harness/product-tools.ts";
import { claudePermission } from "../src/harness/providers/claude-approval.ts";
import { engineProvider } from "../src/harness/providers/index.ts";
import type { EngineSession, ProductResult } from "../src/harness/types.ts";

test
  .skipIf(process.env.DOMOS_NATIVE_SMOKE !== "1")
  .each(["pi", "codex", "claude", "opencode", "acp"])(
  "%s reads tool images, coordinates and verified results",
  async (id) => {
    const directory = await mkdtemp(join(tmpdir(), "domos-native-smoke-"));
    const imageMarker = crypto.randomUUID();
    const marker = crypto.randomUUID();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 800, height: 160 },
    });
    await page.setContent(
      `<body style="font:28px monospace">${imageMarker}</body>`,
    );
    const image = (await page.screenshot()).toString("base64");
    await browser.close();
    const replies: string[] = [];
    let calls = 0;
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
          description: "Read the work computer observation.",
          inputSchema: { type: "object", properties: {} },
          outputSchema: {
            type: "object",
            required: ["marker", "verified", "coordinates"],
            properties: {
              marker: { type: "string" },
              verified: { type: "boolean" },
              coordinates: { type: "object" },
            },
          },
          annotations: { readOnlyHint: true },
        },
      ],
      async (_callId, name, args) => {
        if (name === "approve")
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  claudePermission(args, {
                    allow: args.tool_name === "mcp__domos__computer_probe",
                  }),
                ),
              },
            ],
          };
        expect(name).toBe("computer_probe");
        const result = await worker.computer<ProductResult>({
          operation: "call",
          service: "desktop",
          name: "list_windows",
          arguments: {},
        });
        expect(result.isError).not.toBe(true);
        calls++;
        return {
          content: [{ type: "image", data: image, mimeType: "image/png" }],
          structuredContent: {
            marker,
            verified: false,
            coordinates: { x: 37, y: 91, space: "screenshot" },
          },
        };
      },
    );
    onTestFinished(async () => {
      await worker.close();
      await rm(directory, { recursive: true, force: true, maxRetries: 10 });
    });
    let session: EngineSession;
    session = await engineProvider(id).open({
      process: worker,
      config: {
        provider: id,
        model:
          process.env[`DOMOS_NATIVE_${id.toUpperCase()}_MODEL`] ??
          (id === "opencode" || id === "acp"
            ? "deepseek/deepseek-flash"
            : null),
        ...(id === "acp"
          ? {
              command: "opencode",
              args: ["acp"],
            }
          : {}),
      },
      sessionId: null,
      ...(id === "acp"
        ? {
            env: {
              OPENCODE_CONFIG_CONTENT: JSON.stringify({
                model:
                  process.env.DOMOS_NATIVE_ACP_MODEL ??
                  "deepseek/deepseek-flash",
              }),
            },
          }
        : {}),
      instructions:
        "Call computer_probe once. Return the exact text from its image, its structured marker, coordinates and verified value. Do not use other tools. Do not infer verification from tool success.",
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
      "Read computer_probe. Report the image text, marker, x, y, coordinate space and verified value.",
    );
    const answer = replies.join("\n");
    expect(calls, answer).toBe(1);
    for (const value of [
      imageMarker,
      marker,
      "37",
      "91",
      "screenshot",
      "false",
    ])
      expect(answer).toContain(value);
  },
  150_000,
);
