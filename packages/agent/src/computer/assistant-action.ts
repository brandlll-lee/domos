import { z } from "zod";
import type { ProductTool } from "../harness/types.ts";

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
  );

export type AssistInput = z.infer<typeof assistInput>;
export type Action = { name: string; args: Record<string, unknown> };
export const assistTool: ProductTool = {
  name: "computer_assist",
  description:
    "Jev collaboration mode: delegate all GUI changes through this tool after discovering the target. Supply a bounded goal, exact window, completion condition and all input text. Optional evidence supplies a native role/label and expected value or selection for deterministic verification. Never delegate secrets, login, CAPTCHA, payments or destructive operations. Background is default; foreground requires an explicit escalation. On handoff, inspect fresh state; a returned handoff ID permits one explicit native action via handoff {id,name,args}. Never replay an uncertain action. Reuse the goal and window for that continuation. Results include evidence, actions and timings; review is not verified completion.",
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
]);
export const assistantDiscovery = (name: string) => discovery.has(name);
