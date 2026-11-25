import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, onTestFinished, test } from "vitest";

const exec = promisify(execFile);

test("task CLI lists executable cases and rejects invalid inputs before dispatch", async () => {
  const command = ["apps/cli/src/eval-tasks.ts"];
  const listed = JSON.parse(
    (await exec(process.execPath, [...command, "--list"])).stdout,
  );
  expect(listed.cases).toHaveLength(16);
  expect(
    new Set(listed.cases.map((item: { id: string }) => item.id)).size,
  ).toBe(16);
  for (const args of [
    ["--cases", "missing"],
    ["--repeats", "0"],
    ["--root", process.cwd()],
  ])
    await expect(
      exec(process.execPath, [...command, ...args]),
    ).rejects.toMatchObject({ code: 2 });
  const root = await mkdtemp(join(tmpdir(), "domos-task-report-test-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "empty.json");
  await writeFile(path, "{}");
  await expect(
    exec(process.execPath, [...command, "--trace", path]),
  ).rejects.toMatchObject({ code: 2 });
});

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

test("memory reports keep rule results separate from reviewed task results", async () => {
  const root = await mkdtemp(join(tmpdir(), "domos-eval-cli-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const trace = join(root, "memory.json");
  const answer = {
    prompt: "报告使用什么语言？",
    requestId: "question",
    turnId: "turn",
    taskId: "1",
    messages: [{ messageId: "answer", entryId: 10, text: "报告使用英文。" }],
    completion: "unreviewed",
  };
  const result = {
    id: "manual",
    answers: [answer],
    memories: [{ id: "seed", text: "报告必须使用中文。", revision: 1 }],
    calls: [],
    sourceIds: [10],
    privateMarker: "private",
  };
  for (const [completion, code] of [
    ["unreviewed", 2],
    ["fail", 1],
    ["pass", 0],
  ] as const) {
    await writeFile(
      trace,
      JSON.stringify({
        subject: [
          {
            result: {
              ...result,
              answers: [
                {
                  ...answer,
                  messages: [
                    {
                      ...answer.messages[0],
                      text:
                        completion === "pass"
                          ? "报告使用中文。"
                          : "报告使用英文。",
                    },
                  ],
                  completion,
                  ...(completion === "unreviewed"
                    ? {}
                    : {
                        review: {
                          reviewer: "fixture reviewer",
                          evidence: "人工核对回答与语言要求。",
                        },
                      }),
                },
              ],
            },
          },
        ],
      }),
    );
    const run = exec(process.execPath, [
      "apps/cli/src/eval-memory.ts",
      "--trace",
      trace,
    ]);
    if (code) await expect(run).rejects.toMatchObject({ code });
    else await run;
    const scored = JSON.parse(await readFile(`${trace}.scored.json`, "utf8"));
    expect(scored.subject[0].score).toMatchObject({
      passed: 3,
      total: 3,
      answerReview: completion,
    });
    expect(scored.taskSuccess).toBe(completion);
  }
  await writeFile(
    trace,
    JSON.stringify({
      subject: [
        { result: { ...result, answers: [{ ...answer, completion: "pass" }] } },
      ],
    }),
  );
  await expect(
    exec(process.execPath, ["apps/cli/src/eval-memory.ts", "--trace", trace]),
  ).rejects.toMatchObject({ code: 2 });
});

test("computer scoring reports reviewed failure even when every workflow rule passes", async () => {
  const root = await mkdtemp(join(tmpdir(), "domos-eval-cli-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const trace = join(root, "trace.json");
  const cases = join(root, "cases.json");
  const calls = [
    { name: "desktop_get_window_state", input: { pid: 1, since: null } },
    { name: "desktop_get_window_state", input: { pid: 1, since: "snapshot" } },
    { name: "desktop_set_value", input: {} },
  ].map((call) => ({
    ...call,
    output: "verified",
    startedAt: null,
    endedAt: null,
  }));
  await writeFile(
    cases,
    JSON.stringify([
      {
        name: "review",
        trace: "trace.json",
        expectedTools: calls.map((call) => call.name),
      },
    ]),
  );
  for (const [completion, code] of [
    ["unreviewed", 2],
    ["fail", 1],
    ["pass", 0],
  ] as const) {
    await writeFile(
      trace,
      JSON.stringify({
        source: "review",
        harness: "fixture",
        model: "fixture",
        coverage: "excerpt",
        startedAt: null,
        endedAt: null,
        modelResponses: null,
        completion,
        review: {
          reviewer: "fixture reviewer",
          evidence: "Read the actual field value.",
        },
        calls,
      }),
    );
    for (const args of [
      ["--trace", trace],
      ["--cases", cases],
    ]) {
      const run = exec(process.execPath, [
        "apps/cli/src/eval-computer.ts",
        ...args,
      ]);
      if (code) await expect(run).rejects.toMatchObject({ code });
      else
        expect(JSON.parse((await run).stdout)).toMatchObject(
          args[0] === "--trace"
            ? { passed: 3, completion: "pass" }
            : { completionRate: 1 },
        );
    }
  }
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
