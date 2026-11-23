import { MAX_ATTACHMENTS } from "@domos/agent/attachments";
import type { Bots } from "@domos/agent/bots";
import type { Files } from "@domos/agent/files";
import { materialText } from "@domos/agent/materials";
import type { McpConnections } from "@domos/agent/mcp";
import type { Runtime } from "@domos/agent/runtime";
import { slimChatView } from "@domos/agent/runtime";
import { Teams } from "@domos/agent/teams";
import type { BotWork } from "@domos/agent/work";
import { BOT_NAME_LENGTH, WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import {
  BACKGROUND_CONTEXT as context,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { botConversation, chatPage, singleChatPage } from "./conversation.ts";
import {
  botReferences,
  materialsSchema,
  prepareMaterials,
} from "./materials.ts";

export function teamRouter(
  bots: Bots,
  files: Files,
  work: BotWork,
  runtime?: Runtime,
  mcp?: McpConnections,
) {
  const service = () => {
    const collaboration = runtime?.collaboration;
    if (!runtime || !collaboration) throw new ORPCError("NOT_IMPLEMENTED");
    return { teams: new Teams(collaboration.harness), runtime, collaboration };
  };
  const target = z.object({ id: z.uuid() });
  const teamInput = target.extend({
    name: z.string().trim().min(1).max(BOT_NAME_LENGTH),
    purpose: z.string().max(WORK_TEXT_LENGTH),
    members: z.array(z.number().int().nonnegative()).min(1),
    owner: z.number().int().nonnegative(),
  });
  return {
    list: os.handler(() => service().teams.list(context)),
    subscribe: os.handler(async function* ({ signal }) {
      yield* service().teams.watchList(
        signal ? withAbortSignal(signal, context) : context,
      );
    }),
    create: os
      .input(teamInput)
      .handler(({ input }) => service().teams.create(input, context)),
    update: os.input(teamInput).handler(({ input }) => {
      const { teams, runtime } = service();
      return teams.update(input, runtime, context);
    }),
    session: os
      .input(target)
      .handler(({ input }) =>
        service().teams.session(input.id, undefined, context),
      ),
    get: os
      .input(target.extend(chatPage.shape).refine(singleChatPage))
      .handler(async ({ input, signal }) => {
        const { teams, runtime } = service();
        return slimChatView(
          await teams.view(
            input.id,
            runtime,
            signal ? withAbortSignal(signal, context) : context,
            input,
          ),
        );
      }),
    changes: os.input(target).handler(async function* ({ input, signal }) {
      const { teams, runtime } = service();
      for await (const view of teams.watch(
        input.id,
        runtime,
        signal ? withAbortSignal(signal, context) : context,
      ))
        yield { type: "snapshot" as const, view: slimChatView(view) };
    }),
    send: os
      .input(
        target.extend({
          text: z.string().trim(),
          requestId: z.uuid(),
          attachments: z
            .array(z.string().regex(/^[a-f0-9]{64}$/))
            .max(MAX_ATTACHMENTS)
            .default([]),
          ...materialsSchema,
        }),
      )
      .handler(async ({ input }) => {
        if (
          !input.text &&
          !input.attachments.length &&
          !input.skills.length &&
          !input.context.length &&
          !input.mcp.length &&
          !input.bots.length
        )
          throw new ORPCError("BAD_REQUEST");
        const { teams, runtime } = service();
        const team = (await teams.list(context)).find(
          (team) => team.id === input.id,
        );
        if (!team) throw new ORPCError("NOT_FOUND");
        const members = (await bots.list(context)).filter((bot) =>
          team.members.includes(bot.id),
        );
        const references = botReferences(input.bots, members);
        const recipients = references.length
          ? [
              ...new Set(
                references
                  .toSorted((a, b) => a.position - b.position)
                  .map((reference) => reference.botId),
              ),
            ]
          : [team.owner];
        const view = await teams.view(team.id, runtime, context);
        const deliveries = await Promise.all(
          recipients.map(async (recipient) => {
            const session = await teams.session(team.id, recipient, context);
            const materials = await prepareMaterials(
              { ...input, botId: recipient },
              view,
              work,
              mcp,
              bots,
              async (id, cursor) =>
                cursor
                  ? ((
                      await teams.view(team.id, runtime, context, {
                        around: cursor,
                      })
                    ).messages.find((message) => message.id === id) ?? null)
                  : null,
            );
            materials.bots = references;
            const attachments = await Promise.all(
              (input.attachments ?? []).map((id) =>
                files.metadata(team.owner, id),
              ),
            );
            const shared =
              recipient === team.owner
                ? attachments
                : await files.share(
                    team.owner,
                    recipient,
                    attachments.map((file) => file.id),
                    input.requestId,
                    context,
                  );
            await files.verify(recipient, shared, context);
            return { session, materials, shared };
          }),
        );
        const submissions = [];
        for (const { session, materials, shared } of deliveries) {
          submissions.push(
            await runtime.submit(
              session,
              {
                text: `Team purpose: ${team.purpose}\n\n${materialText(input.text, materials)}`,
                displayText: input.text,
                requestId: input.requestId,
                attachments: shared,
                materials,
              },
              context,
            ),
          );
        }
        return { id: submissions[0]?.id };
      }),
    stop: os.input(target).handler(async ({ input }) => {
      const { teams, runtime } = service();
      await teams.stop(input.id, runtime, context);
    }),
    status: os
      .input(z.object({ sessionId: z.number().int().nonnegative() }))
      .handler(async ({ input }) => {
        await botConversation(bots, input.sessionId);
        return service().collaboration.status(
          input.sessionId as import("@earendil-works/pi-durable").ConversationId,
          undefined,
          context,
        );
      }),
    cancel: os
      .input(
        z.object({ sessionId: z.number().int().nonnegative(), id: z.string() }),
      )
      .handler(async ({ input }) => {
        await botConversation(bots, input.sessionId);
        const { collaboration } = service();
        await collaboration.status(
          input.sessionId as import("@earendil-works/pi-durable").ConversationId,
          input.id,
          context,
        );
        await collaboration.cancel(input.id, context);
      }),
  };
}
