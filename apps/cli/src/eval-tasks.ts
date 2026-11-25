import { execFileSync, fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, homedir, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import {
  judgeVersion,
  verifyCalibration,
} from "../../../packages/agent/src/evals/task-calibration.ts";
import {
  monitoringInstructions,
  taskCase,
  taskCases,
  taskFiles,
} from "../../../packages/agent/src/evals/task-cases.ts";
import {
  evalConfig,
  taskExperiment,
} from "../../../packages/agent/src/evals/task-config.ts";
import {
  graderHash,
  judgeConfig,
} from "../../../packages/agent/src/evals/task-grading.ts";
import {
  judgeTask,
  nativeEval,
} from "../../../packages/agent/src/evals/task-judge.ts";
import {
  compareReports,
  experimentFactor,
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
  evaluationRoot,
  evidenceInventory,
  removeTrialPath,
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
  if (
    trial.judgment &&
    hash(await readFile(join(trial.judgment.directory, "judgment.json"))) !==
      trial.judgment.hash
  )
    throw new Error("Judgment hash mismatch");
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
      harness: { type: "string" },
      model: { type: "string" },
      options: { type: "string" },
      catalog: { type: "boolean" },
      experiment: { type: "string" },
      factor: { type: "string", default: "code" },
      judge: { type: "boolean" },
      calibration: { type: "string" },
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
  if (values.catalog) {
    const directory = resolve(
      values.root ?? join(homedir(), "domos-evals", `catalog-${randomUUID()}`),
    );
    evaluationRoot(directory, repo);
    await mkdir(dirname(directory), { recursive: true });
    await mkdir(directory, { recursive: false });
    const result = await nativeEval({
      directory,
      config: {
        provider: values.harness ?? "codex",
        model: null,
        options: {},
        approvalMode: "ask",
      },
      seconds: 60,
    });
    const cleanup = await cleanTrial(directory);
    if (result.failure) throw new Error(result.failure);
    await removeTrialPath(dirname(directory), directory);
    console.error(`Catalog cleanup released ${cleanup.before} bytes`);
    console.log(JSON.stringify(result.catalog, null, 2));
    return;
  }
  const config = evalConfig.parse({
    provider: values.harness ?? "codex",
    model:
      values.model ??
      (values.harness && values.harness !== "codex" ? "" : "gpt-6.1-terra"),
    options: values.options
      ? JSON.parse(values.options)
      : values.harness && values.harness !== "codex"
        ? {}
        : { effort: "low" },
  });
  const grading = {
    hash: graderHash,
    nativeVersion: null as string | null,
    provider: judgeConfig.provider,
    model: judgeConfig.model,
    options: judgeConfig.options,
  };
  const shouldJudge = values.judge ?? !values.trace;
  let judgeTokens = 0;
  let calibrationVerified = false;
  const grade = async (
    evidence: Parameters<typeof scoreTask>[0],
    directory: string,
  ) => {
    const score = scoreTask(evidence);
    if (!shouldJudge || score.completion !== "unreviewed") return { score };
    if (!values.calibration)
      throw new Error(
        "Semantic grading requires --calibration <passed holdout report>",
      );
    if (!calibrationVerified) {
      grading.nativeVersion = (
        await verifyCalibration(values.calibration)
      ).nativeVersion;
      calibrationVerified = true;
    }
    if (judgeTokens >= 2000000) throw new Error("Judge token budget reached");
    const result = await judgeTask(evidence, directory);
    judgeTokens += result.judgment?.tokens ?? 0;
    if (result.judgment && !result.judgment.failure) {
      try {
        if (
          (await judgeVersion(result.judgment.directory)) !==
          grading.nativeVersion
        )
          throw new Error("Judge version differs from calibration");
      } catch (error) {
        result.score = score;
        result.judgment.failure = String(error);
      }
    }

    return result;
  };
  if (values.trace) {
    const report = taskReport.parse(await json(values.trace));
    if (values.compare) {
      const after = taskReport.parse(await json(values.compare));
      for (const trial of [...report.trials, ...after.trials])
        if (trial.evidenceHash) await readEvidence(trial);
      const comparison = compareReports(
        report,
        after,
        experimentFactor.parse(values.factor),
      );
      console.log(JSON.stringify(comparison, null, 2));
      if (values.output)
        await writeFile(
          values.output,
          `${JSON.stringify(comparison, null, 2)}\n`,
          { flag: "wx" },
        );
      process.exitCode = comparison.tasks.some(
        (item) => item.review === "required",
      )
        ? 2
        : comparison.regressions.length
          ? 1
          : 0;
      return;
    }
    const originalVersion = report.taskHash ?? report.suiteHash;
    report.sourceReport = {
      path: resolve(values.trace),
      hash: hash(await readFile(values.trace)),
    };
    report.gradedAt = new Date().toISOString();
    report.version = 2;
    report.taskHash = originalVersion;
    report.grading = grading;
    const gradingRoot = resolve(
      values.root ?? `${values.trace}.${randomUUID()}.grading`,
    );
    evaluationRoot(gradingRoot, repo);
    await mkdir(gradingRoot, { recursive: false });
    const reviews: Record<string, unknown> = values.review
      ? await json(values.review)
      : {};
    for (const key of Object.keys(reviews))
      if (!report.trials.some((trial) => `${trial.id}:${trial.repeat}` === key))
        throw new Error(`Unknown review trial: ${key}`);
    const retained = new Map<string, Parameters<typeof scoreTask>[0]>();
    for (const trial of report.trials) {
      if (!trial.evidenceHash) continue;
      const evidence = await readEvidence(trial);
      const key = `${trial.id}:${trial.repeat}`;
      if (reviews[key]) trial.review = taskReview.parse(reviews[key]);
      delete trial.judgment;
      trial.score = scoreTask(evidence, trial.review);
      retained.set(key, evidence);
    }
    for (const trial of report.trials) {
      const evidence = retained.get(`${trial.id}:${trial.repeat}`);
      if (!evidence || trial.review) continue;
      Object.assign(
        trial,
        await grade(evidence, join(gradingRoot, `${trial.id}-${trial.repeat}`)),
      );
      if (
        trial.judgment?.failure ||
        (trial.judgment && trial.judgment.tokens === null)
      ) {
        report.stopped = "Judge failed; inspect retained evidence";
        break;
      }
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
    model: config.model,
    harness: config.provider,
    options: config.options,
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
  if (shouldJudge && plan.some((p) => taskCase(p.id).review)) {
    if (!values.calibration)
      throw new Error(
        "Semantic grading requires --calibration <passed holdout report>",
      );
    grading.nativeVersion = (
      await verifyCalibration(values.calibration)
    ).nativeVersion;
    calibrationVerified = true;
  }
  const sources = [
    "task-cases.ts",
    "task-score.ts",
    "task-grading.ts",
    "task-judge.ts",
    "task-native-worker.ts",
    "task-config.ts",
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
  const taskHash = hash(
    Buffer.concat(
      await Promise.all(
        ["task-cases.ts", "task-fixture.ts", "memory-cases.ts"].map((name) =>
          readFile(join(repo, "packages/agent/src/evals", name)),
        ),
      ),
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
  evaluationRoot(root, repo);
  if (
    Boolean(values.before) !== Boolean(values.after) ||
    (values.target && values.before)
  )
    throw new Error("Use --target, or both --before and --after");
  const experiment = values.experiment
    ? taskExperiment.parse(await json(values.experiment))
    : undefined;
  if (
    experiment &&
    (values.before ||
      values.after ||
      values.target ||
      values.harness ||
      values.model ||
      values.options)
  )
    throw new Error("Experiment defines both configurations and targets");
  const targets = experiment
    ? [resolve(experiment.before.target), resolve(experiment.after.target)]
    : values.before && values.after
      ? [resolve(values.before), resolve(values.after)]
      : [resolve(values.target ?? repo)];
  const reports: {
    root: string;
    target: string;
    path: string;
    report: TaskReport;
  }[] = [];
  await mkdir(root, { recursive: true });
  const experimentId = randomUUID();
  const experimentPlan = {
    factor: experiment?.factor ?? "code",
    plan,
    conditions,
    targets,
    configs: experiment
      ? [experiment.before.config, experiment.after.config]
      : [config, config],
  };
  const planHash = hash(JSON.stringify(experimentPlan));
  if (targets.length === 2)
    await writeFile(
      join(root, "experiment.json"),
      JSON.stringify(experimentPlan, null, 2),
      { flag: "wx" },
    );
  for (const [index, target] of targets.entries()) {
    const directory = join(
      root,
      targets.length === 2 ? (index ? "after" : "before") : "run",
    );
    await mkdir(directory);
    const selectedConfig = experiment
      ? index
        ? experiment.after.config
        : experiment.before.config
      : config;
    const report: TaskReport = {
      version: 2,
      taskHash,
      grading,
      suite: "tasks-1",
      ...(targets.length === 2
        ? {
            experiment: {
              id: experimentId,
              factor: experiment?.factor ?? "code",
              arm: index ? ("after" as const) : ("before" as const),
              planHash,
            },
          }
        : {}),
      suiteHash,
      commit: git(target, "rev-parse", "HEAD"),
      dirty: Boolean(git(target, "status", "--porcelain")),
      createdAt: new Date().toISOString(),
      conditions: {
        ...conditions,
        model: selectedConfig.model,
        harness: selectedConfig.provider,
        options: selectedConfig.options,
      },
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
  if (reports.length === 2) {
    const [a, b] = reports;
    if (!a || !b) throw new Error("Experiment requires two arms");
    const preflight = (r: TaskReport) => ({
      ...r,
      plan: [],
      trials: [],
      stopped: null,
    });
    compareReports(
      preflight(a.report),
      preflight(b.report),
      experiment?.factor ?? "code",
    );
  }
  let dispatch = 0;
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
          provider: run.report.conditions.harness,
          model: run.report.conditions.model,
          options: run.report.conditions.options,
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
        dispatch: dispatch++,
      };
      try {
        const bytes = await readFile(join(directory, "evidence.json"));
        if (
          trial.judgment &&
          hash(
            await readFile(join(trial.judgment.directory, "judgment.json")),
          ) !== trial.judgment.hash
        )
          throw new Error("Judgment hash mismatch");
        const evidence = taskEvidence.parse(JSON.parse(bytes.toString()));
        trial.evidenceHash = hash(bytes);
        trial.nativeVersion = evidence.version;
        trial.actualModel =
          evidence.actualModels?.length === 1 &&
          evidence.actualModels[0]?.provider &&
          evidence.actualModels[0]?.model
            ? `${evidence.actualModels[0].provider}/${evidence.actualModels[0].model}`
            : null;
        Object.assign(
          trial,
          await grade(
            evidence,
            join(run.root, `${planned.id}-${planned.repeat}-judge`),
          ),
        );
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
        if (
          trial.judgment?.failure ||
          (trial.judgment && trial.judgment.tokens === null)
        )
          halt = "Judge failed; inspect retained evidence";
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
  if (reports.length === 2 && !halt) {
    const a = reports[0];
    const b = reports[1];
    if (!a || !b) throw new Error("Missing experiment arm");
    const comparison = compareReports(
      a.report,
      b.report,
      experiment?.factor ?? "code",
    );
    await writeFile(
      join(root, "comparison.json"),
      JSON.stringify(comparison, null, 2),
      { flag: "wx" },
    );
  }
  process.exitCode = Math.max(
    ...reports.map((item) => reportExitCode(item.report)),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
