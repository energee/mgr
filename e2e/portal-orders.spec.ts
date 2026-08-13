/**
 * Read-only E2E coverage of the authenticated customer portal (issue #706).
 *
 * This is the proof that the OTP auth harness works: it runs in the
 * `chromium-portal` project, whose storage state comes from
 * `portal-auth.setup.ts` — a real OTP login against the local stack's mail
 * catcher. Without it the fixture would be an unverified abstraction.
 *
 * Scope is deliberately read-only. There is no portal order-placement UI (see
 * the header of customer-order.spec.ts); orders are placed by staff, and the
 * one asserted here is seeded by `seedPortalFixtures`.
 */
import { test, expect } from "@playwright/test";
import { PORTAL_CUSTOMER_NAME, PORTAL_ORDER_NUMBER } from "./seed";

test.describe("Customer portal — authenticated", () => {
  test("orders list renders the customer's orders", async ({ page }) => {
    await page.goto("/portal/orders");

    // Reaching this at all means the portal layout resolved a session AND a
    // non-revoked customer link; without either it redirects to /portal/login.
    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
    await expect(page.getByText(PORTAL_CUSTOMER_NAME).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: PORTAL_ORDER_NUMBER }),
    ).toBeVisible();
  });
});
