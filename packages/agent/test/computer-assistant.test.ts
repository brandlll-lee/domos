import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { ComputerAssistance } from "../src/computer/assistance.ts";
import { runAssistant } from "../src/computer/assistant.ts";
import { assistInput } from "../src/computer/assistant-action.ts";
import { askJev } from "../src/computer/jev.ts";
import { ComputerServices } from "../src/computer/services.ts";
import { ComputersDoc } from "../src/computer/state.ts";
import type { ProductResult } from "../src/harness/types.ts";
import { setup } from "./fixtures/work.ts";

afterEach(() => vi.unstubAllGlobals());
const signal = () => new AbortController().signal;
const choice = (value: string) => ({
  type: "choice",
  choice: value,
  confidence: 0.99,
});
function answer(action: string, target: unknown = choice("button")) {
  return {
    model: "jev-1.14.0",
    answers: {
      safe: { type: "noul", noul: 0.99 },
      action: choice(action),
      target,
      present: { type: "noul", noul: 0.99 },
    },
    usage: { input_tokens: 100, output_tokens: 10 },
  };
}
const observed = (service: string, pixels = false): ProductResult => ({
  content:
    service === "browser"
      ? [
          {
            type: "text",
            text: JSON.stringify({
              data: { snapshot: '- button "Play" [ref=e1]' },
            }),
          },
        ]
      : [
          { type: "text", text: "Player" },
          ...(pixels
            ? [
                {
                  type: "image" as const,
                  data: "aW1hZ2U=",
                  mimeType: "image/png",
                },
              ]
            : []),
        ],
  structuredContent: {
    elements: pixels
      ? []
      : [{ element_token: "button", label: "Play", role: "button" }],
    screenshot_width: 1000,
    screenshot_height: 500,
  },
});

test.each(["typesafe", "openrouter"] as const)(
  "%s uses the fixed System One endpoint and bounds responses",
  async (provider) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(answer("done")));
    vi.stubGlobal("fetch", fetcher);
    await askJev(provider, "test-key", {}, {}, signal());
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      provider === "typesafe"
        ? "https://api.typesafe.ai/v1/systemone"
        : "https://openrouter.ai/api/v1/systemone",
    );
    expect(JSON.parse(String(init.body)).model).toBe(
      provider === "typesafe" ? "jev-1.14.0" : "typesafe/jev-1.14",
    );
    expect(init.redirect).toBe("error");
    fetcher.mockResolvedValueOnce(new Response("x".repeat(65537)));
    await expect(
      askJev(provider, "test-key", {}, {}, signal()),
    ).rejects.toThrow("响应过大");
    fetcher.mockResolvedValueOnce(
      new Response("private upstream body", { status: 401 }),
    );
    await expect(
      askJev(provider, "test-key", {}, {}, signal()),
    ).rejects.toThrow(`辅助决策请求失败（${provider}，HTTP 401）`);
  },
);

test.each(["controls", "pixels", "fallback", "browser"])(
  "%s observes, approves, executes and checks fresh evidence",
  async (mode) => {
    const service = mode === "browser" ? "browser" : "desktop";
    const pixelTarget = mode === "pixels" || mode === "fallback";
    const target = pixelTarget
      ? {
          type: "box",
          box: { left: 0.2, right: 0.4, top: 0.4, bottom: 0.6 },
          confidence: 0.99,
        }
      : choice(service === "browser" ? "@e1" : "button");
    const fetcher = vi.fn();
    if (mode === "fallback")
      fetcher.mockResolvedValueOnce(
        Response.json(answer("type_0", choice("none"))),
      );
    fetcher
      .mockResolvedValueOnce(Response.json(answer("type_0", target)))
      .mockResolvedValueOnce(Response.json(answer("done", target)));
    vi.stubGlobal("fetch", fetcher);
    const call = vi.fn(
      async (
        _name: string,
        _args: Record<string, unknown>,
        _signal: AbortSignal,
      ) => {
        const result = observed(service, pixelTarget);
        if (mode === "fallback")
          result.structuredContent = {
            ...result.structuredContent,
            elements: [
              { element_token: "other", role: "button", label: "Other" },
            ],
          };
        return result;
      },
    );
    const approve = vi.fn(async () => true);
    const result = await runAssistant(
      assistInput.parse({
        service,
        goal: "Search Rain",
        completion: "Rain is listed",
        window: { pid: 1, window_id: 2 },
        inputs: [{ purpose: "search", text: "Rain" }],
      }),
      { provider: "typesafe", key: "test-key" },
      call,
      approve,
      signal(),
    );
    expect(result.structuredContent).toMatchObject({
      status: "completed",
      usage: { inputTokens: mode === "fallback" ? 300 : 200 },
      actions: [{ status: "delivered" }],
    });
    expect(call).toHaveBeenCalledTimes(mode === "fallback" ? 4 : 3);
    expect(approve).toHaveBeenCalledTimes(1);
    const args = call.mock.calls[mode === "fallback" ? 2 : 1]?.[1];
    if (service === "browser")
      expect(args).toEqual({ selector: "@e1", text: "Rain" });
    else
      expect(args).toMatchObject({
        pid: 1,
        window_id: 2,
        delivery_mode: "background",
        text: "Rain",
        ...(pixelTarget ? { x: 300, y: 250 } : { element_token: "button" }),
      });
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(Boolean(request.assets)).toBe(mode === "pixels");
    expect(JSON.stringify(result)).not.toContain("test-key");
  },
);

