/**
 * Playwright E2E test configuration.
 *
 * Uses a global auth setup project to save authenticated browser state,
 * then runs all Chromium tests with that stored state so each spec starts
 * already logged in.
 *
 * Environment variables:
 *   E2E_USER_EMAIL    - Supabase user email  (default: test@brewery.com)
 *   E2E_USER_PASSWORD - Supabase user password (default: testpassword123)
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "bun dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
