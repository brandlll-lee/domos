import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const platforms = ["ubuntu-latest", "windows-latest", "macos-latest"];
const flags = ["code", "native", "input", "package", "sandbox"];

export function scope(paths, full = false) {
  const evalPath = (path) =>
    /^(packages\/agent\/(src\/evals\/|test\/(.*eval.*|memory-trace)\.test\.ts$)|apps\/cli\/(src\/eval-[^/]+\.ts$|test\/evals\.test\.ts$))/.test(
      path,
    );
  const evals =
    !full &&
    paths.some(evalPath) &&
    paths.every(
      (path) =>
        evalPath(path) ||
        /^(AGENTS\.md|\.gitignore|docs\/.*\.md|\.github\/(ci\.(test\.)?mjs|workflows\/checks\.yml))$/.test(
          path,
        ),
    );
  if (evals)
    return {
      code: true,
      native: false,
      input: false,
      package: false,
      sandbox: false,
      full: false,
      web_os: platforms.slice(0, 1),
      evals: true,
    };
  const selected = Object.fromEntries(flags.map((flag) => [flag, full]));
  for (const path of paths) {
    if (/^(AGENTS\.md|README[^/]*\.md|docs\/.*\.md)$/.test(path)) continue;
    selected.code = true;
    if (
      /(^|\/)package\.json$/.test(path) ||
      /^(\.github\/|pnpm-|\.node-version$|tsconfig|biome|vitest|playwright)/.test(
        path,
      )
    ) {
      for (const flag of flags) selected[flag] = true;
      full = true;
      continue;
    }
    if (/^(apps\/web\/|packages\/ui\/)/.test(path)) {
      if (
        /\/computer\/|\/viewer-input|\/browser-takeover|\/computer-settings/.test(
          path,
        )
      )
        selected.native = selected.input = true;
      if (path.startsWith("packages/ui/assets/")) selected.package = true;
      continue;
    }
    if (path.startsWith("apps/desktop/")) {
      if (/^apps\/desktop\/src\/.*\.(css|html|tsx)$/.test(path)) continue;
      selected.native = selected.package = true;
      if (/\/computer|\/input|\/preload|\/src\/main/.test(path))
        selected.input = true;
      continue;
    }
    if (
      /^(apps\/(api|cli|controller)\/|packages\/(agent|hosting)\/|deploy\/)/.test(
        path,
      )
    ) {
      selected.native = true;
      if (
        /\/computer[/.]|\/harness\/|\/runtime\/|packages\/hosting\/|apps\/(cli|controller)\/|apps\/api\/src\/hosting\/|deploy\/|\/(files|work-environment|container|stack-container|sandbox|remote-files)\./.test(
          path,
        )
      )
        selected.package = selected.sandbox = true;
      if (
        /\/computer[/.]|\/harness\/|\/(browser|desktop|computer|cursor)[^/]*\./.test(
          path,
        )
      )
        selected.input = true;
      continue;
    }
    for (const flag of flags) selected[flag] = true;
    full = true;
  }
  return {
    ...selected,
    full,
    web_os: full ? platforms : platforms.slice(0, 1),
    evals: false,
  };
}

export function changedPaths(base, head, cwd) {
  return execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", base, head],
    {
      cwd,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);
}

export const suites = {
  evals: [
    "packages/agent/test/task-evals.test.ts",
    "packages/agent/test/memory-eval.test.ts",
    "packages/agent/test/memory-trace.test.ts",
    "packages/agent/test/computer-evals.test.ts",
    "packages/agent/test/trajectory-evals.test.ts",
    "apps/cli/test/evals.test.ts",
  ],
  native: [
    "packages/agent/test/harness-process.test.ts",
    "packages/agent/test/harness-protocols.test.ts",
    "packages/agent/test/harness-context.test.ts",
    "packages/agent/test/harness-recovery.test.ts",
    "packages/agent/test/harness-install.test.ts",
    "packages/agent/test/computer.test.ts",
    "packages/agent/test/remote-files.test.ts",
    "packages/hosting/test/install.test.ts",
    "apps/desktop/test/host.test.ts",
    "apps/api/test/startup.test.ts",
    "apps/api/test/onboarding.test.ts",
    "apps/api/test/computer-services.test.ts",
  ],
  browser: ["packages/agent/test/computer-services.test.ts"],
};

export function report(results) {
  const scope = results.check.outputs;
  const expected = {
    check: true,
    native: scope.native === "true",
    web: scope.code === "true" && scope.evals !== "true",
    "computer-input": scope.input === "true",
    desktop: scope.code === "true" && scope.evals !== "true",
    sandbox: scope.sandbox === "true",
  };
  const rows = ["| Check | Result |", "| --- | --- |"];
  let failed = false;
  for (const [name, required] of Object.entries(expected)) {
    const result = results[name].result;
    if (required ? result !== "success" : result !== "skipped") failed = true;
    rows.push(
      `| ${name} | ${required || result !== "skipped" ? result : "Omitted by change scope"} |`,
    );
  }
  return { failed, text: `${rows.join("\n")}\n` };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv[2] === "result") {
    const result = report(JSON.parse(process.env.RESULTS));
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.text);
    if (result.failed) process.exitCode = 1;
  } else if (process.argv[2] === "test") {
    const suite = process.argv[3];
    if (suite !== "unit" && !Object.hasOwn(suites, suite))
      throw new Error(`Unknown test suite: ${suite}`);
    const files =
      suite === "unit"
        ? Object.entries(suites)
            .filter(([name]) => name !== "evals")
            .flatMap(([, files]) => files)
            .map((path) => `--exclude=${path}`)
        : suites[suite];
    const pnpm = process.env.npm_execpath;
    if (!pnpm) throw new Error("Run tests through pnpm test:ci.");
    const result = spawnSync(
      process.execPath,
      [pnpm, "exec", "vitest", "run", ...files, ...process.argv.slice(4)],
      { stdio: "inherit" },
    );
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } else {
    const event = JSON.parse(
      readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"),
    );
    const full =
      process.env.GITHUB_EVENT_NAME === "workflow_dispatch" ||
      process.env.GITHUB_REF.startsWith("refs/tags/");
    const base = event.pull_request?.base.sha ?? event.before;
    let selected;
    try {
      selected = scope(
        full ? [] : changedPaths(base, process.env.GITHUB_SHA),
        full,
      );
    } catch {
      selected = scope([], true);
      console.log("Changed paths unavailable; selecting full validation.");
    }
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(selected)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}\n`)
        .join(""),
    );
    console.log(JSON.stringify(selected, null, 2));
  }
}
