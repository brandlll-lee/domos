import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { ConversationView } from "@earendil-works/pi-durable";
import { expect, onTestFinished, test } from "vitest";
import { chatView } from "../src/chat-view.ts";
import { EngineProjection } from "../src/harness/projection.ts";
import { providers } from "../src/harness/providers/index.ts";
import { EngineMessage, type EngineState } from "../src/harness/state.ts";
import { type EngineRuntime, userMessage } from "../src/harness/task-types.ts";
import { messageText } from "../src/messages.ts";
import { chatTranscript } from "../src/transcript.ts";
import { ProtocolProcess, type Request } from "./fixtures/engine-process.ts";

test.each([...providers.values()])(
  "$id keeps completed replies in arrival order during tools and later input",
  async (provider) => {
    const process = new ProtocolProcess();
    onTestFinished(() => process.close());
    const state = {
      config: { provider: provider.id, model: null },
      tasks: [1],
      activeId: 1,
      activeTurn: "first",
      drafts: [],
      approvals: [],
    } as unknown as EngineState;
    const runtime = {
      taskId: 1,
      conversationId: 1,
      commit: async (
        action: (tx: object, current: { input: object }) => Promise<unknown>,
      ) => action({ doc: async () => state }, { input: {} }),
    } as unknown as EngineRuntime;
    const projection = new EngineProjection(runtime, "first", context, []);
    const entries = [
      { kind: EngineMessage, data: userMessage("first", "Check HKD") },
    ];
    const visible = () =>
      chatTranscript(
        chatView(
          {
            conversation: { id: 1 },
            docs: {},
            entries,
          } as unknown as ConversationView,
          state,
        ),
      ).flatMap((item) => (item.kind === "message" ? [item.message] : []));
    const started = Promise.withResolvers<void>();
    let prompt: Request | undefined;
    let history: unknown[] = [];
    process.request = async <T>() => history as T;
    process.receive = (request) => {
      if (provider.id === "pi") {
        process.frame({
          type: "response",
          id: request.id,
          success: true,
          data:
            request.type === "get_state"
              ? { sessionFile: "/work/session" }
              : {},
        });
      } else if (request.id !== undefined) {
        if (request.method === "session/prompt") prompt = request;
        else
          process.response(
            request,
            request.method === "thread/start"
              ? { thread: { id: "native" } }
              : request.method === "turn/start"
                ? { turn: { id: "turn" } }
                : request.method === "session/new"
                  ? { sessionId: "native" }
                  : request.method === "initialize"
                    ? { protocolVersion: 1, agentCapabilities: {} }
                    : {},
          );
      }
      if (
        request.type === "prompt" ||
        request.type === "user" ||
        request.method === "turn/start" ||
        request.method === "session/prompt"
      )
        started.resolve();
    };
    const session = await provider.open({
      process,
      config: state.config,
      sessionId: null,
      instructions: "",
      emit: async (event) => {
        if (event.type !== "context" && event.type !== "usage") {
          await projection.emit(event);
          await projection.flush();
        }
      },
    });
    const run = session.prompt("Check HKD");
    void run.catch(() => {});
    await started.promise;
    const chunk = (id: string, text: string) => {
      if (provider.id === "pi") {
        process.frame({
          type: "message_start",
          message: { role: "assistant" },
        });
        process.frame({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: text },
        });
      } else if (provider.id === "claude") {
        process.frame({
          type: "stream_event",
          event: { type: "message_start", message: { id } },
        });
        process.frame({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { text } },
        });
      } else if (provider.id === "codex") {
        process.frame({
          method: "item/agentMessage/delta",
          params: { itemId: id, delta: text },
        });
      } else {
        process.frame({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "native",
            update: {
              sessionUpdate: "agent_message_chunk",
              messageId: id,
              content: { type: "text", text },
            },
          },
        });
      }
    };
    const complete = (id: string, text: string) => {
      if (provider.id === "pi")
        process.frame({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "toolUse",
            content: [{ type: "text", text }],
          },
        });
      else if (provider.id === "claude")
        process.frame({
          type: "assistant",
          uuid: `${id}:text`,
          message: { id, content: [{ type: "text", text }] },
        });
      else if (provider.id === "codex")
        process.frame({
          method: "item/completed",
          params: { item: { id, type: "agentMessage", text } },
        });
      else
        process.frame({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "native",
            update: {
              sessionUpdate: "tool_call",
              toolCallId: `${id}:tool`,
              title: "Read",
              status: "in_progress",
            },
          },
        });
    };
    chunk("progress", "Checking sources");
    await expect.poll(() => state.drafts.length).toBeGreaterThan(0);
    entries.push({
      kind: EngineMessage,
      data: userMessage("second", "Also USD"),
    });
    complete("progress", "Checking sources");
    await expect
      .poll(() => visible().map(messageText))
      .toEqual(["Check HKD", "Also USD", "Checking sources"]);
    const first = visible().at(-1);
    if (provider.id === "claude") {
      process.frame({
        type: "assistant",
        uuid: "tool",
        message: {
          id: "progress",
          content: [{ type: "tool_use", id: "tool", name: "Read" }],
        },
      });
      await expect
        .poll(() =>
          state.drafts.some((message) =>
            message.content.some((part) => part.type === "toolCall"),
          ),
        )
        .toBe(true);
      expect(visible().map(messageText).at(-1)).toBe("Checking sources");
      process.frame({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { text: "More detail" } },
      });
      process.frame({
        type: "assistant",
        uuid: "detail",
        message: {
          id: "progress",
          content: [{ type: "text", text: "More detail" }],
        },
      });
      await expect
        .poll(() => visible().map(messageText).at(-1))
        .toBe("Checking sources\n\nMore detail");
    }
    chunk("final", "Done");
    complete("final", "Done");
    chunk("blank", "\n\n");
    complete("blank", "\n\n");
    if (provider.id === "pi") process.frame({ type: "agent_settled" });
    else if (provider.id === "claude") process.frame({ type: "result" });
    else if (provider.id === "codex")
      process.frame({
        method: "turn/completed",
        params: { turn: { status: "completed" } },
      });
    else {
      expect(prompt?.params?.prompt).toEqual([
        { type: "text", text: "Check HKD" },
      ]);
      history = ["progress", "final", "blank"].map((id, index) => ({
        info: { id, role: "assistant" },
        parts: [
          { type: "text", text: ["Checking sources", "Done", "\n\n"][index] },
        ],
      }));
      if (!prompt) throw new Error("Prompt required");
      process.response(prompt, { stopReason: "end_turn" });
    }
    await run;
    await projection.flush();
    const messages = visible();
    expect(messages.map(messageText)).toEqual([
      "Check HKD",
      "Also USD",
      provider.id === "claude"
        ? "Checking sources\n\nMore detail"
        : "Checking sources",
      "Done",
    ]);
    expect(messages[2]?.id).toBe(first?.id);
    expect(messages[2]?.timestamp).toBe(first?.timestamp);
    expect(new Set(messages.map((message) => message.id)).size).toBe(
      messages.length,
    );
  },
);
