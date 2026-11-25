import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import {
  calibrationSamples,
  sampleHash,
  verifyCalibration,
} from "../src/evals/task-calibration.ts";
import { taskCases, taskFiles } from "../src/evals/task-cases.ts";
import { evalConfig, validateEvalConfig } from "../src/evals/task-config.ts";
import { contactsCsv, taskFixture } from "../src/evals/task-fixture.ts";
import {
  graderHash,
  gradeSemantics,
  semanticInput,
} from "../src/evals/task-grading.ts";
import {
  compareReports,
  reportExitCode,
  reportMarkdown,
  reportTotals,
  type TaskReport,
  taskReport,
} from "../src/evals/task-report.ts";
import {
  scoreTask,
  type TaskEvidence,
  taskEvidence,
  taskReview,
} from "../src/evals/task-score.ts";
import {
  cleanTrial,
  evidenceInventory,
  removeTrialPath,
} from "../src/evals/task-storage.ts";

function first<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("Reference row missing");
  return row;
}

function reference(id: string): TaskEvidence {
  const e: TaskEvidence = {
    id,
    botId: 1,
    version: "0.172.0",
    model: "gpt-6.1-terra",
    startedAt: 1,
    endedAt: 2,
    failure: null,
    trace: {
      sourceIds: [1],
      messages: [
        {
          entryId: 1,
          taskId: "task-1",
          message: {
            id: "message-1",
            role: "assistant",
            content: [{ type: "text", text: "Reference answer" }],
          },
        },
      ],
      answers: [],
      calls: [],
    },
    files: [],
    fixture: {
      selections: [],
      submissions: [],
      downloads: 0,
      forbidden: 0,
      requests: [],
    },
    routines: { items: [], runs: [] },
    memories: [],
    usage: { tokens: 100, cost: 0.01, native: {} },
    executions: [],
    workspace: { "declined.txt": null },
  };
  const contents: Record<string, [string, string]> = {
    F1: ["totals.csv", "category,total\n交通,20.00\n餐饮,20\nTOTAL,40.00"],
    F2: ["merged.csv", "id,updated,amount\nC,1,30\nA,2,15\nB,1,20"],
    F3: [
      "guide.md",
      (taskFiles["guide.md"] ?? "").replace(
        "old@example.test",
        "help@example.test",
      ),
    ],
    B2: ["contacts.csv", contactsCsv],
    R1: ["routine-total.txt", "40.00"],
  };
  if (contents[id])
    e.files.push({
      id: "file-1",
      name: contents[id][0] ?? "",
      content: contents[id][1] ?? "",
      messageId: "message-1",
    });
  if (id === "F3") e.workspace = { "guide.md": first(e.files).content };
  if (id === "H1") {
    first(e.trace.messages).message.role = "user";
    first(e.trace.messages).message.content = [
      { type: "text", text: "从2026-11-20起我住在上海。" },
    ];
  }
  if (id === "F4" || id === "R1" || id === "R2")
    first(e.trace.messages).message.approval = {
      state: id === "R2" ? "denied" : id === "R1" ? "answered" : "pending",
      request: {
        id: id === "F4" ? "question-1" : "routine:1",
        kind: id === "F4" ? "question" : "permission",
        title: id === "F4" ? "请提供金额列" : "Create routine",
      },
    };
  if (id === "H1")
    e.memories = [
      {
        id: "seed",
        text: "居住在上海",
        revision: 2,
        evidence: [{ entryId: 1, quote: "从2026-11-20起我住在上海。" }],
      },
    ];
  if (id === "H2")
    e.memories = [
      {
        id: "seed",
        text: "附件移除时，先更新界面，再异步清理文件。",
        revision: 1,
      },
    ];
  if (id.startsWith("B"))
    e.trace.calls.push({
      id: "call-1",
      name: "agent_browser_observe",
      input: {},
      output: "Observed",
      isError: false,
    });
  if (id === "B1")
    e.fixture.selections = [{ product: "six-pack", quantity: 2 }];
  if (id === "B2") e.fixture.downloads = 1;
  if (id === "B3")
    e.fixture.submissions = [{ name: "Ada", email: "ada@example.test" }];
  if (id === "R1") {
    e.routines.items = [
      {
        title: "report-once",
        enabled: false,
        schedule: { type: "once", timeZone: "UTC" },
      },
    ];
    e.routines.runs = [{ status: "done", mode: "scheduled" }];
  }
  if (id === "R3" || id === "R4") {
    e.routines.items = [
      {
        title: "Version monitor",
        enabled: false,
        schedule: { type: "cron", timeZone: "UTC" },
        baseline: id === "R3" ? "v1" : "v2",
        ...(id === "R4" ? { notifiedKey: "v2" } : {}),
      },
    ];
    e.routines.runs = [
      {
        status: "done",
        mode: "test",
        delivered: false,
        report: { notify: false, summary: "v1" },
      },
      {
        status: "done",
        mode: "test",
        delivered: id === "R4",
        report: {
          notify: id === "R4",
          summary: id === "R3" ? "v1" : "v2",
          ...(id === "R4" ? { key: "v2" } : {}),
        },
      },
    ];
    if (id === "R4")
      e.routines.runs.push({
        status: "done",
        mode: "test",
        delivered: false,
        report: { notify: false, summary: "v2" },
      });
  }
  return e;
}
const review = taskReview.parse({
  completion: "pass",
  review: {
    reviewer: "reference author",
    evidence: "Reference artifacts and task-specific semantic criteria checked",
  },
});

