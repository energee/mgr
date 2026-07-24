/**
 * E2E smoke tests for packaging sessions — F136 verification surface.
 *
 * Smoke level: navigates to packaging list. The full in_progress -> done
 * flow is skipped below with a tracked schema-drift blocker.
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

  // SKIPPED (tracked in #437): scaffold not yet implemented. The former
  // schema-drift blocker is gone — migration 00269 captured live's drop of
  // the legacy 00080 xor constraints, so selling_format-only line-item
  // inserts now succeed against a replayed local stack. The completion
  // trigger's DB semantics are covered end-to-end at the SQL layer by
  // src/__tests__/integration/packaging-completion-trigger.test.ts; this
  // browser flow still needs to be written.
  test.skip("full packaging session flow", async () => {
    // Step 1: from batch detail, click "Start packaging"
    // Step 2: select selling formats and quantities
    // Step 3: verify packaging session created in `in_progress` state
    // Step 4: PackagingDayView renders (real-time data entry)
    // Step 5: complete the session (transition to done)
    // Step 6: verify finished_goods rows created for each format
    // Step 7: verify batch state transitioned
  });
});
