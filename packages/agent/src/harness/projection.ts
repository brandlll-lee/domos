import type { Context } from "@earendil-works/chord/context";
import { RoutinesDoc } from "../work/routine-state.ts";
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
  private readonly changed = new Set<StoredMessage>();
  private readonly events: EngineEvent[] = [];
  private writing?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private failure?: unknown;
  private processing = false;
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
    if (this.failure) throw this.failure;
    const now = event.recovered
      ? event.timestamp
      : (event.receivedAt ?? Date.now());
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
      this.events.push(event);
      if (event.type === "session" || event.type === "accepted") {
        await this.flush();
        return;
      }
      this.schedule();
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
    if (!message) {
      message = {
        id,
        turnId: this.turnId,
        role: event.type === "tool_result" ? "toolResult" : "assistant",
        content: [],
        stopped: false,
        timestamp: now,
        ...(!event.recovered ? { receivedAt: now } : {}),
      };
      this.messages.push(message);
    }
    if (event.native)
      message.native = stored({ ...message.native, ...event.native });
    if (event.parentId) message.parentId = event.parentId;
    if (contentEvent)
      for (const previous of this.messages) {
        if (
          previous.id !== id &&
          previous.pending &&
          !previous.content.some((part) => part.type === "toolCall")
        ) {
          previous.pending = false;
          previous.endedAt ??= now;
          this.changed.add(previous);
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
          ...(!event.recovered ? { updatedAt: now } : {}),
          toolName: event.name,
          isError: event.failed,
          toolStatus: event.partial
            ? "running"
            : event.failed
              ? "failed"
              : "done",
          ...(!event.partial
            ? {
                endedAt:
                  event.endedAt ?? (event.recovered ? message.endedAt : now),
              }
            : {}),
          content: [
            {
              type: "text",
              text: `${event.append && message.content[0]?.type === "text" ? message.content[0].text : ""}${event.text}`,
              key: id,
            },
          ],
          ...(event.attachments ? { attachments: event.attachments } : {}),
        });
        break;
      case "message":
        if (message.pending !== false && now !== undefined)
          message.timestamp = now;
        Object.assign(message, {
          content: [{ type: "text", text: event.text, key: id }],
          pending: false,
          endedAt: event.endedAt ?? (event.recovered ? message.endedAt : now),
        });
        break;
      case "text":
      case "thinking": {
        if (message.pending === false && !event.replace) return;
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
        message.pending = !event.recovered;
        break;
      }
      default:
        message.activity = stored(event);
    }
    this.changed.add(message);
    this.schedule();
    if (event.type !== "text" && event.type !== "thinking")
      void this.flush().catch((error) => {
        this.failure = error;
      });
  }
  private schedule() {
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch((error) => {
        this.failure = error;
      });
    }, engineLimits.flushMs);
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.failure) return Promise.reject(this.failure);
    this.writing ??= this.write()
      .catch((error) => {
        this.failure = error;
        throw error;
      })
      .finally(() => {
        this.writing = undefined;
      });
    return this.writing;
  }
  private async write() {
    while (this.changed.size || this.events.length) {
      const drafts = [...this.changed].map((message) => stored(message));
      const events = this.events.splice(0);
      this.changed.clear();
      const { runtime, context } = this;
      await runtime.commit(async (tx, current) => {
        const doc = await tx.doc(EngineDoc, runtime.conversationId);
        if (doc.activeId !== runtime.taskId) return;
        for (const event of events) {
          switch (event.type) {
            case "usage":
              if (doc.run && event.usage.model)
                doc.run.model = event.usage.model;
              (await tx.doc(UsageTaskDoc, runtime.taskId)).items[
                event.usage.id
              ] = event.usage;
              break;
            case "context":
            case "compaction":
              await projectContext(tx, doc, runtime, event);
              break;
            case "runtime": {
              const notices = {
                ...doc.runtime?.notices,
                ...event.state.notices,
              };
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
                  doc.sessions[doc.sessionKey] = {
                    id: event.id,
                    through: null,
                  };
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
        }
        const run = current.input.routineRunId
          ? (await tx.doc(RoutinesDoc)).runs.find(
              (run) => run.id === current.input.routineRunId,
            )
          : undefined;
        for (const draft of drafts) {
          if (run?.delivery === "conditional") {
            draft.routine = {
              runId: run.id,
              title: run.title,
              scheduledAt: run.scheduledAt,
              turnId: current.input.turnId,
              delivery: run.delivery,
            };
            if (
              run.delivery === "conditional" &&
              !draft.approval &&
              !draft.takeover
            )
              draft.hidden = true;
          }
          const index = doc.drafts.findIndex((item) => item.id === draft.id);
          if (index < 0) doc.drafts.push(draft);
          else doc.drafts[index] = draft;
        }
        doc.runtime = { ...doc.runtime, processing: this.processing };
      }, context);
    }
  }
}
