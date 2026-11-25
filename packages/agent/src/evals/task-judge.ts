import { execFileSync, fork } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gradeSemantics, judgeConfig, judgePrompt } from "./task-grading.ts";
import type {
  NativeEvalInput,
  NativeEvalResult,
} from "./task-native-worker.ts";
import { scoreTask, type TaskEvidence } from "./task-score.ts";
import { cleanTrial } from "./task-storage.ts";

export async function nativeEval(
  input: NativeEvalInput,
): Promise<NativeEvalResult> {
  await mkdir(input.directory, { recursive: true });
  const child = fork(
    fileURLToPath(new URL("./task-native-worker.ts", import.meta.url)),
    { silent: true, execArgv: [], detached: process.platform !== "win32" },
  );
  child.stdout?.resume();
  child.stderr?.resume();
  let result: NativeEvalResult | undefined;
  child.on("message", (message) => {
    result = message as NativeEvalResult;
  });
  const timer = setTimeout(
    () => {
      if (!child.pid) return;
      if (process.platform === "win32")
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      else process.kill(-child.pid, "SIGKILL");
    },
    (input.seconds + 30) * 1000,
  );
  child.send(input);
  const [code] = await once(child, "exit");
  clearTimeout(timer);
  if (!result || code !== 0)
    throw new Error(
      "Native eval worker did not close cleanly; retain its directory",
    );
  return result;
}

export async function judgeTask(e: TaskEvidence, directory: string) {
  const base = scoreTask(e);
  if (base.completion !== "unreviewed") return { score: base };
  await mkdir(directory, { recursive: false });
  let score = base;
  let result: NativeEvalResult = {
    failure: null,
    version: null,
    text: "",
    tokens: null,
    cost: null,
    knownCost: 0,
  };
  let closed = false;
  try {
    result = await nativeEval({
      directory,
      config: judgeConfig,
      seconds: 120,
      prompt: judgePrompt(e),
    });
    closed = true;
    if (result.failure) throw new Error(result.failure);
    score = gradeSemantics(e, JSON.parse(result.text));
  } catch (error) {
    result.failure = String(error);
  }
  const cleanup = closed ? await cleanTrial(directory) : null;
  await writeFile(
    join(directory, "judgment.json"),
    JSON.stringify({ result, score, cleanup }, null, 2),
  );
  const bytes = await readFile(join(directory, "judgment.json"));
  return {
    score,
    judgment: {
      directory,
      hash: createHash("sha256").update(bytes).digest("hex"),
      failure: result.failure,
      tokens: result.tokens,
      cost: result.cost,
      knownCost: result.knownCost,
      cleanup,
    },
  };
}
