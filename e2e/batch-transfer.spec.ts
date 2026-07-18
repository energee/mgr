/**
 * E2E tests for batch / vessel transfer — F135 verification surface.
 *
 * Smoke level: navigates to vessel-transfers list. Full flow: seeds a
 * planned batch + vessels via e2e/seed.ts (service role), drives the
 * Transfer dialog from batch detail, accepts the suggested state
 * transition, and verifies vessel occupancy plus the vessel_transfers row.
 */
import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSeedClient,
  cleanupTransferFixtures,
  seedVessels,
  seedBatchInState,
  TRANSFER_IDS,
  TRANSFER_BATCH_CODE,
  TRANSFER_FERMENTER_NAME,
} from "./seed";

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
});

// Single-test describe: with fullyParallel only one worker ever runs these
// hooks, so the delete-and-recreate seeding cannot race itself (e2e/seed.ts).
test.describe("Batch transfer — full flow", () => {
  // Lazily initialized in beforeAll: if env resolution fails (no .env.local /
  // stack not started), only this describe fails — the smoke tests above
  // still collect and run.
  let seed: SupabaseClient;

  test.beforeAll(async () => {
    seed = createSeedClient();
    await cleanupTransferFixtures(seed); // reset leftovers from a crashed run
    await seedVessels(seed);
    await seedBatchInState(seed, "planned");
  });

  test.afterAll(async () => {
    if (!seed) return; // beforeAll failed before the client existed
    await cleanupTransferFixtures(seed);
  });

  test("full transfer flow", async ({ page }) => {
    // Step 1: batch detail -> "Transfer" action.
    await page.goto(`/production/batches/${TRANSFER_IDS.batch}`);
    await expect(
      page.getByRole("heading", { name: TRANSFER_BATCH_CODE }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Transfer", exact: true }).click();

    // Step 2: pick the destination fermenter; volume auto-fills from the
    // batch's volume_bbl (10). Submit.
    const dialog = page.getByRole("dialog", { name: /transfer vessel/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox").first().click();
    await page
      .getByRole("option", { name: new RegExp(TRANSFER_FERMENTER_NAME) })
      .click();
    await dialog.getByRole("button", { name: "Transfer", exact: true }).click();

    // Step 3: dialog closes; the planned batch + fermenter destination
    // triggers a suggested "fermenting" transition (toast) — accept it and
    // wait for the success toast (the transition round-trip).
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Yes, update" }).click();
    await expect(page.getByText("Batch marked as fermenting")).toBeVisible({
      timeout: 15_000,
    });

    // The header StatusBadge does NOT live-update: handleSuggestTransition
    // (batch-detail-client.tsx) invalidates ["batches", id] while the unified
    // detail record is cached under ["batches_with_brew_info", id] (the
    // entity's viewTable) — an app-level invalidation-key mismatch tracked in
    // #437. Reload, then assert the badge, scoped to the batch-code heading's
    // parent row so a toast or any unrelated "Fermenting" text can never
    // satisfy the assertion.
    await page.reload();
    const headerRow = page
      .getByRole("heading", { name: TRANSFER_BATCH_CODE })
      .locator("..");
    await expect(headerRow.getByText("Fermenting")).toBeVisible({
      timeout: 30_000,
    });

    // Step 4: destination vessel now shows the batch (vessels list is backed
    // by the vessels_with_batch view).
    await page.goto("/production/vessels");
    const vesselRow = page
      .getByRole("row")
      .filter({ hasText: TRANSFER_FERMENTER_NAME });
    await expect(vesselRow).toContainText(TRANSFER_BATCH_CODE, {
      timeout: 30_000,
    });

    // Step 5: DB-side effects, asserted via the service-role client. The
    // scaffold expected an allocations row here, but a plain vessel transfer
    // writes vessel_transfers only (allocations record consumption/losses,
    // not moves) — assert the transfer row and occupancy instead.
    const { data: transfers } = await seed
      .from("vessel_transfers")
      .select("to_vessel_id, volume_bbl")
      .eq("batch_id", TRANSFER_IDS.batch);
    expect(transfers).toHaveLength(1);
    expect(transfers![0].to_vessel_id).toBe(TRANSFER_IDS.fermenter);
    expect(Number(transfers![0].volume_bbl)).toBe(10);

    const { data: batchRow } = await seed
      .from("batches")
      .select("status")
      .eq("id", TRANSFER_IDS.batch)
      .single();
    expect(batchRow!.status).toBe("fermenting");

    const { data: vesselRowDb } = await seed
      .from("vessels")
      .select("current_batch_id, status")
      .eq("id", TRANSFER_IDS.fermenter)
      .single();
    expect(vesselRowDb!.current_batch_id).toBe(TRANSFER_IDS.batch);
  });
});
