import type { Bots } from "@domos/agent/bots";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

export const botTarget = z.object({ botId: z.number().int().nonnegative() });
const cursor = z
  .string()
  .regex(/^\d+:\d+$/)
  .optional();
export const chatPage = z.object({
  before: cursor,
  after: cursor,
  around: cursor,
});
export const singleChatPage = (page: z.infer<typeof chatPage>) =>
  [page.before, page.after, page.around].filter(Boolean).length <= 1;

export async function botConversation(bots: Bots, botId: number) {
  const conversation = await bots.conversation(botId, BACKGROUND_CONTEXT);
  if (!conversation) throw new ORPCError("NOT_FOUND");
  return conversation;
}
