import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  computerExitCode,
  computerTrace,
  evaluateComputer,
} from "../../../packages/agent/src/evals/computer.ts";
import { readOpenCodeTrace } from "../../../packages/agent/src/evals/opencode.ts";
import {
  evaluateTrajectories,
  readTaskTrace,
  trajectoryCases,
} from "../../../packages/agent/src/evals/trajectory.ts";

async function main() {
  const { values } = parseArgs({
    options: {
      trace: { type: "string" },
      cases: { type: "string" },
      "domos-db": { type: "string" },
      "opencode-db": { type: "string" },
      task: { type: "string" },
    },
  });
  if (values.cases) {
    if (
      values.trace ||
      values.task ||
      values["domos-db"] ||
      values["opencode-db"]
    )
      throw new Error("Use --cases alone.");
    const cases = trajectoryCases.parse(
      JSON.parse(await readFile(values.cases, "utf8")),
    );
    const loaded = await Promise.all(
      cases.map(async (item) => ({
        ...item,
        trace: computerTrace.parse(
          JSON.parse(
            await readFile(
              resolve(dirname(values.cases as string), item.trace),
              "utf8",
            ),
          ),
        ),
      })),
    );
    const result = evaluateTrajectories(loaded);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.cases.some((item) => !item.exactMatch)
      ? 1
      : computerExitCode(result.cases);
    return;
  }
  const native = values.task || values["domos-db"] || values["opencode-db"];
  if (
    native &&
    (values.trace ||
      !values.task ||
      !values["domos-db"] ||
      !Number.isSafeInteger(Number(values.task)) ||
      Number(values.task) <= 0)
  )
    throw new Error(
      "Use --task <id> --domos-db <file> [--opencode-db <file>], --trace <file>, or --cases <file>.",
    );
  const trace = native
    ? values["opencode-db"]
      ? readOpenCodeTrace(
          values["domos-db"] as string,
          values["opencode-db"] as string,
          Number(values.task),
        )
      : readTaskTrace(values["domos-db"] as string, Number(values.task))
    : JSON.parse(
        await readFile(
          values.trace ??
            new URL(
              "../../../packages/agent/test/fixtures/computer-eval.json",
              import.meta.url,
            ),
          "utf8",
        ),
      );
  const result = evaluateComputer(trace);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = computerExitCode([result]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Eval failed");
  process.exitCode = 2;
});
