/**
 * E2E smoke tests for packaging sessions — F136 verification surface.
 *
 * Smoke level: navigates to packaging list. Deeper in_progress -> done
 * transition (PackagingDayView) is scaffolded below.
 */
import { test, expect } from "@playwright/test";

test.describe("Packaging session", () => {
  test("packaging list renders", async ({ page }) => {
    await page.goto("/production/packaging");
    await expect(
      page.getByRole("heading", { name: /packaging/i }),
    ).toBeVisible();
  });

  test("new packaging page renders", async ({ page }) => {
    await page.goto("/production/packaging/new");
    await expect(page.locator("body")).toContainText(/packaging/i);
  });

  test.skip("full packaging session flow", async () => {
    // TODO: requires seed batch in bright-tank state
    // Step 1: from batch detail, click "Start packaging"
    // Step 2: select selling formats and quantities
    // Step 3: verify packaging session created in `in_progress` state
    // Step 4: PackagingDayView renders (real-time data entry)
    // Step 5: complete the session (transition to done)
    // Step 6: verify finished_goods rows created for each format
    // Step 7: verify batch state transitioned to packaged
  });
});
