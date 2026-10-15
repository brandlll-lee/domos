import type { Context } from "@earendil-works/chord/context";
import {
  getCurrentSystemMessage,
  getCurrentSystemPrompt,
  getCurrentTools,
} from "@earendil-works/pi-ai/utils/transcript";
import type { Conversation } from "@earendil-works/pi-durable";

export async function actualPrompt(
  conversation: Conversation,
  context: Context,
) {
  const view = await conversation.context(context);
  const system = getCurrentSystemMessage(view.messages);
  return {
    text: getCurrentSystemPrompt(view.messages),
    sections: system?.sections ?? {},
    tools: getCurrentTools(view.messages).map((tool) => tool.name),
    prepared: system !== undefined,
  };
}
