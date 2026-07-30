/**
 * Global authentication setup for Playwright E2E tests.
 *
 * Persists an authenticated browser storage state to `e2e/.auth/user.json`.
 * All spec files in the "chromium" project depend on this setup so they start
 * already logged in.
 *
 * Two paths:
 *   - Default: hit `/api/auth/dev-login`, which signs in `dev@brewery.test`
 *     (creating it if absent) and redirects. No credentials needed. That route
 *     404s unless it is explicitly enabled — `NODE_ENV=development` (what
 *     `bun dev` gives locally), or `E2E_DEV_LOGIN=1` *together with* a loopback
 *     `NEXT_PUBLIC_SUPABASE_URL` (issue #656). CI's nightly lane sets the flag
 *     because it serves a production `next build` via `bun start`, where
 *     NODE_ENV is "production" (issue #644), and points it at its own local
 *     Supabase stack, which is what satisfies the loopback half.
 *   - If `E2E_USER_EMAIL` is set: drive the real credential form instead, for
 *     targets that cannot enable dev-login — notably a deployed environment,
 *     where the route stays 404 by design.
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
    // Structural selector, not getByRole({ name }): the submit button's
    // accessible name is composed from its children, so a decorative child
    // (e.g. the <Kbd>⌘⏎</Kbd> hint) can silently change it and strand the
    // whole credential path in a timeout. The password form renders exactly
    // one type="submit" button — "Sign in with magic link" is type="button".
    await page.locator("form button[type='submit']").click();
  } else {
    await page.goto("/api/auth/dev-login?redirect=/dashboard");
  }

  await page.waitForURL("**/dashboard**");
  await page.context().storageState({ path: authFile });
});
