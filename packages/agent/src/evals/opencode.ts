import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { computerTrace } from "./computer.ts";

export function readOpenCodeTrace(
  domosFile: string,
  nativeFile: string,
  taskId: number,
) {
  const domos = new DatabaseSync(domosFile, { readOnly: true });
  try {
    const row = domos
      .prepare("SELECT record FROM tasks WHERE id=?")
      .get(taskId);
    if (!row) throw new Error("Task not found");
    const task = z
      .object({ startedAt: z.number(), endedAt: z.number() })
      .parse(JSON.parse(String(row.record)));
    const usage = domos
      .prepare(
        "SELECT record FROM entries WHERE json_extract(record,'$.kind')='domos.engine-usage' AND json_extract(record,'$.data.taskId')=? ORDER BY id LIMIT 1",
      )
      .get(String(taskId));
    if (!usage) throw new Error("Task has no recorded engine usage");
    const engine = z
      .object({
        data: z.object({
          harness: z.literal("opencode"),
          sessionId: z.string(),
          model: z.string(),
        }),
      })
      .parse(JSON.parse(String(usage?.record)));
    const native = new DatabaseSync(nativeFile, { readOnly: true });
    try {
      const parts = native
        .prepare(
          "SELECT json_extract(data,'$.tool') AS name, json_extract(data,'$.state.input') AS input, COALESCE(json_extract(data,'$.state.error'),json_extract(data,'$.state.output'),'') AS output, json_extract(data,'$.state.time.start') AS startedAt, json_extract(data,'$.state.time.end') AS endedAt FROM part WHERE session_id=? AND time_created BETWEEN ? AND ? AND json_extract(data,'$.type')='tool' ORDER BY time_created",
        )
        .all(engine.data.sessionId, task.startedAt, task.endedAt);
      const calls = parts.map((row) => ({
        ...row,
        input: JSON.parse(String(row.input)),
      }));
      const messages = native
        .prepare(
          "SELECT COUNT(*) AS count FROM message WHERE session_id=? AND time_created BETWEEN ? AND ? AND json_extract(data,'$.role')='assistant' AND COALESCE(json_extract(data,'$.summary'),0)=0",
        )
        .get(engine.data.sessionId, task.startedAt, task.endedAt);
      return computerTrace.parse({
        source: `domos-task:${taskId}`,
        harness: "opencode",
        model: engine.data.model,
        coverage: "complete",
        ...task,
        modelResponses: Number(messages?.count),
        completion: "unreviewed",
        calls,
      });
    } finally {
      native.close();
    }
  } finally {
    domos.close();
  }
}
