import { z } from "zod";

const position = z.number().finite().min(-131072).max(131072);
const rectangle = z.object({
  x: position,
  y: position,
  width: z.number().finite().positive().max(131072),
  height: z.number().finite().positive().max(131072),
});
export const computerActivity = z
  .object({
    botId: z.number().int().positive(),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    screen: rectangle,
    window: rectangle.nullable(),
    covered: z.array(rectangle).max(256),
    pointer: z
      .object({
        x: position,
        y: position,
        id: z.number().int().nonnegative(),
        action: z.string().max(48),
        expiresAt: z.number().finite(),
      })
      .nullable(),
    expiresAt: z.number().finite(),
  })
  .nullable();
export type ComputerActivity = z.infer<typeof computerActivity>;
