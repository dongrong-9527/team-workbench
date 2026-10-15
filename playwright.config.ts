import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 7000 },
  outputDir:
    process.env.WORKBENCH_TEST_OUTPUT ?? "/tmp/workbench-playwright-results",
  reporter: "list",
  use: {
    baseURL: "https://127.0.0.1:4173",
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      ...(process.env.WORKBENCH_BROWSER_EXECUTABLE
        ? { executablePath: process.env.WORKBENCH_BROWSER_EXECUTABLE }
        : {}),
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "node tests/e2e/server.mjs",
    url: "https://127.0.0.1:4173",
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 90000,
  },
});
