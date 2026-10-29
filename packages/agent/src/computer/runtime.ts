import { randomUUID } from "node:crypto";
import type { JsonRepresentation } from "@earendil-works/chord";
import {
  BACKGROUND_CONTEXT,
  type Context,
} from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import {
  type ConversationId,
  defineDoc,
  defineExtension,
  defineTool,
  GenerationTask,
  type Harness,
  hook,
  LiveDoc,
  type Registry,
  ToolTask,
} from "@earendil-works/pi-durable";
import { z } from "zod";
import type { Files } from "../files.ts";
import { computerEvidence } from "../harness/evidence.ts";
import type {
  EngineAnswer,
  EngineApproval,
  ProductResult,
  ProductTool,
} from "../harness/types.ts";
import type { Computers } from "./catalog.ts";
import { ComputersDoc } from "./state.ts";
import { takeoverInput } from "./takeover.ts";

export const ComputerRequests = defineDoc<{
  approvals: EngineApproval[];
  tools?: JsonRepresentation<ProductTool>[];
}>({
  kind: "domos.computer-requests",
  version: 1,
  checkpointWhen: () => false,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ approvals: [] }),
});

export class ComputerRuntime {
  private readonly pending = new Map<
    string,
    {
      botId: number;
      resolve: (answer: EngineAnswer) => void;
      completing: boolean;
    }
  >();
  private readonly harness: Harness;
  private readonly registry: Registry;
  private readonly computers: Computers;
  private readonly files: Files;
  constructor(
    harness: Harness,
    registry: Registry,
    computers: Computers,
    files: Files,
  ) {
    this.harness = harness;
    this.registry = registry;
    this.computers = computers;
    this.files = files;
    registry.install(
      defineExtension({
        name: "domos-computer-control",
        hooks: [
          hook(ToolTask, {
            beforeTool: async (call, api, context) => {
              if (!["bash", "powershell", "write", "edit"].includes(call.name))
                return;
              const answer = await this.approve(
                api.conversationId,
                {
                  id: randomUUID(),
                  title: `电脑操作 · ${call.name}`,
                  detail: JSON.stringify(call.arguments),
                  kind: "permission",
                  automatic: true,
                },
                context.abortSignal ?? new AbortController().signal,
                context,
              );
              if (!answer.allow) return { block: "操作未获批准。" };
            },
          }),
          hook(GenerationTask, {
            onYield: (_answer, api) => {
              computers.tools.finish(`computer:${api.conversationId}`);
            },
          }),
        ],
      }),
    );
  }
  async prepare(botId: number, context: Context, refresh = true) {
    if (
      refresh &&
      (await this.harness.snapshot(LiveDoc, botId as ConversationId, context))
        ?.run
    )
      return;
    const catalog = refresh
      ? await this.computers.tools.catalog(botId, context)
      : ((
          await this.harness.snapshot(
            ComputerRequests,
            botId as ConversationId,
            context,
          )
        )?.tools ?? []);
    if (refresh)
      await this.harness.commit(async (tx) => {
        (await tx.doc(ComputerRequests, botId as ConversationId)).tools =
          JSON.parse(JSON.stringify(catalog));
      }, context);
    const extension = defineExtension({
      name: `domos-computer-tools-${botId}`,
      tools: catalog.map((tool) =>
        defineTool({
          name: tool.name,
          description: tool.description,
          parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema),
          executionMode: "sequential",
          execute: async (args, api, ctx) => {
            if (api.conversationId !== botId)
              throw new Error("工具不属于此 Bot。");
            const signal = ctx.abortSignal ?? new AbortController().signal;
            const owner = `computer:${botId}`;
            try {
              let result: ProductResult;
              if (tool.name === "computer_request_takeover") {
                const { service, reason } = takeoverInput.parse(args);
                const binding = await this.computers.binding(botId, ctx);
                const target = await this.computers.serviceTarget(botId, ctx);
                if (!binding.computerId || !target.enabled[service])
                  throw new Error("请先启用对应的电脑服务。");
                const id = randomUUID();
                const page =
                  service === "browser"
                    ? await target.target.services
                        .call(
                          botId,
                          service,
                          "agent_browser_get_url",
                          {},
                          owner,
                          signal,
                          ctx,
                        )
                        .catch(() => undefined)
                    : undefined;
                const url = z
                  .object({
                    response: z.object({ data: z.object({ url: z.url() }) }),
                  })
                  .safeParse(page?.structuredContent).data?.response.data.url;
                const answer = await this.approve(
                  botId,
                  {
                    id,
                    title: service === "browser" ? "Browser" : "Computer",
                    detail: reason,
                    kind: "permission",
                    takeover: {
                      id,
                      service,
                      computerId: binding.computerId,
                      revision: binding.revision,
                      state: "waiting",
                      ...(url && /^https?:\/\//.test(url) ? { url } : {}),
                    },
                    preview: await this.computers.views
                      .capture(botId, service, ctx)
                      .catch(() => undefined),
                  },
                  signal,
                  ctx,
                );
                result = {
                  content: [
                    {
                      type: "text",
                      text: answer.allow
                        ? "User returned control. Observe fresh state before continuing. Do not replay earlier actions."
                        : "Takeover cancelled.",
                    },
                  ],
                  isError: !answer.allow,
                };
              } else {
                result = await this.computers.tools.invoke(
                  botId,
                  tool.name,
                  args,
                  owner,
                  signal,
                  ctx,
                  async (action, aborted) =>
                    (
                      await this.approve(
                        botId,
                        {
                          id: randomUUID(),
                          title: `电脑操作 · ${action.name}`,
                          detail: JSON.stringify(action.args),
                          kind: "permission",
                          automatic: true,
                        },
                        aborted,
                        ctx,
                      )
                    ).allow,
                );
                result = await computerEvidence(
                  this.files,
                  botId,
                  owner,
                  api.callId,
                  tool.name,
                  result,
                  ctx,
                  tool.outputSchema,
                );
              }
              return {
                output: result.content.filter(
                  (item) => item.type === "text" || item.type === "image",
                ),
                ...(result.isError ? { isError: true } : {}),
                details: JSON.parse(JSON.stringify(result)),
              };
            } finally {
              if (signal.aborted) this.computers.tools.finish(owner);
            }
          },
        }),
      ),
    });
    this.registry.install(extension);
    const conversation = await this.harness.conversation(
      botId as ConversationId,
      context,
    );
    if (!conversation) throw new Error("Bot 不存在。");
    const common = this.registry
      .snapshot()
      .installed()
      .filter((item) => !item.name.startsWith("domos-computer-tools-"));
    await conversation.configure(
      { extensions: [...common, extension] },
      context,
    );
  }