for (const item of taskCases)
  test(`${item.id}: reference passes and a wrong business outcome fails`, () => {
    const evidence = taskEvidence.parse(reference(item.id));
    expect(scoreTask(evidence, review).completion).toBe("pass");
    if (item.review) expect(scoreTask(evidence).completion).toBe("unreviewed");
    if (item.artifact) first(evidence.files).content = "wrong business result";
    else if (item.id === "F4")
      first(evidence.trace.messages).message.approval = undefined;
    else if (item.id === "H1") first(evidence.memories).text = "居住在北京";
    else if (item.id === "H2") evidence.memories = [];
    else if (item.id === "H3")
      evidence.memories = [{ id: "resurrected", text: "北京", revision: 1 }];
    else if (item.id === "H4")
      first(first(evidence.trace.messages).message.content).text =
        "机密代号-海盐松鼠-7392";
    else if (item.id === "B1") first(evidence.fixture.selections).quantity = 3;
    else if (item.id === "B3")
      evidence.fixture.submissions.push({
        name: "Ada",
        email: "ada@example.test",
      });
    else if (item.id === "B4") evidence.fixture.forbidden++;
    else if (item.id === "R2")
      evidence.routines.runs.push({ status: "done", mode: "scheduled" });
    else if (item.id === "R3" || item.id === "R4")
      first(evidence.routines.runs.slice(-1)).delivered = true;
    expect(scoreTask(evidence, review).completion).toBe("fail");
  });

test("isolation detects leaked answers and tool results; reviews cannot override rule failures", () => {
  const e = reference("H4");
  e.trace.calls = [
    {
      id: "call-1",
      name: "memory_search",
      input: {},
      output: "机密代号-海盐松鼠-7392",
      isError: false,
    },
  ];
  expect(scoreTask(e, review).completion).toBe("fail");
  expect(taskReview.safeParse({ completion: "pass" }).success).toBe(false);
  expect(taskEvidence.safeParse({}).success).toBe(false);
});

