import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const platforms = ["ubuntu-latest", "windows-latest", "macos-latest"];
const flags = ["code", "native", "input", "package", "sandbox"];

export function scope(paths, full = false) {
  const workPath = (path) =>
    /^apps\/web\/src\/features\/chat\/(work[^/]*\.(tsx|ts|css)|use-chat\.ts)$/.test(
      path,
    ) ||
    /^apps\/web\/src\/features\/(shell\/(environment-switcher|computer-connections)\.(tsx|css)|hosting\/desktop\.ts)$/.test(
      path,
    ) ||
    /^apps\/web\/test\/(work-state\.test\.ts|(bot-work|teams)\.spec\.ts)$/.test(
      path,
    ) ||
    /^apps\/desktop\/(src\/main\.ts|test\/(entry\.mjs|(desktop|workspaces)\.spec\.ts))$/.test(
      path,
    );
  if (
    !full &&
    paths.some(
      (path) =>
        (workPath(path) && path.startsWith("apps/web/src/")) ||
        path === "apps/desktop/test/workspaces.spec.ts" ||
        path === "apps/desktop/test/entry.mjs",
    ) &&
    paths.every(
      (path) =>
        workPath(path) ||
        /^(docs\/.*\.md|\.github\/(ci\.(test\.)?mjs|workflows\/checks\.yml))$/.test(
          path,
        ),
    )
  )
    return {
      code: true,
      native: false,
      input: false,
      package: false,
      sandbox: false,
      full: false,
      web_os: platforms.slice(0, 1),
      evals: false,
      onboarding: false,
      work: true,
    };
  const connectionPath = (path) =>
    /^apps\/web\/src\/features\/apps\/(center|connection-(detail|details|editor|login|page|setup))\.(tsx|css)$/.test(
      path,
    ) ||
    path === "apps/web/src/features/apps/style.css" ||
    path === "apps/web/src/features/chat/page.tsx" ||
    path === "apps/web/test/app-connections.spec.ts" ||
    path === "apps/web/test/drafts.spec.ts" ||
    path === "packages/agent/src/mcp/catalog.ts";
  if (
    !full &&
    paths.some(connectionPath) &&
    paths.every(
      (path) =>
        connectionPath(path) ||
        /^(AGENTS\.md|docs\/.*\.md|\.github\/(ci\.(test\.)?mjs|workflows\/checks\.yml))$/.test(
          path,
        ),
    )
  )
    return {
      code: true,
      native: false,
      input: false,
      package: false,
      sandbox: false,
      full: false,
      web_os: platforms.slice(0, 1),
      evals: false,
      onboarding: false,
      connections: true,
    };
  const activityPath = (path) =>
    path === "apps/web/src/main.tsx" ||
    path === "apps/desktop/test/desktop.spec.ts" ||
    /^apps\/web\/src\/features\/chat\/(activity-state\.ts|working-presence\.(tsx|css)|typing-dots\.tsx|messages\.tsx|page\.tsx|use-chat\.ts|style\.css|copy\.ts)$/.test(
      path,
    ) ||
    /^apps\/web\/test\/((work|chat|transcript)-state\.test\.ts|(bot-work|chat-history|chat-identity|conversations|drafts|files|interactions|message-appearance|messaging|teams)\.spec\.ts)$/.test(
      path,
    );
  if (
    !full &&
    paths.some(
      (path) =>
        (path.startsWith("apps/web/src/features/chat/") ||
          path.startsWith("apps/web/test/")) &&
        activityPath(path),
    ) &&
    paths.every(
      (path) =>
        activityPath(path) ||
        /^(AGENTS\.md|docs\/.*\.md|\.github\/(ci\.(test\.)?mjs|workflows\/checks\.yml))$/.test(
          path,
        ),
    )
  )
    return {
      code: true,
      native: false,
      input: false,
      package: false,
      sandbox: false,
      full: false,
      web_os: platforms.slice(0, 1),
      evals: false,
      onboarding: false,
      activity: true,
    };
  const onboarding =
    !full &&
    paths.some((path) =>
      /^(packages\/ui\/src\/web\/startup|apps\/(desktop\/src\/setup|desktop\/test\/(desktop|runtime|avatars|workspaces)\.spec\.ts$|web\/src\/features\/onboarding))/.test(
        path,
      ),
    ) &&
    paths.every(
      (path) =>
        /^(docs\/.*\.md|AGENTS\.md|pnpm-lock\.yaml|packages\/ui\/package\.json|\.github\/(ci\.(test\.)?mjs|workflows\/checks\.yml))$/.test(
          path,
        ) ||
        /^packages\/ui\/(src\/(assets\.d\.ts|tokens\.ts)|assets\/startup-[^/]+\.png|src\/web\/(startup[^/]*\.(tsx|ts|css)|startup\/[^/]+\.(tsx|css)|(avatar|theme)\.tsx|engine-mark\.(tsx|css)|engine-assets\/[^/]+\.svg))$/.test(
          path,
        ) ||
        /^apps\/desktop\/(src\/setup\.(tsx|css|html)|build\.mjs|test\/(desktop|runtime|avatars|files|identity|notifications|workspaces)\.spec\.ts)$/.test(
          path,
        ) ||
        /^apps\/web\/test\/(onboarding|models|computer-settings)\.spec\.ts$/.test(
          path,
        ) ||
        /^apps\/web\/src\/features\/(onboarding\/root|hosting\/root|shell\/titlebar|computer\/permission|models\/(model-setting|setup-models)|bots\/(details\/model|engine-mark)|apps\/connection-details|chat\/(context|conversations|header|work-detail)|settings\/ai|usage\/(charts|page|quota|tables))\.(tsx|css)$/.test(
          path,
        ) ||
        /^apps\/web\/src\/features\/bots\/assets\/(codex|claude-code|antigravity|grok|devin|cursor)\.svg$/.test(
          path,
        ),
    );
  if (onboarding)
    return {
      code: true,
      native: false,
      input: false,
      package: false,
      sandbox: false,
      full: false,
      web_os: platforms.slice(0, 1),
      evals: false,
      onboarding: true,
    };
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
      onboarding: false,
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
    onboarding: false,
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

export function assertNode(version = process.versions.node) {
  const major = readFileSync(
    new URL("../.node-version", import.meta.url),
    "utf8",
  ).trim();
  if (version.split(".")[0] !== major)
    throw new Error(`Use Node ${major} for pnpm verify; received ${version}.`);
}

export function plan(
  selected,
  {
    shard,
    platform = process.platform,
    transport = "docker",
    webFull = selected.full,
  } = {},
) {
  const pnpm = (...args) => ["pnpm", ...args];
  const vitest = (...files) =>
    pnpm(
      "exec",
      "vitest",
      "run",
      ...files,
      "--reporter=default",
      "--reporter=junit",
      "--outputFile.junit=test-results/unit.xml",
    );
  const playwright = (...args) =>
    platform === "linux"
      ? ["xvfb-run", "-a", "pnpm", "exec", "playwright", "test", ...args]
      : pnpm("exec", "playwright", "test", ...args);
  const jobs = {
    check: [
      ["node", "--test", ".github/ci.test.mjs", ".github/verify.test.mjs"],
    ],
  };
  if (!selected.code) return jobs;
  jobs.check.push(pnpm("lint"), pnpm("typecheck"));
  if (selected.work)
    jobs.check.push(
      vitest(
        "apps/web/test/work-state.test.ts",
        "apps/web/test/chat-state.test.ts",
        "apps/web/test/transcript-state.test.ts",
        "apps/web/test/workspace-state.test.ts",
      ),
    );
  else if (selected.activity)
    jobs.check.push(
      vitest(
        "apps/web/test/work-state.test.ts",
        "apps/web/test/chat-state.test.ts",
        "apps/web/test/transcript-state.test.ts",
      ),
    );
  else if (selected.connections)
    jobs.check.push(
      vitest(
        "apps/api/test/mcp.test.ts",
        "apps/web/test/workspace-state.test.ts",
      ),
    );
  else if (selected.onboarding)
    jobs.check.push(
      vitest(
        "apps/api/test/onboarding.test.ts",
        "apps/api/test/startup.test.ts",
      ),
    );
  else
    jobs.check.push(
      pnpm(
        "test:ci",
        selected.evals ? "evals" : "unit",
        "--reporter=default",
        "--reporter=junit",
        "--outputFile.junit=test-results/unit.xml",
      ),
    );
  if (selected.evals) return jobs;
  let web = [];
  if (selected.work) web = ["bot-work", "teams", "drafts", "conversations"];
  else if (selected.connections)
    web = ["app-connections", "drafts", "conversations"];
  else if (selected.activity)
    web = [
      "bot-work",
      "chat-history",
      "chat-identity",
      "conversations",
      "drafts",
      "files",
      "interactions",
      "message-appearance",
      "messaging",
      "teams",
    ];
  else if (selected.onboarding)
    web = ["onboarding", "models", "computer-settings"];
  jobs.web = [
    pnpm("build"),
    playwright(
      ...web.map((name) => `apps/web/test/${name}.spec.ts`),
      ...(shard ? [`--shard=${shard}`] : []),
      "--output=test-results/e2e",
    ),
  ];
  const desktop = ["desktop", "runtime"];
  if (selected.package)
    desktop.push("files", "workspaces", "notifications", "avatars");
  else if (selected.onboarding) desktop.push("avatars", "workspaces");
  else if (selected.work) desktop.push("workspaces");
  jobs.desktop = [
    pnpm("--filter", "@domos/desktop", "build"),
    ["node", "--test", ".github/desktop-startup.test.mjs"],
    pnpm("exec", "playwright", "install", "chromium", "--only-shell"),
    playwright(
      "--config",
      "apps/desktop/playwright.config.ts",
      ...desktop.map((name) => `${name}.spec.ts`),
    ),
  ];
  if (selected.package)
    jobs.desktop.push(
      pnpm(
        "--filter",
        "@domos/desktop",
        "exec",
        "electron-builder",
        "--win",
        "nsis",
        "--config.win.signExecutable=false",
      ),
      ["node", "--test", "apps/desktop/test/package.test.mjs"],
      playwright(
        "--config",
        "apps/desktop/playwright.config.ts",
        "identity.spec.ts",
        "--output=test-results/desktop/identity",
      ),
    );
  if (selected.native) {
    jobs.native = [
      pnpm(
        "test:ci",
        "native",
        "--reporter=default",
        "--reporter=junit",
        "--outputFile.junit=test-results/harness.xml",
      ),
    ];
    if (selected.input)
      jobs.native.push(
        platform === "linux"
          ? [
              "xvfb-run",
              "-a",
              "pnpm",
              "test:ci",
              "browser",
              "--reporter=default",
              "--reporter=junit",
              "--outputFile.junit=test-results/browser.xml",
            ]
          : pnpm(
              "test:ci",
              "browser",
              "--reporter=default",
              "--reporter=junit",
              "--outputFile.junit=test-results/browser.xml",
            ),
      );
  }
  if (selected.input) {
    jobs["computer-input"] = [
      playwright(
        "--config",
        "apps/desktop/playwright.config.ts",
        "computer-input.spec.ts",
      ),
    ];
    if (platform !== "linux" && !webFull)
      jobs["computer-input"].push(
        pnpm("exec", "playwright", "install", "chromium", "--only-shell"),
        pnpm("build"),
        playwright(
          "browser-takeover.spec.ts",
          "--output=test-results/takeover",
        ),
      );
  }
  if (selected.sandbox)
    jobs.sandbox = [
      vitest("packages/agent/test/container.test.ts"),
      ["bash", ".github/sandbox.sh", transport],
    ];
  return jobs;
}

export function execute(
  commands,
  { cwd = process.cwd(), env = process.env } = {},
) {
  for (const args of commands) {
    console.log(`> ${args.join(" ")}`);
    let [command, ...parameters] = args;
    if (command === "node") command = process.execPath;
    else if (command === "pnpm") {
      if (!process.env.npm_execpath)
        throw new Error("Run checks through pnpm verify.");
      command = process.execPath;
      parameters = [process.env.npm_execpath, ...parameters];
    } else if (command === "xvfb-run") {
      const index = parameters.indexOf("pnpm");
      if (index >= 0) {
        if (!process.env.npm_execpath)
          throw new Error("Run checks through pnpm verify.");
        parameters.splice(index, 1, process.execPath, process.env.npm_execpath);
      }
    }
    const result = spawnSync(command, parameters, {
      cwd,
      env,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `${args[0]} failed: ${result.signal ?? `exit ${result.status}`}`,
      );
  }
}

export function webFingerprints(
  entries,
  commands,
  node = process.versions.node,
) {
  const testFile = /^apps\/web\/test\/[^/]+\.spec\.ts$/;
  const independent = /^apps\/web\/test\/[^/]+\.spec\.ts(?:-snapshots\/|$)/;
  const digest = (value) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const common = digest([
    node,
    process.platform,
    process.arch,
    commands,
    execute.toString(),
    entries.filter(
      ([path]) =>
        !independent.test(path) &&
        !/^\.github\/|^docs\/|^AGENTS\.md$/.test(path),
    ),
  ]);
  const selected = commands.at(-1).filter((value) => testFile.test(value));
  for (const path of selected)
    if (!entries.some(([file]) => file === path))
      throw new Error(`Required web test is missing: ${path}`);
  return Object.fromEntries(
    entries
      .filter(
        ([path]) =>
          testFile.test(path) && (!selected.length || selected.includes(path)),
      )
      .map(([path, hash]) => [
        path,
        digest([
          common,
          hash,
          entries.filter(([asset]) => asset.startsWith(`${path}-snapshots/`)),
        ]),
      ]),
  );
}

export function verifiedWebFiles(report, files) {
  const result = {};
  for (const match of report.matchAll(/<testsuite\s+([^>]+)>/g)) {
    const attributes = Object.fromEntries(
      [...match[1].matchAll(/(\w+)="([^"]*)"/g)].map((value) => [
        value[1],
        value[2],
      ]),
    );
    const file = files.find(
      (path) =>
        path === attributes.name || path.endsWith(`/${attributes.name}`),
    );
    if (
      file &&
      Number(attributes.tests) > 0 &&
      ["failures", "errors", "skipped"].every((key) => attributes[key] === "0")
    )
      result[file] = Number(attributes.tests);
  }
  return result;
}

