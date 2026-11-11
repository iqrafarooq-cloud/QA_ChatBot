// @ts-check
const { defineConfig, devices } = require("@playwright/test");
const path = require("node:path");

const PORT = 3200;
const MOCK_PORT = 4010;

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: `node tests/mock-anthropic.mjs`,
      url: `http://127.0.0.1:${MOCK_PORT}/__requests`,
      env: { MOCK_PORT: String(MOCK_PORT) },
      reuseExistingServer: false,
    },
    {
      command: `node tests/reset-data.mjs && npx next dev -p ${PORT}`,
      url: `http://localhost:${PORT}/api/stats`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        ANTHROPIC_API_KEY: "test-key-not-real",
        QA_BRAIN_PROVIDER: "anthropic",
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
        QA_BRAIN_DATA_DIR: path.join(__dirname, ".e2e-data"),
        QA_BRAIN_MAX_UPLOAD_MB: "2",
        QA_BRAIN_REFUSAL_FALLBACK: "true",
        QA_BRAIN_CHAT_RATE_PER_MIN: "200",
      },
    },
  ],
});