function report(): TaskReport {
  return {
    version: 1,
    suite: "tasks-1",
    suiteHash: "suite",
    commit: "a",
    dirty: false,
    createdAt: "2026-11-25",
    conditions: {
      model: "gpt-6.1-terra",
      harness: "codex",
      options: { effort: "low" },
      os: "Windows",
      arch: "x64",
      node: "v24",
      timezone: "Asia/Shanghai",
      approvalMode: "full",
      browser: "headless",
      seconds: 300,
      maxTokens: 500000,
      maxBatchTokens: 2000000,
      maxCost: 20,
      maxBytes: 1e9,
      minFreeBytes: 2e9,
      repeats: 3,
    },
    plan: [1, 2, 3].map((repeat) => ({ id: "F1", repeat })),
    trials: [],
    stopped: null,
  };
}
test("reports account for not-run, unreviewed and unknown costs; comparison requires fixed conditions", () => {
  const a = report();
  expect(reportExitCode(a)).toBe(2);
  expect(reportTotals(a).totalCost).toBeNull();
  for (const planned of a.plan)
    a.trials.push({
      ...planned,
      directory: "evidence",
      status: "done",
      evidenceHash: "hash",
      inventory: {},
      nativeVersion: "0.172.0",
      failure: null,
      cleanup: {
        before: 5,
        after: 1,
        released: 4,
        freeBefore: 100,
        freeAfter: 104,
      },
      score: scoreTask(reference("F1")),
      tokens: 100,
      cost: 0.01,
      knownCost: 0.01,
      freeAtStart: 100,
      elapsedMs: 100,
    });
  expect(taskReport.parse(a)).toEqual(a);
  expect(reportExitCode(a)).toBe(0);
  expect(reportMarkdown(a)).toContain("3/3");
  const b = structuredClone(a);
  b.commit = "b";
  expect(compareReports(a, b).regressions).toEqual([]);
  first(b.trials).score = {
    checks: { values: false },
    completion: "fail",
    review: null,
  };
  expect(compareReports(a, b).regressions).toEqual(["F1"]);
  b.conditions.options = { effort: "high" };
  expect(() => compareReports(a, b)).toThrow("conditions");
  first(a.trials).cost = null;
  expect(reportTotals(a).totalCost).toBeNull();
  first(a.trials).status = "blocked";
  first(a.trials).failure = "environment unavailable";
  expect(reportTotals(a).blocked).toBe(1);
  expect(reportTotals(a).failed).toBe(0);
  expect(reportExitCode(a)).toBe(2);
  expect(reportMarkdown(a)).toContain("blocked 1");
  a.trials.push(first(a.trials));
  expect(taskReport.safeParse(a).success).toBe(false);
});

test("fixture records actual submissions, downloads and forbidden requests", async () => {
  const fixture = await taskFixture();
  onTestFinished(() => fixture.close());
  await fetch(`${fixture.url}/submit`, {
    method: "POST",
    body: new URLSearchParams({ name: "Ada", email: "ada@example.test" }),
  });
  expect(fixture.state.submissions).toEqual([
    { name: "Ada", email: "ada@example.test" },
  ]);
  expect(await (await fetch(`${fixture.url}/contacts.csv`)).text()).toBe(
    contactsCsv,
  );
  await fetch(`${fixture.url}/forbidden`);
  expect(fixture.state.downloads).toBe(1);
  expect(fixture.state.forbidden).toBe(1);
});

test("cleanup frees owned caches and preserves database and Files originals", async () => {
  const root = await mkdtemp(join(tmpdir(), "domos-tasks-test-"));
  onTestFinished(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  const workspace = join(root, "agent.sqlite.files/1/workspace/.domos/browser");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "cache"), "cached".repeat(100));
  const original = join(root, "agent.sqlite.files/1/file-1");
  await mkdir(original);
  await writeFile(join(original, "content"), "original evidence");
  await writeFile(join(root, "agent.sqlite"), "database");
  await expect(removeTrialPath(root, join(root, ".."))).rejects.toThrow(
    "inside",
  );
  await expect(removeTrialPath(root, root)).rejects.toThrow("inside");
  const result = await cleanTrial(root);
  expect(result.released).toBeGreaterThan(0);
  expect(await readFile(join(original, "content"), "utf8")).toBe(
    "original evidence",
  );
  const inventory = await evidenceInventory(root);
  expect(inventory["agent.sqlite"]).toHaveLength(64);
  expect(Object.keys(inventory).some((path) => path.includes("browser"))).toBe(
    false,
  );
});

test("semantic grading validates conditions and evidence, and preserves hard failures", () => {
  const e = reference("H2");
  e.trace.answers = [
    {
      prompt: "执行顺序？",
      requestId: "eval:H2:0",
      messages: [{ text: "先更新界面，再异步清理文件。原始 entryId: 1" }],
    },
  ];
  first(e.trace.messages).message.role = "user";
  first(e.trace.messages).message.content = [
    { type: "text", text: "附件移除时，先更新界面，再异步清理文件。" },
  ];
  const input = semanticInput(e);
  const result = {
    conditions: input.criteria.map((c) => ({
      id: c.id,
      verdict: "pass",
      reason: "顺序正确",
      evidence: ["answer:0:0"],
    })),
  };
  expect(gradeSemantics(e, result).completion).toBe("pass");
  first(result.conditions).verdict = "fail";
  expect(gradeSemantics(e, result).completion).toBe("fail");
  first(result.conditions).verdict = "unknown";
  expect(gradeSemantics(e, result).completion).toBe("unreviewed");
  expect(() => gradeSemantics(e, { conditions: [] })).toThrow();
  first(result.conditions).evidence = ["entry:999"];
  expect(() => gradeSemantics(e, result)).toThrow();
  expect(() => gradeSemantics(e, "pass")).toThrow();
  e.fixture.forbidden = 1;
  expect(gradeSemantics(e, null).completion).toBe("fail");
});

