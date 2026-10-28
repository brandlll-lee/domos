import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createRegistry,
  defineExtension,
  defineTool,
} from "@earendil-works/pi-durable";
import { expect, onTestFinished, test } from "vitest";
import { openAgent } from "../src/open-agent.ts";
import { png } from "./fixtures/png.ts";

test("Pi normalizes user and tool images, preserves evidence, and applies new model limits after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-model-images-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "agent.sqlite");
  const original = {
    type: "image" as const,
    data: png(2700, 1800).toString("base64"),
    mimeType: "image/png",
  };
  const broken = { ...original, data: "broken" };
  const faux = fauxProvider({
    models: [
      {
        id: "vision",
        input: ["text", "image"],
        inputLimits: {
          images: {
            resize: { maxWidth: 600, maxHeight: 400, maxBytes: 40_000 },
          },
        },
      },
      {
        id: "compact",
        input: ["text", "image"],
        inputLimits: {
          images: {
            resize: { maxWidth: 300, maxHeight: 200, maxBytes: 40_000 },
          },
        },
      },
    ],
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  let calls = 0;
  registry.install(
    defineExtension({
      name: "screenshots",
      tools: [
        defineTool({
          name: "screen",
          description: "Observe the fixture",
          parameters: Type.Object({}),
          execute: async () => {
            calls++;
            return {
              output: [{ type: "text", text: "Delivered" }, original, broken],
              details: { original },
              isError: true,
            };
          },
        }),
      ],
    }),
  );
  const context = BACKGROUND_CONTEXT;
  const options = { models, registry };
  const agent = { model: { provider: "faux", modelId: "vision" } };
  let runtime = await openAgent(file, options, agent, context);
  const check = (
    messages: readonly { role: string; content: unknown }[],
    width: number,
  ) => {
    for (const message of messages) {
      if (!Array.isArray(message.content)) continue;
      const parts = message.content;
      for (const part of parts)
        if (part.type === "image" && part.data !== "broken") {
          const bytes = Buffer.from(part.data, "base64");
          expect(bytes.readUInt32BE(16)).toBe(width);
          expect(part.data.length).toBeLessThanOrEqual(40_000);
        }
    }
  };
  try {
    faux.setResponses([
      async (input) => {
        check(input.messages, 600);
        return fauxAssistantMessage([fauxToolCall("screen", {})], {
          stopReason: "toolUse",
        });
      },
      async (input) => {
        check(input.messages, 600);
        const result = input.messages.findLast(
          (message) => message.role === "toolResult",
        );
        expect(result).toMatchObject({ isError: true });
        expect(result?.content).toContainEqual(broken);
        expect(JSON.stringify(result?.content)).toContain("2700x1800");
        return fauxAssistantMessage([fauxToolCall("screen", {})], {
          stopReason: "toolUse",
        });
      },
      async (input) => {
        const images = input.messages.flatMap((message) =>
          Array.isArray(message.content)
            ? message.content.filter((part) => part.type === "image")
            : [],
        );
        expect(images).toHaveLength(3);
        expect(JSON.stringify(input.messages)).toContain("Earlier tool image");
        return fauxAssistantMessage("Observed");
      },
    ]);
    const outcome = await (
      await runtime.conversation.submit(
        { type: "input", content: [original] },
        context,
      )
    ).wait(context);
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ status: "done" });
    const response = await runtime.conversation.context(context);
    expect(
      response.messages
        .filter((message) => message.role === "assistant")
        .map((message) => message.errorMessage)
        .filter(Boolean),
    ).toEqual([]);
    expect(calls).toBe(2);
    const state = await runtime.conversation.viewState(context);
    try {
      expect(JSON.stringify(state.value.entries)).toContain(original.data);
    } finally {
      state.dispose();
    }
    await runtime.harness.close(context);
    runtime = await openAgent(file, options, agent, context);
    await runtime.conversation.configure(
      { model: { provider: "faux", modelId: "compact" } },
      context,
    );
    faux.setResponses([
      async (input) => {
        check(input.messages, 300);
        return fauxAssistantMessage("Recovered");
      },
    ]);
    await (
      await runtime.conversation.submit(
        { type: "input", content: "Continue" },
        context,
      )
    ).wait(context);
    expect(calls).toBe(2);
    const history = await runtime.conversation.context(context);
    const tool = history.messages.find(
      (message) => message.role === "toolResult",
    );
    expect(tool?.content).toContainEqual(original);
    expect(tool?.content).toContainEqual(broken);
  } finally {
    await runtime.harness.close(context);
  }
});
