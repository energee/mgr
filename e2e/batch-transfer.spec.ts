/**
 * E2E smoke tests for batch / vessel transfer — F135 verification surface.
 *
 * Smoke level: navigates to vessel-transfers list. Deeper flow (start
 * batch -> transfer to fermenter -> transfer to bright tank -> package)
 * is scaffolded below, pending seed data.
 */
import { test, expect } from "@playwright/test";

test.describe("Batch transfer", () => {
  test("vessel-transfers list renders", async ({ page }) => {
    await page.goto("/production/vessel-transfers");
    await expect(
      page.getByRole("heading", { name: /vessel.?transfers?/i }),
    ).toBeVisible();
  });

  test("new vessel-transfer page renders", async ({ page }) => {
    await page.goto("/production/vessel-transfers/new");
    await expect(page.locator("body")).toContainText(/transfer/i);
  });

  test.skip("full transfer flow", async () => {
    // TODO: requires seed batch + vessels
    // Step 1: from batch detail, click "Transfer to vessel"
    // Step 2: pick destination vessel, confirm
    // Step 3: verify dialog closes, batch state machine advances
    // Step 4: verify destination vessel now shows the batch via
    //         vessels_with_batch view
    // Step 5: verify allocations table got a new row
  });
});