  async approve(
    botId: number,
    approval: EngineApproval,
    signal: AbortSignal,
    context: Context,
  ) {
    if (
      approval.automatic &&
      (await this.harness.snapshot(ComputersDoc, context))?.bindings[
        String(botId)
      ]?.approvalMode === "auto"
    )
      return { allow: true };
    signal.throwIfAborted();
    const answer = Promise.withResolvers<EngineAnswer>();
    this.pending.set(approval.id, {
      botId,
      resolve: answer.resolve,
      completing: false,
    });
    const abort = () => answer.resolve({ allow: false });
    signal.addEventListener("abort", abort, { once: true });
    const timer = approval.takeover ? undefined : setTimeout(abort, 600_000);
    let accepted = false;
    try {
      await this.harness.commit(async (tx) => {
        (
          await tx.doc(ComputerRequests, botId as ConversationId)
        ).approvals.push(JSON.parse(JSON.stringify(approval)));
      }, context);
      signal.throwIfAborted();
      const result = await answer.promise;
      accepted = result.allow;
      return result;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      this.pending.delete(approval.id);
      await this.harness.commit(async (tx) => {
        const doc = await tx.doc(ComputerRequests, botId as ConversationId);
        const registered = doc.approvals.some(
          (item) => item.id === approval.id,
        );
        doc.approvals = doc.approvals.filter((item) => item.id !== approval.id);
        if (approval.takeover && registered)
          await tx.appendEntry(botId as ConversationId, {
            kind: "domos.engine-message",
            data: {
              id: approval.id,
              role: "assistant",
              content: [
                { type: "text", text: approval.detail, key: approval.id },
                ...(approval.preview
                  ? [{ ...approval.preview, key: `${approval.id}:preview` }]
                  : []),
              ],
              timestamp: Date.now(),
              stopped: !accepted,
              takeover: {
                ...approval.takeover,
                state: accepted ? "done" : "expired",
              },
            },
          });
      }, BACKGROUND_CONTEXT);
    }
  }

  private async request(botId: number, id: string, context: Context) {
    const pending = this.pending.get(id);
    const approval = (
      await this.harness.snapshot(
        ComputerRequests,
        botId as ConversationId,
        context,
      )
    )?.approvals.find((item) => item.id === id);
    if (!pending || pending.botId !== botId || pending.completing || !approval)
      throw new Error("这次确认已经失效。");
    if (approval.takeover) {
      const binding = await this.computers.binding(botId, context);
      if (
        binding.computerId !== approval.takeover.computerId ||
        binding.revision !== approval.takeover.revision
      )
        throw new Error("工作电脑配置已改变。");
    }
    return { pending, approval };
  }

  async answer(
    botId: number,
    id: string,
    answer: EngineAnswer,
    context: Context,
  ) {
    const { pending, approval } = await this.request(botId, id, context);
    pending.completing = true;
    try {
      if (answer.allow && approval.takeover)
        await this.computers.views.finishRequest(botId, id, context);
      pending.resolve(answer);
    } catch (error) {
      pending.completing = false;
      throw error;
    }
  }

  async takeRequest(botId: number, id: string, view: string, context: Context) {
    const { approval } = await this.request(botId, id, context);
    if (!approval.takeover) throw new Error("接管请求已失效。");
    return this.computers.views.takeRequest(
      botId,
      view,
      id,
      approval.takeover.service,
      approval.takeover.computerId,
      context,
    );
  }
}
