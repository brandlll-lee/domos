import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { expect, test } from "vitest";
import { runtimeFixture } from "./fixtures/runtime.ts";

test.each(["steer", "followUp"] as const)(
  "Durable %s accepts additional inputs during a tool round",
  async (mode) => {
    const runtime = await runtimeFixture();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const extension = defineExtension({
      name: "gated-tool",
      tools: [
        defineTool({
          name: "wait",
          parameters: Type.Object({}),
          description: "Wait",
          async execute() {
            entered.resolve();
            await release.promise;
            return { output: [{ type: "text", text: "Released" }] };
          },
        }),
      ],
    });
    runtime.registry.install(extension);
    await runtime.conversation.configure(
      { extensions: runtime.registry.snapshot().installed() },
      context,
    );
    runtime.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("Done"),
      fauxAssistantMessage("Follow up done"),
    ]);
    const first = await runtime.engines.submit(
      runtime.conversation.id,
      { text: "First", requestId: crypto.randomUUID() },
      context,
    );
    await entered.promise;
    const input = {
      text: "Additional",
      requestId: crypto.randomUUID(),
      ...(mode === "followUp" ? { whenBusy: mode } : {}),
    };
    const second = await runtime.engines.submit(
      runtime.conversation.id,
      input,
      context,
    );
    expect(
      (await runtime.engines.submit(runtime.conversation.id, input, context))
        .id,
    ).toBe(second.id);
    release.resolve();
    expect((await first.wait(context)).status).toBe("done");
    expect((await second.wait(context)).status).toBe("done");
    const messages = (await runtime.conversation.context(context)).messages;
    expect(JSON.stringify(messages)).toContain("Additional");
    expect(
      (await runtime.engines.view(runtime.conversation.id, context)).busy,
    ).toBe(false);
  },
);

test("stop cancels the active tool and settles queued inputs", async () => {
  const runtime = await runtimeFixture();
  const entered = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  const extension = defineExtension({
    name: "cancel-tool",
    tools: [
      defineTool({
        name: "wait",
        parameters: Type.Object({}),
        description: "Wait",
        async execute(_args, _api, ctx) {
          entered.resolve();
          await new Promise<void>((resolve) =>
            ctx.abortSignal?.addEventListener(
              "abort",
              () => {
                aborted.resolve();
                resolve();
              },
              { once: true },
            ),
          );
          return { output: [] };
        },
      }),
    ],
  });
  runtime.registry.install(extension);
  await runtime.conversation.configure(
    { extensions: runtime.registry.snapshot().installed() },
    context,
  );
  runtime.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
  ]);
  const first = await runtime.engines.submit(
    runtime.conversation.id,
    { text: "First", requestId: crypto.randomUUID() },
    context,
  );
  await entered.promise;
  const second = await runtime.engines.submit(
    runtime.conversation.id,
    { text: "Queued", requestId: crypto.randomUUID(), whenBusy: "followUp" },
    context,
  );
  await runtime.engines.stop(runtime.conversation.id, context);
  await aborted.promise;
  expect((await first.wait(context)).status).toBe("unanswered");
  expect((await second.wait(context)).status).toBe("unanswered");
  expect(
    (await runtime.engines.view(runtime.conversation.id, context)).busy,
  ).toBe(false);
});
