/**
 * E2E tests for the recipe editor — F134 verification surface.
 *
 * Smoke level: navigates to /production/recipes and the create form. Full
 * flow: opens a seeded recipe (recipe + malt catalog seeded via e2e/seed.ts
 * — the local stack starts with no catalog data), renames it, adds a grain,
 * asserts the live estimates react, and verifies persistence across a
 * reload.
 */
import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSeedClient,
  cleanupRecipeFixtures,
  seedMaltCatalog,
  seedRecipe,
  RECIPE_ID,
  RECIPE_MALT_NAME,
  RECIPE_NAME_PREFIX,
} from "./seed";

test.describe("Recipe editor", () => {
  test("recipes list renders", async ({ page }) => {
    await page.goto("/production/recipes");
    await expect(
      page.getByRole("heading", { name: /recipes/i }),
    ).toBeVisible();
  });

  test("new recipe page renders", async ({ page }) => {
    await page.goto("/production/recipes/new");
    // Recipe editor uses a custom two-column layout, not EntityDetailUnified.
    await expect(page.locator("body")).toContainText(/recipe/i);
  });
});

// Single-test describe: with fullyParallel only one worker ever runs these
// hooks, so the delete-and-recreate seeding cannot race itself (e2e/seed.ts).
test.describe("Recipe editor — full flow", () => {
  // Lazily initialized in beforeAll: if env resolution fails (no .env.local /
  // stack not started), only this describe fails — the smoke tests above
  // still collect and run.
  let seed: SupabaseClient;
  const recipeName = `${RECIPE_NAME_PREFIX}437`;

  test.beforeAll(async () => {
    seed = createSeedClient();
    await cleanupRecipeFixtures(seed); // reset leftovers from a crashed run
    await seedMaltCatalog(seed);
    // The recipe row is seeded, not created via /production/recipes/new: the
    // universal create form cannot submit against an empty catalog (optional
    // select fields initialize to "", which recipeSchema's .uuid() fields
    // reject as "Invalid UUID", and there are no options to pick instead) —
    // an app-level form/schema mismatch tracked in #437. The editor below is
    // this spec's subject.
    await seedRecipe(seed, recipeName);
  });

  test.afterAll(async () => {
    if (!seed) return; // beforeAll failed before the client existed
    await cleanupRecipeFixtures(seed);
  });

  test("full recipe editing flow", async ({ page }) => {
    // Step 1: open the seeded recipe in the purpose-built editor.
    await page.goto(`/production/recipes/${RECIPE_ID}`);

    // The header Save button renders only while a section is dirty (and
    // unmounts once the aggregate save commits) — its disappearance is the
    // reliable "saved" signal, immune to stacked toasts.
    const saveButton = page.getByRole("button", { name: "Save", exact: true });

    // Step 2: rename in the basics section and save.
    const renamed = `${recipeName} v2`;
    const nameInput = page.locator("#recipe-name");
    await expect(nameInput).toHaveValue(recipeName, { timeout: 30_000 });
    await nameInput.fill(renamed);
    await saveButton.click();
    await expect(saveButton).toBeHidden({ timeout: 15_000 });

    // Live-estimates sidebar, scoped to its "Estimates" heading so the
    // mobile estimates bar (same labels, hidden on desktop) never collides.
    const estimatesCard = page
      .locator("div.rounded-lg")
      .filter({ has: page.getByRole("heading", { name: "Estimates" }) });
    const ogValue = estimatesCard
      .locator("div.rounded-md")
      .filter({ hasText: "OG" })
      .locator("div.font-mono");
    const fgValue = estimatesCard
      .locator("div.rounded-md")
      .filter({ hasText: "FG" })
      .locator("div.font-mono");

    // Step 3: with an empty grain bill every estimate is an em dash.
    await expect(ogValue).toHaveText("—");

    // Step 4: add a grain to the grain bill and give it a weight
    // (800 lbs in a 10 bbl recipe ≈ OG 1.072).
    await page.getByRole("button", { name: /add malt/i }).click();
    await page.getByPlaceholder("Search malts...").fill("E2E Pale");
    await page.getByRole("option", { name: new RegExp(RECIPE_MALT_NAME) }).click();
    const grainRow = page.getByRole("row").filter({ hasText: RECIPE_MALT_NAME });
    await grainRow.getByRole("spinbutton").fill("800");

    // Live estimates react to the in-editor state: OG/FG/ABV turn numeric.
    // Gravity is asserted unit-agnostically — the display honors the user's
    // gravity unit preference (SG "1.072" vs Plato "17.4°P"). (IBU stays "—"
    // — it needs hops, and the hop schedule, including its drag-and-drop
    // reorder, is deliberately out of scope here: the reorder interaction is
    // a flake magnet; tracked in #437.)
    await expect(ogValue).toHaveText(/\d/, { timeout: 15_000 });
    await expect(fgValue).toHaveText(/\d/);
    await expect(estimatesCard.locator(".text-3xl")).toHaveText(/\d(\.\d+)?%/);

    // Step 5: save the grain bill, reload, and verify everything persisted.
    await saveButton.click();
    await expect(saveButton).toBeHidden({ timeout: 15_000 });

    await page.reload();
    await expect(page.locator("#recipe-name")).toHaveValue(renamed, {
      timeout: 30_000,
    });
    await expect(
      page.getByRole("row").filter({ hasText: RECIPE_MALT_NAME }).getByRole("spinbutton"),
    ).toHaveValue("800", { timeout: 15_000 });
    await expect(ogValue).toHaveText(/\d/, { timeout: 15_000 });
  });
});
