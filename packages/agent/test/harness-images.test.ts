import { expect, onTestFinished, test } from "vitest";
import { engineProvider } from "../src/harness/providers/index.ts";
import type { EngineId } from "../src/harness/types.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

const image = {
  type: "image" as const,
  mimeType: "image/png",
  data: "iVBORw0KGgo=",
};

test.each<EngineId>(["pi", "codex", "claude", "opencode"])(
  "%s sends image bytes through its native protocol",
  async (provider) => {
    const process = new ProtocolProcess();
    onTestFinished(() => process.close());
    let prompt: unknown;
    process.receive = (request) => {
      if (request.type === "get_state")
        process.frame({
          type: "response",
          id: request.id,
          success: true,
          data: {
            sessionFile: "/work/pi.jsonl",
            model: { input: ["text", "image"] },
          },
        });
      else if (request.type === "prompt") {
        prompt = request;
        process.frame({
          type: "response",
          id: request.id,
          success: true,
          data: {},
        });
        process.frame({ type: "agent_settled" });
      } else if (request.type === "user") {
        prompt = request.message;
        process.frame({ type: "result", is_error: false });
      } else if (request.method === "initialize")
        process.response(request, {
          protocolVersion: 1,
          agentCapabilities: { promptCapabilities: { image: true } },
        });
      else if (request.method === "thread/start")
        process.response(request, { thread: { id: "native" } });
      else if (request.method === "turn/start") {
        prompt = request.params?.input;
        process.response(request, { turn: { id: "turn" } });
        process.frame({
          method: "turn/completed",
          params: { turn: { status: "completed" } },
        });
      } else if (request.method === "session/new")
        process.response(request, { sessionId: "native" });
      else if (request.method === "session/prompt") {
        prompt = request.params?.prompt;
        process.response(request, { stopReason: "end_turn" });
      } else if (request.id !== undefined) {
        if (provider === "pi")
          process.frame({
            type: "response",
            id: request.id,
            success: true,
            data: {},
          });
        else process.response(request, {});
      }
    };
    const session = await engineProvider(provider).open({
      process,
      config: { provider, model: null },
      sessionId: null,
      instructions: "Test",
      emit: async () => {},
    });
    await session.prompt("Describe", [image]);
    if (provider === "pi")
      expect(prompt).toMatchObject({ message: "Describe", images: [image] });
    if (provider === "codex")
      expect(prompt).toEqual([
        { type: "text", text: "Describe" },
        { type: "image", url: `data:image/png;base64,${image.data}` },
      ]);
    if (provider === "claude")
      expect(prompt).toEqual({
        role: "user",
        content: [
          { type: "text", text: "Describe" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: image.mimeType,
              data: image.data,
            },
          },
        ],
      });
    if (provider === "opencode")
      expect(prompt).toEqual([{ type: "text", text: "Describe" }, image]);
  },
);

test("OpenCode rejects images when the negotiated protocol does not support them", async () => {
  const process = new ProtocolProcess();
  onTestFinished(() => process.close());
  process.receive = (request) =>
    process.response(
      request,
      request.method === "initialize"
        ? { protocolVersion: 1, agentCapabilities: {} }
        : { sessionId: "native" },
    );
  const session = await engineProvider("opencode").open({
    process,
    config: { provider: "opencode", model: null },
    sessionId: null,
    instructions: "Test",
    emit: async () => {},
  });
  await expect(session.prompt("Describe", [image])).rejects.toThrow("图片");
  expect(
    process.requests.some((request) => request.method === "session/prompt"),
  ).toBe(false);
});

test.each(["pi", "codex"] as const)(
  "%s reports the selected model's declared image capability",
  async (provider) => {
    const process = new ProtocolProcess();
    onTestFinished(() => process.close());
    process.receive = (request) => {
      if (provider === "pi")
        process.frame({
          type: "response",
          id: request.id,
          success: true,
          data:
            request.type === "get_state"
              ? { sessionFile: "/work/pi.jsonl", model: { input: ["text"] } }
              : {},
        });
      else
        process.response(
          request,
          request.method === "thread/start"
            ? { thread: { id: "native" } }
            : request.method === "model/list"
              ? {
                  data: [
                    {
                      id: "selected",
                      model: "selected",
                      displayName: "Selected",
                      inputModalities: ["text"],
                      isDefault: true,
                    },
                  ],
                }
              : {},
        );
    };
    const session = await engineProvider(provider).open({
      process,
      config: { provider, model: null },
      sessionId: null,
      instructions: "Test",
      emit: async () => {},
    });
    expect(await session.vision?.()).toBe(false);
    await expect(session.prompt("Describe", [image])).rejects.toThrow("模型");
  },
);
