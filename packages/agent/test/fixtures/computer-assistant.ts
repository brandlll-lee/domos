import { vi } from "vitest";
import { assistInput } from "../../src/computer/assistant-action.ts";
import type { ProductResult } from "../../src/harness/types.ts";

export const signal = () => new AbortController().signal;
export const input = (service = "desktop") =>
  assistInput.parse({
    service,
    goal: "Search Rain",
    completion: "Rain is listed",
    window: { pid: 1, window_id: 2 },
    inputs: [{ purpose: "search", text: "Rain" }],
  });
export const observed = (
  role = "Edit",
): ProductResult & { structuredContent: Record<string, unknown> } => ({
  content: [{ type: "text", text: "Search" }],
  structuredContent: {
    pid: 1,
    window_id: 2,
    capture_id: "capture",
    window_bounds: { x: 0, y: 0, w: 1000, h: 500 },
    elements: [
      {
        element_token: "s1:1",
        label: "Search",
        role,
        frame: { x: 10, y: 20, w: 100, h: 40 },
      },
    ],
  },
});
export const connection = { provider: "typesafe" as const, key: "test-key" };
export function mockChoice(
  select: (criteria: Record<string, string>) => string,
  confidence = 0.99,
) {
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    return Response.json({
      model: "jev-1.14.0",
      answers: Object.fromEntries(
        Object.entries(body.questions).map(([id, q]) => {
          const criteria = (q as { criteria: Record<string, string> }).criteria;
          const choice = select(criteria);
          return [
            id,
            {
              type: "choice",
              choice,
              confidence,
              probabilities: Object.fromEntries(
                Object.keys(criteria).map((key) => [
                  key,
                  Number(key === choice),
                ]),
              ),
            },
          ];
        }),
      ),
      usage: { input_tokens: 100, output_tokens: 10 },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
