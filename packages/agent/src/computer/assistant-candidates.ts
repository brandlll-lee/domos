import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProductResult } from "../harness/types.ts";
import type { Action, AssistInput } from "./assistant-action.ts";
import { compose, roleClass } from "./assistant-task.ts";

export type Candidate = {
  description: string;
  label: string;
  role: string;
  input?: string;
  step?: number;
  platform?: string;
  state?: string;
  region?: Record<string, unknown>;
  action?: Action;
};

const rect = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object") return value;
    const box = value as Record<string, unknown>;
    return { ...box, width: box.w ?? box.width, height: box.h ?? box.height };
  },
  z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
);
const control = z.object({
  element_token: z.string().min(1),
  role: z.string(),
  label: z.string().nullish(),
  name: z.string().nullish(),
  value: z.string().nullish(),
  enabled: z.boolean().optional(),
  in_web_content: z.boolean().optional(),
  element_index: z.number().int().optional(),
  parent_index: z.number().int().nullish(),
  selected: z.boolean().optional(),
  unlabelled: z.boolean().optional(),
  frame: rect,
});
export function observationText(result: ProductResult) {
  if (result.isError) throw new Error("界面读取失败，请重新观察。");
  const text = result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  try {
    return String(JSON.parse(text).data?.snapshot ?? text).slice(0, 16000);
  } catch {
    return text.slice(0, 16000);
  }
}

