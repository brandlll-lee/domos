import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, onTestFinished, test } from "vitest";
import { computerTrace } from "../src/evals/computer.ts";
import {
  evaluateTrajectories,
  readTaskTrace,
  trajectoryCases,
} from "../src/evals/trajectory.ts";

test("task traces retain parameters, receipt times, errors, cost and incomplete results", async () => {
  const root = await mkdtemp(join(tmpdir(), "domos-trace-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "agent.sqlite");
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE tasks(id INTEGER,record TEXT); CREATE TABLE entries(id INTEGER PRIMARY KEY, record TEXT)",
  );
  db.prepare("INSERT INTO tasks VALUES(?,?)").run(
    1,
    JSON.stringify({ startedAt: 100, endedAt: 400 }),
  );
  const insert = db.prepare("INSERT INTO entries(record) VALUES(?)");
  for (const data of [
    {
      id: "call",
      role: "assistant",
      timestamp: 110,
      content: [
        {
          type: "toolCall",
          id: "x",
          name: "read",
          arguments: { path: "src/a.ts", offset: 4 },
        },
      ],
    },
    {
      id: "result",
      role: "toolResult",
      toolCallId: "x",
      endedAt: 250,
      isError: true,
      content: [{ type: "text", text: "Read failed" }],
    },
    {
      id: "result",
      role: "toolResult",
      toolCallId: "x",
      endedAt: 300,
      isError: false,
      native: { structuredContent: { receipt: "original result" } },
      content: [{ type: "text", text: "Recovered" }],
    },
  ])
    insert.run(
      JSON.stringify({ kind: "domos.engine-message", byTaskId: 1, data }),
    );
  insert.run(
    JSON.stringify({
      kind: "domos.usage-task",
      data: { taskId: "1", harness: "codex", model: "model" },
    }),
  );
  insert.run(
    JSON.stringify({
      kind: "domos.engine-usage",
      data: { taskId: "1", costUsd: 0.02 },
    }),
  );
  db.close();
  const before = await readFile(path);
  const trace = readTaskTrace(path, 1);
  expect(trace).toMatchObject({
    coverage: "complete",
    modelResponses: null,
    assistantTextMessages: 0,
    completion: "unreviewed",
    costUsd: 0.02,
    calls: [
      {
        input: { path: "src/a.ts", offset: 4 },
        startedAt: 110,
        endedAt: 300,
        failed: false,
        output: "Recovered",
        id: "x",
        message: { entryId: 1, messageId: "call" },
        result: { entryId: 3, messageId: "result" },
      },
    ],
  });
  expect(trace.database).toBe(path);
  const reference = trace.calls[0]?.result;
  if (!reference) throw new Error("Result reference required");
  const archive = new DatabaseSync(path, { readOnly: true });
  try {
    const row = archive
      .prepare("SELECT record FROM entries WHERE id=?")
      .get(reference.entryId);
    expect(
      JSON.parse(String(row?.record)).data.native.structuredContent,
    ).toEqual({ receipt: "original result" });
  } finally {
    archive.close();
  }
  expect(
    evaluateTrajectories([{ name: "read", trace, expectedTools: ["read"] }]),
  ).toMatchObject({
    toolSelectionAccuracy: 1,
    precision: 1,
    recall: 1,
    completionRate: null,
    costUsd: 0.02,
    cases: [
      {
        trace: {
          database: path,
          calls: [{ id: "x", result: { entryId: 3, messageId: "result" } }],
        },
      },
    ],
  });
  expect(await readFile(path)).toEqual(before);
  expect(() => readTaskTrace(path, 2)).toThrow("Task not found");
  const incomplete = {
    ...trace,
    coverage: "excerpt" as const,
    costUsd: null,
    calls: [{ ...trace.calls[0]!, endedAt: null, failed: undefined }],
  };
  expect(
    evaluateTrajectories([
      {
        name: "incomplete",
        trace: incomplete,
        expectedTools: ["read", "verify"],
      },
    ]),
  ).toMatchObject({
    precision: 1,
    recall: 0.5,
    toolSelectionAccuracy: 0,
    costUsd: null,
    cases: [{ toolSuccessRate: null, metrics: { toolTimeMs: null } }],
  });
});

test("committed trajectory cases run against retained source traces", async () => {
  const root = new URL("./fixtures/", import.meta.url);
  const cases = trajectoryCases.parse(
    JSON.parse(await readFile(new URL("trajectory-cases.json", root), "utf8")),
  );
  const loaded = await Promise.all(
    cases.map(async (item) => ({
      ...item,
      trace: computerTrace.parse(
        JSON.parse(await readFile(new URL(item.trace, root), "utf8")),
      ),
    })),
  );
  const result = evaluateTrajectories(loaded);
  expect(result.precision).toBe(1);
  expect(result.recall).toBe(1);
  expect(result.reviewedCases).toBe(
    loaded.filter((item) => item.trace.completion !== "unreviewed").length,
  );
  expect(result.completionRate).toBe(1);
  expect(result.costUsd).toBeNull();
});
