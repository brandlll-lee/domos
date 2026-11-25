import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { taskCase } from "./task-cases.ts";
import { taskReview } from "./task-score.ts";

export const taskReport = z
  .object({
    version: z.literal(1),
    suite: z.literal("tasks-1"),
    suiteHash: z.string().min(1),
    commit: z.string().min(1),
    dirty: z.boolean(),
    createdAt: z.string(),
    conditions: z.object({
      model: z.literal("gpt-6.1-terra"),
      harness: z.literal("codex"),
      options: z.record(z.string(), z.string()),
      os: z.string(),
      arch: z.string(),
      node: z.string(),
      timezone: z.string(),
      approvalMode: z.literal("full"),
      browser: z.literal("headless"),
      seconds: z.number().positive(),
      maxTokens: z.number().positive(),
      repeats: z.number().int().positive(),
      maxBatchTokens: z.number().positive(),
      maxCost: z.number().positive().nullable(),
      maxBytes: z.number().positive(),
      minFreeBytes: z.number().positive(),
    }),
    plan: z
      .array(
        z.object({
          id: z.string().refine((id) => {
            try {
              taskCase(id);
              return true;
            } catch {
              return false;
            }
          }),
          repeat: z.number().int().positive(),
        }),
      )
      .min(1),
    trials: z.array(
      z.object({
        id: z.string(),
        repeat: z.number().int().positive(),
        directory: z.string(),
        status: z.enum(["done", "blocked"]),
        evidenceHash: z.string().nullable(),
        inventory: z.record(z.string(), z.string()),
        nativeVersion: z.string().nullable(),
        failure: z.string().nullable(),
        cleanup: z
          .object({
            before: z.number(),
            after: z.number(),
            released: z.number(),
            freeBefore: z.number(),
            freeAfter: z.number(),
          })
          .nullable(),
        score: z
          .object({
            checks: z.record(z.string(), z.boolean()),
            completion: z.enum(["pass", "fail", "unreviewed"]),
            review: z
              .object({ reviewer: z.string(), evidence: z.string() })
              .nullable(),
          })
          .nullable(),
        tokens: z.number().nullable(),
        cost: z.number().nullable(),
        knownCost: z.number().nonnegative(),
        freeAtStart: z.number().nonnegative().nullable(),
        elapsedMs: z.number().nonnegative(),
        review: taskReview.optional(),
      }),
    ),
    stopped: z.string().nullable(),
  })
  .superRefine((report, ctx) => {
    const plan = report.plan.map((item) => `${item.id}:${item.repeat}`);
    const seen = new Set<string>();
    if (new Set(plan).size !== plan.length)
      ctx.addIssue({ code: "custom", message: "Duplicate planned trial" });
    for (const trial of report.trials) {
      const key = `${trial.id}:${trial.repeat}`;
      if (!plan.includes(key) || seen.has(key))
        ctx.addIssue({ code: "custom", message: `Unexpected trial: ${key}` });
      if (
        taskCase(trial.id).review &&
        trial.score?.completion === "pass" &&
        !trial.score.review
      )
        ctx.addIssue({
          code: "custom",
          message: `Missing semantic review: ${key}`,
        });
      if (
        trial.status === "done" &&
        (!trial.evidenceHash || !trial.score || !trial.cleanup)
      )
        ctx.addIssue({ code: "custom", message: `Incomplete trial: ${key}` });
      seen.add(key);
    }
  });
export type TaskReport = z.infer<typeof taskReport>;

export function reportTotals(report: TaskReport) {
  const passed = report.trials.filter(
    (item) =>
      item.status === "done" &&
      !item.failure &&
      item.score?.completion === "pass",
  ).length;
  const knownCost = report.trials.reduce(
    (sum, item) => sum + item.knownCost,
    0,
  );
  const unknownCost = report.trials.filter((item) => item.cost === null).length;
  return {
    planned: report.plan.length,
    ran: report.trials.length,
    passed,
    blocked: report.trials.filter((item) => item.status === "blocked").length,
    failed: report.trials.filter(
      (item) =>
        item.status === "done" &&
        (item.score?.completion === "fail" || item.failure),
    ).length,
    unreviewed: report.trials.filter(
      (item) => item.score?.completion === "unreviewed",
    ).length,
    notRun: report.plan.length - report.trials.length,
    knownCost,
    unknownCost,
    totalCost:
      unknownCost || report.trials.length < report.plan.length
        ? null
        : knownCost,
  };
}
export function reportExitCode(report: TaskReport) {
  const totals = reportTotals(report);
  return totals.failed
    ? 1
    : totals.passed === totals.planned && !report.stopped
      ? 0
      : 2;
}
const cell = (value: string) =>
  value.replaceAll("|", "\\|").replaceAll("\n", " ");
