/**
 * Read-only E2E coverage of the authenticated customer portal (issue #706).
 *
 * This is the proof that the OTP auth harness works: it runs in the
 * `chromium-portal` project, whose storage state comes from
 * `portal-auth.setup.ts` — a real OTP login against the local stack's mail
 * catcher. Without it the fixture would be an unverified abstraction.
 *
 * Covers the read-only views and order placement (Phase 4, node C2). The
 * placement test is the one that could not exist before: it needs migration
 * 00290's customer INSERT policy, 00292's readable product list, and this
 * project's OTP-derived session all at once.
 */
import { test, expect } from "@playwright/test";
import {
  createSeedClient,
  PORTAL_CUSTOMER_NAME,
  PORTAL_FORMAT_NAME,
  PORTAL_ORDER_NUMBER,
} from "./seed";

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

  test("customer places an order through the portal", async ({ page }) => {
    await page.goto("/portal/orders");
    await page.getByRole("link", { name: "Place Order" }).click();
    await expect(
      page.getByRole("heading", { name: "Place an Order" }),
    ).toBeVisible();

    // The picker is populated by get_portal_available_products() (00292).
    // Before that migration a portal customer read zero rows here and this
    // list was empty for everyone, so an empty option set is a real
    // regression rather than a seeding problem.
    await page.getByRole("button", { name: "Add Item" }).click();
    await page.getByLabel("Product / Format").click();
    await page
      .getByRole("option", { name: new RegExp(PORTAL_FORMAT_NAME) })
      .click();
    await page.getByLabel("Quantity").fill("3");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await page.getByRole("button", { name: "Submit Order" }).click();

    // Redirects to the new order's detail page. The order number comes from
    // the DEFAULT, never the client, so assert its shape not a fixed value.
    await expect(page).toHaveURL(/\/portal\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByText(/ORD-\d{4}-\d+/).first()).toBeVisible();
    await expect(page.getByText(/draft/i).first()).toBeVisible();

    // Rendered text is not the contract — the row is. Assert DB-side what
    // 00290's WITH CHECK actually constrains, because a UI that merely *looks*
    // right while persisting a priced or non-draft order is the failure this
    // whole design exists to prevent.
    const orderId = page.url().split("/").pop() as string;
    const seed = createSeedClient();
    const { data: order } = await seed
      .from("orders")
      .select("status, version, is_export, scheduled_date, fulfilled_date, delivery_id, order_number")
      .eq("id", orderId)
      .single();

    expect(order?.status).toBe("draft");
    expect(order?.version).toBe(1);
    expect(order?.is_export ?? false).toBe(false);
    expect(order?.scheduled_date).toBeNull();
    expect(order?.fulfilled_date).toBeNull();
    expect(order?.delivery_id).toBeNull();
    expect(order?.order_number).toMatch(/^ORD-\d{4}-\d+$/);

    const { data: items } = await seed
      .from("order_items")
      .select("quantity, unit_price")
      .eq("order_id", orderId);

    expect(items).toHaveLength(1);
    expect(items?.[0].quantity).toBe(3);
    // Staff price the order at confirm time; the customer must never set this.
    expect(items?.[0].unit_price).toBeNull();
  });
});
