import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openChat } from "@domos/agent/chat";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { expect, onTestFinished, test, vi } from "vitest";
import { reply } from "../src/chat.ts";

const context = BACKGROUND_CONTEXT;

async function database() {
  const directory = await mkdtemp(join(tmpdir(), "domos-chat-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "agent.sqlite");
}

function credentials(key = "local-test-key") {
  vi.stubEnv("DEEPSEEK_API_KEY", key);
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
}

test("streams through the DeepSeek adapter and sends saved history after reopening", async () => {
  credentials();
  const file = await database();
  const partial = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe("https://api.deepseek.com/chat/completions");
      expect(request.headers.get("authorization")).toBe(
        "Bearer local-test-key",
      );
      const body = await request.json();
      requests.push(body);
      expect(body.model).toBe("deepseek-flash");
      expect(body.stream).toBe(true);
      const first = requests.length === 1;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const delta = (value: object, finish: string | null = null) => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id: "chat-completion",
                  object: "chat.completion.chunk",
                  created: 1,
                  model: "deepseek-flash",
                  choices: [{ index: 0, delta: value, finish_reason: finish }],
                })}\n\n`,
              ),
            );
          };
          delta({ role: "assistant", reasoning_content: "Test reasoning" });
          delta({ content: first ? "Hello" : "Remembered" });
          if (first) {
            await release.promise;
            delta({ content: " world" });
          }
          delta({}, "stop");
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  );
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  const first = await openChat(file, context);
  let output = "";
  try {
    const waiting = reply(
      first.conversation,
      "Remember this.",
      context,
      (text) => {
        output += text;
        if (output === "Hello") partial.resolve();
      },
    );
    try {
      await partial.promise;
      expect(output).toBe("Hello");
    } finally {
      release.resolve();
    }
    expect(await waiting).toBe(true);
    expect(output).toBe("Hello world");
  } finally {
    release.resolve();
    await first.harness.close(context);
  }
  const second = await openChat(file, context);
  try {
    expect(second.conversation.id).toBe(first.conversation.id);
    output = "";
    expect(
      await reply(second.conversation, "What did I say?", context, (text) => {
        output += text;
      }),
    ).toBe(true);
    expect(output).toBe("Remembered");
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "Remember this." }),
        expect.objectContaining({ role: "assistant", content: "Hello world" }),
        expect.objectContaining({ role: "user", content: "What did I say?" }),
      ]),
    );
  } finally {
    await second.harness.close(context);
  }
});

test("a provider failure does not print credential-bearing error details", async () => {
  credentials();
  const file = await database();
  vi.stubGlobal("fetch", async () =>
    Response.json(
      {
        error: {
          message: "Rejected local-test-key",
          type: "authentication_error",
        },
      },
      { status: 401 },
    ),
  );
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  const { harness, conversation } = await openChat(file, context);
  let output = "";
  try {
    expect(
      await reply(conversation, "Hello", context, (text) => {
        output += text;
      }),
    ).toBe(false);
    expect(output).toBe("");
  } finally {
    await harness.close(context);
  }
});

test("an empty credential fails before a model request", async () => {
  credentials("");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  await expect(openChat(await database(), context)).rejects.toThrow(
    "请在 .env 中填写 DEEPSEEK_API_KEY。",
  );
  expect(fetch).not.toHaveBeenCalled();
});
