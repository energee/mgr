/**
 * Service-role seed helpers for Playwright E2E specs (issue #437).
 *
 * The local Supabase stack starts with migrations only ([db.seed] enabled =
 * false in supabase/config.toml), so every E2E flow must self-seed. These
 * helpers give specs a PostgREST client authenticated with the service-role
 * key (bypasses RLS) plus deterministic fixtures.
 *
 * Conventions:
 *  - Per-spec deterministic UUID namespaces (playwright.config.ts runs specs
 *    fullyParallel against one shared database): batch-transfer uses
 *    `e2e00001-…`, recipe-editor `e2e00002-…`. New specs must claim a fresh
 *    second segment.
 *  - Seed in beforeAll of a describe block that contains a SINGLE test, so
 *    only one worker ever runs the hooks (fullyParallel schedules tests, not
 *    files, onto workers — two workers running the same file's hooks would
 *    race the delete/insert cycle).
 *  - Cleanup first, then insert: a crashed previous run leaves rows in
 *    advanced states (e.g. a fermenting batch) that state-machine triggers
 *    would block an upsert from resetting, so delete-and-recreate is the only
 *    idempotent reset. Run cleanup again in afterAll.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the process
 * env when set, else parsed from .env.local / .env at the repo root (the same
 * files `bun dev` feeds Next).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Minimal KEY=VALUE parser for .env.local/.env (no dotenv dependency). */
function readEnvFile(name: string): Record<string, string> {
  try {
    const raw = readFileSync(join(process.cwd(), name), "utf8");
    const out: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      out[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

function resolveEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  // .env.local wins over .env, matching Next's precedence.
  return readEnvFile(".env.local")[key] ?? readEnvFile(".env")[key];
}

/**
 * Service-role Supabase client for seeding and out-of-band assertions.
 * Bypasses RLS; use only from test hooks, never from application code.
 */
export function createSeedClient(): SupabaseClient {
  const url = resolveEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = resolveEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error(
      "E2E seeding requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
        "(from the environment or .env.local — run `supabase start` first)."
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Throws with context when a seed/cleanup PostgREST call fails. */
function assertOk(step: string, error: { message: string } | null): void {
  if (error) throw new Error(`E2E seed step "${step}" failed: ${error.message}`);
}

// =============================================================================
// Batch-transfer spec fixtures (namespace e2e00001-…)
// =============================================================================

export const TRANSFER_IDS = {
  fermenter: "e2e00001-0000-4000-8000-000000000001",
  brite: "e2e00001-0000-4000-8000-000000000002",
  batch: "e2e00001-0000-4000-8000-000000000003",
} as const;

export const TRANSFER_BATCH_CODE = "E2E-XFER-437";
export const TRANSFER_FERMENTER_NAME = "E2E Fermenter 437";

/**
 * Removes every row the batch-transfer spec creates, in FK-safe order
 * (vessels.current_batch_id references batches, so vessels are detached
 * before the batch row is deleted). Safe to run when nothing exists.
 */
export async function cleanupTransferFixtures(seed: SupabaseClient): Promise<void> {
  const vesselIds = [TRANSFER_IDS.fermenter, TRANSFER_IDS.brite];
  assertOk(
    "detach vessels",
    (await seed.from("vessels").update({ current_batch_id: null }).in("id", vesselIds)).error
  );
  assertOk(
    "delete vessel_transfers",
    (await seed.from("vessel_transfers").delete().eq("batch_id", TRANSFER_IDS.batch)).error
  );
  assertOk(
    "delete batch",
    (await seed.from("batches").delete().eq("id", TRANSFER_IDS.batch)).error
  );
  assertOk(
    "delete vessels",
    (await seed.from("vessels").delete().in("id", vesselIds)).error
  );
}

/** Seeds two ready_for_use vessels (a fermenter and a brite tank). */
export async function seedVessels(seed: SupabaseClient): Promise<void> {
  assertOk(
    "insert vessels",
    (
      await seed.from("vessels").insert([
        {
          id: TRANSFER_IDS.fermenter,
          name: TRANSFER_FERMENTER_NAME,
          vessel_type: "fermenter",
          capacity_bbl: 20,
          status: "ready_for_use",
          is_active: true,
        },
        {
          id: TRANSFER_IDS.brite,
          name: "E2E Brite 437",
          vessel_type: "brite",
          capacity_bbl: 20,
          status: "ready_for_use",
          is_active: true,
        },
      ])
    ).error
  );
}

/**
 * Seeds the spec's batch in the given state (INSERTed directly at that
 * status — the state-machine trigger only validates UPDATEs).
 */
export async function seedBatchInState(seed: SupabaseClient, status: string): Promise<void> {
  assertOk(
    "insert batch",
    (
      await seed.from("batches").insert({
        id: TRANSFER_IDS.batch,
        batch_code: TRANSFER_BATCH_CODE,
        name: "E2E Transfer Batch",
        status,
        volume_bbl: 10,
      })
    ).error
  );
}

// =============================================================================
// Recipe-editor spec fixtures (namespace e2e00002-…)
// =============================================================================

export const RECIPE_MALT_ID = "e2e00002-0000-4000-8000-000000000001";
export const RECIPE_MALT_NAME = "E2E Pale Malt 437";
export const RECIPE_ID = "e2e00002-0000-4000-8000-000000000002";
/** All recipes the spec touches use this prefix so cleanup can find them. */
export const RECIPE_NAME_PREFIX = "E2E Recipe ";

/** Removes recipes the spec created through the UI plus the seeded malt. */
export async function cleanupRecipeFixtures(seed: SupabaseClient): Promise<void> {
  assertOk(
    "delete recipe_malts",
    (await seed.from("recipe_malts").delete().eq("malt_id", RECIPE_MALT_ID)).error
  );
  assertOk(
    "delete recipes",
    (await seed.from("recipes").delete().like("name", `${RECIPE_NAME_PREFIX}%`)).error
  );
  assertOk(
    "delete malt",
    (await seed.from("malts").delete().eq("id", RECIPE_MALT_ID)).error
  );
}

/**
 * Seeds the recipe row the editor flow drives. Seeded directly (not through
 * /production/recipes/new) because the universal create form initializes its
 * optional select fields to "" while recipeSchema's `.uuid()` fields reject
 * "" with "Invalid UUID" — with an empty local catalog there is no option to
 * pick, so the form cannot submit at all. That form/schema mismatch is an
 * app-level issue (tracked in #437); the recipe EDITOR is this spec's
 * subject.
 */
export async function seedRecipe(seed: SupabaseClient, name: string): Promise<void> {
  assertOk(
    "insert recipe",
    (
      await seed.from("recipes").insert({
        id: RECIPE_ID,
        name,
        volume_bbl: 10,
        is_active: true,
      })
    ).error
  );
}

/** Seeds one base malt so the grain-bill "Add Malt" picker has a catalog. */
export async function seedMaltCatalog(seed: SupabaseClient): Promise<void> {
  assertOk(
    "insert malt",
    (
      await seed.from("malts").insert({
        id: RECIPE_MALT_ID,
        name: RECIPE_MALT_NAME,
        maltster: "E2E Maltings",
        type: "base",
        color_lovibond: 2,
        potential_ppg: 37,
        is_active: true,
      })
    ).error
  );
}
