/**
 * E2E tests for packaging sessions — F136 verification surface.
 *
 * Smoke level: navigates to the packaging list. Full flow: seeds a
 * `packaging`-state batch and a `planned` session via e2e/seed.ts (service
 * role), advances the session to `in_progress`, adds a line item through the
 * PackagingDayView quick-add row, completes the session through the review
 * dialog, and asserts the finished goods the DB trigger creates.
 *
 * The former schema-drift blocker is gone: migration 00269 captured live's
 * out-of-band drop of the legacy 00080 xor constraints, so selling_format-only
 * line items now insert against a replayed local stack (verified — both
 * `chk_sli_format_xor` and `chk_fg_format_xor` are absent after replay).
 */
import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSeedClient,
  cleanupPackagingFixtures,
  seedPackagingFixtures,
  PACKAGING_IDS,
  PACKAGING_BATCH_CODE,
  PACKAGING_FORMAT_NAME,
  PACKAGING_QUANTITY,
} from "./seed";
import { pickComboboxOption } from "./ui";

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
});

// Single-test describe: with fullyParallel only one worker ever runs these
// hooks, so the delete-and-recreate seeding cannot race itself (e2e/seed.ts).
test.describe("Packaging session — full flow", () => {
  // Playwright's 30s default is a per-TEST budget, and this one spends it on a
  // status transition, a full page swap, two async-loaded comboboxes, a
  // completion dialog and several DB round trips. Locally, against `bun dev`,
  // a route that has to compile on first hit can eat most of it on its own.
  test.slow();

  let seed: SupabaseClient;

  test.beforeAll(async () => {
    seed = createSeedClient();
    await cleanupPackagingFixtures(seed); // reset leftovers from a crashed run
    await seedPackagingFixtures(seed);
  });

  test.afterAll(async () => {
    if (!seed) return; // beforeAll failed before the client existed
    await cleanupPackagingFixtures(seed);
  });

  test("full packaging session flow", async ({ page }) => {
    // Step 1: a `planned` session renders through EntityDetailUnified; the
    // generic transition lives in the "Actions" dropdown.
    await page.goto(`/production/packaging/${PACKAGING_IDS.session}`);
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Move to In Progress" }).click();

    // Step 2: the status flip swaps the whole page for PackagingDayView.
    // Its quick-add row is the marker that the swap happened.
    const addRowBatch = page.getByPlaceholder("Select batch");
    await expect(addRowBatch).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("button", { name: "Complete Session" }),
    ).toBeDisabled();

    // Step 3: add a line item. Both pickers are async-loaded comboboxes —
    // see e2e/ui.ts for why the interaction is polled. Picking the
    // batch derives the brand.
    await pickComboboxOption(page, "Select batch", PACKAGING_BATCH_CODE);
    await pickComboboxOption(page, "Select format", PACKAGING_FORMAT_NAME);

    // Planned is prefilled with a suggestion from batch volume / fill volume;
    // overwrite both quantities so actual === planned and no implied-loss
    // dialog is queued (see PACKAGING_QUANTITY in e2e/seed.ts).
    await page.getByPlaceholder("Planned").fill(String(PACKAGING_QUANTITY));
    await page.getByPlaceholder("Actual").fill(String(PACKAGING_QUANTITY));
    await page.getByRole("button", { name: "Add line item" }).click();

    // Step 4: the row lands in the table and the totals footer appears.
    const lineRow = page
      .getByRole("row")
      .filter({ hasText: PACKAGING_BATCH_CODE });
    await expect(lineRow).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("cell", { name: "Totals" })).toBeVisible();

    // Step 5: complete through the review dialog.
    const completeButton = page.getByRole("button", {
      name: "Complete Session",
    });
    await expect(completeButton).toBeEnabled();
    await completeButton.click();
    const dialog = page.getByRole("dialog", {
      name: /complete packaging session/i,
    });
    await expect(dialog).toBeVisible();
    // No "no actual quantity" warning: every line has an actual.
    await expect(dialog).not.toContainText(/no actual quantity/i);
    await dialog.getByRole("button", { name: "Confirm Completion" }).click();
    await expect(page.getByText("Packaging session completed")).toBeVisible({
      timeout: 30_000,
    });

    // Step 6: DB-side effects, asserted via the service-role client — the
    // finished goods are created by the on_packaging_session_completion
    // trigger, not by the client, so the DB is the only honest source here.
    const { data: sessionRow } = await seed
      .from("packaging_sessions")
      .select("status, completed_at")
      .eq("id", PACKAGING_IDS.session)
      .single();
    expect(sessionRow!.status).toBe("completed");
    expect(sessionRow!.completed_at).not.toBeNull();

    const { data: lineItems } = await seed
      .from("session_line_items")
      .select("id, batch_id, selling_format_id, planned_quantity, actual_quantity")
      .eq("session_id", PACKAGING_IDS.session);
    expect(lineItems).toHaveLength(1);
    expect(lineItems![0].batch_id).toBe(PACKAGING_IDS.batch);
    expect(lineItems![0].selling_format_id).toBe(PACKAGING_IDS.format);
    expect(lineItems![0].actual_quantity).toBe(PACKAGING_QUANTITY);

    const { data: finishedGoods } = await seed
      .from("finished_goods")
      .select(
        "id, quantity, brand_id, selling_format_id, session_line_item_id, lot_number",
      )
      .eq("batch_id", PACKAGING_IDS.batch);
    expect(finishedGoods).toHaveLength(1);
    expect(finishedGoods![0].quantity).toBe(PACKAGING_QUANTITY);
    expect(finishedGoods![0].brand_id).toBe(PACKAGING_IDS.brand);
    expect(finishedGoods![0].selling_format_id).toBe(PACKAGING_IDS.format);
    expect(finishedGoods![0].session_line_item_id).toBe(lineItems![0].id);
    // YYYYMMDD-NNN lot numbering (00142/00205).
    expect(finishedGoods![0].lot_number).toMatch(/^\d{8}-\d{3}$/);

    // The trigger also records a completed batch -> finished_good allocation.
    // Keyed on THIS run's finished-good id, not on the batch: completed
    // allocations cannot be deleted (see cleanupPackagingFixtures), so a
    // by-batch query would also return rows left by earlier local runs.
    const { data: allocations } = await seed
      .from("allocations")
      .select("source_type, source_id, destination_type, quantity, status")
      .eq("destination_id", finishedGoods![0].id);
    expect(allocations).toHaveLength(1);
    expect(allocations![0].source_type).toBe("batch");
    expect(allocations![0].source_id).toBe(PACKAGING_IDS.batch);
    expect(allocations![0].destination_type).toBe("finished_good");
    expect(allocations![0].status).toBe("completed");
  });
});
