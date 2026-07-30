/**
 * E2E tests for the core production workflow.
 *
 * Smoke level: navigation to the production-domain list pages. Full flow: the
 * uninterrupted recipe -> batch -> brew log -> packaging chain, which is the
 * one thing the per-leg specs cannot show. Its individual legs are covered
 * elsewhere — recipe editing by recipe-editor.spec.ts, vessel transfer and the
 * planned -> fermenting advance by batch-transfer.spec.ts, and session
 * completion -> finished goods by packaging-session.spec.ts — so this spec
 * deliberately drives the LINKS between them:
 *
 *   - "Start Brew Day" on a planned batch, which creates a brew_logs row and
 *     its brew_log_batches link, then chains into the ingredient-consumption
 *     dialog;
 *   - the batch's advance through fermenting and conditioning;
 *   - "Start Packaging", which creates a packaging session with a line item
 *     for the batch and moves the batch to `packaging`.
 *
 * The chain stops at a `planned` packaging session on purpose: completing one
 * is packaging-session.spec.ts's subject, and duplicating it here would also
 * drag in the undeletable completed allocations documented in e2e/seed.ts.
 */
import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSeedClient,
  cleanupProductionFixtures,
  seedProductionFixtures,
  PRODUCTION_IDS,
  PRODUCTION_BATCH_CODE,
  PRODUCTION_FORMAT_NAME,
  PRODUCTION_PACKAGE_QUANTITY,
} from "./seed";
import { pickComboboxOption } from "./ui";

test.describe("Production Workflow", () => {
  test("navigate to recipes list", async ({ page }) => {
    await page.goto("/production/recipes");
    await expect(
      page.getByRole("heading", { name: /recipes/i }),
    ).toBeVisible();
  });

  test("navigate to batches list", async ({ page }) => {
    await page.goto("/production/batches");
    await expect(
      page.getByRole("heading", { name: /batches/i }),
    ).toBeVisible();
  });

  test("navigate to vessels list", async ({ page }) => {
    await page.goto("/production/vessels");
    await expect(
      page.getByRole("heading", { name: /vessels/i }),
    ).toBeVisible();
  });
});

