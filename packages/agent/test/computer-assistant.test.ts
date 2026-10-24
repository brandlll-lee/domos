import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { ComputerAssistance } from "../src/computer/assistance.ts";
import { runAssistant } from "../src/computer/assistant.ts";
import { assistInput } from "../src/computer/assistant-action.ts";
import type { Computers } from "../src/computer/catalog.ts";
import { ComputerServices } from "../src/computer/services.ts";
import { ComputersDoc } from "../src/computer/state.ts";
import { ComputerTools } from "../src/computer/tools.ts";
import { setup } from "./fixtures/work.ts";

afterEach(() => vi.unstubAllGlobals());

import {
  connection,
  input,
  mockChoice,
  observed,
  signal,
} from "./fixtures/computer-assistant.ts";

test.each(["Edit", "AXTextField", "entry", "text", "browser"])(
  "%s compiles one complete action, approves and reobserves",
  async (mode) => {
    let turn = 0;
    const fetcher = mockChoice((criteria) =>
      ++turn === 1
        ? (Object.keys(criteria).find((id) =>
            criteria[id]?.startsWith("Enter supplied"),
          ) ?? "abstain")
        : "review",
    );
    const service = mode === "browser" ? "browser" : "desktop";
    const native = observed(mode);
    if (mode === "text") native.structuredContent.platform = "linux";
    const view =
      service === "browser"
        ? {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  data: { snapshot: '- textbox "Search" [ref=e1]' },
                }),
              },
            ],
          }
        : native;
    const call = vi.fn(async () => view);
    const approve = vi.fn(async (_action: unknown) => true);
    const result = await runAssistant(
      input(service),
      connection,
      call,
      approve,
      signal(),
    );
    expect(result.structuredContent).toMatchObject({
      status: "review",
      actions: [{ status: "delivered" }],
      usage: { inputTokens: 200 },
      timings: { decision: expect.any(Number) },
    });
    expect(call).toHaveBeenCalledTimes(3);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0]?.[0]).toMatchObject({
      args:
        service === "browser"
          ? { selector: "@e1", text: "Rain" }
          : {
              pid: 1,
              window_id: 2,
              element_token: "s1:1",
              value: "Rain",
              delivery_mode: "background",
            },
    });
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1].body));
    expect(Object.keys(request.questions)).toEqual(["next"]);
    expect(JSON.stringify(request)).not.toContain("element_token");
    expect(request.assets).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("test-key");
  },
);

test.each(["denied", "uncertain", "cancelled", "verified"])(
  "%s retains approval, cancellation and evidence boundaries",
  async (mode) => {
    const controller = new AbortController();
    let turn = 0;
    mockChoice((criteria) => {
      if (mode === "cancelled") controller.abort();
      return ++turn === 1
        ? (Object.keys(criteria).find((id) =>
            criteria[id]?.startsWith("Enter supplied"),
          ) ?? "abstain")
        : "review";
    });
    const call = vi.fn(async (name: string) => {
      if (name === "set_value" && mode === "uncertain") throw new Error("lost");
      if (name === "verify_state")
        return {
          content: [],
          structuredContent: { status: "satisfied", stable: true },
        };
      return observed();
    });
    const task = {
      ...input(),
      ...(mode === "verified"
        ? { evidence: { role: "Edit", label: "Search", value: "Rain" } }
        : {}),
    };
    const result = runAssistant(
      task,
      connection,
      call,
      async () => mode !== "denied",
      controller.signal,
    );
    if (mode === "cancelled") {
      await expect(result).rejects.toThrow();
      expect(call).toHaveBeenCalledTimes(1);
    } else
      expect((await result).structuredContent?.status).toBe(
        mode === "verified"
          ? "completed"
          : mode === "uncertain"
            ? "uncertain"
            : "handoff",
      );
  },
);

