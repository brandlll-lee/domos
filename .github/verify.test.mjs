import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertNode,
  execute,
  plan,
  schedule,
  scope,
  snapshot,
  verifiedWebFiles,
  verify,
  verifyWeb,
  webFingerprints,
} from "./ci.mjs";

test("web evidence follows product inputs and each test file", () => {
  const entries = [
    ["apps/web/src/main.tsx", "source"],
    ["apps/web/test/fixtures/service.ts", "fixture"],
    ["pnpm-lock.yaml", "dependencies"],
    ["apps/web/test/first.spec.ts", "first"],
    ["apps/web/test/second.spec.ts", "second"],
    ["apps/web/test/first.spec.ts-snapshots/theme.png", "image"],
  ];
  const commands = [["pnpm", "exec", "playwright", "test"]];
  const original = webFingerprints(entries, commands, "24.22.1");
  const first = "apps/web/test/first.spec.ts";
  const second = "apps/web/test/second.spec.ts";
  for (const changed of [first, `${first}-snapshots/theme.png`]) {
    const result = webFingerprints(
      entries.map(([path, hash]) => [
        path,
        path === changed ? "changed" : hash,
      ]),
      commands,
      "24.22.1",
    );
    assert.notEqual(result[first], original[first]);
    assert.equal(result[second], original[second]);
  }
  for (const changed of entries.slice(0, 3).map(([path]) => path)) {
    const result = webFingerprints(
      entries.map(([path, hash]) => [
        path,
        path === changed ? "changed" : hash,
      ]),
      commands,
      "24.22.1",
    );
    for (const file of [first, second])
      assert.notEqual(result[file], original[file]);
  }
  assert.notDeepEqual(webFingerprints(entries, commands, "24.23.0"), original);
  assert.notDeepEqual(
    webFingerprints(entries, [[...commands[0], "--retries=1"]], "24.22.1"),
    original,
  );
  assert.throws(
    () =>
      webFingerprints(entries, [
        [...commands[0], "apps/web/test/missing.spec.ts"],
      ]),
    /Required web test is missing/,
  );
  assert.deepEqual(
    verifiedWebFiles(
      '<testsuite name="first.spec.ts" tests="1" failures="0" errors="0" skipped="1">',
      [first],
    ),
    {},
  );
  assert.deepEqual(
    verifiedWebFiles(
      '<testsuite name="first.spec.ts" tests="0" failures="0" errors="0" skipped="0">',
      [first],
    ),
    {},
  );
});

