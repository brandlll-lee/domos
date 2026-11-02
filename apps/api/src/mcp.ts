import type { Bots } from "@domos/agent/bots";
import type { McpConnections } from "@domos/agent/mcp";
import { mcpApps } from "@domos/agent/mcp/catalog";
import { mcpConfig } from "@domos/agent/mcp/config";
import { WorkError } from "@domos/agent/work";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { botConversation } from "./conversation.ts";

const id = z.uuid();
const revision = z.number().int().nonnegative();

export function mcpRouter(
  bots: Bots,
  connections?: McpConnections,
  callback?: string,
) {
  const access = async <T>(action: (service: McpConnections) => Promise<T>) => {
    if (!connections)
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        message: "连接服务不可用。",
      });
    try {
      return await action(connections);
    } catch (error) {
      if (error instanceof WorkError)
        throw new ORPCError(error.code, { message: error.message });
      throw error;
    }
  };
  return {
    catalog: os.handler(() => mcpApps),
    native: os
      .input(
        z.object({
          botId: z.number().int().positive(),
          enabled: z.boolean().optional(),
        }),
      )
      .handler(({ input }) =>
        access(async (service) => {
          await botConversation(bots, input.botId);
          if (!service.nativeCatalog)
            throw new ORPCError("SERVICE_UNAVAILABLE");
          const catalog = await service
            .nativeCatalog(input.botId, BACKGROUND_CONTEXT)
            .catch((error: unknown) => {
              throw new ORPCError("BAD_REQUEST", {
                message:
                  error instanceof Error
                    ? error.message
                    : "原生连接目录不可用。",
              });
            });
          if (input.enabled !== undefined) {
            if (catalog.inheritance !== "selectable")
              throw new ORPCError("BAD_REQUEST", {
                message: "此 Harness 使用原生继承范围。请在原生程序管理连接。",
              });
            catalog.inherited = await service.native(
              input.botId,
              BACKGROUND_CONTEXT,
              input.enabled,
            );
          }
          return catalog;
        }),
      ),
    list: os.handler(() =>
      access((service) => service.list(BACKGROUND_CONTEXT)),
    ),
    save: os
      .input(
        z.object({
          id,
          revision,
          name: z.string().min(1).max(128),
          computerId: z.string().min(1).max(128),
          enabled: z.boolean(),
          config: mcpConfig.optional(),
        }),
      )
      .handler(({ input }) =>
        access((service) => service.save(input, BACKGROUND_CONTEXT)),
      ),
    grant: os
      .input(
        z.object({
          id,
          revision,
          grants: z
            .array(
              z.object({
                botId: z.number().int().positive(),
                tools: z.array(z.string().min(1).max(256)).max(512).nullable(),
              }),
            )
            .max(256),
        }),
      )
      .handler(({ input }) =>
        access(async (service) => {
          for (const grant of input.grants)
            await botConversation(bots, grant.botId);
          return service.grant(
            input.id,
            input.revision,
            input.grants,
            BACKGROUND_CONTEXT,
          );
        }),
      ),
    remove: os
      .input(z.object({ id, revision }))
      .handler(({ input }) =>
        access((service) =>
          service.remove(input.id, input.revision, BACKGROUND_CONTEXT),
        ),
      ),
    check: os
      .input(z.object({ id }))
      .handler(({ input, signal }) =>
        access((service) =>
          service.check(input.id, BACKGROUND_CONTEXT, signal),
        ),
      ),
    login: os
      .input(
        z.object({
          id,
          client: z
            .object({
              client_id: z.string().min(1),
              client_secret: z.string().optional(),
            })
            .optional(),
        }),
      )
      .handler(({ input }) =>
        access((service) => {
          if (!callback)
            throw new ORPCError("SERVICE_UNAVAILABLE", {
              message: "此部署尚未提供 OAuth 回调地址。",
            });
          return service.login(
            input.id,
            callback,
            input.client,
            BACKGROUND_CONTEXT,
          );
        }),
      ),
    logout: os
      .input(z.object({ id, cancel: z.boolean().default(false) }))
      .handler(({ input }) =>
        access((service) =>
          service.logout(input.id, BACKGROUND_CONTEXT, input.cancel),
        ),
      ),
  };
}
