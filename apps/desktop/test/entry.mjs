import { isAbsolute } from "node:path";
import { app } from "electron";

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
