import { randomUUID } from "node:crypto";
import type { Context } from "@earendil-works/chord/context";
import type { ProductResult, ProductTool } from "../harness/types.ts";
import { runAssistant } from "./assistant.ts";
import {
  assistantDiscovery,
  assistInput,
  assistTool,
} from "./assistant-action.ts";
import { continuation } from "./assistant-task.ts";
import type { Computers } from "./catalog.ts";
import type { Computer } from "./index.ts";
import type { ComputerService, ServiceState } from "./service-types.ts";

export class ComputerTools {
  private readonly targets = new Set<Computer>();
  private readonly states = new Map<string, ServiceState>();
  private readonly computers: Computers;
  private readonly handoffs = new Map<
    string,
    {
      id: string;
      botId: number;
      computerId: string;
      revision: number;
      service: ComputerService;
      window?: { pid: number; window_id: number };
    }
  >();
  constructor(computers: Computers) {
    this.computers = computers;
  }

  async state(botId: number, context: Context) {
    const { target, enabled, id } = await this.computers.serviceTarget(
      botId,
      context,
    );
    this.targets.add(target);
    const state = (service: ComputerService) => ({
      enabled: Boolean(enabled[service]),
      ...this.states.get(`${id}:${botId}:${service}`),
      available: Boolean(
        enabled[service] &&
          this.states.get(`${id}:${botId}:${service}`)?.available,
      ),
    });
    return { browser: state("browser"), desktop: state("desktop") };
  }

  async configure(
    botId: number,
    service: ComputerService,
    enabled: boolean,
    context: Context,
    install = false,
  ) {
    return this.computers.transfer(
      botId,
      async () => {
        const { target, id } = await this.computers.serviceTarget(
          botId,
          context,
        );
        this.targets.add(target);
        if (enabled)
          this.states.set(
            `${id}:${botId}:${service}`,
            await target.services.prepare(botId, service, context, install),
          );
        await this.computers.serviceSettings(botId, service, enabled, context);
        if (!enabled) {
          await this.computers.views.closeBot(botId, service, context);
          await target.services.disable(botId, service);
        }
        return this.state(botId, context);
      },
      context,
    );
  }

  async catalog(botId: number, context: Context): Promise<ProductTool[]> {
    const binding = await this.computers.binding(botId, context);
    if (!binding.computerId) return [];
    const { target, enabled, id } = await this.computers.serviceTarget(
      botId,
      context,
    );
    this.targets.add(target);
    const mode = await this.computers.assistance.state(botId, context);
    const tools: ProductTool[] = [];
    for (const service of ["browser", "desktop"] as const) {
      if (!enabled[service]) continue;
      const state = await target.services.prepare(botId, service, context);
      this.states.set(`${id}:${botId}:${service}`, state);
      if (!state.available) continue;
      for (const tool of await target.services.catalog(botId, service, context))
        if (!mode.enabled || assistantDiscovery(`${service}_${tool.name}`))
          tools.push({ ...tool, name: `${service}_${tool.name}` });
    }
    if (mode.enabled && (enabled.browser || enabled.desktop))
      tools.push(assistTool);
    return tools;
  }

