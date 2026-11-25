import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, onTestFinished, test } from "vitest";

const exec = promisify(execFile);

test("memory scoring rejects missing and malformed execution results", async () => {
  const root = await mkdtemp(join(tmpdir(), "domos-eval-cli-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const trace = join(root, "memory.json");
  for (const subject of [[{}], [{ result: { id: "manual" } }]]) {
    await writeFile(trace, JSON.stringify({ subject }));
    await expect(
      exec(process.execPath, ["apps/cli/src/eval-memory.ts", "--trace", trace]),
    ).rejects.toMatchObject({ code: 2 });
  }
  await writeFile(
    trace,
    JSON.stringify({ subject: [{ failure: { kind: "worker" } }] }),
  );
  await expect(
    exec(process.execPath, ["apps/cli/src/eval-memory.ts", "--trace", trace]),
  ).rejects.toMatchObject({ code: 1 });
});

test("computer single and suite scoring report unexercised checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "domos-eval-cli-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const trace = join(root, "trace.json");
  const cases = join(root, "cases.json");
  await writeFile(
    trace,
    JSON.stringify({
      source: "empty",
      harness: "codex",
      model: "unknown",
      coverage: "excerpt",
      startedAt: null,
      endedAt: null,
      modelResponses: null,
      completion: "unreviewed",
      calls: [],
    }),
  );
  await writeFile(
    cases,
    JSON.stringify([{ name: "empty", trace: "trace.json", expectedTools: [] }]),
  );
  for (const args of [
    ["--trace", trace],
    ["--cases", cases],
  ])
    await expect(
      exec(process.execPath, ["apps/cli/src/eval-computer.ts", ...args]),
    ).rejects.toMatchObject({ code: 2 });
});
