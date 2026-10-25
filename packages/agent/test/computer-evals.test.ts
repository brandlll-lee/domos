import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { computerTrace, evaluateComputer } from "../src/evals/computer.ts";
import { readOpenCodeTrace } from "../src/evals/opencode.ts";

const baseline = computerTrace.parse(
  JSON.parse(
    await readFile(
      new URL("./fixtures/computer-eval.json", import.meta.url),
      "utf8",
    ),
  ),
);

test("task 7094 retains three workflow failures despite a reviewed successful outcome", () => {
  const result = evaluateComputer(baseline);
  expect(result.checks.map((check) => check.status)).toEqual([
    "fail",
    "fail",
    "fail",
  ]);
  expect(result).toMatchObject({
    completion: "pass",
    passed: 0,
    exercised: 3,
    checkPassRate: 0,
    metrics: { toolTimeMs: null, outsideToolsMs: null, fixedSleeps: 1 },
  });
});

test("the same rules accept verified delivery, compatible deltas and available tools", () => {
  const trace = structuredClone(baseline);
  const batch = trace.calls[1];
  const read = trace.calls[2];
  const wait = trace.calls[3];
  if (!batch || !read || !wait) throw new Error("Baseline calls required");
  batch.output = "Set AXValue; verified field value matches supplied text.";
  read.input.max_elements = 250;
  read.output = "no change since s00000002";
  wait.name = "domos_desktop_verify_state";
  wait.output = "Playback state verified";
  expect(evaluateComputer(trace)).toMatchObject({
    passed: 3,
    exercised: 3,
    checkPassRate: 1,
  });
  expect(evaluateComputer({ ...trace, calls: [] })).toMatchObject({
    passed: 0,
    exercised: 0,
    checkPassRate: null,
  });
  expect(() => evaluateComputer({ ...trace, endedAt: -1 })).toThrow();
});

test("native import reads complete tool arguments and counts concurrent tool time once", () => {
  const directory = mkdtempSync(join(tmpdir(), "domos-eval-"));
  const domosPath = join(directory, "domos.sqlite");
  const nativePath = join(directory, "opencode.sqlite");
  try {
    const domos = new DatabaseSync(domosPath);
    domos.exec(
      `CREATE TABLE tasks(id INTEGER, record TEXT);
       CREATE TABLE entries(id INTEGER, record TEXT);
       INSERT INTO tasks VALUES(1,'{"startedAt":0,"endedAt":100}');
       INSERT INTO entries VALUES(1,'{"kind":"domos.engine-usage","data":{"taskId":"1","harness":"opencode","model":"fixture","sessionId":"session"}}');`,
    );
    domos.close();
    const native = new DatabaseSync(nativePath);
    native.exec(
      `CREATE TABLE part(session_id TEXT,time_created INTEGER,data TEXT);
       CREATE TABLE message(session_id TEXT,time_created INTEGER,data TEXT);
       INSERT INTO part VALUES('session',10,'{"type":"tool","tool":"domos_desktop_set_value","state":{"input":{"value":"song"},"output":"Set AXValue","time":{"start":10,"end":40}}}');
       INSERT INTO part VALUES('session',20,'{"type":"tool","tool":"domos_desktop_set_value","state":{"input":{"value":"song"},"output":"Set AXValue","time":{"start":20,"end":50}}}');
       INSERT INTO message VALUES('session',0,'{"role":"assistant"}');`,
    );
    native.close();
    const trace = readOpenCodeTrace(domosPath, nativePath, 1);
    expect(trace.calls[0]?.input).toEqual({ value: "song" });
    expect(evaluateComputer(trace)).toMatchObject({
      completion: "unreviewed",
      metrics: { modelResponses: 1, toolTimeMs: 40, outsideToolsMs: 60 },
    });
    expect(() => readOpenCodeTrace(domosPath, nativePath, 2)).toThrow(
      "Task not found",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
