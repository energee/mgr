/**
 * Global authentication setup for Playwright E2E tests.
 *
 * Persists an authenticated browser storage state to `e2e/.auth/user.json`.
 * All spec files in the "chromium" project depend on this setup so they start
 * already logged in.
 *
 * Two paths:
 *   - Default: hit `/api/auth/dev-login`, which signs in `dev@brewery.test`
 *     (creating it if absent) and redirects. Requires NODE_ENV=development,
 *     which `bun dev` provides. No credentials needed.
 *   - If `E2E_USER_EMAIL` is set: drive the real credential form instead, for
 *     targets where the dev-login route 404s (any production build).
 */
import { test as setup } from "@playwright/test";

const authFile = "e2e/.auth/user.json";

setup("authenticate", async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL;

  if (email) {
    // The login route is `/login`. `src/app/(auth)/` is a route group, so the
    // parentheses never appear in the URL — `/auth/login` renders a 404.
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(process.env.E2E_USER_PASSWORD ?? "");
    await page.getByRole("button", { name: /^sign in$/i }).click();
  } else {
    await page.goto("/api/auth/dev-login?redirect=/dashboard");
  }

  await page.waitForURL("**/dashboard**");
  await page.context().storageState({ path: authFile });
});