  async invoke(
    botId: number,
    name: string,
    args: Record<string, unknown>,
    owner: string,
    signal: AbortSignal,
    context: Context,
    approve?: (
      action: { name: string; args: Record<string, unknown> },
      signal: AbortSignal,
    ) => Promise<boolean>,
  ) {
    return this.computers.transfer(
      botId,
      async () => {
        const { target, enabled, id } = await this.computers.serviceTarget(
          botId,
          context,
        );
        this.targets.add(target);
        if (name === assistTool.name) {
          const input = assistInput.parse(args);
          const connection = await this.computers.assistance.connect(
            botId,
            context,
          );
          if (!connection || !enabled[input.service] || !approve)
            throw new Error("辅助决策未启用或审批通道不可用。");
          const actor = {
            botId,
            color: await this.computers.color(botId, context),
            owner,
          };
          const tools = await target.services.catalog(
            botId,
            input.service,
            context,
          );
          const catalog = new Set(tools.map((tool) => tool.name));
          const binding = await this.computers.binding(botId, context);
          const call = async (
            tool: string,
            arguments_: Record<string, unknown>,
            aborted: AbortSignal,
          ) => {
            if (!catalog.has(tool)) throw new Error("辅助决策动作不可用。");
            const current = await this.computers.assistance.connect(
              botId,
              context,
            );
            if (
              current?.key !== connection.key ||
              current.provider !== connection.provider
            )
              throw new Error("辅助决策设置已改变。请重新观察后继续。");
            return target.services.call(
              botId,
              input.service,
              tool,
              arguments_,
              owner,
              aborted,
              context,
              actor,
            );
          };
          return target.services.run(
            botId,
            input.service,
            owner,
            signal,
            async (controlled) => {
              if (input.handoff) {
                const failure = (text: string): ProductResult => ({
                  content: [{ type: "text" as const, text }],
                  isError: true,
                });
                const grant = this.handoffs.get(owner);
                if (
                  !grant ||
                  grant.id !== input.handoff.id ||
                  grant.botId !== botId ||
                  grant.computerId !== id ||
                  grant.revision !== binding.revision ||
                  grant.service !== input.service ||
                  grant.window?.pid !== input.window?.pid ||
                  grant.window?.window_id !== input.window?.window_id
                )
                  return failure(
                    "这次交接已失效。请重新提交电脑子任务，不要复用旧 ID。",
                  );
                let action: ReturnType<typeof continuation>;
                try {
                  action = continuation(input);
                } catch (error) {
                  return failure(
                    error instanceof Error ? error.message : "交接参数无效。",
                  );
                }
                if (!catalog.has(action.name))
                  return failure("交接动作不可用。");
                if (!(await approve(action, controlled)))
                  return failure("操作未获批准。");
                this.handoffs.delete(owner);
                const result = await call(action.name, action.args, controlled);
                return {
                  ...result,
                  content: [
                    {
                      type: "text" as const,
                      text: JSON.stringify({
                        route: "main-agent-handoff",
                        action,
                        status: result.isError ? "failed" : "delivered",
                      }),
                    },
                    ...result.content,
                  ],
                };
              }
              this.handoffs.delete(owner);
              const click = tools.find((tool) => tool.name === "click");
              const properties = click?.inputSchema.properties as
                | Record<string, unknown>
                | undefined;
              const result = await runAssistant(
                input,
                connection,
                call,
                approve,
                controlled,
                catalog.has("parse_visual_regions") &&
                  Boolean(properties?.capture_id),
              );
              if (
                ["handoff", "uncertain"].includes(
                  String(result.structuredContent?.status),
                )
              ) {
                const handoffId = randomUUID();
                this.handoffs.set(owner, {
                  id: handoffId,
                  botId,
                  computerId: id,
                  revision: binding.revision,
                  service: input.service,
                  window: input.window,
                });
                result.structuredContent = {
                  ...result.structuredContent,
                  handoffId,
                };
                result.content.push({
                  type: "text",
                  text: JSON.stringify({
                    handoffId,
                    tools: tools
                      .filter((tool) =>
                        [
                          "click",
                          "type_text",
                          "set_value",
                          "press_key",
                          "scroll",
                          "run_steps",
                          "agent_browser_click",
                          "agent_browser_fill",
                          "agent_browser_press",
                        ].includes(tool.name),
                      )
                      .map(({ name, inputSchema }) => ({ name, inputSchema })),
                    instruction:
                      "Inspect fresh state. This ID permits one explicit native action through computer_assist.handoff; it never permits replay of uncertain actions.",
                  }),
                });
              }
              return result;
            },
          );
        }
        if (
          (await this.computers.assistance.state(botId, context)).enabled &&
          !assistantDiscovery(name)
        )
          throw new Error(
            "Jev 协作模式已开启。请通过 computer_assist 提交电脑子任务。",
          );

        for (const service of ["browser", "desktop"] as const) {
          if (!enabled[service]) continue;
          const tool = (
            await target.services.catalog(botId, service, context)
          ).find((item) => `${service}_${item.name}` === name);
          if (tool)
            return target.services.call(
              botId,
              service,
              tool.name,
              args,
              owner,
              signal,
              context,
              {
                botId,
                color: await this.computers.color(botId, context),
                owner,
              },
            );
        }
        throw new Error("工作电脑工具未启用。请检查电脑设置。");
      },
      context,
    );
  }

  async takeover(botId: number, service: ComputerService, context: Context) {
    const { target, enabled } = await this.computers.serviceTarget(
      botId,
      context,
    );
    if (!enabled[service]) throw new Error("请先启用这项电脑服务。");
    return target.services.takeover(botId, service);
  }

  async *activity(botId: number, signal: AbortSignal, context: Context) {
    const { target, enabled } = await this.computers.serviceTarget(
      botId,
      context,
    );
    if (!enabled.desktop) return;
    yield* target.services.activity(botId, signal, context);
  }

  async release(
    botId: number,
    service: ComputerService,
    lease: string,
    context: Context,
  ) {
    const { target } = await this.computers.serviceTarget(botId, context);
    return target.services.release(botId, service, lease);
  }

  finish(owner: string) {
    this.handoffs.delete(owner);
    for (const target of this.targets) target.services.finish(owner);
  }
}
