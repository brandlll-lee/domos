import type { Context } from "@earendil-works/chord/context";
import { projectContext } from "./context.ts";
import { EngineDoc } from "./state.ts";
import {
  type EngineRuntime,
  type StoredMessage,
  stored,
} from "./task-types.ts";
import { type EngineEvent, engineLimits } from "./types.ts";
import { UsageTaskDoc } from "./usage.ts";

export class EngineProjection {
  private readonly runtime: EngineRuntime;
  private readonly turnId: string;
  private readonly context: Context;
  private readonly messages: StoredMessage[];
  private changed = false;
  private flushed = 0;
  constructor(
    runtime: EngineRuntime,
    turnId: string,
    context: Context,
    messages: readonly StoredMessage[],
  ) {
    this.runtime = runtime;
    this.turnId = turnId;
    this.context = context;
    this.messages = structuredClone(messages) as StoredMessage[];
  }

  async emit(event: EngineEvent) {
    if (
      event.type === "usage" ||
      event.type === "runtime" ||
      event.type === "context" ||
      event.type === "compaction" ||
      event.type === "approval_closed"
    ) {
      await this.runtime.commit(async (tx) => {
        if (event.type === "usage")
          (await tx.doc(UsageTaskDoc, this.runtime.taskId)).items[
            event.usage.id
          ] = event.usage;
        else if (event.type === "context" || event.type === "compaction") {
          await projectContext(
            tx,
            await tx.doc(EngineDoc, this.runtime.conversationId),
            this.runtime,
            event,
          );
        } else if (event.type === "approval_closed") {
          const doc = await tx.doc(EngineDoc, this.runtime.conversationId);
          doc.approvals = doc.approvals.filter((item) => item.id !== event.id);
        } else {
          const doc = await tx.doc(EngineDoc, this.runtime.conversationId);
          const notices = { ...doc.runtime?.notices, ...event.state.notices };
          doc.runtime = {
            ...doc.runtime,
            ...event.state,
            ...(event.state.notices ? { notices } : {}),
          };
        }
      }, this.context);
      return;
    }
    if (
      event.type === "session" ||
      event.type === "accepted" ||
      event.type === "approval"
    ) {
      await this.flush();
      await this.runtime.commit(async (tx) => {
        const doc = await tx.doc(EngineDoc, this.runtime.conversationId);
        if (event.type === "session") {
          if (doc.sessionId !== event.id)
            doc.runtime = doc.runtime?.controls
              ? { controls: doc.runtime.controls }
              : {};
          doc.sessionId = event.id;
        }
        if (event.type === "accepted") {
          doc.dispatch = "accepted";
          doc.turnId = event.id ?? null;
        }
        if (event.type === "approval") doc.approvals.push(event.approval);
      }, this.context);
      return;
    }
    const id = `${this.turnId}:${event.id}:${event.type === "thinking" ? "thinking" : event.type === "tool_result" ? "result" : "message"}`;
    let message = this.messages.find((item) => item.id === id);
    if (!message) {
      message = {
        id,
        turnId: this.turnId,
        role: event.type === "tool_result" ? "toolResult" : "assistant",
        content: [],
        stopped: false,
        timestamp: Date.now(),
      };
      this.messages.push(message);
    }
    if (event.type === "tool")
      message.content = [
        stored({
          type: "toolCall",
          id: event.id,
          name: event.name,
          arguments: event.input,
          key: id,
        }),
      ];
    else if (event.type === "tool_result")
      Object.assign(message, {
        toolCallId: event.id,
        toolName: event.name,
        isError: event.failed,
        toolStatus: event.failed ? "failed" : "done",
        content: [
          {
            type: "text",
            text: event.text.slice(-engineLimits.outputCharacters),
            key: id,
          },
        ],
        ...(event.attachments ? { attachments: event.attachments } : {}),
      });
    else if (event.type === "message") {
      message.content = [{ type: "text", text: event.text, key: id }];
      message.pending = false;
    } else {
      const previous = message.content[0];
      const text =
        `${event.replace ? "" : (previous && (previous.type === "text" ? previous.text : previous.type === "thinking" ? previous.thinking : "")) || ""}${event.text}`.slice(
          -engineLimits.outputCharacters,
        );
      message.content = [
        event.type === "text"
          ? { type: "text", text, key: id }
          : { type: "thinking", thinking: text, key: id },
      ];
      message.pending = true;
    }
    this.changed = true;
    if (
      event.type === "message" ||
      Date.now() - this.flushed >= engineLimits.flushMs
    )
      await this.flush();
  }

  async flush() {
    if (!this.changed) return;
    const drafts = stored(this.messages);
    await this.runtime.commit(async (tx) => {
      (await tx.doc(EngineDoc, this.runtime.conversationId)).drafts = drafts;
    }, this.context);
    this.changed = false;
    this.flushed = Date.now();
  }
}
