import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { app } from "electron";

const require = createRequire(
  createRequire(import.meta.url).resolve("@playwright/test/package.json"),
);
// Explicit Electron executables need Playwright's startup barrier.
require(
  join(
    dirname(require.resolve("playwright-core/package.json")),
    "lib/server/electron/loader.js",
  ),
);

try {
  const directory = app.commandLine.getSwitchValue("test-data-dir");
  if (!isAbsolute(directory))
    throw new Error("Test data directory must be absolute");
  app.setPath("userData", directory);
  await import("../dist/main.mjs");
} catch (error) {
  console.error(error);
  app.exit(1);
}
