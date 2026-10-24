import type { ProductResult } from "../harness/types.ts";
import type { Action, AssistInput } from "./assistant-action.ts";
import type { Candidate } from "./assistant-candidates.ts";

export const roleClass = (role: string, platform?: string) => {
  const key = role
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/^ax/, "");
  if (key === "text" && platform !== "linux") return "statictext";
  return (
    (
      {
        pushbutton: "button",
        splitbutton: "button",
        switch: "toggle",
        togglebutton: "toggle",
        radiobutton: "radio",
        combobox: "popup",
        popupbutton: "popup",
        menubutton: "popup",
        menuitem: "menu_item",
        menubaritem: "menu_item",
        checkmenuitem: "menu_item",
        radiomenuitem: "menu_item",
        hyperlink: "link",
        edit: "text_input",
        textinput: "text_input",
        entry: "text_input",
        text: "text_input",
        textfield: "text_input",
        textarea: "text_input",
        searchfield: "text_input",
        textbox: "text_input",
        searchbox: "text_input",
        tabitem: "tab",
        pagetab: "tab",
      } as Record<string, string>
    )[key] ?? key
  );
};

export function permitted(input: AssistInput, label: string) {
  const risks = {
    destructive:
      /\b(delete|remove|erase|trash|discard|clear all|format|reset)\b|删除|清空|丢弃/i,
    send: /\b(send|submit|post|publish|share|reply)\b|发送|提交|发布|分享|回复/i,
    purchase:
      /\b(buy|purchase|pay|checkout|order|subscribe)\b|购买|付款|支付|订阅/i,
    close_unsaved: /\b(close|quit|exit|don't save)\b|关闭|退出|不保存/i,
  };
  return Object.entries(risks).every(
    ([risk, pattern]) =>
      !pattern.test(label) ||
      input.allowed_risks.includes(
        risk as AssistInput["allowed_risks"][number],
      ),
  );
}

export const progress = (input: AssistInput, counts: number[]) =>
  input.steps.map((step, index) => ({
    role: step.role,
    label: step.label,
    action: step.action,
    performed: counts[index] ?? 0,
    required: step.times,
    ready:
      !step.after_previous ||
      input.steps
        .slice(0, index)
        .every((earlier, i) => (counts[i] ?? 0) >= earlier.times),
  }));

export function compose(
  input: AssistInput,
  entries: Record<string, Candidate>,
  counts: number[] = [],
) {
  const state = progress(input, counts);
  const words = new Set(
    `${input.goal} ${input.completion}`.toLowerCase().match(/[\p{L}\p{N}]+/gu),
  );
  const ranked = Object.entries(entries).flatMap(
    ([id, candidate], position) => {
      const action = candidate.action;
      if (!action || !permitted(input, candidate.label)) return [];
      const kind =
        action.name === "agent_browser_fill"
          ? "set_value"
          : action.name === "agent_browser_press"
            ? "press_key"
            : action.name === "agent_browser_click"
              ? "click"
              : action.name;
      const steps = input.steps.flatMap((step, i) =>
        roleClass(step.role, candidate.platform) === candidate.role &&
        step.label.toLowerCase() === candidate.label.toLowerCase() &&
        (step.action === kind ||
          (action.name === "agent_browser_fill" &&
            step.action === "type_text")) &&
        (!step.input || step.input === candidate.input)
          ? [i]
          : [],
      );
      const due = steps.find(
        (i) =>
          state[i]?.ready && (counts[i] ?? 0) < (input.steps[i]?.times ?? 1),
      );
      if (steps.length && due === undefined) return [];
      if (
        !input.allowed_actions.includes(
          kind as AssistInput["allowed_actions"][number],
        ) &&
        !(
          action.name === "agent_browser_fill" &&
          input.allowed_actions.includes("type_text")
        )
      )
        return [];
      candidate.step = due;
      const relevant = [
        ...(candidate.label.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []),
      ].some((word) => words.has(word));
      return [
        {
          id,
          candidate,
          position,
          rank: due !== undefined ? 0 : relevant ? 1 : 2,
        },
      ];
    },
  );
  const kept = ranked
    .sort((a, b) => a.rank - b.rank || a.position - b.position)
    .slice(0, 24)
    .sort((a, b) => a.position - b.position);
  return {
    table: Object.fromEntries(kept.map(({ id, candidate }) => [id, candidate])),
    dropped: ranked.length - kept.length,
  };
}

export function deliveryCandidates(
  table: Record<string, Candidate>,
  foreground: Set<string>,
) {
  return Object.fromEntries(
    Object.entries(table).map(([id, candidate]) => {
      if (!candidate.action || !foreground.has(id)) return [id, candidate];
      return [
        `${id}:foreground`,
        {
          ...candidate,
          description: `${candidate.description}; foreground delivery after Driver refused background delivery`,
          action: {
            ...candidate.action,
            args: { ...candidate.action.args, delivery_mode: "foreground" },
          },
        },
      ];
    }),
  );
}

export function actionOutcome(
  result: ProductResult,
): "delivered" | "background_refused" | "stale" | "failed" {
  const state = result.structuredContent ?? {};
  if (!result.isError && state.status !== "refused" && !state.refusal)
    return "delivered";
  const error = state.error as
    | { code?: string; escalation?: { recommended?: string } }
    | undefined;
  const refusal = state.refusal as { code?: string } | undefined;
  const escalation = state.escalation as { recommended?: string } | undefined;
  const code = String(
    state.error_code ?? state.code ?? refusal?.code ?? error?.code ?? "",
  );
  if (
    code.startsWith("background_") ||
    escalation?.recommended === "foreground" ||
    error?.escalation?.recommended === "foreground"
  )
    return "background_refused";
  const text = result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  if (
    /stale_(element|snapshot|capture)|snapshot_(mismatch|expired)|capture_(mismatch|expired)/.test(
      code,
    ) ||
    /element_token is stale/.test(text)
  )
    return "stale";
  return "failed";
}

export function continuation(input: AssistInput): Action {
  const handoff = input.handoff;
  if (!handoff) throw new Error("交接动作缺失。");
  const args = { ...handoff.args };
  if (input.service === "desktop") {
    for (const [key, value] of Object.entries(input.window ?? {})) {
      if (args[key] !== undefined && args[key] !== value)
        throw new Error("交接窗口与任务窗口不一致。");
      args[key] = value;
    }
    if (args.element_token && (args.x !== undefined || args.y !== undefined))
      throw new Error("控件编号与坐标不能同时提供。请重新观察。");
    args.delivery_mode ??= input.delivery;
    if (
      args.delivery_mode === "foreground" &&
      input.delivery !== "foreground" &&
      !input.allow_foreground
    )
      throw new Error("本任务尚未允许前台操作。");
  }
  return { name: handoff.name, args };
}
