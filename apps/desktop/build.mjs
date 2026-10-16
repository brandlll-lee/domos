import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { metrics, themes } from "../../packages/ui/src/tokens.ts";

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
for (const name of ["setup.html", "setup.css", "setup.js", "preload.cjs"])
  await cp(join(here, "src", name), join(dist, name));
const variables = Object.entries(metrics)
  .map(([key, value]) => `--${key}:${value}`)
  .join(";");
const colors = Object.entries(themes.light)
  .map(
    ([key, value]) => `--color-${key}:light-dark(${value},${themes.dark[key]})`,
  )
  .join(";");
await writeFile(join(dist, "theme.css"), `:root{${variables};${colors}}`);
const brand = join(dist, "brand.cjs");
await build({
  stdin: {
    contents:
      'import { createElement } from "react"; import { renderToStaticMarkup } from "react-dom/server"; import { BrandMark } from "@domos/ui/avatar"; export const html = renderToStaticMarkup(createElement(BrandMark));',
    resolveDir: join(root, "apps/web"),
    loader: "tsx",
  },
  outfile: brand,
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
});
const logo = createRequire(import.meta.url)(brand).html;
const html = await readFile(join(dist, "setup.html"), "utf8");
await writeFile(
  join(dist, "setup.html"),
  html.replace('<span class="brand" aria-hidden="true">◉</span>', logo),
);
await rm(brand);
await cp(join(root, "apps/web/dist"), join(runtime, "web"), {
  recursive: true,
});
await mkdir(join(runtime, "work/deploy"), { recursive: true });
await cp(
  join(root, "deploy/workspace.Dockerfile"),
  join(runtime, "work/deploy/workspace.Dockerfile"),
);
for (const name of ["proxy.Dockerfile", "squid.conf"])
  await cp(join(root, "deploy", name), join(runtime, "work/deploy", name));
await cp(join(root, "deploy/licenses"), join(runtime, "work/deploy/licenses"), {
  recursive: true,
});
await writeFile(
  join(runtime, "release.json"),
  JSON.stringify({
    version: release.version,
    workImage: release.workImage,
    proxyImage: release.proxyImage,
    proxyBuild: { context: "work", dockerfile: "deploy/proxy.Dockerfile" },
    controllerEntry: "controller.mjs",
    serverEntry: "server.mjs",
    bridgeEntry: "bridge.mjs",
    staticDir: "web",
    workBuild: { context: "work", dockerfile: "deploy/workspace.Dockerfile" },
  }),
);
