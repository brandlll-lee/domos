import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { metrics, themes } from "@domos/ui/tokens";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const runtime = join(here, "runtime");
const dist = join(here, "dist");
const release = JSON.parse(
  await readFile(join(root, "deploy/release.json"), "utf8"),
);
const pnpm = (...args) => {
  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath, ...args],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  if (result.status !== 0) throw new Error("桌面构建未完成。");
};
pnpm("build");
await rm(runtime, { recursive: true, force: true });
pnpm(
  "--config.node-linker=hoisted",
  "--filter",
  "@domos/api",
  "deploy",
  "--legacy",
  "--prod",
  runtime,
);
createRequire(join(runtime, "node_modules/@domos/agent/package.json"))(
  "electron",
);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const banner = {
  js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
};
await build({
  entryPoints: [join(here, "src/main.ts")],
  outfile: join(dist, "main.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["electron"],
  banner,
});
const external = [
  "@earendil-works/*",
  "@hono/*",
  "@orpc/*",
  "hono",
  "hono/*",
  "zod",
];
for (const [entry, output] of [
  ["apps/api/src/main.ts", "server.mjs"],
  ["apps/controller/src/main.ts", "controller.mjs"],
  ["packages/agent/src/computer/bridge.ts", "bridge.mjs"],
])
  await build({
    entryPoints: [join(root, entry)],
    outfile: join(runtime, output),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external,
    banner,
  });
await cp(join(here, "src/preload.cjs"), join(dist, "preload.cjs"));
for (const name of ["setup.html", "setup.css", "setup.js", "setup-preload.cjs"])
  await cp(join(here, "src", name), join(dist, name));
await cp(
  join(root, "packages/ui/src/web/controls.css"),
  join(dist, "controls.css"),
);
await cp(
  join(root, "packages/ui/src/web/setup.css"),
  join(dist, "setup-layout.css"),
);
const variables = (values, prefix = "") =>
  Object.entries(values)
    .map(([key, value]) => `--${prefix}${key}:${value};`)
    .join("");
await writeFile(
  join(dist, "setup-theme.css"),
  `:root{${variables(metrics)}${variables(themes.light, "color-")}}@media(prefers-color-scheme:dark){:root{${variables(themes.dark, "color-")}}}`,
);
await cp(join(root, "packages/ui/assets/icon.png"), join(dist, "icon.png"));
await cp(join(root, "apps/web/dist"), join(runtime, "web"), {
  recursive: true,
});
await cp(join(root, "deploy/NOTICE"), join(runtime, "NOTICE"));
await cp(join(root, "deploy/licenses"), join(runtime, "licenses"), {
  recursive: true,
});
await mkdir(join(runtime, "work/deploy"), { recursive: true });
await mkdir(join(runtime, "work/packages/agent/src/harness"), {
  recursive: true,
});
await mkdir(join(runtime, "work/packages/ui/src"), { recursive: true });
for (const name of ["package.json", "src/computer-effect.mjs"])
  await cp(
    join(root, "packages/ui", name),
    join(runtime, "work/packages/ui", name),
  );
for (const name of [
  "worker.mjs",
  "account-environment.mjs",
  "gateway.mjs",
  "pi-entry.mjs",
  "pi-account.mjs",
  "http-service.mjs",
  "browser-service.mjs",
  "browser-view.mjs",
  "desktop-view.mjs",
  "computer-service.mjs",
  "desktop-activity.mjs",
  "desktop-overlay.mjs",
  "desktop-overlay-preload.cjs",
])
  await cp(
    join(root, "packages/agent/src/harness", name),
    join(runtime, "work/packages/agent/src/harness", name),
  );
await cp(
  join(root, "deploy/workspace.Dockerfile"),
  join(runtime, "work/deploy/workspace.Dockerfile"),
);
await cp(
  join(root, "deploy/workspace.mjs"),
  join(runtime, "work/deploy/workspace.mjs"),
);
for (const name of ["proxy.Dockerfile", "squid.conf"])
  await cp(join(root, "deploy", name), join(runtime, "work/deploy", name));
await cp(join(root, "deploy/licenses"), join(runtime, "work/deploy/licenses"), {
  recursive: true,
});
const service = join(runtime, "service");
await mkdir(service, { recursive: true });
for (const name of [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "domos.config.json",
  ".dockerignore",
])
  await cp(join(root, name), join(service, name));
for (const name of [
  "apps/api",
  "apps/cli",
  "apps/controller",
  "apps/web",
  "packages/agent",
  "packages/hosting",
  "packages/ui",
])
  await cp(join(root, name), join(service, name), {
    recursive: true,
    filter: (path) =>
      !path
        .split(/[\\/]/)
        .some((part) =>
          ["node_modules", "dist", "test", "runtime", "release"].includes(part),
        ),
  });
await mkdir(join(service, "apps/desktop"), { recursive: true });
await cp(
  join(here, "package.json"),
  join(service, "apps/desktop/package.json"),
);
await mkdir(join(service, "deploy"), { recursive: true });
for (const name of ["Dockerfile", "release.json", "NOTICE", "licenses"])
  await cp(join(root, "deploy", name), join(service, "deploy", name), {
    recursive: true,
  });
await writeFile(
  join(runtime, "release.json"),
  JSON.stringify({
    version: release.version,
    serviceImage: release.serviceImage,
    serviceBuild: { context: "service", dockerfile: "deploy/Dockerfile" },
    workImage: release.workImage,
    proxyImage: release.proxyImage,
    proxyBuild: { context: "work", dockerfile: "deploy/proxy.Dockerfile" },
    controllerEntry: "controller.mjs",
    serverEntry: "server.mjs",
    bridgeEntry: "bridge.mjs",
    workerEntry: "node_modules/@domos/agent/src/harness/worker.mjs",
    staticDir: "web",
    workBuild: { context: "work", dockerfile: "deploy/workspace.Dockerfile" },
  }),
);
