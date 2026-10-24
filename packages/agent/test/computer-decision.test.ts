import { afterEach, expect, test, vi } from "vitest";
import { candidates } from "../src/computer/assistant-candidates.ts";
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

test("native candidates reject partial, disabled, ambiguous and malformed controls", () => {
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
  ).toBe(false);
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
    visualCandidates(input(), "capture", visual()).visual_play?.action?.args,
  ).toMatchObject({ capture_id: "capture", x: 40, y: 40 });
  expect(() => visualCandidates(input(), "stale", visual())).toThrow();
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