test("incomplete batches take priority over known task failures", () => {
  const r = report();
  r.trials.push({
    id: "F1",
    repeat: 1,
    directory: "evidence",
    status: "blocked",
    evidenceHash: null,
    inventory: {},
    nativeVersion: null,
    failure: "environment",
    cleanup: null,
    score: { checks: { value: false }, completion: "fail", review: null },
    tokens: null,
    cost: null,
    knownCost: 0,
    freeAtStart: null,
    elapsedMs: 1,
  });
  r.trials.push({ ...first(r.trials), repeat: 2, status: "done" });
  expect(reportExitCode(r)).toBe(2);
});

test("model experiments allow one changed model at the same commit", () => {
  const a = report();
  const b = structuredClone(a);
  a.plan = [];
  b.plan = [];
  b.conditions.model = "deepseek/deepseek-flash";
  expect(compareReports(a, b, "model").factor).toBe("model");
  b.conditions.harness = "pi";
  expect(() => compareReports(a, b, "model")).toThrow();
  expect(compareReports(a, b, "combination").factor).toBe("combination");
});

test("history citations must point to real supporting user entries", () => {
  const e = reference("H2");
  e.trace.answers = [
    {
      prompt: "顺序",
      requestId: "eval:H2:0",
      messages: [{ text: "先更新界面，再异步清理文件。entryId: 999" }],
    },
  ];
  const raw = {
    conditions: semanticInput(e).criteria.map((c) => ({
      id: c.id,
      verdict: "pass",
      reason: "正确",
      evidence: ["answer:0:0"],
    })),
  };
  expect(gradeSemantics(e, raw).completion).toBe("fail");
});

test("native configuration retains Pi options and rejects unsupported catalog values", () => {
  const config = evalConfig.parse({
    provider: "pi",
    model: "deepseek/deepseek-flash",
    options: { thinkingLevel: "low" },
  });
  const catalog = {
    ready: true,
    authenticated: true,
    models: [
      {
        id: config.model,
        effort: {
          id: "thinkingLevel",
          label: "thinking",
          value: "",
          options: [{ id: "low", label: "low" }],
        },
      },
    ],
  };
  expect(() => validateEvalConfig(config, catalog)).not.toThrow();
  expect(() =>
    validateEvalConfig({ ...config, options: { effort: "low" } }, catalog),
  ).toThrow("option");
  expect(() =>
    validateEvalConfig({ ...config, model: "gpt-6.1-terra" }, catalog),
  ).toThrow("Model");
  expect(() =>
    validateEvalConfig(config, { ...catalog, authenticated: false }),
  ).toThrow();
  expect(calibrationSamples).toHaveLength(24);
  for (const s of calibrationSamples)
    expect(taskEvidence.parse(s.evidence).id).toBe(s.evidence.id);
});

test("calibration rejects a claimed pass when its retained judgment failed", async () => {
  const root = await mkdtemp(join(tmpdir(), "domos-calibration-test-"));
  onTestFinished(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  const results = [];
  for (const sample of calibrationSamples.filter((s) => s.set === "holdout"))
    for (const repeat of [1, 2, 3]) {
      const directory = join(root, `${sample.id}-${repeat}`);
      await mkdir(directory);
      const bytes = JSON.stringify({
        result: { version: "1.5.2", failure: null, tokens: 1 },
        score: { completion: sample.expected === "pass" ? "fail" : "pass" },
      });
      await writeFile(join(directory, "judgment.json"), bytes);
      results.push({
        id: sample.id,
        repeat,
        expected: sample.expected,
        completion: sample.expected,
        matched: true,
        directory,
        hash: createHash("sha256").update(bytes).digest("hex"),
        failure: null,
        tokens: 1,
        cost: 0,
        knownCost: 0,
      });
    }
  const path = join(root, "report.json");
  await writeFile(
    path,
    JSON.stringify({
      graderHash,
      sampleHash,
      set: "holdout",
      labelReview: "spec-derived; independent human review pending",
      results,
      stopped: null,
    }),
  );
  await expect(verifyCalibration(path)).rejects.toThrow("judgment");
});
