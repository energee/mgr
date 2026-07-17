/**
 * Playwright E2E test configuration.
 *
 * Uses a global auth setup project to save authenticated browser state,
 * then runs all Chromium tests with that stored state so each spec starts
 * already logged in.
 *
 * Environment variables:
 *   PLAYWRIGHT_BASE_URL - where the app is served (default: http://localhost:3000)
 *   E2E_USER_EMAIL      - Supabase user email; if unset, auth.setup.ts uses the
 *                         dev-login route instead of the credential form
 *   E2E_USER_PASSWORD   - Supabase user password
 *
 * Set PLAYWRIGHT_BASE_URL when :3000 is taken by another worktree's dev server.
 * For localhost targets the port is derived from it and passed to `bun dev`,
 * so one variable moves both the server and the tests. For a non-localhost
 * target (e.g. a preview deploy) no webServer is configured at all — the
 * target is assumed to be already serving, and deriving PORT=3000 from a
 * port-less https URL would otherwise wrongly boot a local dev server.
 */
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const baseUrl = new URL(BASE_URL);
const IS_LOCAL_TARGET = ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname);
const PORT = baseUrl.port || "3000";
const SERVER_READY_URL = new URL("/api/health", baseUrl).toString();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: BASE_URL,
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
  // Only boot a dev server for localhost targets; a remote base URL is
  // already serving and must not trigger a local `bun dev` on :3000.
  ...(IS_LOCAL_TARGET && {
    webServer: {
      command: "bun dev",
      // Probe a lightweight route that also confirms the isolated database is
      // ready. Compiling the full root page exceeded Playwright's implicit
      // 60-second startup limit on a cold GitHub Actions runner.
      url: SERVER_READY_URL,
      timeout: process.env.CI ? 120_000 : 60_000,
      // Next reads PORT, so BASE_URL moves the server and the tests together.
      env: { PORT },
      // Locally this adopts whatever already answers on BASE_URL — including
      // another worktree's dev server. Set PLAYWRIGHT_BASE_URL to an unused port
      // when that matters.
      reuseExistingServer: !process.env.CI,
    },
  }),
});
