import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { evaluateComputer } from "../../../packages/agent/src/evals/computer.ts";
import { readOpenCodeTrace } from "../../../packages/agent/src/evals/opencode.ts";

async function main() {
  const { values } = parseArgs({
    options: {
      trace: { type: "string" },
      "domos-db": { type: "string" },
      "opencode-db": { type: "string" },
      task: { type: "string" },
    },
  });
  const native = values.task || values["domos-db"] || values["opencode-db"];
  if (
    native &&
    (values.trace ||
      !values.task ||
      !values["domos-db"] ||
      !values["opencode-db"] ||
      !Number.isSafeInteger(Number(values.task)) ||
      Number(values.task) <= 0)
  )
    throw new Error(
      "Use --task <id> --domos-db <file> --opencode-db <file>, or --trace <file>.",
    );
  const trace = native
    ? readOpenCodeTrace(
        values["domos-db"] as string,
        values["opencode-db"] as string,
        Number(values.task),
      )
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
  process.exitCode =
    result.passed !== result.exercised
      ? 1
      : result.exercised !== result.total
        ? 2
        : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Eval failed");
  process.exitCode = 2;
});
