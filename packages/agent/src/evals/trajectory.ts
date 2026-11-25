import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { ChatMessage } from "../messages.ts";
import {
  type ComputerTrace,
  computerTrace,
  evaluateComputer,
} from "./computer.ts";

export function readTaskTrace(path: string, taskId: number): ComputerTrace {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const row = database
      .prepare("SELECT record FROM tasks WHERE id=?")
      .get(taskId);
    if (!row) throw new Error("Task not found");
    const task = JSON.parse(String(row.record));
    const messages = new Map<string, ChatMessage>();
    const entryIds = new Map<string, number>();
    for (const row of database
      .prepare(
        "SELECT id, record FROM entries WHERE CAST(json_extract(record,'$.byTaskId') AS TEXT)=? AND json_extract(record,'$.kind')='domos.engine-message' ORDER BY id",
      )
      .all(String(taskId))) {
      const message = JSON.parse(String(row.record)).data as ChatMessage;
      messages.set(message.id, message);
      entryIds.set(message.id, Number(row.id));
    }
    const usages = database
      .prepare(
        "SELECT record FROM entries WHERE json_extract(record,'$.data.taskId')=? AND json_extract(record,'$.kind') IN ('domos.engine-usage','domos.usage-task') ORDER BY id",
      )
      .all(String(taskId))
      .map((row) => JSON.parse(String(row.record)));
    const usage =
      usages.find((entry) => entry.kind === "domos.usage-task")?.data ??
      usages[0]?.data;
    if (!usage) throw new Error("Task has no recorded Harness identity");
    const rows = [...messages.values()];
    const calls = rows.flatMap((message) =>
      message.content
        .filter((part) => part.type === "toolCall")
        .map((part) => {
          const result = rows.find((result) => result.toolCallId === part.id);
          return {
            id: part.id,
            message: {
              entryId: entryIds.get(message.id),
              messageId: message.id,
            },
            ...(result
              ? {
                  result: {
                    entryId: entryIds.get(result.id),
                    messageId: result.id,
                  },
                }
              : {}),
            name: part.name,
            input: part.arguments,
            output:
              result?.content
                .flatMap((part) => (part.type === "text" ? [part.text] : []))
                .join("\n") ?? "",
            startedAt: message.timestamp ?? null,
            endedAt: result?.endedAt ?? null,
            failed:
              result?.isError ??
              (result?.toolStatus === "failed"
                ? true
                : result?.toolStatus === "done"
                  ? false
                  : undefined),
          };
        }),
    );
    const billed = usages
      .filter((entry) => entry.kind === "domos.engine-usage")
      .map((entry) => entry.data);
    const costUsd =
      billed.length &&
      billed.every(
        (entry) =>
          typeof entry.costUsd === "number" && entry.costScope !== "session",
      )
        ? billed.reduce((sum, entry) => sum + entry.costUsd, 0)
        : null;
    return computerTrace.parse({
      source: `domos-task:${taskId}`,
      database: path,
      harness: usage.harness,
      model: usage.model ?? "unknown",
      coverage:
        task.startedAt != null &&
        task.endedAt != null &&
        calls.every((call) => call.startedAt !== null && call.endedAt !== null)
          ? "complete"
          : "excerpt",
      startedAt: task.startedAt ?? null,
      endedAt: task.endedAt ?? null,
      modelResponses: null,
      assistantTextMessages: rows.filter(
        (message) =>
          message.role === "assistant" &&
          !message.pending &&
          message.content.some((part) => part.type === "text"),
      ).length,
      completion: "unreviewed",
      costUsd,
      calls,
    });
  } finally {
    database.close();
  }
}

export const trajectoryCases = z
  .array(
    z.object({
      name: z.string().min(1),
      trace: z.string().min(1),
      expectedTools: z.array(z.string().min(1)),
    }),
  )
  .min(1);

export function evaluateTrajectories(
  cases: { name: string; trace: ComputerTrace; expectedTools: string[] }[],
) {
  const results = cases.map(({ name, trace, expectedTools }) => {
    const remaining = [...expectedTools];
    let matched = 0;
    for (const call of trace.calls) {
      const index = remaining.indexOf(call.name);
      if (index >= 0) {
        matched++;
        remaining.splice(index, 1);
      }
    }
    const measured = trace.calls.filter((call) => call.failed !== undefined);
    return {
      name,
      ...evaluateComputer(trace),
      precision: trace.calls.length
        ? matched / trace.calls.length
        : expectedTools.length
          ? 0
          : 1,
      recall: expectedTools.length ? matched / expectedTools.length : 1,
      exactMatch:
        matched === expectedTools.length && matched === trace.calls.length,
      toolSuccessRate: measured.length
        ? measured.filter((call) => !call.failed).length / measured.length
        : null,
      measuredResults: measured.length,
      costUsd: trace.costUsd ?? null,
    };
  });
  const reviewed = results.filter(
    (result) => result.completion !== "unreviewed",
  );
  return {
    kind: "trajectory-suite",
    cases: results,
    toolSelectionAccuracy:
      results.filter((result) => result.exactMatch).length / results.length,
    precision:
      results.reduce((sum, result) => sum + result.precision, 0) /
      results.length,
    recall:
      results.reduce((sum, result) => sum + result.recall, 0) / results.length,
    completionRate: reviewed.length
      ? reviewed.filter((result) => result.completion === "pass").length /
        reviewed.length
      : null,
    reviewedCases: reviewed.length,
    costUsd: results.every((result) => result.costUsd !== null)
      ? results.reduce((sum, result) => sum + (result.costUsd ?? 0), 0)
      : null,
  };
}
