import { z } from "zod";
import type { ProductTool } from "../harness/types.ts";

const actionKind = z.enum(["click", "set_value", "type_text", "press_key"]);
export const assistInput = z
  .object({
    service: z.enum(["desktop", "browser"]),
    goal: z.string().trim().min(1).max(2000),
    completion: z.string().trim().min(1).max(1000),
    window: z
      .object({
        pid: z.number().int().positive(),
        window_id: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    delivery: z.enum(["background", "foreground"]).default("background"),
    allow_foreground: z.boolean().default(false),
    allowed_actions: z
      .array(actionKind)
      .min(1)
      .max(4)
      .default(["click", "set_value", "type_text", "press_key"]),
    allowed_risks: z
      .array(z.enum(["destructive", "send", "purchase", "close_unsaved"]))
      .max(4)
      .default([]),
    steps: z
      .array(
        z
          .object({
            role: z.string().min(1).max(80),
            label: z.string().min(1).max(120),
            action: actionKind,
            input: z.string().min(1).max(120).optional(),
            times: z.number().int().min(1).max(12).default(1),
            after_previous: z.boolean().default(true),
          })
          .strict(),
      )
      .max(12)
      .default([]),
    visual_targets: z.array(z.string().min(1).max(120)).max(12).default([]),
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
    evidence: z
      .object({
        role: z.string().min(1),
        label: z.string().min(1),
        value: z.string().optional(),
        selected: z.boolean().optional(),
        timeout_ms: z.number().int().min(100).max(30000).optional(),
      })
      .strict()
      .optional(),
    handoff: z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1),
        args: z.record(z.string(), z.unknown()),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (input) => input.service !== "desktop" || input.window,
    "桌面任务需要指定已观察的窗口。",
  )
  .refine(
    (input) =>
      input.steps.every(
        (step) =>
          input.allowed_actions.includes(step.action) &&
          (!["set_value", "type_text"].includes(step.action) ||
            input.inputs.some((value) => value.purpose === step.input)),
      ),
    "步骤必须使用允许的动作和已提供的输入。",
  );

export type AssistInput = z.infer<typeof assistInput>;
export type Action = { name: string; args: Record<string, unknown> };
export const assistTool: ProductTool = {
  name: "computer_assist",
  description:
    "Jev collaboration mode: delegate GUI changes through this tool. Discover the exact window first. Supply a bounded goal, completion condition, exact input text, and steps with observed role/label, action and input purpose. Steps run in order unless after_previous is false; times counts delivered actions, not verified effects. allowed_actions and allowed_risks bound the task; risks still require approval. Desktop text defaults to set_value; request type_text only when needed. Background is default; allow_foreground permits a separately approved foreground candidate after a structured background refusal. visual_targets names exact visible labels for capture-bound fallback. Optional evidence supplies a native role/label, expected value or selection, and timeout_ms for bounded state verification. For app loading or replies, use this or desktop_verify_state instead of shell sleeps. Never delegate secrets, login or CAPTCHA. On handoff, inspect fresh state; a returned ID permits one explicit action via handoff {id,name,args}. Never reuse a consumed ID or replay an uncertain action. Reuse the goal and window for continuation. Results include decisions, actions and timings; review is not verified completion.",
  inputSchema: z.toJSONSchema(assistInput, { unrepresentable: "any" }),
};

const discovery = new Set([
  "desktop_list_windows",
  "desktop_list_apps",
  "desktop_get_window_state",
  "desktop_get_desktop_state",
  "desktop_get_screen_size",
  "desktop_get_agent_cursor_state",
  "desktop_verify_state",
  "desktop_zoom",
  "desktop_launch_app",
  "desktop_bring_to_front",
  "browser_agent_browser_snapshot",
  "browser_agent_browser_screenshot",
  "browser_agent_browser_get_url",
  "browser_agent_browser_get_title",
  "browser_agent_browser_restart",
]);
export const assistantDiscovery = (name: string) => discovery.has(name);
