import { z } from "zod";

const coordinate = z.number().finite().min(0).max(32768);
export const viewerAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ack"),
    seq: z.number().int().nonnegative(),
    maxFps: z.number().int().min(1).max(30).optional(),
  }),
  z.object({ type: z.enum(["take", "back"]) }),
  z.object({ type: z.literal("text"), text: z.string().max(10000) }),
  z.object({
    type: z.literal("key"),
    key: z.string().min(1).max(64),
    modifiers: z.number().int().min(0).max(15).default(0),
  }),
  z.object({
    type: z.literal("pointer"),
    event: z.enum(["down", "up", "move", "scroll", "cancel"]),
    x: coordinate,
    y: coordinate,
    button: z.enum(["left", "right", "middle"]).default("left"),
    deltaX: z.number().finite().min(-10000).max(10000).default(0),
    deltaY: z.number().finite().min(-10000).max(10000).default(0),
    modifiers: z.number().int().min(0).max(15).optional(),
  }),
]);

export type ViewerAction = z.infer<typeof viewerAction>;
export type ViewFrame = {
  seq: number;
  data: string;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  timestamp: number;
};
