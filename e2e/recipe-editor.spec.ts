/**
 * E2E smoke tests for the recipe editor — F134 verification surface.
 *
 * Smoke level: navigates to /production/recipes and a recipe detail.
 * Deeper flow (create -> edit grain bill -> save -> verify estimates) is
 * scaffolded as test.skip below, pending seed data.
 */
import { test, expect } from "@playwright/test";

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

  test.skip("full recipe editing flow", async () => {
    // TODO: requires seed recipes
    // Step 1: navigate to recipes list, click first row
    // Step 2: change name, save (recipe-basics-section auto-saves)
    // Step 3: add a grain to the grain bill, save
    // Step 4: verify live OG/FG/ABV/IBU estimates update
    // Step 5: drag-and-drop reorder the hop schedule (PR #246)
    // Step 6: refresh — verify all changes persisted
  });
});
