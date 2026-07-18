/**
 * E2E tests for the core production workflow.
 *
 * These tests verify basic navigation to production-domain list pages
 * and include a skipped scaffold for the full recipe-to-package flow.
 */
import { test, expect } from "@playwright/test";

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

  // SKIPPED (tracked in #437): the recipe, transfer, and packaging legs of
  // this chain are now individually covered — recipe editing by
  // recipe-editor.spec.ts, vessel transfer + state advance by
  // batch-transfer.spec.ts, and the packaging completion trigger at the SQL
  // layer by src/__tests__/integration/packaging-completion-trigger.test.ts
  // (its UI leg is schema-drift-blocked; see packaging-session.spec.ts). The
  // remaining value here is the single uninterrupted recipe->package chain,
  // which stays tracked in #437.
  test.skip("full production workflow: recipe -> batch -> brew log -> package", async ({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    page,
  }) => {
    // Step 1: Navigate to recipes, find or create a recipe
    // Step 2: Navigate to batches, create batch from recipe
    // Step 3: Start brew day from batch detail
    // Step 4: Add brew readings
    // Step 5: Transition through states
    // Step 6: Create packaging session
    // Step 7: Verify finished goods
  });
});
