import { z } from "zod";

export const taskOutcome = z.object({
  completion: z.enum(["pass", "fail", "unreviewed"]),
  review: z
    .object({
      reviewer: z.string().trim().min(1),
      evidence: z.string().trim().min(1),
    })
    .optional(),
});

export function taskCompletion(
  states: readonly ("pass" | "fail" | "unreviewed")[],
): "pass" | "fail" | "unreviewed" {
  if (states.includes("fail")) return "fail";
  return states.length && states.every((state) => state === "pass")
    ? "pass"
    : "unreviewed";
}
