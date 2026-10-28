import { defineConfig } from "@playwright/test";
const port=Number(process.env.UI_TEST_PORT || 3100);
const baseURL=`http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.spec.ts",
  timeout: 45000,
  workers: 1,
  use: {
    baseURL,
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180000,
    env: { APP_MODE: "demo", APP_ORIGIN: baseURL },
  },
  reporter: "list",
});
