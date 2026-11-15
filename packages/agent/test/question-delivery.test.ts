import { createRegistry, type TaskId } from "@earendil-works/pi-durable";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { expect, test } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import { ComputerRuntime, QuestionDoc } from "../src/computer/runtime.ts";
import { EngineExecution } from "../src/harness/execution.ts";
import { openGateway } from "../src/harness/gateway.mjs";
import { interactionExtension } from "../src/harness/interactions.ts";
import { context, setup } from "./fixtures/work.ts";

test.each([false, true])(
  "questions retain identity and answer state across gateway and storage restarts (allow=%s)",
  async (allow) => {
    const fixture = await setup();
    let runtime = await fixture.open();
    const execution = new EngineExecution({} as Computers);
    const bind = () => {
      execution.computer = new ComputerRuntime(
        runtime.harness,
        createRegistry(),
        {} as Computers,
        runtime.files,
      );
    };
    bind();
    const tool = interactionExtension(execution).tools[2];
    const botId = runtime.conversation.id;
    const callIds: string[] = [];
    const input = {
      title: "原问题",
      questions: [
        {
          id: "source",
          title: "来源？",
          options: [{ id: "package", label: "包装" }],
        },
      ],
    };
    const api = (taskId: number, callId: string) =>
      ({
        conversationId: botId,
        taskId: taskId as TaskId,
        callId,
      }) as Parameters<typeof tool.execute>[1];
    async function send(taskId: number, title: string) {
      const gateway = await openGateway(
        [
          {
            name: "approve",
            description: "Approve",
            inputSchema: { type: "object" },
          },
          {
            name: tool.name,
            description: tool.description,
            inputSchema: { ...tool.parameters },
          },
        ],
        async (callId, name, args) => {
          if (name === "approve") return { content: [] };
          callIds.push(callId);
          const result = await tool.execute(
            args as typeof input,
            api(taskId, callId),
            context,
          );
          return { content: result.output ?? [] };
        },
      );
      const client = new Client({ name: "test", version: "1" });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(gateway.url)),
        );
        await client.listTools();
        await client.callTool({ name: "approve", arguments: {} });
        const result = CallToolResultSchema.parse(
          await client.callTool({
            name: tool.name,
            arguments: { ...input, title },
          }),
        );
        const content = result.content[0];
        if (content?.type !== "text") throw new Error("题卡回执缺少文本。");
        return JSON.parse(content.text) as {
          status: string;
          questionId: string;
        };
      } finally {
        await client.close();
        await gateway.close();
      }
    }
    try {
      const first = await send(101, input.title);
      const retryApi = api(101, "2:3");
      expect(await tool.execute(input, retryApi, context)).toEqual({
        output: [{ type: "text", text: JSON.stringify(first) }],
      });
      const answer = {
        allow,
        ...(allow ? { answers: { source: ["package"] } } : {}),
      };
      await runtime.harness.commit(async (tx) => {
        (await tx.doc(QuestionDoc, botId, first.questionId, null)).answer =
          answer;
      }, context);
      await runtime.harness.close(context);
      runtime = await fixture.open();
      bind();
      expect(await tool.execute(input, retryApi, context)).toEqual({
        output: [
          {
            type: "text",
            text: JSON.stringify({
              status: allow ? "answered" : "cancelled",
              questionId: first.questionId,
              ...(allow ? { answers: answer.answers } : {}),
            }),
          },
        ],
      });
      await expect(
        tool.execute({ ...input, title: "不同问题" }, retryApi, context),
      ).rejects.toThrow("问题请求标识重复");
      const second = await send(202, "新问题");
      expect(callIds).toEqual(["2:3", "2:3"]);
      expect(second.status).toBe("sent");
      expect(second.questionId).not.toBe(first.questionId);
      const entries = await runtime.conversation.entries(
        {},
        100,
        undefined,
        context,
      );
      const cards = entries.items.filter(
        (entry) => (entry.data as { approval?: unknown })?.approval,
      );
      expect(cards).toHaveLength(2);
      const saved = await runtime.harness.snapshot(
        QuestionDoc,
        botId,
        second.questionId,
        context,
      );
      expect(saved?.request?.title).toBe("新问题");
      expect(saved?.answer).toBeUndefined();
    } finally {
      await runtime.harness.close(context);
    }
  },
);