export function verifyWeb(commands, { cwd, evidence }) {
  const saved = existsSync(evidence.path)
    ? JSON.parse(readFileSync(evidence.path, "utf8"))
    : {};
  const files = Object.keys(evidence.fingerprints);
  if (!files.length) throw new Error("Web verification has no test files.");
  const pending = files.filter(
    (file) =>
      saved[file]?.fingerprint !== evidence.fingerprints[file] ||
      !Number.isInteger(saved[file]?.tests) ||
      saved[file].tests <= 0,
  );
  console.log(
    `Web evidence: ${files.length - pending.length} files reused; ${pending.length} files to run.`,
  );
  if (!pending.length) return;
  const report = join(cwd, "test-results/web.xml");
  rmSync(report, { force: true });
  const run = commands.map((args) => [...args]);
  const tests = run
    .at(-1)
    .filter((value) => !/^apps\/web\/test\/[^/]+\.spec\.ts$/.test(value));
  tests.splice(tests.indexOf("test") + 1, 0, ...pending);
  run[run.length - 1] = tests;
  let completed = {};
  let failed = false;
  try {
    execute(run, { cwd });
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (existsSync(report)) {
      completed = verifiedWebFiles(readFileSync(report, "utf8"), pending);
      if (failed && Object.keys(completed).length === pending.length)
        completed = {};
      for (const [file, count] of Object.entries(completed))
        saved[file] = {
          fingerprint: evidence.fingerprints[file],
          tests: count,
          tree: evidence.tree,
          completedAt: new Date().toISOString(),
        };
      mkdirSync(resolve(evidence.path, ".."), { recursive: true });
      writeFileSync(`${evidence.path}.tmp`, JSON.stringify(saved, null, 2));
      renameSync(`${evidence.path}.tmp`, evidence.path);
    }
  }
  const missing = pending.filter((file) => !completed[file]);
  if (missing.length)
    throw new Error(
      `Web verification lacks passing evidence: ${missing.join(", ")}`,
    );
}

