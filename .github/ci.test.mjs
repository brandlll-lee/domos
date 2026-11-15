import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { changedPaths, report, scope, suites } from "./ci.mjs";

test("documentation avoids product jobs; UI keeps daily checks", () => {
  assert.equal(
    scope(["README.zh-CN.md", "docs/setup.md", "AGENTS.md"]).code,
    false,
  );
  assert.deepEqual(scope(["apps/web/src/features/chat/question.tsx"]), {
    code: true,
    native: false,
    input: false,
    package: false,
    sandbox: false,
    full: false,
    web_os: ["ubuntu-latest"],
  });
  assert.equal(scope(["packages/ui/src/web/chat.css"]).package, false);
  assert.equal(scope(["apps/desktop/src/setup.css"]).package, false);
});

test("platform and deployment changes select their regressions", () => {
  for (const path of [
    "packages/agent/src/harness/process.ts",
    "packages/agent/src/computer/catalog.ts",
    "packages/agent/src/computer.ts",
  ]) {
    const selected = scope([path]);
    for (const flag of ["native", "input", "package", "sandbox"])
      assert.equal(selected[flag], true, `${path}: ${flag}`);
  }
  assert.equal(scope(["deploy/restrict-computer-egress.sh"]).sandbox, true);
  assert.equal(scope(["apps/controller/src/index.ts"]).sandbox, true);
  assert.equal(scope(["packages/agent/src/work-environment.ts"]).sandbox, true);
  assert.equal(scope(["packages/agent/src/files.ts"]).sandbox, true);
  assert.equal(scope(["apps/desktop/src/preload.cjs"]).input, true);
  assert.equal(scope(["packages/ui/assets/icon.ico"]).package, true);
  assert.equal(scope(["apps/web/test/browser-takeover.spec.ts"]).input, true);
});

test("dependencies, shared configuration, unknown paths and full runs select all platforms", () => {
  for (const paths of [
    ["pnpm-lock.yaml"],
    ["packages/agent/package.json"],
    ["tsconfig.json"],
    [".github/workflows/checks.yml"],
    ["new-package/source.ts"],
    [],
  ]) {
    const selected = scope(paths, paths.length === 0);
    for (const flag of [
      "code",
      "native",
      "input",
      "package",
      "sandbox",
      "full",
    ])
      assert.equal(selected[flag], true, `${paths}: ${flag}`);
    assert.equal(selected.web_os.length, 3);
  }
});

test("git diff includes additions, deletions and both sides of a rename", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "domos-ci-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8" });
  git("init", "--quiet");
  git("config", "user.name", "CI test");
  git("config", "user.email", "ci@example.invalid");
  for (const name of ["delete.ts", "old name.ts"])
    writeFileSync(join(directory, name), name);
  git("add", ".");
  git("commit", "--quiet", "-m", "fixture");
  const base = git("rev-parse", "HEAD").trim();
  renameSync(join(directory, "old name.ts"), join(directory, "new name.ts"));
  rmSync(join(directory, "delete.ts"));
  writeFileSync(join(directory, "added.ts"), "added");
  git("add", "-A");
  git("commit", "--quiet", "-m", "changes");
  assert.deepEqual(changedPaths(base, "HEAD", directory).sort(), [
    "added.ts",
    "delete.ts",
    "new name.ts",
    "old name.ts",
  ]);
});

test("native suites contain distinct existing tests; unit tests get the remainder", () => {
  const files = Object.values(suites).flat();
  assert.equal(new Set(files).size, files.length);
  for (const path of files) assert.ok(existsSync(path), path);
  assert.ok(!files.includes("apps/web/test/viewer-input.test.ts"));
});

test("result accepts scope omissions and rejects failed, cancelled or unexpectedly skipped jobs", () => {
  const results = {
    check: { result: "success", outputs: { code: "true", native: "true" } },
    native: { result: "success" },
    web: { result: "success" },
    desktop: { result: "success" },
    sandbox: { result: "skipped" },
    "computer-input": { result: "skipped" },
  };
  assert.equal(report(results).failed, false);
  assert.match(report(results).text, /Omitted by change scope/);
  for (const result of ["failure", "cancelled", "skipped"]) {
    assert.equal(report({ ...results, native: { result } }).failed, true);
  }
  assert.equal(
    report({ ...results, check: { result: "failure", outputs: {} } }).failed,
    true,
  );
});