export function reportMarkdown(report: TaskReport) {
  const totals = reportTotals(report);
  const rows = [
    "# Domos task evaluation",
    "",
    `Commit: ${report.commit}${report.dirty ? " (dirty)" : ""}. Model: ${report.conditions.model}.`,
    "",
    `Planned ${totals.planned}; ran ${totals.ran}; passed ${totals.passed}; failed ${totals.failed}; blocked ${totals.blocked}; unreviewed ${totals.unreviewed}; not run ${totals.notRun}.`,
    `Cost USD: ${totals.totalCost ?? "unknown"}. Known subtotal: ${totals.knownCost}. Unknown trials: ${totals.unknownCost}.`,
    `Stop: ${report.stopped ?? "none"}.`,
    "",
    "| Task | Trials | Passed | Median ms |",
    "| --- | --- | --- | --- |",
  ];
  for (const id of new Set(report.plan.map((item) => item.id))) {
    const trials = report.trials.filter((item) => item.id === id);
    const times = trials.map((item) => item.elapsedMs).sort((a, b) => a - b);
    const middle = Math.floor(times.length / 2);
    const median = times.length
      ? times.length % 2
        ? times[middle]
        : ((times[middle - 1] ?? 0) + (times[middle] ?? 0)) / 2
      : "unknown";
    rows.push(
      `| ${id}: ${taskCase(id).title} | ${trials.map((item) => (item.status === "blocked" ? "blocked" : item.failure ? "fail" : (item.score?.completion ?? "unknown"))).join(", ")} | ${trials.filter((item) => item.status === "done" && !item.failure && item.score?.completion === "pass").length}/${report.plan.filter((item) => item.id === id).length} | ${median} |`,
    );
  }
  rows.push(
    "",
    "| Trial | Evidence | Failed checks | Failure | Released bytes |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const item of report.trials)
    rows.push(
      `| ${item.id}/${item.repeat} | ${cell(item.directory)} | ${Object.entries(
        item.score?.checks ?? {},
      )
        .filter(([, value]) => !value)
        .map(([key]) => key)
        .join(
          ", ",
        )} | ${cell(item.failure ?? "")} | ${item.cleanup?.released ?? "unknown"} |`,
    );
  rows.push(
    "",
    "Three repeats describe this sample. They do not establish precise reliability. Missing cost remains unknown.",
    "",
  );
  return rows.join("\n");
}
export function compareReports(before: TaskReport, after: TaskReport) {
  if (before.dirty || after.dirty)
    throw new Error("Compare committed versions with clean working trees");
  if (before.commit === after.commit)
    throw new Error("Comparison requires two different commits");
  if (
    before.suiteHash !== after.suiteHash ||
    !isDeepStrictEqual(before.conditions, after.conditions) ||
    !isDeepStrictEqual(before.plan, after.plan)
  )
    throw new Error("Comparison conditions differ");
  if (
    before.stopped ||
    after.stopped ||
    before.trials.length !== before.plan.length ||
    after.trials.length !== after.plan.length
  )
    throw new Error("Comparison has incomplete trials");
  const versions = (report: TaskReport) =>
    [...new Set(report.trials.map((item) => item.nativeVersion))].sort();
  if (
    versions(before).includes(null) ||
    !isDeepStrictEqual(versions(before), versions(after))
  )
    throw new Error("Harness versions differ or are unknown");
  const tasks = [...new Set(before.plan.map((item) => item.id))].map((id) => {
    const count = (report: TaskReport) =>
      report.trials.filter(
        (item) =>
          item.id === id && !item.failure && item.score?.completion === "pass",
      ).length;
    return {
      id,
      before: count(before),
      after: count(after),
      review: [...before.trials, ...after.trials].some(
        (item) =>
          item.id === id &&
          (item.failure || item.score?.completion === "unreviewed"),
      )
        ? "required"
        : "complete",
    };
  });
  return {
    before: reportTotals(before),
    after: reportTotals(after),
    tasks,
    regressions: tasks
      .filter((item) => item.after < item.before)
      .map((item) => item.id),
    note: "Small differences require more preplanned paired trials. Separate reports alone do not prove interleaved execution.",
  };
}