export async function snapshot(root, tree, use) {
  const directory = mkdtempSync(join(tmpdir(), "domos-verify-"));
  const target = join(directory, "source");
  mkdirSync(target);
  try {
    execFileSync(
      "git",
      [
        "archive",
        "--format=tar",
        `--output=${join(directory, "source.tar")}`,
        tree,
      ],
      { cwd: root },
    );
    execFileSync("tar", ["-xf", "source.tar", "-C", "source"], {
      cwd: directory,
    });
    return await use(target);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function selection() {
  if (process.env.VERIFY_SELECTION)
    return JSON.parse(process.env.VERIFY_SELECTION);
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const full =
    process.env.GITHUB_EVENT_NAME === "workflow_dispatch" ||
    process.env.GITHUB_REF.startsWith("refs/tags/");
  const base = event.pull_request?.base.sha ?? event.before;
  const head = process.env.GITHUB_SHA;
  try {
    const paths = full ? [] : changedPaths(base, head);
    return { base, head, paths, scope: scope(paths, full) };
  } catch {
    console.log("Changed paths unavailable; selecting full validation.");
    return { base, head, paths: [], scope: scope([], true) };
  }
}

export function schedule(selected, jobs, platform = process.platform) {
  const ci = Object.keys(jobs).filter(
    (name) =>
      (name === "sandbox" && platform !== "linux") ||
      (name === "desktop" && selected.package && platform !== "win32"),
  );
  return { local: Object.keys(jobs).filter((name) => !ci.includes(name)), ci };
}

export function verify(selected, options = {}) {
  const jobs = plan(selected, options);
  const assigned = schedule(selected, jobs);
  console.log(JSON.stringify({ scope: selected, jobs, ...assigned }, null, 2));
  if (options.job && !Object.hasOwn(jobs, options.job))
    throw new Error(`Required check ${options.job} is absent from this plan.`);
  if (assigned.ci.includes(options.job))
    throw new Error(`Check ${options.job} requires its CI operating system.`);
  for (const [name, commands] of Object.entries(jobs)) {
    if (options.job && options.job !== name) continue;
    if (!options.job && assigned.ci.includes(name)) continue;
    if (name === "web" && options.evidence) {
      verifyWeb(commands, options);
      continue;
    }
    execute(commands, {
      ...options,
      env: {
        ...(options.env ?? process.env),
        ...(name === "sandbox" ? { DOMOS_CONTAINER_TESTS: "1" } : {}),
      },
    });
  }
  if (!options.job && assigned.ci.length)
    console.log(
      `Local checks passed. Pending CI checks: ${assigned.ci.join(", ")}.`,
    );
}

async function verifyTree(root, base, tree, full = false, job) {
  const paths = full ? [] : changedPaths(base, tree, root);
  if (!full && !paths.length) {
    console.log("No changes to verify.");
    return;
  }
  await snapshot(root, tree, async (cwd) => {
    const source = await import(
      pathToFileURL(join(cwd, ".github/ci.mjs")).href
    );
    source.assertNode();
    console.log(JSON.stringify({ base, tree, paths }, null, 2));
    const selected = source.scope(paths, full);
    if (selected.code)
      execute([["pnpm", "install", "--frozen-lockfile"]], { cwd });
    const web = source.plan(selected).web;
    const entries = web
      ? execFileSync("git", ["ls-tree", "-rz", tree], {
          cwd: root,
          encoding: "utf8",
        })
          .split("\0")
          .filter(Boolean)
          .map((entry) => {
            const [metadata, path] = entry.split("\t");
            return [path, metadata.split(" ").at(-1)];
          })
      : [];
    const evidence = web
      ? {
          tree,
          path: resolve(
            root,
            execFileSync(
              "git",
              ["rev-parse", "--git-path", "domos-verify/web.json"],
              { cwd: root, encoding: "utf8" },
            ).trim(),
          ),
          fingerprints: source.webFingerprints(entries, web),
        }
      : undefined;
    source.verify(selected, { cwd, evidence, job });
    if (job)
      console.log(
        `Push checks passed. Pending CI: ${
          Object.keys(source.plan(selected))
            .filter((name) => name !== job)
            .join(", ") || "none"
        }.`,
      );
  });
}

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
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    assertNode();
    const args = process.argv.slice(2);
    const command = args[0];
    if (command === "hooks") {
      if (existsSync(".git")) {
        chmodSync(".githooks/pre-push", 0o755);
        execFileSync("git", [
          "config",
          "--local",
          "core.hooksPath",
          ".githooks",
        ]);
      }
    } else if (command === "result") {
      const result = report(JSON.parse(process.env.RESULTS));
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.text);
      if (result.failed) process.exitCode = 1;
    } else if (command === "test") {
      const suite = args[1];
      if (suite !== "unit" && !Object.hasOwn(suites, suite))
        throw new Error(`Unknown test suite: ${suite}`);
      const files =
        suite === "unit"
          ? Object.entries(suites)
              .filter(([name]) => name !== "evals")
              .flatMap(([, files]) => files)
              .map((path) => `--exclude=${path}`)
          : suites[suite];
      execute([["pnpm", "exec", "vitest", "run", ...files, ...args.slice(2)]]);
    } else if (command === "verify") {
      const jobIndex = args.indexOf("--job");
      if (jobIndex >= 0 && !args[jobIndex + 1])
        throw new Error("--job requires a check name.");
      if (process.env.GITHUB_ACTIONS === "true" || jobIndex >= 0) {
        const selected = selection();
        verify(selected.scope, {
          job: jobIndex >= 0 ? args[jobIndex + 1] : undefined,
          shard: process.env.VERIFY_SHARD,
          transport: process.env.VERIFY_TRANSPORT,
          webFull: process.env.VERIFY_WEB_FULL === "true",
        });
      } else if (args.includes("--push")) {
        const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
          encoding: "utf8",
        }).trim();
        for (const line of readFileSync(0, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)) {
          const [ref, local, , remote] = line.trim().split(/\s+/);
          if (/^0+$/.test(local)) continue;
          const base = /^0+$/.test(remote)
            ? execFileSync("git", ["hash-object", "-t", "tree", "--stdin"], {
                input: "",
                encoding: "utf8",
              }).trim()
            : remote;
          await verifyTree(
            root,
            base,
            local,
            ref.startsWith("refs/tags/"),
            "check",
          );
        }
      } else {
        const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
          encoding: "utf8",
        }).trim();
        const base = execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim();
        const tree = execFileSync("git", ["write-tree"], {
          encoding: "utf8",
        }).trim();
        if (args.includes("--plan")) {
          const paths = changedPaths(base, tree, root);
          console.log(
            JSON.stringify(
              {
                base,
                tree,
                paths,
                scope: scope(paths),
                jobs: plan(scope(paths)),
              },
              null,
              2,
            ),
          );
        } else await verifyTree(root, base, tree);
      }
    } else {
      const selected = selection();
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `${Object.entries(selected.scope)
          .map(([key, value]) => `${key}=${JSON.stringify(value)}\n`)
          .join("")}selection=${JSON.stringify(selected)}\n`,
      );
      console.log(
        JSON.stringify({ ...selected, jobs: plan(selected.scope) }, null, 2),
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
