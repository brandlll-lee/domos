import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/test",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 30_000,
  use: {
    browserName: "chromium",
    viewport: { width: 1360, height: 900 },
    trace: "retain-on-failure",
  },
});
