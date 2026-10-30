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
    const title = `Domos image probe ${crypto.randomUUID()}`;
    const browser = await chromium.launch({ headless: false });
    onTestFinished(() => browser.close());
    const page = await browser.newPage({
      viewport: { width: 800, height: 160 },
    });
    await page.setContent(
      `<title>${title}</title><body style="font:28px monospace">${imageMarker}</body>`,
    );
    const replies: string[] = [];
    const toolNames: string[] = [];
    let calls = 0;
    const memoryMarker = crypto.randomUUID();
    let saved = "";
    let searches = 0;
    const worker = new WorkProcess(
      [
        process.execPath,
        fileURLToPath(new URL("../src/harness/worker.mjs", import.meta.url)),
      ],
      { cwd: directory, home: directory },
      [
        ...(id === "claude" ? [permissionTool] : []),
        {
          name: "memory_save",
          description: "Save a lasting user profile fact.",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
        },
        {
          name: "memory_search",
          description: "Search saved memory and return its receipt marker.",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
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
                    allow: [
                      "mcp__domos__computer_probe",
                      "mcp__domos__memory_save",
                      "mcp__domos__memory_search",
                    ].includes(String(args.tool_name)),
                  }),
                ),
              },
            ],
          };
        if (name === "memory_save") {
          saved = String(args.text);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  id: "profile",
                  revision: 1,
                  text: saved,
                }),
              },
            ],
          };
        }
        if (name === "memory_search") {
          expect(saved).toMatch(/Chinese|中文/i);
          searches++;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ text: saved, marker: memoryMarker }),
              },
            ],
          };
        }
        expect(name).toBe("computer_probe");
        const listed = await worker.computer<{
          isError: boolean;
          structuredContent: {
            windows: { title: string; window_id: number; pid: number }[];
          };
        }>({
          operation: "call",
          service: "desktop",
          name: "list_windows",
          arguments: {},
        });
        expect(listed.isError).not.toBe(true);
        const target = listed.structuredContent.windows.find((window) =>
          window.title.includes(title),
        );
        expect(target).toBeTruthy();
        const observed = await worker.computer<ProductResult>({
          operation: "call",
          service: "desktop",
          name: "get_window_state",
          arguments: {
            pid: target?.pid,
            window_id: target?.window_id,
            include_screenshot: true,
          },
        });
        expect(
          observed.isError,
          JSON.stringify(
            observed.content.filter((part) => part.type === "text"),
          ),
        ).not.toBe(true);
        const images = observed.content.filter((part) => part.type === "image");
        expect(images).toHaveLength(1);
        calls++;
        return {
          content: images,
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
        ...(id === "codex" ? { options: { effort: "low" } } : {}),
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
        "Call computer_probe once. Then call memory_save with the fact 'User prefers Chinese replies', then memory_search with query 'Chinese'. Return the memory receipt marker and the exact text from the image, structured marker, coordinates and verified value. Use only these tools. Do not infer verification from tool success.",
      approve: async () => ({ allow: false }),
      emit: async (event) => {
        if (event.type === "message") replies.push(event.text);
        if (event.type === "tool") toolNames.push(event.name);
        if (event.type === "approval")
          await session?.answer(event.approval.id, {
            allow: /computer_probe|memory_save|memory_search/.test(
              event.approval.detail,
            ),
          });
      },
    });
    await session.ready?.();
    await worker.toolsReady();
    await session.prompt(
      "Read computer_probe, save my Chinese response preference, then search it. Report the memory receipt marker, image text, marker, x, y, coordinate space and verified value.",
    );
    const answer = replies.join("\n");
    expect(calls, answer).toBe(1);
    if (id === "pi") {
      expect(toolNames).toContain("mcp__domos__computer_probe");
      expect(toolNames).not.toContain("codemode");
    }
    expect(searches, answer).toBeGreaterThanOrEqual(1);
    for (const value of [
      imageMarker,
      memoryMarker,
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
