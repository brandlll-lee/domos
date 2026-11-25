import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  calibrationReport,
  calibrationSamples,
  calibrationTotals,
  sampleHash,
} from "../../../packages/agent/src/evals/task-calibration.ts";
import { graderHash } from "../../../packages/agent/src/evals/task-grading.ts";
import { judgeTask } from "../../../packages/agent/src/evals/task-judge.ts";
import {
  directoryBytes,
  diskFree,
  evaluationRoot,
} from "../../../packages/agent/src/evals/task-storage.ts";

async function main() {
  const { values } = parseArgs({
    options: {
      set: { type: "string", default: "development" },
      root: { type: "string" },
    },
  });
  if (!["development", "holdout"].includes(values.set))
    throw new Error("Choose development or holdout");
  const root = resolve(
    values.root ?? join(homedir(), "domos-evals", `calibration-${Date.now()}`),
  );
  evaluationRoot(
    root,
    resolve(fileURLToPath(new URL("../../..", import.meta.url))),
  );
  await mkdir(root, { recursive: false });
  const report = calibrationReport.parse({
    graderHash,
    sampleHash,
    set: values.set,
    labelReview: "spec-derived; independent human review pending",
    results: [],
    stopped: null,
  });
  for (const sample of calibrationSamples.filter((s) => s.set === values.set)) {
    for (const repeat of [1, 2, 3]) {
      if (
        report.results.reduce((sum, r) => sum + (r.tokens ?? 0), 0) >=
          2000000 ||
        (await directoryBytes(root)) >= 1024 ** 3 ||
        (await diskFree(root)) < 2 * 1024 ** 3
      ) {
        report.stopped = "Calibration resource budget reached";
        break;
      }
      const directory = join(root, `${sample.id}-${repeat}`);
      const result = await judgeTask(sample.evidence, directory);
      if (!result.judgment)
        throw new Error(
          `Reference sample bypassed semantic grading: ${sample.id}`,
        );
      report.results.push({
        id: sample.id,
        repeat,
        expected: sample.expected,
        completion: result.score.completion,
        matched: result.score.completion === sample.expected,
        ...result.judgment,
      });
      console.log(
        `${sample.id}/${repeat}: ${result.score.completion}; expected=${sample.expected}`,
      );
      await writeFile(
        join(root, "report.json"),
        JSON.stringify(report, null, 2),
      );
      if (result.judgment.failure || result.judgment.tokens === null) {
        report.stopped = result.judgment.failure ?? "Judge usage unknown";
        break;
      }
    }
    if (report.stopped) break;
  }
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(
    join(root, "summary.json"),
    JSON.stringify(calibrationTotals(report), null, 2),
  );
  console.log(join(root, "report.json"));
  process.exitCode = report.stopped
    ? 2
    : report.results.some((r) => !r.matched)
      ? 1
      : 0;
}
main().catch((error) => {
  console.error(String(error));
  process.exitCode = 2;
});
