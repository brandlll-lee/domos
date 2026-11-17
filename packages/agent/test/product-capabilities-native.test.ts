import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, onTestFinished, test } from "vitest";
import type { EngineExecution } from "../src/harness/execution.ts";
import { interactionExtension } from "../src/harness/interactions.ts";
import { WorkProcess } from "../src/harness/process.ts";
import { productInstructions } from "../src/harness/product-guidance.mjs";
import { permissionTool } from "../src/harness/product-tools.ts";
import { claudePermission } from "../src/harness/providers/claude-approval.ts";
import { engineProvider } from "../src/harness/providers/index.ts";
import type { EngineSession } from "../src/harness/types.ts";

test
  .skipIf(process.env.DOMOS_NATIVE_PRODUCT !== "1")
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
  "%s selects product capabilities from user intent",
  async (id) => {
    const directory = await mkdtemp(join(tmpdir(), "domos-product-eval-"));
    const tools = interactionExtension({} as EngineExecution).tools.map(
      (tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: JSON.parse(JSON.stringify(tool.parameters)) as Record<
          string,
          unknown
        >,
      }),
    );
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const replies: string[] = [];
    let rounds = 0;
    const worker = new WorkProcess(
      [
        process.execPath,
        fileURLToPath(new URL("../src/harness/worker.mjs", import.meta.url)),
      ],
      { cwd: directory, home: directory },
      [...tools, ...(id === "claude" ? [permissionTool] : [])],
      async (_callId, name, args) => {
        if (name === "approve")
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  claudePermission(args, {
                    allow: tools.some((tool) =>
                      String(args.tool_name).endsWith(`__${tool.name}`),
                    ),
                  }),
                ),
              },
            ],
          };
        calls.push({ name, args });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                name === "ask_question"
                  ? { status: "answered", answers: { format: ["summary"] } }
                  : name === "review_draft"
                    ? { status: "confirmed", body: "Reviewed draft" }
                    : name === "request_credentials"
                      ? { status: "configured" }
                      : { status: "sent", messageId: "fixture-card" },
              ),
            },
          ],
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
        model: process.env[`DOMOS_NATIVE_${id.toUpperCase()}_MODEL`] ?? null,
        ...(id === "codex" ? { options: { effort: "low" } } : {}),
      },
      sessionId: null,
      instructions: `${productInstructions(tools)}\nThis is a controlled product-selection test. Use no shell, browser or file tools. Product results are test fixtures. Do not perform external actions.`,
      approve: async () => ({ allow: false }),
      emit: async (event) => {
        if (event.type === "message") {
          replies.push(event.text);
          rounds++;
        }
        if (event.type === "approval")
          await session.answer(event.approval.id, {
            allow:
              /ask_question|send_link_card|review_draft|request_credentials/.test(
                event.approval.detail,
              ),
          });
      },
    });
    await session.ready?.();
    await worker.toolsReady();
    const cases = [
      {
        prompt:
          "我想让你写报告，但我还没决定要简短结论还是完整报告。现在请让我选一下这两种交付形式。",
        tool: "ask_question",
      },
      {
        prompt:
          "把 https://example.com/report 发给我，我接下来要打开这份报告。",
        tool: "send_link_card",
      },
      {
        prompt:
          "我准备发一条公告：周五下午三点发布。先把实际草稿交给我审阅修改，等我确认。现在不要发布。",
        tool: "review_draft",
      },
      {
        prompt:
          "我要配置工作区现有的 Notes 应用连接，但还没有登录。请先让我完成安全配置。",
        tool: "request_credentials",
      },
      { prompt: "只回答：2 加 2 等于几？", tool: null },
    ];
    const evidence = [];
    for (const item of cases) {
      const start = performance.now();
      const before = calls.length;
      const beforeRounds = rounds;
      await session.prompt(item.prompt);
      const used = calls.slice(before);
      evidence.push({
        expected: item.tool,
        tools: used.map((call) => call.name),
        elapsedMs: Math.round(performance.now() - start),
        assistantMessages: rounds - beforeRounds,
      });
      await mkdir("test-results", { recursive: true });
      await writeFile(
        `test-results/product-capabilities-${id}.json`,
        JSON.stringify(
          {
            harness: id,
            coverage: "real native model selection; fixture tool results",
            modelRoundTrips: null,
            cases: evidence,
          },
          null,
          2,
        ),
      );
      if (item.tool)
        expect(
          used.map((call) => call.name),
          replies.join("\n"),
        ).toContain(item.tool);
      else expect(used, replies.join("\n")).toHaveLength(0);
    }
  },
  240_000,
);
