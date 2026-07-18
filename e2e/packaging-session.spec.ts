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

  // SKIPPED (tracked in #437): blocked by replay-chain vs live schema drift,
  // not by missing seed data. The replayed migration chain still enforces the
  // 00080 constraints chk_sli_format_xor / chk_fg_format_xor (legacy
  // package_type_id / keg_type_id must be set), but every UI line-item insert
  // (packaging-batch-dialog, add-to-packaging-session-dialog,
  // use-session-line-items) writes selling_format_id-only rows — verified
  // empirically against a fresh `supabase db reset`: the "Start packaging"
  // INSERT is rejected before a session can even be completed. Live dropped
  // those constraints (uncaptured drift; 00232's own self-verification block
  // writes the same selling_format-only shape). Until a migration captures
  // the constraint drops, this flow cannot run against the local stack. The
  // completion trigger's DB semantics are covered end-to-end at the SQL layer
  // by src/__tests__/integration/packaging-completion-trigger.test.ts.
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
