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
        "Send a complete message to the user immediately. Set kind to question when user input is needed. Deliver the final answer in your normal reply.",
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
                  : "Message delivered.",
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
        "Each complete reply reaches the user immediately. Use message_user for a complete update or a question while you work. Deliver the final result in your normal reply. Keep reasoning in the thinking channel. Write conversational replies in short, natural paragraphs. Use headings, lists, and tables when they help the user. Follow requests for detailed reports or structured documents.",
    ),
  ],
});
