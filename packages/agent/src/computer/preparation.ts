import { randomUUID } from "node:crypto";
import type { Context } from "@earendil-works/chord/context";
import type { Harness } from "@earendil-works/pi-durable";
import { computerSchema } from "../runtime/config.ts";
import { requireRevision, WorkError } from "../work/state.ts";
import type { Computers } from "./catalog.ts";
import { type ComputerRecord, ComputersDoc } from "./state.ts";

type Selection = { botId: number; revision: number; requestId: string };
export type ComputerMode = "process" | "shared" | "dedicated";

export class ComputerPreparation {
  private readonly harness: Harness;
  private readonly computers: Computers;
  private readonly pending = new Map<
    number,
    { requestId: string; result: ReturnType<Computers["binding"]> }
  >();

  constructor(harness: Harness, computers: Computers) {
    this.harness = harness;
    this.computers = computers;
  }

  private get template() {
    const { workComputer, computer } = this.computers.config;
    return workComputer ?? (computer.kind !== "process" ? computer : undefined);
  }

  async state(_context: Context) {
    return {
      deployment: this.computers.config.deployment,
      canIsolate: Boolean(this.template),
    };
  }

  configure(input: Selection & { mode: ComputerMode }, context: Context) {
    const pending = this.pending.get(input.botId);
    if (pending) {
      if (pending.requestId === input.requestId) return pending.result;
      throw new WorkError("CONFLICT", "正在为这个 Bot 准备电脑。");
    }
    const result = (async () => {
      const binding = await this.computers.binding(input.botId, context);
      if (binding.requestId === input.requestId) return binding;
      requireRevision(binding.revision, input.revision);
      await this.computers.assertIdle(input.botId, context);
      const item = await this.record(input.mode, input.botId, context);
      if (!item.authorized)
        await this.computers.authorize(item.id, true, context);
      await this.computers.ensureReady(item.id, context);
      return this.computers.assign(
        input.botId,
        { ...input, computerId: item.id },
        context,
      );
    })().finally(() => this.pending.delete(input.botId));
    this.pending.set(input.botId, { requestId: input.requestId, result });
    return result;
  }

  private async record(
    mode: ComputerMode,
    botId: number,
    context: Context,
  ): Promise<ComputerRecord> {
    const template = this.template;
    if (mode !== "process" && !template)
      throw new WorkError(
        "BAD_REQUEST",
        "这台服务尚未配置隔离电脑。请联系管理员。",
      );
    return this.harness.commit(async (tx) => {
      const doc = await tx.doc(ComputersDoc);
      const existing = doc.items.find((item) =>
        mode === "process"
          ? item.config.kind === "process"
          : item.config.kind !== "process" &&
            (mode === "shared"
              ? item.scope?.kind === "shared" || item.id === template?.id
              : item.scope?.kind === "dedicated" && item.scope.botId === botId),
      );
      if (existing) return { ...existing };
      if (!template) throw new WorkError("NOT_FOUND", "未找到服务环境。");
      const id = `${mode}-${randomUUID().slice(0, 12)}`;
      const config = computerSchema.parse(
        template.kind === "controller"
          ? { ...template, id }
          : { ...template, id, volume: `domos-${id}-work` },
      );
      const item: ComputerRecord = {
        id,
        name: mode === "shared" ? "共用隔离电脑" : "独立隔离电脑",
        config,
        authorized: true,
        scope:
          mode === "shared" ? { kind: "shared" } : { kind: "dedicated", botId },
      };
      doc.items.push(item);
      return item;
    }, context);
  }
}