test("mode gates catalog and invocation; handoffs are explicit, single-use and owner-bound", async () => {
  let enabled = true;
  const services = {
    prepare: vi.fn(async () => ({ available: true })),
    catalog: vi.fn(async () =>
      ["get_window_state", "click"].map((name) => ({
        name,
        inputSchema: {},
        description: name,
      })),
    ),
    call: vi.fn(async () => observed("Button")),
    run: async (
      _bot: number,
      _service: string,
      _owner: string,
      s: AbortSignal,
      work: (s: AbortSignal) => unknown,
    ) => work(s),
    finish: vi.fn(),
  };
  const computers = {
    binding: async () => ({ computerId: "pc", revision: 1 }),
    serviceTarget: async () => ({
      id: "pc",
      target: { services },
      enabled: { desktop: true },
    }),
    assistance: {
      state: async () => ({ enabled }),
      connect: async () => (enabled ? connection : undefined),
    },
    color: async () => "blue",
    transfer: async (_bot: number, work: () => unknown) => work(),
  } as unknown as Computers;
  const tools = new ComputerTools(computers);
  expect((await tools.catalog(1, context)).map((tool) => tool.name)).toEqual([
    "desktop_get_window_state",
    "computer_assist",
  ]);
  const invoke = (name: string, args = {}, owner = "owner") =>
    tools.invoke(1, name, args, owner, signal(), context, async () => true);
  await expect(invoke("desktop_click")).rejects.toThrow("Jev");
  await invoke("desktop_get_window_state");
  mockChoice(() => "abstain");
  const result = await invoke("computer_assist", input());
  const handoff = {
    id: result.structuredContent?.handoffId,
    name: "click",
    args: { element_token: "s1:1" },
  };
  await expect(
    invoke("computer_assist", { ...input(), handoff }, "other"),
  ).resolves.toMatchObject({
    isError: true,
    content: [{ text: expect.stringContaining("交接已失效") }],
  });
  expect(
    (await invoke("computer_assist", { ...input(), handoff })).content,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("main-agent-handoff"),
      }),
    ]),
  );
  expect(services.call).toHaveBeenLastCalledWith(
    1,
    "desktop",
    "click",
    expect.objectContaining({ pid: 1, window_id: 2 }),
    "owner",
    expect.any(AbortSignal),
    context,
    expect.any(Object),
  );
  await expect(
    invoke("computer_assist", { ...input(), handoff }),
  ).resolves.toMatchObject({
    isError: true,
    content: [{ text: expect.stringContaining("交接已失效") }],
  });
  const next = await invoke("computer_assist", input());
  tools.finish("owner");
  await expect(
    invoke("computer_assist", {
      ...input(),
      handoff: { ...handoff, id: next.structuredContent?.handoffId },
    }),
  ).resolves.toMatchObject({
    isError: true,
    content: [{ text: expect.stringContaining("交接已失效") }],
  });
  enabled = false;
  expect((await tools.catalog(1, context)).map((tool) => tool.name)).toContain(
    "desktop_click",
  );
  await invoke("desktop_click");
});

test.each(["stale", "background", "partial", "empty"])(
  "%s refreshes evidence without replaying uncertain work",
  async (mode) => {
    let choice = 0;
    const fetcher = mockChoice((criteria) =>
      ++choice <= (mode === "partial" ? 1 : 2)
        ? (Object.keys(criteria).find((id) =>
            criteria[id]?.startsWith("Click"),
          ) ?? "abstain")
        : "review",
    );
    let reads = 0;
    let actions = 0;
    const call = vi.fn(async (name: string) => {
      if (name !== "get_window_state") {
        if (++actions === 1 && ["stale", "background"].includes(mode))
          return {
            content: [],
            isError: mode === "stale",
            structuredContent:
              mode === "stale"
                ? { code: "stale_element_token" }
                : {
                    status: "refused",
                    refusal: { code: "background_unavailable" },
                  },
          };
        return { content: [] };
      }
      const view = observed("Button");
      const state = view.structuredContent;
      state.elements =
        mode === "empty"
          ? []
          : (state.elements as Record<string, unknown>[]).map((item) => ({
              ...item,
              element_token: `s${++reads}:1`,
            }));
      if (mode === "partial" && reads === 1) state.truncated = true;
      return view;
    });
    const approve = vi.fn(async () => true);
    const result = await runAssistant(
      assistInput.parse({ ...input(), allow_foreground: true }),
      connection,
      call,
      approve,
      signal(),
    );
    expect(result.structuredContent?.status).toBe(
      mode === "empty" ? "handoff" : "review",
    );
    if (mode === "empty") expect(fetcher).not.toHaveBeenCalled();
    else {
      expect(approve.mock.calls).toHaveLength(mode === "partial" ? 1 : 2);
      if (mode === "partial")
        expect(call.mock.calls[1]?.[0]).toBe("get_window_state");
      if (mode === "background")
        expect(JSON.stringify(result.structuredContent?.decisions)).toContain(
          ":foreground",
        );
      if (mode === "stale")
        expect(call).toHaveBeenCalledWith(
          "click",
          expect.objectContaining({ element_token: "s2:1" }),
          expect.any(AbortSignal),
        );
    }
  },
);

test.each([3, 12])(
  "%i declared steps count only delivered actions and verify without another decision",
  async (times) => {
    const fetcher = mockChoice(
      (criteria) =>
        Object.keys(criteria).find((id) => criteria[id]?.startsWith("Click")) ??
        "abstain",
      0.6,
    );
    const call = vi.fn(async (name: string) =>
      name === "verify_state"
        ? {
            content: [],
            structuredContent: { status: "satisfied", stable: true },
          }
        : observed("Button"),
    );
    const task = assistInput.parse({
      ...input(),
      steps: [{ role: "Button", label: "Search", action: "click", times }],
      evidence: {
        role: "Text",
        label: "Counter",
        value: String(times),
        timeout_ms: 3000,
      },
    });
    const result = await runAssistant(
      task,
      connection,
      call,
      async () => true,
      signal(),
    );
    expect(result.structuredContent).toMatchObject({
      status: "completed",
      progress: [{ performed: times }],
    });
    expect(fetcher).toHaveBeenCalledTimes(times);
    expect(call.mock.calls.filter(([name]) => name === "click")).toHaveLength(
      times,
    );
    expect(call).toHaveBeenCalledWith(
      "verify_state",
      expect.objectContaining({ timeout_ms: 3000 }),
      expect.any(AbortSignal),
    );
  },
);

test("computer ownership spans decision waits", async () => {
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
