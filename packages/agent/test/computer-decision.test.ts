import { afterEach, expect, test, vi } from "vitest";
import { assistInput } from "../src/computer/assistant-action.ts";
import { candidates } from "../src/computer/assistant-candidates.ts";
import { continuation } from "../src/computer/assistant-task.ts";
import { visualCandidates } from "../src/computer/assistant-visual.ts";
import { askJev } from "../src/computer/jev.ts";
import {
  input,
  mockChoice,
  observed,
  signal,
} from "./fixtures/computer-assistant.ts";

afterEach(() => vi.unstubAllGlobals());

test.each(["typesafe", "openrouter"] as const)(
  "%s uses a bounded fixed endpoint and rejects unknown candidates",
  async (provider) => {
    const fetcher = mockChoice(() => "ready");
    const questions = {
      connection: {
        type: "choice" as const,
        instructions: "Select ready",
        criteria: { ready: "ready" },
      },
    };
    await askJev(provider, "test-key", {}, questions, signal());
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      provider === "typesafe"
        ? "https://api.typesafe.ai/v1/systemone"
        : "https://openrouter.ai/api/v1/systemone",
    );
    expect(fetcher.mock.calls[0]?.[1].redirect).toBe("error");
    fetcher.mockResolvedValueOnce(new Response("x".repeat(65537)));
    await expect(
      askJev(provider, "test-key", {}, questions, signal()),
    ).rejects.toThrow("响应过大");
    fetcher.mockResolvedValueOnce(
      new Response("private upstream body", { status: 401 }),
    );
    await expect(
      askJev(provider, "test-key", {}, questions, signal()),
    ).rejects.toThrow("HTTP 401");
    mockChoice(() => "invented");
    await expect(
      askJev(provider, "test-key", {}, questions, signal()),
    ).rejects.toThrow("候选无效");
  },
);

test("native candidates retain partial and reject disabled, ambiguous and malformed controls", () => {
  const view = observed("Button");
  const state = view.structuredContent ?? {};
  const element = (state.elements as Record<string, unknown>[])[0] ?? {};
  state.elements = [
    element,
    { ...element, element_token: "s1:2" },
    { ...element, label: "Disabled", enabled: false },
    { ...element, label: "Hidden", frame: { x: 20, y: 0, w: 0, h: 20 } },
  ];
  expect(
    Object.values(candidates(input(), view).table).some((item) => item.action),
  ).toBe(false);
  state.elements = [element];
  state.truncated = true;
  expect(
    Object.values(candidates(input(), view).table).some((item) => item.action),
  ).toBe(true);
});

test("task relevance keeps late controls; steps, risks and values bound the menu", () => {
  const view = observed("Button");
  const state = view.structuredContent;
  const element = (state.elements as Record<string, unknown>[])[0] ?? {};
  state.elements = Array.from({ length: 195 }, (_, i) => ({
    ...element,
    label: `Other ${i}`,
    element_token: `s1:${i}`,
  }));
  (state.elements as unknown[]).push(
    { ...element, label: "Devin Local", element_token: "s1:200" },
    { ...element, label: "Send", element_token: "s1:201" },
  );
  const task = assistInput.parse({
    ...input(),
    steps: [
      { role: "Button", label: "Devin Local", action: "click" },
      { role: "Button", label: "Send", action: "click" },
    ],
    allowed_risks: ["send"],
  });
  const first = candidates(task, view);
  expect(Object.keys(first.table)).toHaveLength(27);
  expect(
    Object.values(first.table).find((item) => item.label === "Devin Local")
      ?.step,
  ).toBe(0);
  expect(Object.values(first.table).some((item) => item.label === "Send")).toBe(
    false,
  );
  expect(
    Object.values(candidates(task, view, [1, 0]).table).find(
      (item) => item.label === "Send",
    )?.step,
  ).toBe(1);
  expect(
    Object.values(
      candidates({ ...task, allowed_risks: [] }, view, [1]).table,
    ).some((item) => item.label === "Send"),
  ).toBe(false);
  const field = observed();
  field.structuredContent.elements = [
    {
      ...(field.structuredContent.elements as Record<string, unknown>[])[0],
      value: "Rain",
    },
  ];
  expect(
    Object.values(candidates(input(), field).table).some((item) => item.action),
  ).toBe(false);
  const staticText = observed("Text");
  staticText.structuredContent.platform = "win32";
  expect(
    Object.values(candidates(input(), staticText).table).some(
      (item) => item.action,
    ),
  ).toBe(false);
  staticText.structuredContent.platform = "linux";
  expect(
    Object.values(candidates(input(), staticText).table).find(
      (item) => item.action,
    )?.action?.name,
  ).toBe("set_value");
});

test("candidate identities survive new tokens and distinguish ancestor paths", () => {
  const view = observed("Button");
  const element =
    (view.structuredContent.elements as Record<string, unknown>[])[0] ?? {};
  const key = Object.keys(candidates(input(), view).table)[0];
  element.element_token = "s2:99";
  expect(Object.keys(candidates(input(), view).table)[0]).toBe(key);
  view.structuredContent.elements = [
    { ...element, element_index: 1, parent_index: 10 },
    { ...element, element_index: 2, parent_index: 20 },
    { role: "Group", label: "Left", element_index: 10 },
    { role: "Group", label: "Right", element_index: 20 },
  ];
  expect(
    Object.values(candidates(input(), view).table).filter(
      (item) => item.action,
    ),
  ).toHaveLength(2);
  const handoff = {
    ...input(),
    handoff: { id: "test", name: "click", args: { element_token: "s2:99" } },
  };
  expect(continuation(handoff).args).toMatchObject({ pid: 1, window_id: 2 });
  expect(() =>
    continuation({
      ...handoff,
      handoff: { ...handoff.handoff, args: { pid: 3 } },
    }),
  ).toThrow("窗口");
  expect(() =>
    continuation({
      ...handoff,
      handoff: { ...handoff.handoff, args: { element_token: "s2:99", x: 1 } },
    }),
  ).toThrow("坐标");
});

const visual = () => ({
  schema: "cua.visual_regions_v1",
  capture: {
    capture_id: "capture",
    source: { kind: "window", pid: 1, window_id: 2 },
    screenshot: {
      mime_type: "image/png",
      reference: "capture.png",
      width: 1000,
      height: 500,
    },
    action_coordinate_space: { kind: "screenshot_pixels" },
  },
  regions: [
    {
      id: "play",
      kind: "text",
      text: "Play",
      interactive: true,
      confidence: 0.99,
      bounds: { x: 20, y: 30, width: 40, height: 20 },
    },
  ],
});
test("visual candidates keep capture-bound pixels and reject mismatches", () => {
  expect(
    Object.values(
      visualCandidates(
        { ...input(), visual_targets: ["Play"] },
        "capture",
        visual(),
      ),
    )[0]?.action?.args,
  ).toMatchObject({ capture_id: "capture", x: 40, y: 40 });
  expect(() => visualCandidates(input(), "stale", visual())).toThrow();
  expect(visualCandidates(input(), "capture", visual())).toEqual({});
  const invalid = visual();
  invalid.regions.push({
    ...invalid.regions[0],
    id: "outside",
    kind: "text",
    text: "Outside",
    interactive: true,
    confidence: 1,
    bounds: { x: 2000, y: 0, width: 20, height: 20 },
  });
  expect(() => visualCandidates(input(), "capture", invalid)).toThrow();
});