// Single-test describe: with fullyParallel only one worker ever runs these
// hooks, so the delete-and-recreate seeding cannot race itself (e2e/seed.ts).
test.describe("Production workflow — full chain", () => {
  // The longest flow in the suite: a brew-day dialog, a consumption dialog,
  // two state transitions and a packaging dialog, each a server round trip.
  test.slow();

  let seed: SupabaseClient;

  test.beforeAll(async () => {
    seed = createSeedClient();
    await cleanupProductionFixtures(seed); // reset leftovers from a crashed run
    await seedProductionFixtures(seed);
  });

  test.afterAll(async () => {
    if (!seed) return; // beforeAll failed before the client existed
    await cleanupProductionFixtures(seed);
  });

  test("recipe -> batch -> brew log -> packaging session", async ({ page }) => {
    // Step 1: the seeded batch is `planned` and carries the recipe.
    await page.goto(`/production/batches/${PRODUCTION_IDS.batch}`);
    await expect(
      page.getByRole("heading", { name: PRODUCTION_BATCH_CODE }),
    ).toBeVisible({ timeout: 30_000 });

    // Step 2: Start Brew Day. The brew number is left blank so the
    // generate_brew_number() trigger (00181) assigns BRW-YYYY-DDD — asserted
    // below, because a client-supplied number would prove nothing about it.
    await page.getByRole("button", { name: "Start Brew Day" }).click();
    const brewDialog = page.getByRole("dialog", { name: /start brew day/i });
    await expect(brewDialog).toBeVisible();
    await brewDialog.getByRole("button", { name: "Start Brew Day" }).click();

    // Step 3: because the batch has a recipe, creation chains into the
    // ingredient-consumption dialog. Skip it — planning FIFO ingredient
    // allocations needs an inventory fixture this spec deliberately omits,
    // and "Skip" is a real user path (both buttons call the same onDone).
    const consumptionDialog = page.getByRole("dialog", {
      name: /confirm ingredient consumption/i,
    });
    await expect(consumptionDialog).toBeVisible({ timeout: 30_000 });
    await consumptionDialog.getByRole("button", { name: "Skip" }).click();

    // Skipping navigates to the new brew log.
    await page.waitForURL("**/production/brew-logs/**", { timeout: 30_000 });

    // The brew log and its link to the batch exist server-side.
    const { data: links } = await seed
      .from("brew_log_batches")
      .select("brew_log_id, volume_bbl")
      .eq("batch_id", PRODUCTION_IDS.batch);
    expect(links).toHaveLength(1);
    expect(Number(links![0].volume_bbl)).toBe(10);

    const { data: brewLog } = await seed
      .from("brew_logs")
      .select("brew_number, status, brew_date")
      .eq("id", links![0].brew_log_id)
      .single();
    // Created already in_progress: the user explicitly started the brew day.
    expect(brewLog!.status).toBe("in_progress");
    // Server-assigned by generate_brew_number(): BRW-YYYY-DDD, optionally
    // with a dedup suffix when several brews land on the same day.
    expect(brewLog!.brew_number).toMatch(/^BRW-\d{4}-\d{3}/);

    // Step 4: advance planned -> fermenting -> conditioning. These are generic
    // transitions with no named action, so they live in the Actions dropdown.
    //
    // Each iteration waits on the RECORD, not on the UI. Clicking a menu item
    // closes the dropdown immediately, so "the menu item is gone" is true the
    // instant it is clicked and says nothing about whether the transition
    // round trip finished — waiting on that let the next iteration open a
    // stale menu and miss its target.
    const advances = [
      ["Move to Fermenting", "fermenting"],
      ["Move to Conditioning", "conditioning"],
    ] as const;
    for (const [label, expectedStatus] of advances) {
      // Reload each iteration. It gives the menu a record that already
      // reflects the previous transition, and it clears the sonner toasts —
      // which are fixed top-right, directly over this "Actions" button, and
      // otherwise swallow the click (see clickUnderToasts in e2e/ui.ts; the
      // Actions trigger is a Radix DropdownMenuTrigger that opens on
      // pointerdown, so a dispatched click would not open it).
      await page.goto(`/production/batches/${PRODUCTION_IDS.batch}`);
      await page.getByRole("button", { name: "Actions" }).click();
      await page.getByRole("menuitem", { name: label }).click();
      await expect
        .poll(
          async () => {
            const { data } = await seed
              .from("batches")
              .select("status")
              .eq("id", PRODUCTION_IDS.batch)
              .single();
            return data?.status;
          },
          { timeout: 30_000 },
        )
        .toBe(expectedStatus);
    }

    // Step 5: Start Packaging is offered only from `conditioning`. It creates
    // the session AND moves the batch, so it is the true recipe->package link.
    await page.reload();
    await page.getByRole("button", { name: "Start Packaging" }).click();
    const packagingDialog = page.getByRole("dialog", {
      name: /start packaging/i,
    });
    await expect(packagingDialog).toBeVisible();
    await pickComboboxOption(page, "Select format", PRODUCTION_FORMAT_NAME);
    await packagingDialog
      .getByPlaceholder("e.g. 30")
      .fill(String(PRODUCTION_PACKAGE_QUANTITY));
    await packagingDialog
      .getByRole("button", { name: "Create Session" })
      .click();
    await expect(packagingDialog).not.toBeVisible({ timeout: 30_000 });

    // Step 6: the chain's end state, asserted DB-side.
    await expect
      .poll(
        async () => {
          const { data } = await seed
            .from("batches")
            .select("status")
            .eq("id", PRODUCTION_IDS.batch)
            .single();
          return data?.status;
        },
        { timeout: 30_000 },
      )
      .toBe("packaging");

    const { data: lineItems } = await seed
      .from("session_line_items")
      .select("session_id, brand_id, selling_format_id, planned_quantity")
      .eq("batch_id", PRODUCTION_IDS.batch);
    expect(lineItems).toHaveLength(1);
    expect(lineItems![0].brand_id).toBe(PRODUCTION_IDS.brand);
    expect(lineItems![0].selling_format_id).toBe(PRODUCTION_IDS.format);
    expect(lineItems![0].planned_quantity).toBe(PRODUCTION_PACKAGE_QUANTITY);

    const { data: session } = await seed
      .from("packaging_sessions")
      .select("status")
      .eq("id", lineItems![0].session_id)
      .single();
    expect(session!.status).toBe("planned");
  });
});
