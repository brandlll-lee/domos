import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/test",
  testMatch: "**/*.spec.ts",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["junit", { outputFile: "test-results/web.xml" }]],
  timeout: 30_000,
  use: {
    browserName: "chromium",
    viewport: { width: 1360, height: 900 },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
});
