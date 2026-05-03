/**
 * E2E smoke tests for the dashboard — F128 + F200 verification surface.
 *
 * Smoke level: dashboard route loads. Deeper assertions on chart contents
 * and the new activity heatmap (F200, in_progress) are scaffolded below.
 */
import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("dashboard root renders", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("body")).toContainText(/dashboard/i);
  });

  test("inventory dashboard renders", async ({ page }) => {
    await page.goto("/dashboard/inventory");
    await expect(page.locator("body")).toContainText(/inventory/i);
  });

  test("sales dashboard renders", async ({ page }) => {
    await page.goto("/dashboard/sales");
    await expect(page.locator("body")).toContainText(/sales/i);
  });

  test.skip("activity heatmap (F200, in_progress) renders cells for the past 12 weeks", async () => {
    // TODO: implement once F200 lands
    // Step 1: navigate to /dashboard
    // Step 2: locate the activity heatmap component
    // Step 3: verify ~84 cells render (12 weeks * 7 days)
    // Step 4: verify cell color reflects activity count (0 -> empty, >0 -> tint)
    // Step 5: hover a cell -> verify tooltip shows date + count
  });

  test.skip("dashboard trends charts render with real data", async () => {
    // TODO: requires seed batches + orders
    // Step 1: navigate to /dashboard
    // Step 2: verify production trend chart has at least 1 data point
    // Step 3: verify sales trend chart has at least 1 data point
  });
});
