import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProductResult } from "../harness/types.ts";
import type { Action, AssistInput } from "./assistant-action.ts";

export type Candidate = { description: string; action?: Action };
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
  frame: rect,
});
const normalize = (role: string) =>
  role
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/^ax/, "");
const textRoles = new Set([
  "edit",
  "entry",
  "textfield",
  "textarea",
  "searchfield",
]);
const clickRoles = new Set([
  "button",
  "pushbutton",
  "splitbutton",
  "switch",
  "togglebutton",
  "checkbox",
  "radiobutton",
  "combobox",
  "popupbutton",
  "menubutton",
  "menuitem",
  "menubaritem",
  "checkmenuitem",
  "radiomenuitem",
  "hyperlink",
  "link",
  "tab",
  "tabitem",
  "pagetab",
]);

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

export function candidates(input: AssistInput, result: ProductResult) {
  const table: Record<string, Candidate> = {};
  let dropped = 0;
  const ambiguous = new Set<string>();
  const add = (description: string, action: Action) => {
    const id = `a_${createHash("sha256").update(description).digest("hex").slice(0, 16)}`;
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
    if (Object.keys(table).length < 24) table[id] = { description, action };
    else dropped++;
  };
  const target = { ...input.window, delivery_mode: input.delivery };
  if (input.service === "desktop") {
    const state = result.structuredContent ?? {};
    // Driver tokens are valid only in the snapshot that produced them.
    if (
      state.pid !== input.window?.pid ||
      state.window_id !== input.window?.window_id ||
      state.truncated === true ||
      state.truncation_reason
    )
      return { table: controls({}), dropped };
    const elements = z.array(z.unknown()).parse(state.elements ?? []);
    for (const raw of elements) {
      const parsed = control.safeParse(raw);
      if (!parsed.success) continue;
      const item = parsed.data;
      const role = normalize(item.role);
      const label = (item.label || item.name || "").trim();
      if (
        !label ||
        label === item.value ||
        item.enabled === false ||
        /password|secure/.test(role) ||
        /^(close|minimize|maximize|restore|关闭|最小化|最大化|还原)$/i.test(
          label,
        )
      )
        continue;
      // Electron desktop controls also use window-scoped Driver tokens.
      const location = { ...target, element_token: item.element_token };
      if (textRoles.has(role)) {
        for (const value of input.inputs)
          add(`Enter supplied ${value.purpose} in ${label}`, {
            name: "type_text",
            args: { ...location, text: value.text },
          });
      } else if (clickRoles.has(role))
        add(`Click ${role} ${label}`, { name: "click", args: location });
    }
  } else {
    for (const line of observationText(result).split("\n")) {
      const ref = /\[ref=(e\d+)\]/.exec(line)?.[1];
      if (!ref || /\[disabled\]/.test(line)) continue;
      const selector = `@${ref}`;
      if (/\b(textbox|searchbox|combobox)\b/.test(line)) {
        for (const value of input.inputs)
          add(`Enter supplied ${value.purpose} in ${line.slice(0, 180)}`, {
            name: "agent_browser_fill",
            args: { selector, text: value.text },
          });
      } else if (
        /\b(button|link|checkbox|radio|menuitem|tab|option)\b/.test(line)
      )
        add(`Click ${line.slice(0, 180)}`, {
          name: "agent_browser_click",
          args: { selector },
        });
    }
  }
  if (Object.keys(table).length) {
    add(
      "Press Enter in the current focused control",
      input.service === "desktop"
        ? { name: "press_key", args: { ...target, key: "return" } }
        : { name: "agent_browser_press", args: { key: "Enter" } },
    );
  }
  return { table: controls(table), dropped };
}

export function controls(
  table: Record<string, Candidate>,
): Record<string, Candidate> {
  return {
    ...table,
    reobserve: {
      description:
        "Interface is changing or incomplete; observe again without acting",
    },
    review: {
      description:
        "Completion appears satisfied; return evidence for verification",
    },
    abstain: {
      description:
        "Need a different target, missing input, risky operation or main-agent judgment; hand off",
    },
  };
}
