import type { ProductResult } from "../harness/types.ts";
import type { AssistInput } from "./assistant-action.ts";
import { roleClass } from "./assistant-task.ts";

type Call = (
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<ProductResult>;

export async function observe(
  input: AssistInput,
  call: Call,
  signal: AbortSignal,
  counts: number[] = [],
) {
  if (input.service === "browser")
    return call(
      "agent_browser_snapshot",
      { interactive: false, compact: true },
      signal,
    );
  const read = (expanded: boolean, query?: string) =>
    call(
      "get_window_state",
      {
        ...input.window,
        tree_format: "both",
        since: null,
        include_screenshot: true,
        max_image_dimension: 1200,
        max_elements: expanded ? 1000 : 250,
        max_depth: expanded ? 30 : 25,
        timeout_ms: expanded ? 5000 : 1000,
        ...(query ? { query } : {}),
      },
      signal,
    );
  const result = await read(false);
  const state = result.structuredContent;
  const target = input.steps.find(
    (step, i) => (counts[i] ?? 0) < step.times,
  )?.label;
  const elements = state?.elements as { label?: string }[] | undefined;
  return !result.isError &&
    (state?.truncated ||
      state?.truncation_reason ||
      state?.elements_complete === false)
    ? read(
        true,
        target && !elements?.some((item) => item.label === target)
          ? target
          : undefined,
      )
    : result;
}

export function visualFallback(
  input: AssistInput,
  result: ProductResult,
  labels: string[],
) {
  const state = result.structuredContent ?? {};
  if (
    state.pid !== input.window?.pid ||
    state.window_id !== input.window?.window_id
  )
    return false;
  if (String(state.degraded_reason).startsWith("ax_tree_empty")) return true;
  if (state.truncated || state.truncation_reason) return false;
  if (state.elements_complete === true)
    return (
      input.visual_targets.some(
        (target) => !labels.includes(target.toLowerCase()),
      ) || labels.length === 0
    );
  const elements = state.elements as
    | {
        role?: string;
        label?: string;
        parent_index?: number;
        element_index?: number;
      }[]
    | undefined;
  return !elements?.some((element) => {
    const role = roleClass(element.role ?? "");
    if (
      ["window", "application", "frame", "titlebar", "menubar"].includes(role)
    )
      return false;
    const parent = elements.find(
      (item) => item.element_index === element.parent_index,
    );
    return (
      roleClass(parent?.role ?? "") !== "titlebar" && Boolean(element.label)
    );
  });
}

export async function verify(
  input: AssistInput,
  call: Call,
  signal: AbortSignal,
) {
  if (input.service !== "desktop" || !input.evidence) return undefined;
  const proof = input.evidence;
  const result = await call(
    "verify_state",
    {
      ...input.window,
      expect: [
        {
          element: {
            selector: { role: proof.role, label_contains: proof.label },
            exists: true,
            ...(proof.value === undefined ? {} : { value_equals: proof.value }),
            ...(proof.selected === undefined
              ? {}
              : { selected: proof.selected }),
          },
        },
      ],
      timeout_ms: proof.timeout_ms ?? 2000,
      stable_samples: 2,
    },
    signal,
  );
  return !result.isError &&
    result.structuredContent?.status === "satisfied" &&
    result.structuredContent?.stable === true
    ? result
    : undefined;
}
