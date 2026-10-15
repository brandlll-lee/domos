import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
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
import { chatView } from "../src/chat-view.ts";
import { openAgent } from "../src/open-agent.ts";
import { chatTranscript } from "../src/transcript.ts";

test("complete messages persist during work, stay distinct from narration, and survive restart once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-delivery-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const database = join(directory, "agent.sqlite");
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  const name = `work_${crypto.randomUUID().replaceAll("-", "")}`;
  const work = fauxToolCall(name, {});
  const gate = Promise.withResolvers<void>();
  registry.install(
    defineExtension({
      name: "work",
      tools: [
        defineTool({
          name,
          description: "Wait for work completion.",
          parameters: Type.Object({}),
          replay: "safe",
          async execute(_args, _api, ctx) {
            const release = () => gate.resolve();
            ctx.abortSignal?.addEventListener("abort", release, { once: true });
            try {
              await gate.promise;
            } finally {
              ctx.abortSignal?.removeEventListener("abort", release);
            }
            return { output: [{ type: "text", text: "Ready" }] };
          },
        }),
      ],
    }),
  );
  faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall("message_user", { message: "I will check the source." })],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      [fauxToolCall("message_user", { message: "The source is available." })],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      [{ type: "text", text: "Internal tool narration" }, work],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("Complete result"),
  ]);
  const options = { models, registry };
  const agent = { model: { provider: "faux", modelId: "faux-1" } };
  const first = await openAgent(database, options, agent, context);
  const state = await first.conversation.viewState(context);
  let avatar: string | undefined;
  const delivered = () =>
    chatTranscript(chatView(state.value)).flatMap((item) =>
      item.kind === "message" && item.message.role === "assistant"
        ? item.message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
        : [],
    );
  try {
    avatar = (await first.bots.list(context))[0]?.avatar;
    await first.conversation.submit(
      { type: "input", content: "Check" },
      context,
    );
    await expect
      .poll(delivered)
      .toEqual(["I will check the source.", "The source is available."]);
    await expect
      .poll(() =>
        chatView(state.value).tools.some(
          (tool) => tool.callId === work.id && tool.status === "running",
        ),
      )
      .toBe(true);
    expect(chatView(state.value).busy).toBe(true);
    expect(delivered()).toEqual([
      "I will check the source.",
      "The source is available.",
    ]);
  } finally {
    state.dispose();
    await first.harness.close(context);
  }
  const second = await openAgent(database, options, agent, context);
  try {
    await second.conversation.waitForIdle(context);
    const restored = await second.conversation.viewState(context);
    try {
      const items = chatTranscript(chatView(restored.value));
      const texts = items.flatMap((item) =>
        item.kind === "message" && item.message.role === "assistant"
          ? item.message.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
          : [],
      );
      expect(texts).toEqual([
        "I will check the source.",
        "The source is available.",
        "Complete result",
      ]);
      expect(new Set(items.map((item) => `${item.kind}:${item.id}`)).size).toBe(
        items.length,
      );
      expect((await second.bots.list(context))[0]?.avatar).toBe(avatar);
    } finally {
      restored.dispose();
    }
  } finally {
    await second.harness.close(context);
  }
});

test("an invalid user message stays a failed tool step", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-delivery-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("message_user", { message: "   " })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("Please provide your request."),
  ]);
  const runtime = await openAgent(
    join(directory, "agent.sqlite"),
    { models, registry: createRegistry() },
    { model: { provider: "faux", modelId: "faux-1" } },
    context,
  );
  try {
    await runtime.conversation.submit(
      { type: "input", content: "Hello" },
      context,
    );
    await runtime.conversation.waitForIdle(context);
    const state = await runtime.conversation.viewState(context);
    try {
      const items = chatTranscript(chatView(state.value));
      expect(items.filter((item) => item.kind === "message")).toHaveLength(2);
      expect(items.find((item) => item.kind === "activity")).toMatchObject({
        status: "failed",
        steps: [{ type: "tool", status: "failed" }],
      });
    } finally {
      state.dispose();
    }
  } finally {
    await runtime.harness.close(context);
  }
});