export function candidates(
  input: AssistInput,
  result: ProductResult,
  counts: number[] = [],
) {
  const table: Record<string, Candidate> = {};
  let dropped = 0;
  const ambiguous = new Set<string>();
  const add = (
    description: string,
    action: Action,
    label: string,
    role: string,
    path = "",
    purpose?: string,
    state = "enabled",
  ) => {
    const id = `a_${createHash("sha256")
      .update(JSON.stringify([role, label, path, action.name, purpose]))
      .digest("hex")
      .slice(0, 16)}`;
    if (ambiguous.has(id)) {
      dropped++;
      return;
    }
    if (table[id]) {
      delete table[id];
      ambiguous.add(id);
      dropped += 2;
      return;
    }
    table[id] = {
      description,
      action,
      label,
      role,
      input: purpose,
      state,
      platform: String(result.structuredContent?.platform),
    };
  };
  const target = { ...input.window, delivery_mode: input.delivery };
  if (input.service === "desktop") {
    const state = result.structuredContent ?? {};
    // Driver tokens are valid only in the snapshot that produced them.
    if (
      state.pid !== input.window?.pid ||
      state.window_id !== input.window?.window_id
    )
      return { table: controls({}), dropped };
    const elements = z.array(z.unknown()).parse(state.elements ?? []);
    const indexed = new Map(
      elements.flatMap((raw) => {
        const item = control
          .partial({ frame: true, element_token: true })
          .safeParse(raw);
        return item.success && item.data.element_index !== undefined
          ? [[item.data.element_index, item.data] as const]
          : [];
      }),
    );
    const bounds = rect.safeParse(state.window_bounds);
    for (const raw of elements) {
      const parsed = control.safeParse(raw);
      if (!parsed.success) continue;
      const item = parsed.data;
      const role = roleClass(item.role, String(state.platform));
      const ancestors = [];
      const seen = new Set<number>();
      let parent = item.parent_index;
      while (parent != null && !seen.has(parent) && indexed.has(parent)) {
        seen.add(parent);
        const ancestor = indexed.get(parent);
        if (!ancestor) break;
        ancestors.unshift([
          roleClass(ancestor.role),
          ancestor.label || ancestor.name || "",
        ]);
        parent = ancestor.parent_index;
      }
      const label = (item.label || item.name || "").trim();
      if (
        !label ||
        label === item.value ||
        item.enabled === false ||
        item.unlabelled === true ||
        ancestors.some(([role]) => role === "titlebar") ||
        (bounds.success &&
          (item.frame.x >= bounds.data.x + bounds.data.width ||
            item.frame.y >= bounds.data.y + bounds.data.height ||
            item.frame.x + item.frame.width <= bounds.data.x ||
            item.frame.y + item.frame.height <= bounds.data.y)) ||
        /password|secure/.test(role) ||
        /^(close|minimize|maximize|restore|关闭|最小化|最大化|还原)$/i.test(
          label,
        )
      )
        continue;
      // Electron desktop controls also use window-scoped Driver tokens.
      const location = { ...target, element_token: item.element_token };
      const path = JSON.stringify(ancestors);
      if (role === "text_input") {
        for (const value of input.inputs) {
          if (item.value === value.text) continue;
          const method =
            input.steps.find(
              (step) =>
                roleClass(step.role, String(state.platform)) === role &&
                step.label.toLowerCase() === label.toLowerCase() &&
                step.input === value.purpose,
            )?.action === "type_text" ||
            !input.allowed_actions.includes("set_value")
              ? "type_text"
              : "set_value";
          add(
            `Enter supplied ${value.purpose} in ${label}; ${item.value ? "has text" : "empty"}`,
            {
              name: method,
              args: {
                ...location,
                [method === "set_value" ? "value" : "text"]: value.text,
              },
            },
            label,
            role,
            path,
            value.purpose,
            item.value ? "has_text" : "empty",
          );
        }
      } else if (
        [
          "button",
          "toggle",
          "checkbox",
          "radio",
          "popup",
          "menu_item",
          "link",
          "tab",
        ].includes(role) &&
        !(role === "radio" && item.selected)
      )
        add(
          `Click ${role} ${label}${item.selected === undefined ? "" : `; selected=${item.selected}`}`,
          { name: "click", args: location },
          label,
          role,
          path,
          undefined,
          role === "toggle" || role === "checkbox"
            ? item.selected
              ? "checked"
              : "unchecked"
            : role === "radio"
              ? "not_selected"
              : "enabled",
        );
    }
  } else {
    for (const line of observationText(result).split("\n")) {
      const ref = /\[ref=(e\d+)\]/.exec(line)?.[1];
      if (!ref || /\[disabled\]/.test(line)) continue;
      const selector = `@${ref}`;
      const label = /"([^"]+)"/.exec(line)?.[1] ?? "";
      if (!label || /password|secure/i.test(line)) continue;
      if (/\b(textbox|searchbox|combobox)\b/.test(line)) {
        for (const value of input.inputs)
          add(
            `Enter supplied ${value.purpose} in ${line.slice(0, 180)}`,
            {
              name: "agent_browser_fill",
              args: { selector, text: value.text },
            },
            label,
            "text_input",
            "",
            value.purpose,
          );
      } else if (
        /\b(button|link|checkbox|radio|menuitem|tab|option)\b/.test(line)
      )
        add(
          `Click ${line.slice(0, 180)}`,
          {
            name: "agent_browser_click",
            args: { selector },
          },
          label,
          roleClass(
            line
              .trim()
              .replace(/^[- ]*/, "")
              .split(" ")[0] ?? "button",
          ),
        );
    }
  }
  if (
    Object.keys(table).length &&
    input.steps.some(
      (step) => step.action === "press_key" && step.label === "Enter",
    )
  ) {
    add(
      "Press Enter in the current focused control",
      input.service === "desktop"
        ? { name: "press_key", args: { ...target, key: "return" } }
        : { name: "agent_browser_press", args: { key: "Enter" } },
      "Enter",
      "key",
    );
  }
  const composed = compose(input, table, counts);
  return {
    table: controls(composed.table),
    dropped: dropped + composed.dropped,
  };
}

export function controls(
  table: Record<string, Candidate>,
): Record<string, Candidate> {
  return {
    ...table,
    reobserve: {
      label: "",
      role: "control",
      description:
        "Interface is changing or incomplete; observe again without acting",
    },
    review: {
      label: "",
      role: "control",
      description:
        "Completion appears satisfied; return evidence for verification",
    },
    abstain: {
      label: "",
      role: "control",
      description:
        "Need a different target, missing input, risky operation or main-agent judgment; hand off",
    },
  };
}
