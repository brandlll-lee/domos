import { z } from "zod";
import type { AssistInput } from "./assistant-action.ts";
import type { Candidate } from "./assistant-candidates.ts";

const integer = z.number().int().nonnegative();
const positive = z.number().int().positive();
const label = z.string().trim().min(1);
const visual = z.object({
  schema: z.literal("cua.visual_regions_v1"),
  capture: z.object({
    capture_id: label,
    source: z.object({
      kind: z.literal("window"),
      pid: positive,
      window_id: integer,
    }),
    screenshot: z.object({
      mime_type: z.literal("image/png"),
      reference: label,
      width: positive,
      height: positive,
    }),
    action_coordinate_space: z.union([
      z.object({ kind: z.literal("screenshot_pixels") }),
      z
        .object({
          kind: z.literal("affine"),
          m11: z.number(),
          m12: z.number(),
          m21: z.number(),
          m22: z.number(),
          tx: z.number(),
          ty: z.number(),
        })
        .refine(
          (s) => Math.abs(s.m11 * s.m22 - s.m12 * s.m21) > Number.EPSILON,
        ),
    ]),
  }),
  regions: z
    .array(
      z.object({
        id: label,
        kind: z.enum(["text", "icon"]),
        text: label.nullish(),
        label: label.nullish(),
        bounds: z.object({
          x: integer,
          y: integer,
          width: positive,
          height: positive,
        }),
        confidence: z.number().min(0).max(1),
        interactive: z.boolean(),
      }),
    )
    .max(100),
});

export function visualCandidates(
  input: AssistInput,
  captureId: string,
  payload: unknown,
): Record<string, Candidate> {
  const { capture, regions } = visual.parse(payload);
  if (
    capture.capture_id !== captureId ||
    capture.source.pid !== input.window?.pid ||
    capture.source.window_id !== input.window.window_id
  )
    throw new Error("辅助决策截图或窗口已改变。");
  const ids = new Set<string>();
  const labels = new Map<string, number>();
  for (const region of regions) {
    const { x, y, width, height } = region.bounds;
    if (
      ids.has(region.id) ||
      x + width > capture.screenshot.width ||
      y + height > capture.screenshot.height ||
      !(region.kind === "text" ? region.text : region.label)
    )
      throw new Error("辅助决策视觉区域无效。");
    ids.add(region.id);
    const name = region.text || region.label || "";
    labels.set(name, (labels.get(name) ?? 0) + 1);
  }
  return Object.fromEntries(
    regions
      .filter(
        (region) =>
          region.interactive &&
          region.confidence >= 0.85 &&
          labels.get(region.text || region.label || "") === 1,
      )
      .slice(0, 24)
      .map((region) => [
        `visual_${region.id}`,
        {
          description: `Click ${region.text || region.label}`,
          action: {
            name: "click",
            args: {
              ...input.window,
              delivery_mode: input.delivery,
              capture_id: captureId,
              // Driver maps this screenshot point to the target once, including mixed-DPI displays.
              x: Math.floor(region.bounds.x + region.bounds.width / 2),
              y: Math.floor(region.bounds.y + region.bounds.height / 2),
            },
          },
        },
      ]),
  );
}
