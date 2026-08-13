/**
 * Customer-portal authentication setup for Playwright E2E tests.
 *
 * Persists an authenticated PORTAL storage state to `e2e/.auth/portal.json`,
 * which the `chromium-portal` project consumes. Separate from
 * `auth.setup.ts` (staff) because the two sessions are different users with
 * different roles and cannot share one state file.
 *
 * Portal login is OTP/magic-link only — `shouldCreateUser: false`, no password
 * path (src/app/portal/(auth)/login/portal-login-form.tsx) — so there is no
 * credential form to drive and no dev-login shortcut. This setup therefore
 * performs the real flow: seed a portal customer + auth user (e2e/seed.ts),
 * request a code from the login form, read it out of the local Mailpit
 * (e2e/mailpit.ts), and submit it.
 *
 * Requires the local Supabase stack (`supabase start` / `make db-local`): the
 * mail catcher on :54324 is where the code comes from, and `[auth.email]
 * otp_length` plus the magic_link template in `supabase/config.toml` are what
 * make the emitted code one this form accepts.
 */
import { test as setup, expect } from "@playwright/test";
import { createSeedClient, cleanupPortalFixtures, seedPortalFixtures, PORTAL_USER_EMAIL } from "./seed";
import { clearMailbox, waitForLoginCode } from "./mailpit";

const authFile = "e2e/.auth/portal.json";

setup("authenticate portal customer", async ({ page }) => {
  const seed = createSeedClient();
  // Delete-and-recreate: a crashed previous run leaves an auth user whose
  // profile role was decided before its customer row existed.
  await cleanupPortalFixtures(seed);
  await seedPortalFixtures(seed);
  await clearMailbox();

  await page.goto("/portal/login");
  await page.getByLabel("Email").fill(PORTAL_USER_EMAIL);
  // Structural selector for the same reason as auth.setup.ts: the button's
  // accessible name is composed from its children.
  await page.locator("form button[type='submit']").click();

  // The form only swaps to the code step once Supabase accepted the request,
  // so this also localizes a rejected send (unknown email, invite-only portal).
  await expect(page.getByLabel("Verification code")).toBeVisible();

  await page.getByLabel("Verification code").fill(await waitForLoginCode(PORTAL_USER_EMAIL));

  // The OTP input auto-submits on completion — no Verify click needed.
  await page.waitForURL("**/portal/orders**");
  await page.context().storageState({ path: authFile });
});
