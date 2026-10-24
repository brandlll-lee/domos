import type { Context } from "@earendil-works/chord/context";
import type { ProductTool } from "../harness/types.ts";
import { runAssistant } from "./assistant.ts";
import { assistInput, assistTool } from "./assistant-action.ts";
import type { Computers } from "./catalog.ts";
import type { Computer } from "./index.ts";
import type { ComputerService, ServiceState } from "./service-types.ts";

export class ComputerTools {
  private readonly targets = new Set<Computer>();
  private readonly states = new Map<string, ServiceState>();
  private readonly computers: Computers;
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
    const tools: ProductTool[] = [];
    for (const service of ["browser", "desktop"] as const) {
      if (!enabled[service]) continue;
      const state = await target.services.prepare(botId, service, context);
      this.states.set(`${id}:${botId}:${service}`, state);
      if (!state.available) continue;
      for (const tool of await target.services.catalog(botId, service, context))
        tools.push({ ...tool, name: `${service}_${tool.name}` });
    }
    if (
      tools.length &&
      (await this.computers.assistance.connect(botId, context))
    )
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
        const { target, enabled } = await this.computers.serviceTarget(
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
          const catalog = new Set(
            (await target.services.catalog(botId, input.service, context)).map(
              (tool) => tool.name,
            ),
          );
          return target.services.run(
            botId,
            input.service,
            owner,
            signal,
            (controlled) =>
              runAssistant(
                input,
                connection,
                async (tool, arguments_, aborted) => {
                  if (!catalog.has(tool))
                    throw new Error("辅助决策动作不可用。");
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
                },
                approve,
                controlled,
              ),
          );
        }
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
    for (const target of this.targets) target.services.finish(owner);
  }
}
