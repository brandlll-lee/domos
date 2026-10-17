import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  workers: 1,
  outputDir: "../../test-results/desktop",
  use: { trace: "retain-on-failure" },
});
