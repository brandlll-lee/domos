import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "vitest";
import { runtimeFixture } from "./fixtures/runtime.ts";

test("a durable submission sends stored image bytes and preserves attachment metadata", async () => {
  const runtime = await runtimeFixture();
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  const id = runtime.conversation.id;
  const file = await runtime.files.upload(id, "screen.png", bytes, context);
  runtime.faux.setResponses([
    (input) => {
      const message = input.messages.find((message) => message.role === "user");
      expect(message?.content).toContainEqual({
        type: "image",
        data: bytes.toString("base64"),
        mimeType: "image/png",
      });
      return fauxAssistantMessage("Seen");
    },
  ]);
  const submission = await runtime.engines.submit(
    id,
    { text: "Describe", requestId: crypto.randomUUID(), attachments: [file] },
    context,
  );
  expect((await submission.wait(context)).status).toBe("done");
  expect(
    (await runtime.engines.view(id, context)).messages[0]?.attachments,
  ).toMatchObject([{ id: file.id, name: "screen.png" }]);
});

test("published files use the shared delivery tool and survive reopening", async () => {
  const runtime = await runtimeFixture();
  const extension = runtime.files.extension();
  runtime.registry.install(extension);
  await runtime.conversation.configure(
    { extensions: runtime.registry.snapshot().installed() },
    context,
  );
  const id = runtime.conversation.id;
  const file = await runtime.files.upload(
    id,
    "report.txt",
    Buffer.from("Report contents"),
    context,
  );
  runtime.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("attach_file", { id: file.id }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("Published"),
  ]);
  const submission = await runtime.engines.submit(
    id,
    { text: "Publish", requestId: crypto.randomUUID() },
    context,
  );
  expect((await submission.wait(context)).status).toBe("done");
  const reopened = await runtime.reopen();
  expect(
    (await reopened.engines.view(id, context)).messages.find((message) =>
      message.attachments?.some((item) => item.id === file.id),
    ),
  ).toBeDefined();
  expect(await (await reopened.files.download(id, file.id)).text()).toBe(
    "Report contents",
  );
});
