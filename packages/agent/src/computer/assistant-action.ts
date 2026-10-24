import { z } from "zod";
import type { ProductTool } from "../harness/types.ts";

export const assistInput = z
  .object({
    service: z.enum(["desktop", "browser"]),
    goal: z.string().trim().min(1).max(2000),
    completion: z.string().trim().min(1).max(1000),
    window: z
      .object({
        pid: z.number().int().nonnegative(),
        window_id: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    delivery: z.enum(["background", "foreground"]).default("background"),
    inputs: z
      .array(
        z
          .object({
            purpose: z.string().min(1).max(120),
            text: z.string().max(2000),
          })
          .strict(),
      )
      .max(6)
      .default([]),
  })
  .strict()
  .refine(
    (input) => input.service !== "desktop" || input.window,
    "桌面任务需要指定已观察的窗口。",
  );

export const assistTool: ProductTool = {
  name: "computer_assist",
  description:
    "Delegate a bounded GUI subtask to Jev on the assigned computer. Supply a precise goal, visible completion condition, exact desktop window, and all input text. Prefer it for decisions between GUI actions; use run_steps for already known steps. Observe and identify the target first. Never delegate secrets, login, CAPTCHA, payments, or destructive operations. Background is the default; request foreground only after background is unavailable. It returns observed evidence and completed actions. On handoff or uncertain outcome, inspect before continuing; never replay the subtask.",
  inputSchema: z.toJSONSchema(assistInput, { unrepresentable: "any" }),
};

export type Action = { name: string; args: Record<string, unknown> };

export function assistantAction(
  input: z.infer<typeof assistInput>,
  choice: string,
  location: Record<string, unknown>,
): Action {
  const desktop = input.service === "desktop";
  const base = { ...input.window, delivery_mode: input.delivery };
  let next: Action;
  if (choice.startsWith("type_")) {
    const text = input.inputs[Number(choice.slice(5))]?.text;
    if (text === undefined) throw new Error("辅助决策输入未提供。");
    next = desktop
      ? {
          name: "type_text",
          args: { ...base, ...location, text },
        }
      : { name: "agent_browser_fill", args: { ...location, text } };
  } else if (["click", "double_click"].includes(choice)) {
    next = desktop
      ? { name: choice, args: { ...base, ...location } }
      : { name: "agent_browser_click", args: location };
  } else if (["down", "up"].includes(choice)) {
    next = desktop
      ? {
          name: "scroll",
          args: {
            ...base,
            direction: choice,
            amount: 1,
            by: "page",
          },
        }
      : {
          name: "agent_browser_scroll",
          args: { direction: choice, amount: 500 },
        };
  } else {
    const key = { enter: "Enter", tab: "Tab", escape: "Escape" }[choice];
    next = desktop
      ? {
          name: "press_key",
          args: {
            ...base,
            key: choice === "enter" ? "return" : key?.toLowerCase(),
          },
        }
      : { name: "agent_browser_press", args: { key } };
  }
  return next;
}
