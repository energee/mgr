/**
 * Teardown for the `setup-portal` project (#810).
 *
 * `portal-auth.setup.ts` seeds a real customer, order, portal link and
 * `auth.users` row. Without teardown those fixtures persist on a shared local
 * dev database after `bun e2e` and show up in staff lists. This runs once,
 * after every project depending on `setup-portal` finishes, and removes them.
 */
import { rm } from "node:fs/promises";
import { test as teardown } from "@playwright/test";
import { createSeedClient, cleanupPortalFixtures } from "./seed";

teardown("cleanup portal fixtures", async () => {
  await cleanupPortalFixtures(createSeedClient());
  // The stored session belongs to the auth user just deleted; leaving it
  // makes a later `--project=chromium-portal --no-deps` rerun fail with an
  // unexplained login redirect instead of a fresh setup.
  await rm("e2e/.auth/portal.json", { force: true });
});