test("a failed web run retains passed files and reruns only missing evidence", () => {
  const cwd = mkdtempSync(join(tmpdir(), "domos-web-evidence-"));
  const first = "apps/web/test/first.spec.ts";
  const second = "apps/web/test/second.spec.ts";
  const path = join(cwd, "evidence.json");
  const runner = join(cwd, "runner.mjs");
  mkdirSync(join(cwd, "test-results"));
  writeFileSync(
    runner,
    `
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
const files = process.argv.slice(3);
const retry = existsSync('attempts.jsonl');
appendFileSync('attempts.jsonl', JSON.stringify(files) + '\\n');
const failed = !retry && files.some(file => file.endsWith('second.spec.ts'));
writeFileSync('test-results/web.xml', files.map(file => '<testsuite name="' + file + '" tests="1" failures="' + (!retry && file.endsWith('second.spec.ts') ? 1 : 0) + '" errors="0" skipped="0"></testsuite>').join(''));
process.exit(failed ? 1 : 0);
`,
  );
  const commands = [["node", runner, "test", first, second]];
  const evidence = {
    path,
    tree: "tree",
    fingerprints: { [first]: "first", [second]: "second" },
  };
  try {
    assert.throws(() => verifyWeb(commands, { cwd, evidence }), /exit 1/);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path, "utf8"))), [
      first,
    ]);
    verifyWeb(commands, { cwd, evidence });
    verifyWeb(commands, { cwd, evidence });
    const attempts = readFileSync(join(cwd, "attempts.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(attempts, [[first, second], [second]]);
    evidence.fingerprints[first] = "changed";
    verifyWeb(commands, { cwd, evidence });
    assert.deepEqual(
      JSON.parse(
        readFileSync(join(cwd, "attempts.jsonl"), "utf8")
          .trim()
          .split("\n")
          .at(-1),
      ),
      [first],
    );
    writeFileSync(
      runner,
      `import { writeFileSync } from 'node:fs'; writeFileSync('test-results/web.xml', '<testsuite name="${first}" tests="1" failures="0" errors="0" skipped="0"></testsuite>'); process.exit(7);`,
    );
    evidence.fingerprints[first] = "process-failure";
    assert.throws(() => verifyWeb(commands, { cwd, evidence }), /exit 7/);
    assert.notEqual(
      JSON.parse(readFileSync(path, "utf8"))[first].fingerprint,
      "process-failure",
    );
    writeFileSync(runner, "process.exit(0);");
    assert.throws(
      () => verifyWeb(commands, { cwd, evidence }),
      /lacks passing evidence/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("verification rejects Node 22 before commands run", () => {
  assert.throws(() => assertNode("22.22.2"), /Node 24.*22\.22\.2/);
  assert.doesNotThrow(() => assertNode("24.22.1"));
});

test("Work verification contains workspace restoration and persistence checks", () => {
  const selected = scope(["apps/web/src/features/chat/work.tsx"]);
  const commands = plan(selected);
  assert.ok(
    commands.desktop.some((args) => args.includes("workspaces.spec.ts")),
    "Work verification requires apps/desktop/test/workspaces.spec.ts",
  );
  assert.ok(
    commands.web.some((args) => args.includes("apps/web/test/drafts.spec.ts")),
  );
  assert.ok(
    commands.check.some((args) => args.includes(".github/verify.test.mjs")),
  );
  assert.equal(commands.native, undefined);
  assert.equal(commands.sandbox, undefined);
  assert.deepEqual(plan(scope(["docs/example.md"])), {
    check: [
      ["node", "--test", ".github/ci.test.mjs", ".github/verify.test.mjs"],
    ],
  });
});

test("failed processes and unavailable commands fail verification", () => {
  assert.throws(() => execute([["node", "-e", "process.exit(7)"]]), /exit 7/);
  assert.throws(
    () => execute([["domos-command-that-does-not-exist"]]),
    /ENOENT/,
  );
  assert.throws(
    () => execute([["node", "-e", "process.kill(process.pid, 'SIGTERM')"]]),
    /failed:/,
  );
  assert.throws(
    () => verify(scope(["docs/example.md"]), { job: "desktop" }),
    /Required check desktop is absent/,
  );
  assert.throws(
    () =>
      verify(scope([".github/ci.mjs"]), {
        job: process.platform === "linux" ? "desktop" : "sandbox",
      }),
    /requires its CI operating system/,
  );
});

test("host scheduling keeps other operating systems pending for CI", () => {
  const selected = scope([".github/ci.mjs"]);
  const jobs = plan(selected);
  const builder = jobs.desktop.find((args) =>
    args.includes("electron-builder"),
  );
  assert.ok(builder);
  assert.equal(builder[builder.indexOf("--publish") + 1], "never");
  assert.ok(builder.includes("--config.nsis.publish=null"));
  for (const platform of ["win32", "linux", "darwin"]) {
    const assigned = schedule(selected, jobs, platform);
    assert.deepEqual(
      [...assigned.local, ...assigned.ci].sort(),
      Object.keys(jobs).sort(),
    );
    assert.ok(assigned.local.includes("check"));
    assert.equal(assigned.local.includes("sandbox"), platform === "linux");
    assert.equal(assigned.local.includes("desktop"), platform === "win32");
  }
});

test("snapshot reads the staged tree and leaves unstaged files intact", async () => {
  const root = mkdtempSync(join(tmpdir(), "domos-verify-test-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "--quiet");
    writeFileSync(join(root, "value.txt"), "staged");
    git("add", "value.txt");
    const tree = git("write-tree");
    writeFileSync(join(root, "value.txt"), "unstaged");
    let directory;
    await snapshot(root, tree, async (path) => {
      directory = path;
      assert.equal(readFileSync(join(path, "value.txt"), "utf8"), "staged");
    });
    assert.throws(() => readFileSync(join(directory, "value.txt")), /ENOENT/);
    assert.equal(readFileSync(join(root, "value.txt"), "utf8"), "unstaged");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ordinary pushes verify committed content and block failed checks", () => {
  const root = mkdtempSync(join(tmpdir(), "domos-push-test-"));
  const cwd = join(root, "source");
  const remote = join(root, "remote.git");
  mkdirSync(cwd);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.VERIFY_SELECTION;
  delete env.GITHUB_ACTIONS;
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.name", "Verification test");
    git("config", "user.email", "verify@example.invalid");
    mkdirSync(join(cwd, ".github"));
    mkdirSync(join(cwd, ".githooks"));
    mkdirSync(join(cwd, "docs"));
    for (const file of [
      ".github/ci.mjs",
      ".githooks/pre-push",
      ".node-version",
    ])
      copyFileSync(file, join(cwd, file));
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        type: "module",
        scripts: { verify: "node .github/ci.mjs verify" },
      }),
    );
    const contract = `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
assert.equal(readFileSync('docs/value.md', 'utf8'), 'saved');
`;
    for (const file of ["ci.test.mjs", "verify.test.mjs"])
      writeFileSync(join(cwd, ".github", file), contract);
    writeFileSync(join(cwd, "docs/value.md"), "saved");
    git("add", ".");
    git("commit", "--quiet", "-m", "Initial fixture");
    git("init", "--bare", "--quiet", remote);
    git("remote", "add", "origin", remote);
    git("push", "--quiet", "-u", "origin", "main");
    execFileSync(process.execPath, [".github/ci.mjs", "hooks"], { cwd });
    assert.equal(git("config", "--local", "core.hooksPath"), ".githooks");
    writeFileSync(join(cwd, "docs/note.md"), "selected");
    git("add", "docs/note.md");
    const staged = JSON.parse(
      execFileSync(process.execPath, [".github/ci.mjs", "verify", "--plan"], {
        cwd,
        env,
        encoding: "utf8",
      }),
    );
    execFileSync(process.execPath, [".github/ci.mjs", "verify"], {
      cwd,
      env,
      stdio: "pipe",
    });
    git("commit", "--quiet", "-m", "Select documentation");
    const event = join(root, "event.json");
    writeFileSync(event, JSON.stringify({ before: staged.base }));
    const ci = JSON.parse(
      execFileSync(process.execPath, [".github/ci.mjs"], {
        cwd,
        encoding: "utf8",
        env: {
          ...env,
          GITHUB_EVENT_PATH: event,
          GITHUB_OUTPUT: join(root, "outputs"),
          GITHUB_SHA: git("rev-parse", "HEAD"),
          GITHUB_REF: "refs/heads/main",
          GITHUB_EVENT_NAME: "push",
        },
      }),
    );
    assert.deepEqual(ci.paths, staged.paths);
    assert.deepEqual(ci.scope, staged.scope);
    assert.deepEqual(ci.jobs, staged.jobs);
    writeFileSync(join(cwd, "docs/value.md"), "unstaged");
    const output = git("push", "origin", "main");
    assert.match(
      output,
      /node --test .github\/ci.test.mjs .github\/verify.test.mjs/,
    );
    assert.match(output, /Push checks passed\. Pending CI: none/);
    const accepted = git("rev-parse", "HEAD");
    assert.equal(
      git("ls-remote", "origin", "refs/heads/main").split(/\s+/)[0],
      accepted,
    );
    writeFileSync(join(cwd, "docs/value.md"), "wrong");
    git("add", "docs/value.md");
    git("commit", "--quiet", "-m", "Fail documentation contract");
    const failed = spawnSync("git", ["push", "origin", "main"], {
      cwd,
      env,
      encoding: "utf8",
    });
    assert.notEqual(failed.status, 0, failed.stdout + failed.stderr);
    assert.match(failed.stdout + failed.stderr, /wrong[\s\S]*saved/);
    assert.equal(
      git("ls-remote", "origin", "refs/heads/main").split(/\s+/)[0],
      accepted,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
