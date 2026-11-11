import type { Bot } from "@domos/agent/bots";
import { type InputMaterials, MAX_MATERIALS } from "@domos/agent/materials";
import type { McpConnections } from "@domos/agent/mcp";
import { messageText } from "@domos/agent/messages";
import type { ChatView } from "@domos/agent/view";
import type { BotWork } from "@domos/agent/work";
import { WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

export const materialsSchema = {
  bots: z
    .array(
      z.object({
        id: z.string().min(1),
        botId: z.number().int().nonnegative(),
        position: z.number().int().nonnegative(),
      }),
    )
    .max(MAX_MATERIALS)
    .default([]),
  mcp: z
    .array(
      z.object({
        id: z.string().min(1),
        native: z
          .object({ provider: z.string().min(1), source: z.string() })
          .optional(),
        available: z.boolean().optional(),
        status: z.string().optional(),
        position: z.number().int().nonnegative().optional(),
      }),
    )
    .max(MAX_MATERIALS)
    .default([]),
  skills: z
    .array(
      z.object({
        id: z.string().min(1),
        revision: z.number().int().nonnegative().optional(),
        native: z
          .object({
            provider: z.string().min(1),
            name: z.string().min(1),
            path: z.string().min(1),
            source: z.string(),
          })
          .optional(),
        position: z.number().int().nonnegative().optional(),
      }),
    )
    .max(MAX_MATERIALS)
    .default([]),
  context: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          id: z.uuid(),
          type: z.literal("text"),
          text: z.string().trim().min(1).max(WORK_TEXT_LENGTH),
          position: z.number().int().nonnegative().optional(),
        }),
        z.object({
          id: z.uuid(),
          type: z.literal("message"),
          messageId: z.string().min(1).max(128),
          position: z.number().int().nonnegative().optional(),
        }),
      ]),
    )
    .max(MAX_MATERIALS)
    .default([]),
};

export function botReferences(
  selections: z.infer<typeof materialsSchema.bots>,
  bots: Pick<Bot, "id" | "name" | "avatar">[],
) {
  return selections.map((selection) => {
    const bot = bots.find((bot) => bot.id === selection.botId);
    if (!bot)
      throw new ORPCError("BAD_REQUEST", { message: "引用的 Bot 不可用。" });
    return { ...selection, name: bot.name, avatar: bot.avatar };
  });
}

export async function prepareMaterials(
  input: {
    botId: number;
    requestId: string;
    skills: z.infer<typeof materialsSchema.skills>;
    context: z.infer<typeof materialsSchema.context>;
    mcp: z.infer<typeof materialsSchema.mcp>;
  },
  view: Pick<ChatView, "messages">,
  work: BotWork,
  connections?: McpConnections,
): Promise<InputMaterials> {
  const existing = view.messages.find(
    (message) => message.requestId === input.requestId,
  );
  if (existing) return existing.materials ?? { skills: [], context: [] };
  const skills = input.skills.length
    ? await work.skills.list(BACKGROUND_CONTEXT)
    : [];
  const catalog =
    input.skills.some((skill) => skill.native) ||
    input.mcp.some((item) => item.native)
      ? await work.read(input.botId, BACKGROUND_CONTEXT)
      : undefined;
  const managed =
    input.mcp.length && connections
      ? await connections.list(BACKGROUND_CONTEXT)
      : [];
  return {
    ...(input.mcp.length
      ? {
          mcp: input.mcp.map((selection) => {
            if (selection.native) {
              return {
                ...selection,
                name: selection.id,
                available: Boolean(
                  selection.available &&
                    catalog?.nativeSkillsProvider === selection.native.provider,
                ),
                status: selection.status ?? "unknown",
              };
            }
            const item = managed.find((item) => item.id === selection.id);
            return {
              ...selection,
              name: item?.name ?? selection.id,
              available: Boolean(
                item?.enabled &&
                  item.grants.some((grant) => grant.botId === input.botId),
              ),
              status: item?.status ?? (item ? "configured" : "连接不存在"),
            };
          }),
        }
      : {}),
    skills: [
      ...new Map(
        input.skills.map((selection) => [selection.id, selection]),
      ).values(),
    ].map(({ id, revision, native, position }) => {
      if (native) {
        const skill = catalog?.nativeSkills?.find(
          (item) =>
            item.name === native.name &&
            item.path === native.path &&
            item.source === native.source,
        );
        if (!skill || catalog?.nativeSkillsProvider !== native.provider)
          throw new ORPCError("NOT_FOUND", {
            message: "原生技能目录已变化，请重新选择。",
          });
        return {
          id,
          name: skill.name,
          native,
          position,
        };
      }
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
      return {
        id,
        revision,
        name: skill.name,
        content: skill.content,
        position,
      };
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
