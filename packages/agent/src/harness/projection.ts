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
  private processing = false;
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
    const { runtime, context } = this;
    if (event.type === "runtime" && event.state.processing !== undefined)
      this.processing = event.state.processing;
    if (
      [
        "usage",
        "runtime",
        "context",
        "compaction",
        "session",
        "accepted",
      ].includes(event.type)
    ) {
      await runtime.commit(async (tx, current) => {
        const doc = await tx.doc(EngineDoc, runtime.conversationId);
        if (doc.activeId !== runtime.taskId) return;
        switch (event.type) {
          case "usage":
            if (doc.run && event.usage.model) doc.run.model = event.usage.model;
            (await tx.doc(UsageTaskDoc, runtime.taskId)).items[event.usage.id] =
              event.usage;
            break;
          case "context":
          case "compaction":
            await projectContext(tx, doc, runtime, event);
            break;
          case "runtime": {
            const notices = { ...doc.runtime?.notices, ...event.state.notices };
            doc.runtime = {
              ...doc.runtime,
              ...event.state,
              ...(event.state.notices ? { notices } : {}),
            };
            break;
          }
          case "session":
            if (doc.sessionId !== event.id)
              doc.runtime = doc.runtime?.controls
                ? { controls: doc.runtime.controls }
                : {};
            doc.sessionId = event.id;
            if (doc.sessionKey) {
              doc.sessions ??= {};
              if (doc.sessions[doc.sessionKey]?.id !== event.id)
                doc.sessions[doc.sessionKey] = { id: event.id, through: null };
            }
            break;
          case "accepted": {
            doc.dispatch = "accepted";
            doc.turnId = event.id ?? null;
            if (doc.run && event.id) doc.run.nativeId = event.id;
            const session = doc.sessionKey
              ? doc.sessions?.[doc.sessionKey]
              : undefined;
            if (
              event.ready !== false &&
              !current.input.operation &&
              current.input.entryId &&
              session
            )
              session.through = current.input.entryId;
          }
        }
      }, context);
      if (
        event.type !== "compaction" &&
        !(
          event.type === "runtime" &&
          (event.state.notices || event.state.retry)
        )
      )
        return;
    }
    const contentEvent =
      "id" in event &&
      ["tool", "tool_result", "text", "thinking", "message"].includes(
        event.type,
      );
    const key = contentEvent
      ? `${event.id}:${event.type === "thinking" ? "thinking" : event.type === "tool_result" ? "result" : "message"}`
      : `activity:${"id" in event ? `${event.type}:${event.id}` : this.messages.length}`;
    const id = `${this.turnId}:${key}`;
    let message = this.messages.find((item) => item.id === id);
    const now = Date.now();
    if (!message) {
      message = {
        id,
        turnId: this.turnId,
        role: event.type === "tool_result" ? "toolResult" : "assistant",
        content: [],
        stopped: false,
        timestamp: now,
        receivedAt: now,
      };
      this.messages.push(message);
    }
    if (contentEvent)
      for (const previous of this.messages) {
        if (
          previous.id !== id &&
          previous.pending &&
          !previous.content.some((part) => part.type === "toolCall")
        ) {
          previous.pending = false;
          previous.endedAt = now;
        }
      }
    switch (event.type) {
      case "tool":
        message.content = [
          {
            type: "toolCall",
            id: event.id,
            name: event.name,
            arguments: stored(event.input),
            key: id,
          },
        ];
        break;
      case "tool_result":
        Object.assign(message, {
          toolCallId: event.id,
          toolName: event.name,
          isError: event.failed,
          toolStatus: event.failed ? "failed" : "done",
          endedAt: now,
          content: [{ type: "text", text: event.text, key: id }],
          ...(event.attachments ? { attachments: event.attachments } : {}),
        });
        break;
      case "message":
        if (message.pending !== false) message.timestamp = now;
        Object.assign(message, {
          content: [{ type: "text", text: event.text, key: id }],
          pending: false,
          endedAt: now,
        });
        break;
      case "text":
      case "thinking": {
        if (message.pending === false) return;
        const part = message.content[0];
        const previous =
          part?.type === "text"
            ? part.text
            : part?.type === "thinking"
              ? part.thinking
              : "";
        const text = `${event.replace ? "" : previous}${event.text}`;
        message.content = [
          event.type === "text"
            ? { type: "text", text, key: id }
            : { type: "thinking", thinking: text, key: id },
        ];
        message.pending = true;
        break;
      }
      default:
        message.activity = stored(event);
    }
    this.changed = true;
    if (
      (event.type !== "text" && event.type !== "thinking") ||
      now - this.flushed >= engineLimits.flushMs
    )
      await this.flush();
  }
  async flush() {
    if (!this.changed) return;
    const drafts = stored(this.messages);
    await this.runtime.commit(async (tx) => {
      const doc = await tx.doc(EngineDoc, this.runtime.conversationId);
      if (doc.activeId !== this.runtime.taskId) return;
      doc.drafts = drafts;
      doc.runtime = { ...doc.runtime, processing: this.processing };
    }, this.context);
    this.changed = false;
    this.flushed = Date.now();
  }
}
