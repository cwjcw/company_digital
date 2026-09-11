import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173", channel: "chrome", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "pnpm dev --host 127.0.0.1", url: "http://127.0.0.1:5173", reuseExistingServer: true, timeout: 60_000 }
});
