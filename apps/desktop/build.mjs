import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { metrics, themes } from "@domos/ui/tokens";
import { build } from "esbuild";
import { desktopBinary } from "../../packages/agent/src/harness/desktop-driver.mjs";
import {
  publishedReleaseSchema,
  releaseSchema,
} from "../../packages/hosting/src/install.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const runtime = join(here, "runtime");
const dist = join(here, "dist");
const release = (
  process.argv[2] ? publishedReleaseSchema : releaseSchema
).parse(
  JSON.parse(
    await readFile(
      process.argv[2] ?? join(root, "deploy/release.json"),
      "utf8",
    ),
  ),
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
  js: 'import { createRequire as createDesktopRequire } from "node:module"; const require = createDesktopRequire(import.meta.url);',
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
  "undici",
  "zod",
  "sharp",
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
await build({
  entryPoints: [join(here, "src/setup.tsx")],
  outfile: join(dist, "setup.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome144",
  loader: { ".webp": "file", ".woff2": "file", ".png": "file" },
  assetNames: "assets/[name]-[hash]",
  define: { "process.env.NODE_ENV": '"production"' },
});
for (const name of ["setup.html", "setup-preload.cjs"])
  await cp(join(here, "src", name), join(dist, name));
const variables = (values, prefix = "") =>
  Object.entries(values)
    .map(([key, value]) => `--${prefix}${key}:${value};`)
    .join("");
await writeFile(
  join(dist, "setup-theme.css"),
  `:root{${variables(metrics)}${variables(themes.light, "color-")}}@media(prefers-color-scheme:dark){:root{${variables(themes.dark, "color-")}}}`,
);
for (const name of ["icon.png", "icon.ico"])
  await cp(join(root, "packages/ui/assets", name), join(dist, name));
await cp(join(root, "apps/web/dist"), join(runtime, "web"), {
  recursive: true,
});
await cp(join(root, "deploy/NOTICE"), join(runtime, "NOTICE"));
await cp(join(root, "deploy/licenses"), join(runtime, "licenses"), {
  recursive: true,
});
const nativeBinary = await desktopBinary(homedir());
const nativeDirectory = join(
  runtime,
  "node_modules/@domos/agent/src/harness/cua-driver",
);
await mkdir(nativeDirectory, { recursive: true });
await cp(
  nativeBinary,
  join(
    nativeDirectory,
    process.platform === "win32" ? "cua-driver.exe" : "cua-driver",
  ),
);
await cp(
  join(
    dirname(nativeBinary),
    process.platform === "win32" ? "cua-cursor-theme.exe" : "cua-cursor-theme",
  ),
  join(
    nativeDirectory,
    process.platform === "win32" ? "cua-cursor-theme.exe" : "cua-cursor-theme",
  ),
);
await writeFile(
  join(runtime, "release.json"),
  JSON.stringify({
    ...release,
    controllerEntry: "controller.mjs",
    serverEntry: "server.mjs",
    bridgeEntry: "bridge.mjs",
    workerEntry: "node_modules/@domos/agent/src/harness/worker.mjs",
    staticDir: "web",
  }),
);
