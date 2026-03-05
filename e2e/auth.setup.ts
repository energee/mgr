/**
 * Global authentication setup for Playwright E2E tests.
 *
 * Logs in via the Supabase-backed login page and persists browser storage
 * state to `e2e/.auth/user.json`.  All spec files in the "chromium" project
 * depend on this setup so they start with an authenticated session.
 *
 * Credentials are read from environment variables (see playwright.config.ts).
 */
import { test as setup } from "@playwright/test";

const authFile = "e2e/.auth/user.json";

setup("authenticate", async ({ page }) => {
  // Navigate to login page
  await page.goto("/auth/login");

  // Fill in credentials from environment
  await page
    .getByLabel("Email")
    .fill(process.env.E2E_USER_EMAIL ?? "test@brewery.com");
  await page
    .getByLabel("Password")
    .fill(process.env.E2E_USER_PASSWORD ?? "testpassword123");
  await page.getByRole("button", { name: /sign in/i }).click();

  // Wait for redirect to dashboard
  await page.waitForURL("/dashboard**");

  // Save signed-in state
  await page.context().storageState({ path: authFile });
});
