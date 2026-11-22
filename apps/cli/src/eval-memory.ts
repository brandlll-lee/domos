import { execFileSync, fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { memoryCases } from "../../../packages/agent/src/evals/memory-cases.ts";
import {
  evaluateMemory,
  type MemoryTrial,
} from "../../../packages/agent/src/evals/memory-score.ts";
import type { MemoryWorkerInput } from "../../../packages/agent/src/evals/memory-worker.ts";

async function trial(
  input: MemoryWorkerInput,
): Promise<Record<string, unknown>> {
  const child = fork(
    fileURLToPath(
      new URL(
        "../../../packages/agent/src/evals/memory-worker.ts",
        import.meta.url,
      ),
    ),
    { silent: true, execArgv: [] },
  );
  let result: Record<string, unknown> | undefined;
  let checkpoint = false;
  child.stdout?.resume();
  child.stderr?.resume();
  child.on("message", (message: Record<string, unknown>) => {
    if (message.phase) {
      console.error(`${input.id}: ${message.phase}`);
      return;
    }
    if (message.checkpoint) {
      checkpoint = true;
      child.kill("SIGKILL");
    } else result = message;
  });
  const timer = setTimeout(
    () => child.kill("SIGKILL"),
    (input.seconds + 30) * 1000,
  );
  child.send(input);
  const [code, signal] = await once(child, "exit");
  clearTimeout(timer);
  if (checkpoint) return trial({ ...input, resume: true });
  return (
    result ?? {
      failure: { kind: "worker", message: `Worker exited: ${code ?? signal}` },
    }
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      harness: { type: "string", default: "codex" },
      model: { type: "string" },
      options: { type: "string" },
      case: { type: "string" },
      output: { type: "string" },
      seconds: { type: "string", default: "150" },
      "max-tokens": { type: "string", default: "250000" },
      catalog: { type: "boolean", default: false },
      trace: { type: "string" },
    },
  });
  if (values.trace) {
    const report = JSON.parse(await readFile(values.trace, "utf8")) as {
      subject: {
        result?: MemoryTrial;
        failure?: unknown;
        score?: ReturnType<typeof evaluateMemory>;
      }[];
    };
    if (!Array.isArray(report.subject) || !report.subject.length)
      throw new Error("Trace must contain executed memory cases.");
    for (const item of report.subject)
      if (
        item.result &&
        !memoryCases.some((test) => test.id === item.result?.id)
      )
        throw new Error(`Unknown trace case: ${item.result.id}`);
    for (const item of report.subject)
      item.score = item.result ? evaluateMemory(item.result) : undefined;
    const output = resolve(values.output ?? `${values.trace}.scored.json`);
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(output);
    process.exitCode = report.subject.every(
      (item) => !item.failure && item.score?.passed === item.score?.total,
    )
      ? 0
      : 1;
    return;
  }
  if (!values.model && !values.catalog)
    throw new Error(
      "Use --catalog to inspect native models, then pass --model <exact id>.",
    );
  const seconds = Number(values.seconds);
  const maxTokens = Number(values["max-tokens"]);
  if (
    ![seconds, maxTokens].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw new Error("Budgets must be positive integers.");
  const options: unknown = values.options
    ? JSON.parse(values.options)
    : undefined;
  if (
    options &&
    (typeof options !== "object" ||
      Array.isArray(options) ||
      Object.values(options).some((item) => typeof item !== "string"))
  )
    throw new Error(
      "--options must be a JSON object of native option IDs and string values.",
    );
  const config = {
    provider: values.harness,
    model: values.model ?? null,
    ...(options ? { options: options as Record<string, string> } : {}),
    approvalMode: "full" as const,
  };
  const selected = values.case
    ? memoryCases.filter((item) => item.id === values.case)
    : memoryCases;
  if (!selected.length) throw new Error(`Unknown case: ${values.case}`);
  const root = await mkdtemp(join(tmpdir(), "domos-memory-eval-"));
  const results = [];
  for (const item of values.catalog ? [memoryCases[0]] : selected) {
    const directory = join(root, item.id);
    await mkdir(directory);
    const outcome = await trial({
      id: item.id,
      directory,
      config,
      seconds,
      maxTokens,
      catalog: values.catalog,
    });
    if (values.catalog) {
      console.log(JSON.stringify(outcome, null, 2));
      return;
    }
    const record = outcome.result as MemoryTrial | undefined;
    const score = record ? evaluateMemory(record) : null;
    results.push({ ...outcome, failure: outcome.failure, score });
    console.log(
      `${item.id}: ${outcome.failure ? `${JSON.stringify(outcome.failure)}; ` : ""}${score ? `${score.passed}/${score.total} rules; answer unreviewed` : "unscored"}`,
    );
  }
  const report = {
    version: 1,
    suite: "memory-1",
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    dirty: Boolean(
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim(),
    ),
    config,
    budgets: { seconds, maxTokens },
    createdAt: new Date().toISOString(),
    directory: root,
    subject: results,
    judge: null,
    taskSuccess: "unreviewed",
  };
  const output = resolve(values.output ?? join(root, "report.json"));
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(output);
  process.exitCode = results.every(
    (item) =>
      !item.failure && item.score && item.score.passed === item.score.total,
  )
    ? 0
    : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
