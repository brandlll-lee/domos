import { randomUUID } from "node:crypto";
import type { Context } from "@earendil-works/chord/context";
import type { Harness } from "@earendil-works/pi-durable";
import { computerSchema } from "../runtime/config.ts";
import { requireRevision, WorkError } from "../work/state.ts";
import type { Computers } from "./catalog.ts";
import {
  type ComputerRecord,
  ComputerSetupDoc,
  ComputersDoc,
} from "./state.ts";

type Selection = {
  botId: number;
  revision: number;
  requestId: string;
};
export type ComputerMode = "shared" | "dedicated";

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
    return workComputer ?? (computer.kind === "docker" ? computer : undefined);
  }

  async state(context: Context) {
    const [setup, directory] = await Promise.all([
      this.harness.snapshot(ComputerSetupDoc, context),
      this.harness.snapshot(ComputersDoc, context),
    ]);
    const shared = directory?.items.find(
      (item) => item.id === directory.defaultId,
    );
    const host = shared
      ? shared.config.kind === "process"
        ? "process"
        : "docker"
      : (setup?.host ?? null);
    return {
      host,
      canIsolate: Boolean(this.template),
      sharedId: directory?.defaultId ?? null,
    };
  }

  async configure(
    input: Selection & { host: "process" | "docker" },
    context: Context,
  ) {
    return this.run(
      input,
      async () => {
        const item = await this.record(
          "shared",
          input.botId,
          input.host,
          context,
        );
        await this.computers.authorize(item.id, true, context);
        await this.computers.ensureReady(item.id, context);
        const binding = await this.computers.assign(
          input.botId,
          { ...input, computerId: item.id },
          context,
        );
        await this.computers.setDefault(item.id, context);
        await this.harness.commit(async (tx) => {
          (await tx.doc(ComputerSetupDoc)).host = input.host;
        }, context);
        return binding;
      },
      context,
    );
  }

  async prepare(input: Selection & { mode: ComputerMode }, context: Context) {
    return this.run(
      input,
      async () => {
        const state = await this.state(context);
        if (!state.host)
          throw new WorkError("BAD_REQUEST", "请先选择 Bot 的运行位置。");
        if (input.mode === "dedicated" && state.host === "process")
          throw new WorkError(
            "BAD_REQUEST",
            "独立电脑需要隔离环境。请先选择 Docker。",
          );
        const item =
          input.mode === "shared" && state.sharedId
            ? (await this.harness.snapshot(ComputersDoc, context))?.items.find(
                (item) => item.id === state.sharedId,
              )
            : await this.record(input.mode, input.botId, state.host, context);
        if (!item) throw new WorkError("NOT_FOUND", "共享电脑不存在。");
        await this.computers.ensureReady(item.id, context);
        return this.computers.assign(
          input.botId,
          { ...input, computerId: item.id },
          context,
        );
      },
      context,
    );
  }

  private run(
    input: Selection,
    action: () => ReturnType<Computers["binding"]>,
    context: Context,
  ) {
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
      return action();
    })().finally(() => this.pending.delete(input.botId));
    this.pending.set(input.botId, { requestId: input.requestId, result });
    return result;
  }

  private async record(
    mode: ComputerMode,
    botId: number,
    host: "process" | "docker",
    context: Context,
  ): Promise<ComputerRecord> {
    const template = this.template;
    if (host === "docker" && !template)
      throw new WorkError(
        "BAD_REQUEST",
        "隔离环境尚未安装。请在桌面端准备 Docker，或让管理员配置工作镜像。",
      );
    return this.harness.commit(async (tx) => {
      const doc = await tx.doc(ComputersDoc);
      const existing = doc.items.find((item) =>
        host === "process"
          ? item.config.kind === "process"
          : item.config.kind === "docker" &&
            (mode === "shared"
              ? item.scope?.kind === "shared" || item.id === template?.id
              : item.scope?.kind === "dedicated" && item.scope.botId === botId),
      );
      if (existing) {
        existing.scope =
          mode === "shared" ? { kind: "shared" } : { kind: "dedicated", botId };
        return { ...existing };
      }
      const id = `${mode}-${randomUUID().slice(0, 12)}`;
      const config = computerSchema.parse({
        ...template,
        kind: "docker",
        id,
        volume: `domos-${id}-work`,
      });
      const item: ComputerRecord = {
        id,
        name: mode === "shared" ? "共享电脑" : "独立电脑",
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