test.each(["denied", "uncertain", "low confidence", "malformed box"])(
  "%s stops without replay",
  async (mode) => {
    const data = answer(
      "click",
      mode === "malformed box"
        ? {
            type: "box",
            box: { left: 0.9, right: 0.1, top: 0, bottom: 1 },
            confidence: 1,
          }
        : choice("button"),
    );
    if (mode === "low confidence") data.answers.safe.noul = 0.4;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(data)),
    );
    const call = vi.fn(async (name: string) => {
      if (name === "click") throw new Error("connection lost");
      return observed("desktop");
    });
    const result = await runAssistant(
      assistInput.parse({
        service: "desktop",
        goal: "Play",
        completion: "Playing",
        window: { pid: 1, window_id: 2 },
      }),
      { provider: "typesafe", key: "test-key" },
      call,
      async () => mode !== "denied",
      signal(),
    );
    expect(result.structuredContent?.status).toBe(
      mode === "uncertain" ? "uncertain" : "handoff",
    );
    expect(call).toHaveBeenCalledTimes(mode === "uncertain" ? 2 : 1);
  },
);

test("takeover cancels an in-flight decision before it can execute", async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      controller.abort();
      return Response.json(answer("click"));
    }),
  );
  const call = vi.fn(async () => observed("desktop"));
  await expect(
    runAssistant(
      assistInput.parse({
        service: "desktop",
        goal: "Play",
        completion: "Playing",
        window: { pid: 1, window_id: 2 },
      }),
      { provider: "typesafe", key: "test-key" },
      call,
      async () => true,
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(1);
});

test("computer control covers decision waits and rejects a competing owner", async () => {
  const services = new ComputerServices(async () => {
    throw new Error("Worker not needed");
  });
  const pending = services
    .run(1, "desktop", "first", signal(), async (controlled) => {
      await new Promise<void>((resolve) =>
        controlled.addEventListener("abort", () => resolve(), { once: true }),
      );
    })
    .catch((error: Error) => error.message);
  await expect(
    services.run(2, "desktop", "second", signal(), async () => {}),
  ).rejects.toThrow("其他任务");
  const lease = await services.takeover(1, "desktop");
  expect(await pending).toContain("待核对");
  await services.release(1, "desktop", lease);
  services.finish("first");
  await services.close();
});

test("provider keys stay separate and settings expose only presence", async () => {
  const runtime = await (await setup()).open();
  onTestFinished(() => runtime.harness.close(context));
  const credentials = new InMemoryCredentialStore();
  const assistance = new ComputerAssistance(runtime.harness, credentials);
  await assistance.saveKey("typesafe", "official-test-key");
  await runtime.harness.commit(async (tx) => {
    const doc = await tx.doc(ComputersDoc);
    doc.items.push({
      id: "process",
      name: "Work",
      config: { kind: "process" },
      authorized: true,
    });
    doc.bindings["1"] = {
      computerId: "process",
      revision: 0,
      requestId: "test",
    };
  }, context);
  await expect(
    assistance.configure(
      1,
      { computerId: "other", revision: 0, provider: "typesafe", enabled: true },
      context,
    ),
  ).rejects.toThrow("工作电脑已改变");
  await assistance.configure(
    1,
    { computerId: "process", revision: 0, provider: "typesafe", enabled: true },
    context,
  );
  await expect(
    assistance.configure(
      1,
      {
        computerId: "process",
        revision: 0,
        provider: "typesafe",
        enabled: false,
      },
      context,
    ),
  ).rejects.toThrow();
  expect(await assistance.connect(1, context)).toEqual({
    provider: "typesafe",
    key: "official-test-key",
  });
  expect(await assistance.state(1, context)).toMatchObject({
    enabled: true,
    configured: { typesafe: true, openrouter: false },
  });
  await assistance.saveKey("openrouter", "router-test-key");
  await assistance.saveKey("typesafe", "");
  expect(await assistance.state(1, context)).toMatchObject({
    configured: { typesafe: false, openrouter: true },
  });
  expect(JSON.stringify(await assistance.state(1, context))).not.toContain(
    "test-key",
  );
});
