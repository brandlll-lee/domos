import { createHash, randomUUID } from "node:crypto";
import type { JsonRepresentation } from "@earendil-works/chord";
import {
  BACKGROUND_CONTEXT,
  type Context,
} from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import {
  type ConversationId,
  defineDoc,
  defineDocFamily,
  defineExtension,
  defineTool,
  GenerationTask,
  type Harness,
  hook,
  LiveDoc,
  type Registry,
  type TaskId,
} from "@earendil-works/pi-durable";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
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

const ComputerCallDoc = defineDocFamily<
  {
    name: string;
    arguments: JsonRepresentation<Record<string, unknown>>;
    result: JsonRepresentation<ProductResult> | null;
  },
  null
>({
  kind: "domos.computer-call",
  version: 1,
  scope: "task",
  family: true,
  checkpointWhen: () => false,
  initial: () => ({ name: "", arguments: {}, result: null }),
});

export class ComputerRuntime {
  private readonly validator = new AjvJsonSchemaValidator();
  private toolNames = new Set<string>();
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
    this.toolNames = new Set(catalog.map((tool) => tool.name));
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
            const result = await this.invoke(
              botId,
              tool,
              args,
              api.callId,
              signal,
              ctx,
            );
            return {
              output: result.content.filter(
                (item) => item.type === "text" || item.type === "image",
              ),
              ...(result.isError ? { isError: true } : {}),
              details: JSON.parse(JSON.stringify(result)),
            };
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

  isComputerTool(name: string) {
    return this.toolNames.has(name);
  }

  async call(
    botId: number,
    taskId: TaskId,
    callId: string,
    tool: ProductTool,
    args: Record<string, unknown>,
    signal: AbortSignal,
    context: Context,
  ): Promise<ProductResult> {
    signal.throwIfAborted();
    const checked = this.validator.getValidator(tool.inputSchema)(args);
    if (!checked.valid) throw new Error(checked.errorMessage);
    const key = createHash("sha256").update(callId).digest("hex");
    let cached: ProductResult | undefined;
    await this.harness.commit(async (tx) => {
      const call = await tx.doc(ComputerCallDoc, taskId, key, null);
      if (call.name) {
        if (
          call.name !== tool.name ||
          JSON.stringify(call.arguments) !== JSON.stringify(args)
        )
          throw new Error("工具请求标识重复。");
        if (!call.result)
          throw new Error("前次电脑调用结果未知。请观察，不要重放动作。");
        cached = JSON.parse(JSON.stringify(call.result));
        return;
      }
      call.name = tool.name;
      call.arguments = JSON.parse(JSON.stringify(args));
    }, context);
    if (cached) return cached;
    signal.throwIfAborted();
    const result = await this.invoke(
      botId,
      tool,
      args,
      callId,
      signal,
      context,
    );
    await this.harness.commit(async (tx) => {
      (await tx.doc(ComputerCallDoc, taskId, key, null)).result = JSON.parse(
        JSON.stringify(result),
      );
    }, BACKGROUND_CONTEXT);
    return result;
  }

  private async invoke(
    botId: number,
    tool: ProductTool,
    args: Record<string, unknown>,
    callId: string,
    signal: AbortSignal,
    context: Context,
  ): Promise<ProductResult> {
    const owner = `computer:${botId}`;
    try {
      let result: ProductResult;
      if (tool.name === "computer_request_takeover") {
        const { service, reason } = takeoverInput.parse(args);
        const binding = await this.computers.binding(botId, context);
        const target = await this.computers.serviceTarget(botId, context);
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
                  context,
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
              .capture(botId, service, context)
              .catch(() => undefined),
          },
          signal,
          context,
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
          context,
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
                context,
              )
            ).allow,
        );
        result = await computerEvidence(
          this.files,
          botId,
          owner,
          callId,
          tool.name,
          result,
          context,
          tool.outputSchema,
        );
      }
      return result;
    } finally {
      if (signal.aborted) this.computers.tools.finish(owner);
    }
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
