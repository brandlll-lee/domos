import { z } from "zod";
import type { ProductTool } from "../harness/types.ts";

export const takeoverInput = z
  .object({
    service: z.enum(["browser", "desktop"]),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

export const takeoverTool: ProductTool = {
  name: "computer_request_takeover",
  description:
    "Pause this task and ask the user to operate the assigned browser or desktop. Use for sign-in, CAPTCHA, sensitive steps, or an explicit user handoff. Wait for completion. Observe fresh state before continuing.",
  inputSchema: {
    type: "object",
    properties: {
      service: { type: "string", enum: ["browser", "desktop"] },
      reason: { type: "string", minLength: 1, maxLength: 1000 },
    },
    required: ["service", "reason"],
    additionalProperties: false,
  },
};
