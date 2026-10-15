import { Type } from "@earendil-works/pi-ai";
import {
  defineExtension,
  defineTool,
  section,
} from "@earendil-works/pi-durable";

export type MessageDelivery = { text: string };

export const messaging = defineExtension({
  name: "domos-messaging",
  tools: [
    defineTool({
      name: "message_user",
      description:
        "Send a complete message to the user while continuing the task. Use for brief acknowledgements, important updates, or questions. Deliver the final answer in your normal reply.",
      parameters: Type.Object({ message: Type.String({ minLength: 1 }) }),
      executionMode: "sequential",
      replay: "safe",
      async execute({ message }) {
        const text = message.trim();
        if (!text) throw new Error("Message is empty");
        return {
          output: [{ type: "text", text: "Message delivered." }],
          details: { delivery: { text } satisfies MessageDelivery },
        };
      },
    }),
  ],
  sections: [
    section(
      "messaging",
      () =>
        "Use message_user to acknowledge substantial work or share important progress before continuing. Send only useful complete messages, not a narration of each tool call. Keep reasoning in the thinking channel. Put the complete final answer in your normal reply; do not repeat delivered updates. Write conversational replies in short, natural paragraphs. Use headings, lists, and tables when they help the user. Follow requests for detailed reports or structured documents.",
    ),
  ],
});
