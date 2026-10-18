import { Type } from "@earendil-works/pi-ai";
import {
  defineExtension,
  defineTool,
  section,
} from "@earendil-works/pi-durable";

export type MessageDelivery = { text: string; kind?: "update" | "question" };

export const messaging = defineExtension({
  name: "domos-messaging",
  tools: [
    defineTool({
      name: "message_user",
      description:
        "Send a complete message. Updates arrive with the completed task. Set kind to question when user input is needed immediately. Deliver the final answer in your normal reply.",
      parameters: Type.Object({
        message: Type.String({ minLength: 1 }),
        kind: Type.Optional(
          Type.Union([Type.Literal("update"), Type.Literal("question")]),
        ),
      }),
      executionMode: "sequential",
      replay: "safe",
      async execute({ message, kind }) {
        const text = message.trim();
        if (!text) throw new Error("Message is empty");
        return {
          output: [
            {
              type: "text",
              text:
                kind === "question"
                  ? "Question delivered."
                  : "Message queued for task completion.",
            },
          ],
          details: {
            delivery: {
              text,
              ...(kind ? { kind } : {}),
            } satisfies MessageDelivery,
          },
        };
      },
    }),
  ],
  sections: [
    section(
      "messaging",
      () =>
        "Deliver the complete result in your final reply after finishing the task. The user sees live tool activity while you work. Use message_user with kind question when you need an immediate answer from the user. Other messages wait for task completion. Keep reasoning in the thinking channel. Write conversational replies in short, natural paragraphs. Use headings, lists, and tables when they help the user. Follow requests for detailed reports or structured documents.",
    ),
  ],
});
