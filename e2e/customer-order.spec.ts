/**
 * E2E smoke tests for the customer order flow — F114 verification surface.
 *
 * Covers both the internal sales/orders pages and the external customer
 * portal. Deeper flow (place order -> allocate -> pick -> fulfill) is
 * scaffolded below.
 */
import { test, expect } from "@playwright/test";

test.describe("Customer order — internal", () => {
  test("orders list renders", async ({ page }) => {
    await page.goto("/sales/orders");
    await expect(
      page.getByRole("heading", { name: /orders/i }),
    ).toBeVisible();
  });

  test("new order page renders", async ({ page }) => {
    await page.goto("/sales/orders/new");
    await expect(page.locator("body")).toContainText(/order/i);
  });
});

test.describe("Customer order — portal", () => {
  test("portal login renders without auth", async ({ browser }) => {
    // Portal login is the only page reachable without an authenticated session.
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await page.goto("/portal/login");
    await expect(page.locator("body")).toContainText(/sign in|login|portal/i);
    await context.close();
  });
});

test.describe("Customer order — full flow", () => {
  test.skip("place order through portal -> allocate -> fulfill", async () => {
    // TODO: requires seed customer + finished goods
    // Step 1: portal login as a customer
    // Step 2: navigate to /portal/orders, click "New order"
    // Step 3: pick selling formats, set quantities, submit
    // Step 4: switch to internal session, navigate to /sales/orders
    // Step 5: open the new order, allocate finished goods
    // Step 6: generate pick list
    // Step 7: mark fulfilled, verify state transition
    // Step 8: verify portal customer view shows updated state
  });
});
