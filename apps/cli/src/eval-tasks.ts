import { execFileSync, fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, homedir, platform, release } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import {
  monitoringInstructions,
  taskCase,
  taskCases,
  taskFiles,
} from "../../../packages/agent/src/evals/task-cases.ts";
import {
  compareReports,
  reportExitCode,
  reportMarkdown,
  type TaskReport,
  taskReport,
} from "../../../packages/agent/src/evals/task-report.ts";
import {
  scoreTask,
  taskEvidence,
  taskReview,
} from "../../../packages/agent/src/evals/task-score.ts";
import {
  cleanTrial,
  directoryBytes,
  diskFree,
  evidenceInventory,
} from "../../../packages/agent/src/evals/task-storage.ts";
import type { TaskWorkerInput } from "../../../packages/agent/src/evals/task-worker.ts";

const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const git = (root: string, ...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const hash = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
async function save(report: TaskReport, path: string) {
  taskReport.parse(report);
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: "w" });
  await writeFile(`${path}.md`, reportMarkdown(report));
}
async function readEvidence(trial: TaskReport["trials"][number]) {
  if (
    !isDeepStrictEqual(
      await evidenceInventory(trial.directory),
      trial.inventory,
    )
  )
    throw new Error(`Evidence changed: ${trial.id}/${trial.repeat}`);
  const bytes = await readFile(join(trial.directory, "evidence.json"));
  if (hash(bytes) !== trial.evidenceHash)
    throw new Error("Evidence hash mismatch");
  const evidence = taskEvidence.parse(JSON.parse(bytes.toString()));
  if (evidence.id !== trial.id) throw new Error("Evidence task mismatch");
  return evidence;
}
async function worker(input: TaskWorkerInput) {
  const child = fork(
    fileURLToPath(
      new URL(
        "../../../packages/agent/src/evals/task-worker.ts",
        import.meta.url,
      ),
    ),
    {
      silent: true,
      detached: process.platform !== "win32",
      execArgv: [],
      env: { ...process.env, AGENT_BROWSER_HEADED: "false" },
    },
  );
  child.stdout?.resume();
  child.stderr?.resume();
  let result: { failure: { kind: string; message: string } | null } | undefined;
  let timedOut = false;
  child.on(
    "message",
    (message: {
      phase?: string;
      failure?: { kind: string; message: string } | null;
    }) => {
      if (message.phase) console.error(`${input.id}: ${message.phase}`);
      else if ("failure" in message)
        result = { failure: message.failure ?? null };
    },
  );
  const timer = setTimeout(
    () => {
      timedOut = true;
      if (child.pid && process.platform === "win32")
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      else if (child.pid) process.kill(-child.pid, "SIGKILL");
    },
    (input.seconds + 45) * 1000,
  );
  child.send(input);
  const [code, signal] = await once(child, "exit");
  clearTimeout(timer);
  if (timedOut || !result || code !== 0)
    return {
      failure: `${timedOut ? "Worker timeout" : `Worker exit ${code ?? signal}`}; ${result?.failure?.message ?? "No settled worker result"}`,
      closed: false,
    };
  return {
    failure: result.failure
      ? `${result.failure.kind}: ${result.failure.message}`
      : null,
    closed: result.failure?.kind !== "evidence",
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      list: { type: "boolean" },
      cases: { type: "string" },
      repeats: { type: "string", default: "3" },
      root: { type: "string" },
      target: { type: "string" },
      before: { type: "string" },
      after: { type: "string" },
      seconds: { type: "string", default: "300" },
      "max-tokens": { type: "string", default: "500000" },
      "max-batch-tokens": { type: "string", default: "2000000" },
      "max-cost": { type: "string" },
      "max-mib": { type: "string", default: "1024" },
      "min-free-mib": { type: "string", default: "2048" },
      trace: { type: "string" },
      compare: { type: "string" },
      review: { type: "string" },
      output: { type: "string" },
    },
  });
  if (values.list) {
    console.log(
      JSON.stringify(
        { cases: taskCases, files: taskFiles, monitoringInstructions },
        null,
        2,
      ),
    );
    return;
  }
  if (values.trace) {
    const report = taskReport.parse(await json(values.trace));
    if (values.compare) {
      const after = taskReport.parse(await json(values.compare));
      for (const trial of [...report.trials, ...after.trials])
        if (trial.evidenceHash) await readEvidence(trial);
      const comparison = compareReports(report, after);
      console.log(JSON.stringify(comparison, null, 2));
      if (values.output)
        await writeFile(
          values.output,
          `${JSON.stringify(comparison, null, 2)}\n`,
          { flag: "wx" },
        );
      process.exitCode = comparison.regressions.length
        ? 1
        : comparison.tasks.some((item) => item.review === "required")
          ? 2
          : 0;
      return;
    }
    const reviews: Record<string, unknown> = values.review
      ? await json(values.review)
      : {};
    for (const key of Object.keys(reviews))
      if (!report.trials.some((trial) => `${trial.id}:${trial.repeat}` === key))
        throw new Error(`Unknown review trial: ${key}`);
    for (const trial of report.trials) {
      if (!trial.evidenceHash) continue;
      const evidence = await readEvidence(trial);
      const key = `${trial.id}:${trial.repeat}`;
      if (reviews[key]) trial.review = taskReview.parse(reviews[key]);
      trial.score = scoreTask(evidence, trial.review);
    }
    const output = resolve(
      values.output ?? `${values.trace}.${randomUUID()}.scored.json`,
    );
    if (output === resolve(values.trace))
      throw new Error("Preserve the original report; select a new output");
    await writeFile(output, "", { flag: "wx" });
    await save(report, output);
    console.log(output);
    process.exitCode = reportExitCode(report);
    return;
  }
  if (values.compare || values.review || values.output)
    throw new Error("Use --trace with --compare, --review or --output");
  const positive = (key: string, value: string) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1)
      throw new Error(`${key} must be a positive integer`);
    return number;
  };
  const conditions: TaskReport["conditions"] = {
    model: "gpt-6.1-terra",
    harness: "codex",
    options: { effort: "low" },
    os: `${platform()} ${release()}`,
    arch: arch(),
    node: process.version,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    approvalMode: "full",
    browser: "headless",
    seconds: positive("seconds", values.seconds),
    maxTokens: positive("max-tokens", values["max-tokens"]),
    repeats: positive("repeats", values.repeats),
    maxBatchTokens: positive("max-batch-tokens", values["max-batch-tokens"]),
    maxCost: values["max-cost"]
      ? positive("max-cost", values["max-cost"])
      : null,
    maxBytes: positive("max-mib", values["max-mib"]) * 1024 ** 2,
    minFreeBytes: positive("min-free-mib", values["min-free-mib"]) * 1024 ** 2,
  };
  const ids = values.cases
    ? values.cases.split(",")
    : taskCases.map((item) => item.id);
  ids.forEach(taskCase);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate cases");
  const plan = ids.flatMap((id) =>
    Array.from({ length: conditions.repeats }, (_, index) => ({
      id,
      repeat: index + 1,
    })),
  );
  const sources = [
    "task-cases.ts",
    "task-score.ts",
    "task-fixture.ts",
    "task-worker.ts",
    "memory-trace.ts",
    "memory-cases.ts",
    "task-report.ts",
    "task-storage.ts",
    "outcome.ts",
  ];
  const suiteHash = hash(
    Buffer.concat(
      await Promise.all([
        ...sources.map((name) =>
          readFile(join(repo, "packages/agent/src/evals", name)),
        ),
        readFile(fileURLToPath(import.meta.url)),
      ]),
    ),
  );
  const root = resolve(
    values.root ??
      join(
        homedir(),
        "domos-evals",
        `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`,
      ),
  );
  const local = relative(repo, root);
  if (
    !local ||
    (!local.startsWith(`..${sep}`) && local !== ".." && !isAbsolute(local))
  )
    throw new Error("Keep evaluation evidence outside the repository");
  if (
    Boolean(values.before) !== Boolean(values.after) ||
    (values.target && values.before)
  )
    throw new Error("Use --target, or both --before and --after");
  const targets =
    values.before && values.after
      ? [resolve(values.before), resolve(values.after)]
      : [resolve(values.target ?? repo)];
  const reports: {
    root: string;
    target: string;
    path: string;
    report: TaskReport;
  }[] = [];
  await mkdir(root, { recursive: true });
  for (const [index, target] of targets.entries()) {
    const directory = join(
      root,
      targets.length === 2 ? (index ? "after" : "before") : "run",
    );
    await mkdir(directory);
    const report: TaskReport = {
      version: 1,
      suite: "tasks-1",
      suiteHash,
      commit: git(target, "rev-parse", "HEAD"),
      dirty: Boolean(git(target, "status", "--porcelain")),
      createdAt: new Date().toISOString(),
      conditions,
      plan,
      trials: [],
      stopped: null,
    };
    if (targets.length === 2 && report.dirty)
      throw new Error("Paired runs require clean committed versions");
    reports.push({
      root: directory,
      target,
      path: join(directory, "report.json"),
      report,
    });
  }
  let halt: string | null = null;
  for (const [index, planned] of plan.entries()) {
    const order = index % 2 ? [...reports].reverse() : reports;
    for (const run of order) {
      const trials = reports.flatMap((item) => item.report.trials);
      const knownCost = trials.reduce((sum, trial) => sum + trial.knownCost, 0);
      if (
        (await directoryBytes(root)) >= conditions.maxBytes ||
        (await diskFree(root)) < conditions.minFreeBytes
      )
        halt = "Disk budget reached";
      if (
        trials.reduce((sum, trial) => sum + (trial.tokens ?? 0), 0) >=
          conditions.maxBatchTokens ||
        (conditions.maxCost !== null && knownCost >= conditions.maxCost)
      )
        halt = "Batch usage budget reached";
      if (halt) break;
      const directory = join(run.root, `${planned.id}-${planned.repeat}`);
      await mkdir(directory);
      const freeAtStart = await diskFree(directory);
      const startedAt = Date.now();
      const settled = await worker({
        ...planned,
        directory,
        codeRoot: run.target,
        config: {
          provider: "codex",
          model: conditions.model,
          options: conditions.options,
          approvalMode: conditions.approvalMode,
        },
        seconds: conditions.seconds,
        maxTokens: conditions.maxTokens,
      });
      const trial: TaskReport["trials"][number] = {
        ...planned,
        directory,
        status: "blocked",
        evidenceHash: null,
        inventory: {},
        nativeVersion: null,
        failure: settled.failure,
        cleanup: null,
        score: null,
        tokens: null,
        cost: null,
        knownCost: 0,
        freeAtStart,
        elapsedMs: Date.now() - startedAt,
      };
      try {
        const bytes = await readFile(join(directory, "evidence.json"));
        const evidence = taskEvidence.parse(JSON.parse(bytes.toString()));
        trial.evidenceHash = hash(bytes);
        trial.nativeVersion = evidence.version;
        trial.score = scoreTask(evidence);
        trial.tokens = evidence.usage.tokens;
        trial.cost = evidence.usage.cost;
        trial.knownCost =
          typeof evidence.usage.native.cost === "number"
            ? evidence.usage.native.cost
            : (evidence.usage.cost ?? 0);
        if (!settled.closed)
          throw new Error(
            "Worker cleanup did not settle; preserve directory for inspection",
          );
        trial.cleanup = await cleanTrial(directory);
        trial.inventory = await evidenceInventory(directory);
        trial.status =
          evidence.failure?.kind === "environment" ? "blocked" : "done";
        if (!trial.failure && evidence.failure)
          trial.failure = `${evidence.failure.kind}: ${evidence.failure.message}`;
        if (
          trial.tokens === null ||
          (trial.cost === null && conditions.maxCost !== null)
        )
          halt =
            "Native usage or cost unknown; inspect pilot evidence before further paid dispatch";
        if (trial.status === "blocked") halt = "Environment blocked";
      } catch (error) {
        trial.failure = `${trial.failure ?? ""}; ${error}`;
        halt = "Evidence or cleanup failed";
      }
      run.report.trials.push(trial);
      console.log(
        `${planned.id}/${planned.repeat}: ${trial.score?.completion ?? "blocked"}; cost=${trial.cost ?? "unknown"}; released=${trial.cleanup?.released ?? "unknown"}`,
      );
      for (const item of reports) {
        item.report.stopped = halt;
        await save(item.report, item.path);
      }
      if (halt) break;
    }
    if (halt) break;
  }
  for (const run of reports) {
    run.report.stopped = halt;
    await save(run.report, run.path);
    console.log(run.path);
  }
  process.exitCode = Math.max(
    ...reports.map((item) => reportExitCode(item.report)),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
