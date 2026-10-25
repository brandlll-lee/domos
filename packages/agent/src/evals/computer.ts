import { z } from "zod";

export const computerTrace = z
  .object({
    source: z.string(),
    harness: z.enum(["pi", "claude", "codex", "opencode"]),
    model: z.string(),
    coverage: z.enum(["complete", "excerpt"]),
    startedAt: z.number().finite(),
    endedAt: z.number().finite(),
    modelResponses: z.number().int().nonnegative().nullable(),
    completion: z.enum(["pass", "fail", "unreviewed"]),
    calls: z.array(
      z
        .object({
          name: z.string(),
          input: z.record(z.string(), z.unknown()),
          output: z.string(),
          startedAt: z.number().finite(),
          endedAt: z.number().finite(),
        })
        .refine(
          (call) => call.endedAt >= call.startedAt,
          "Call ends before it starts",
        ),
    ),
  })
  .refine(
    (trace) =>
      trace.endedAt >= trace.startedAt &&
      trace.calls.every(
        (call) =>
          call.startedAt >= trace.startedAt && call.endedAt <= trace.endedAt,
      ),
    "Calls must fit inside the task interval",
  );
export type ComputerTrace = z.infer<typeof computerTrace>;

export function evaluateComputer(input: unknown) {
  const trace = computerTrace.parse(input);
  const failures = {
    inputVerification: [] as number[],
    incrementalScope: [] as number[],
    availableTools: [] as number[],
  };
  let inputs = 0;
  let deltas = 0;
  let sleeps = 0;
  const scopes = new Map<string, string>();
  const calls = trace.calls.toSorted((a, b) => a.startedAt - b.startedAt);
  for (const [index, call] of trace.calls.entries()) {
    const name = call.name.replace(/^(domos_)?desktop_/, "");
    const inputTools = ["type_text", "set_value", "press_key", "hotkey"];
    const steps = Array.isArray(call.input.steps) ? call.input.steps : [];
    if (
      inputTools.includes(name) ||
      (name === "run_steps" &&
        steps.some(
          (step) =>
            step &&
            typeof step === "object" &&
            (inputTools.includes(step.tool) ||
              inputTools.some((tool) => tool in step)),
        ))
    ) {
      inputs++;
      if (/not verified/i.test(call.output))
        failures.inputVerification.push(index + 1);
    }
    const observe =
      name === "run_steps"
        ? call.input.observe
        : name === "get_window_state"
          ? call.input
          : undefined;
    if (observe && typeof observe === "object") {
      const reading = observe as Record<string, unknown>;
      if (reading.include_accessibility_tree !== false) {
        const target = JSON.stringify([
          call.input.session,
          reading.pid ?? call.input.pid,
          reading.window_id ?? call.input.window_id,
        ]);
        const scope = JSON.stringify([
          reading.query ?? "",
          reading.max_elements ?? 250,
          reading.max_depth ?? 25,
        ]);
        const previous = scopes.get(target);
        if (
          previous &&
          (reading.since || (name === "run_steps" && reading.since !== null))
        ) {
          deltas++;
          if (
            previous !== scope &&
            /no earlier read|no usable earlier read/i.test(call.output)
          )
            failures.incrementalScope.push(index + 1);
        }
        scopes.set(target, scope);
      }
    }
    if (/unavailable tool|unknown tool/i.test(call.output))
      failures.availableTools.push(index + 1);
    if (/\bStart-Sleep\b|\bsleep\s+\d/i.test(String(call.input.command ?? "")))
      sleeps++;
  }
  const exercisedCounts = {
    inputVerification: inputs,
    incrementalScope: deltas,
    availableTools: trace.calls.length,
  };
  const checks = Object.entries(failures).map(([name, calls]) => ({
    name,
    status: calls.length
      ? "fail"
      : exercisedCounts[name as keyof typeof failures]
        ? "pass"
        : "not-exercised",
    calls,
  }));
  const exercised = checks.filter(
    (check) => check.status !== "not-exercised",
  ).length;
  const passed = checks.filter((check) => check.status === "pass").length;
  let end = trace.startedAt;
  let toolTimeMs = 0;
  for (const call of calls) {
    toolTimeMs += Math.max(0, call.endedAt - Math.max(end, call.startedAt));
    end = Math.max(end, call.endedAt);
  }
  return {
    kind: "computer-trajectory-eval",
    source: trace.source,
    harness: trace.harness,
    model: trace.model,
    coverage: trace.coverage,
    completion: trace.completion,
    checks,
    passed,
    exercised,
    total: checks.length,
    checkPassRate: exercised ? passed / exercised : null,
    metrics: {
      elapsedMs: trace.endedAt - trace.startedAt,
      toolCalls: trace.calls.length,
      modelResponses: trace.modelResponses,
      toolTimeMs: trace.coverage === "complete" ? toolTimeMs : null,
      outsideToolsMs:
        trace.coverage === "complete"
          ? trace.endedAt - trace.startedAt - toolTimeMs
          : null,
      fixedSleeps: sleeps,
    },
  };
}
