import type { InputMaterials } from "@domos/agent/materials";
import { messageText } from "@domos/agent/messages";
import type { ChatView } from "@domos/agent/view";
import type { BotWork } from "@domos/agent/work";
import { WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

export const materialsSchema = {
  skills: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        revision: z.number().int().nonnegative(),
      }),
    )
    .max(10)
    .default([]),
  context: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          id: z.uuid(),
          type: z.literal("text"),
          text: z.string().trim().min(1).max(WORK_TEXT_LENGTH),
        }),
        z.object({
          id: z.uuid(),
          type: z.literal("message"),
          messageId: z.string().min(1).max(128),
        }),
      ]),
    )
    .max(10)
    .default([]),
};

export async function prepareMaterials(
  input: {
    botId: number;
    requestId: string;
    skills: z.infer<typeof materialsSchema.skills>;
    context: z.infer<typeof materialsSchema.context>;
  },
  view: ChatView,
  work: BotWork,
): Promise<InputMaterials> {
  const existing = view.messages.find(
    (message) => message.requestId === input.requestId,
  );
  if (existing) return existing.materials ?? { skills: [], context: [] };
  const skills = input.skills.length
    ? await work.skills.list(BACKGROUND_CONTEXT)
    : [];
  return {
    skills: [
      ...new Map(
        input.skills.map((selection) => [selection.id, selection]),
      ).values(),
    ].map(({ id, revision }) => {
      const skill = skills.find(
        (item) => item.id === id && item.enabledBots.includes(input.botId),
      );
      if (!skill)
        throw new ORPCError("NOT_FOUND", {
          message: "技能已删除或未为此 Bot 启用。",
        });
      if (skill.revision !== revision)
        throw new ORPCError("CONFLICT", {
          message: `技能 ${skill.name} 已更新，请重新选择。`,
        });
      return { id, revision, name: skill.name, content: skill.content };
    }),
    context: [
      ...new Map(input.context.map((item) => [item.id, item])).values(),
    ].map((item) => {
      if (item.type === "text") return { ...item, botId: input.botId };
      const message = view.messages.find(
        (message) =>
          message.id === item.messageId &&
          !message.pending &&
          (message.role === "user" || message.role === "assistant"),
      );
      if (!message || !messageText(message).trim())
        throw new ORPCError("NOT_FOUND", {
          message: "引用消息不存在或尚未完成。",
        });
      const text = messageText(message);
      if (text.length > WORK_TEXT_LENGTH)
        throw new ORPCError("BAD_REQUEST", {
          message: "引用消息过长。请改用粘贴文本，选择需要的内容。",
        });
      return {
        ...item,
        botId: input.botId,
        text,
        role: message.role as "user" | "assistant",
        ...(message.timestamp ? { timestamp: message.timestamp } : {}),
      };
    }),
  };
}
