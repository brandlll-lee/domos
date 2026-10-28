import type { Context } from "@earendil-works/chord/context";
import type { TaskId } from "@earendil-works/pi-durable";
import type { Files } from "../files.ts";
import { EngineDoc, EngineInputDoc } from "./state.ts";
import type { EngineRuntime, EngineTaskInput } from "./task-types.ts";
import type { EngineSession } from "./types.ts";

export class EngineInputs {
  private ready = false;
  private open = true;
  private pending = Promise.resolve();
  private readonly runtime: EngineRuntime;
  private readonly session: EngineSession;
  private readonly files: Files | undefined;
  private readonly context: Context;

  constructor(
    runtime: EngineRuntime,
    session: EngineSession,
    files: Files | undefined,
    context: Context,
  ) {
    this.runtime = runtime;
    this.session = session;
    this.files = files;
    this.context = context;
  }

  start() {
    this.ready = true;
    this.notify();
  }

  notify() {
    if (!this.ready || !this.open || !this.session.steer) return;
    this.pending = this.pending.then(() => this.deliver());
    void this.pending.catch(() => {});
  }

  async close() {
    this.open = false;
    await this.pending;
  }

  private async deliver() {
    while (this.open && !this.runtime.signal.aborted) {
      let next: { id: TaskId; input: EngineTaskInput } | undefined;
      await this.runtime.commit(async (tx) => {
        const doc = await tx.doc(EngineDoc, this.runtime.conversationId);
        if (doc.activeId !== this.runtime.taskId) return;
        for (const id of doc.tasks) {
          if (id === this.runtime.taskId) continue;
          const task = await tx.task(id);
          if (!task || task.state.status === "terminal") continue;
          const input = await tx.doc(EngineInputDoc, id);
          if (input.status !== "queued") continue;
          input.owner = this.runtime.taskId;
          input.status = "sending";
          next = { id, input: task.input as EngineTaskInput };
          return;
        }
      }, this.context);
      if (!next) return;
      const current = next;
      let result: "accepted" | "refused" | "uncertain" = "uncertain";
      try {
        const images = await this.files?.images(
          this.runtime.conversationId,
          next.input.attachments ?? [],
          this.context,
        );
        result =
          (await this.session.steer?.(next.input.text, images)) ?? "refused";
      } catch {}
      await this.runtime.commit(async (tx) => {
        const input = await tx.doc(EngineInputDoc, current.id);
        if (input.status !== "sending") return;
        input.status = result === "refused" ? "deferred" : result;
        if (result === "refused") input.owner = null;
      }, this.context);
      if (result !== "accepted") {
        this.open = false;
        return;
      }
    }
  }
}
