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
 *    `e2e00001-…`, recipe-editor `e2e00002-…`, packaging-session `e2e00003-…`,
 *    customer-order `e2e00004-…`, production-workflow `e2e00005-…`, portal auth
 *    `e2e00006-…`. New specs must claim a fresh second segment.
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
 * Hostnames reachable only on the machine running the tests. Mirrors
 * `LOOPBACK_HOSTNAMES` in `src/app/api/auth/dev-login/route.ts` and the local
 * target list in `playwright.config.ts`. `new URL()` reports an IPv6 host in
 * brackets and `[::1]` is the only form it can yield, so no bare variant.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Refuses to seed a database that is not addressed by a loopback hostname.
 *
 * These helpers do delete-and-recreate resets by construction (see the header),
 * so pointing them at a shared project destroys data. The hazard is not
 * hypothetical: `resolveEnv` falls back to the repo-root `.env`, and this
 * repo's `.env` holds the HOSTED project's URL and service-role key. A
 * developer running `bun e2e` locally without exporting the local stack's
 * values would otherwise have run every `cleanup*Fixtures` call against
 * production — silently, because a service-role client bypasses RLS and the
 * deletes would simply succeed.
 *
 * Same shape and rationale as the `E2E_DEV_LOGIN` loopback condition (#656),
 * and the same caveat: loopback constrains the network path, not the value of
 * the data behind it. A tunnel or local proxy in front of a real database
 * still presents a loopback hostname. It is a guard against the common
 * accident, not a proof of disposability.
 *
 * `E2E_ALLOW_REMOTE_SEED=1` opts out, for the deliberate case of seeding a
 * remote target. Being unset is off; only exactly "1" counts.
 */
function assertSeedTargetIsLocal(url: string): void {
  if (process.env.E2E_ALLOW_REMOTE_SEED === "1") return;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`E2E seeding: unparseable NEXT_PUBLIC_SUPABASE_URL "${url}".`);
  }
  if (LOOPBACK_HOSTNAMES.has(hostname)) return;
  throw new Error(
    `E2E seeding refused: "${hostname}" is not a loopback host. These helpers ` +
      "delete and recreate rows, so they only run against a local stack. Note " +
      "that the repo-root .env points at the HOSTED project — export the local " +
      "stack's NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (see " +
      "`supabase status -o env`), or set E2E_ALLOW_REMOTE_SEED=1 if you really " +
      "mean to seed a remote database."
  );
}

/**
 * Service-role Supabase client for seeding and out-of-band assertions.
 * Bypasses RLS; use only from test hooks, never from application code.
 *
 * Throws unless the target is loopback — see `assertSeedTargetIsLocal`.
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
  assertSeedTargetIsLocal(url);
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

// =============================================================================
// Packaging-session spec fixtures (namespace e2e00003-…)
// =============================================================================

export const PACKAGING_IDS = {
  brand: "e2e00003-0000-4000-8000-000000000001",
  container: "e2e00003-0000-4000-8000-000000000002",
  format: "e2e00003-0000-4000-8000-000000000003",
  recipe: "e2e00003-0000-4000-8000-000000000004",
  batch: "e2e00003-0000-4000-8000-000000000005",
  session: "e2e00003-0000-4000-8000-000000000006",
} as const;

const PACKAGING_BRAND_NAME = "E2E Packaging Brand 437";
export const PACKAGING_BATCH_CODE = "E2E-PKG-437";
export const PACKAGING_FORMAT_NAME = "E2E 4-Pack 437";
/**
 * Quantity the spec types into BOTH planned and actual. They must match:
 * `computePackagingLoss` treats planned-minus-actual as an implied packaging
 * loss and queues a blocking RecordLossDialog per batch, which disables
 * "Confirm Completion" until it is answered. Equal quantities keep the flow
 * to the path under test.
 */
export const PACKAGING_QUANTITY = 24;

/**
 * Removes every row the packaging-session spec creates or causes to be
 * created, in FK-safe order. The completion trigger
 * (`create_finished_goods_from_packaging`) writes finished_goods with
 * generated ids, plus an allocations row and possibly a bin_inventory
 * placement, so those are resolved by lookup rather than by fixed id.
 * Safe to run when nothing exists.
 *
 * ONE ROW IS DELIBERATELY LEFT BEHIND: the `completed` batch -> finished_good
 * allocation the trigger writes. `prevent_completed_allocation_delete` refuses
 * to delete completed allocations, and `completed` is terminal in the
 * allocations transition map, so the status cannot be moved out of the way
 * first either. That is an inventory-integrity control (stock changes stay
 * traceable) and test cleanup is not a reason to weaken it — so cleanup
 * removes only non-completed allocations. This does not compromise repeat
 * runs: CI starts from a fresh database, and the spec's assertions key on the
 * finished-good id created by the run in progress, so a leftover row from a
 * previous local run can neither satisfy nor break them.
 */
export async function cleanupPackagingFixtures(seed: SupabaseClient): Promise<void> {
  const { data: fgRows, error: fgLookupError } = await seed
    .from("finished_goods")
    .select("id")
    .eq("batch_id", PACKAGING_IDS.batch);
  assertOk("lookup finished_goods", fgLookupError);
  const fgIds = (fgRows ?? []).map((row) => row.id as string);

  if (fgIds.length > 0) {
    assertOk(
      "delete bin_inventory",
      (await seed.from("bin_inventory").delete().in("finished_good_id", fgIds)).error
    );
    // allocations is polymorphic (no FK), so both endpoints are cleared.
    assertOk(
      "delete allocations by destination",
      (
        await seed
          .from("allocations")
          .delete()
          .in("destination_id", fgIds)
          .neq("status", "completed")
      ).error
    );
  }
  assertOk(
    "delete allocations by source",
    (
      await seed
        .from("allocations")
        .delete()
        .eq("source_id", PACKAGING_IDS.batch)
        .neq("status", "completed")
    ).error
  );
  assertOk(
    "delete finished_goods",
    (await seed.from("finished_goods").delete().eq("batch_id", PACKAGING_IDS.batch)).error
  );
  assertOk(
    "delete session_line_items",
    (await seed.from("session_line_items").delete().eq("session_id", PACKAGING_IDS.session)).error
  );
  assertOk(
    "delete packaging_session",
    (await seed.from("packaging_sessions").delete().eq("id", PACKAGING_IDS.session)).error
  );
  assertOk(
    "delete packaging batch",
    (await seed.from("batches").delete().eq("id", PACKAGING_IDS.batch)).error
  );
  assertOk(
    "delete packaging recipe",
    (await seed.from("recipes").delete().eq("id", PACKAGING_IDS.recipe)).error
  );
  assertOk(
    "delete selling_format",
    (await seed.from("selling_formats").delete().eq("id", PACKAGING_IDS.format)).error
  );
  assertOk(
    "delete container",
    (await seed.from("containers").delete().eq("id", PACKAGING_IDS.container)).error
  );
  assertOk(
    "delete packaging brand",
    (await seed.from("brands").delete().eq("id", PACKAGING_IDS.brand)).error
  );
}

/**
 * Seeds brand -> container -> selling format -> recipe -> a `packaging`-state
 * batch -> one `planned` session with no line items (the spec adds the line
 * through the UI).
 *
 * The recipe exists because the quick-add row's batch picker
 * (`usePackagableBatches`) selects `recipes!inner(brand_id, …)` and drops rows
 * without a derivable brand — a batch with no recipe never appears in it.
 */
export async function seedPackagingFixtures(seed: SupabaseClient): Promise<void> {
  assertOk(
    "insert packaging brand",
    (await seed.from("brands").insert({ id: PACKAGING_IDS.brand, name: PACKAGING_BRAND_NAME, is_active: true })).error
  );
  assertOk(
    "insert container",
    (
      await seed.from("containers").insert({
        id: PACKAGING_IDS.container,
        name: "E2E 16oz Can 437",
        type: "package",
        volume_oz: 16,
        is_active: true,
      })
    ).error
  );
  assertOk(
    "insert selling_format",
    (
      await seed.from("selling_formats").insert({
        id: PACKAGING_IDS.format,
        container_id: PACKAGING_IDS.container,
        name: PACKAGING_FORMAT_NAME,
        unit_count: 4,
        is_active: true,
      })
    ).error
  );
  assertOk(
    "insert packaging recipe",
    (
      await seed.from("recipes").insert({
        id: PACKAGING_IDS.recipe,
        name: "E2E Packaging Recipe 437",
        brand_id: PACKAGING_IDS.brand,
        volume_bbl: 10,
        is_active: true,
      })
    ).error
  );
  // INSERTed straight at `packaging` — the state-machine trigger only
  // validates UPDATEs, and this spec's subject is the session, not the batch.
  assertOk(
    "insert packaging batch",
    (
      await seed.from("batches").insert({
        id: PACKAGING_IDS.batch,
        batch_code: PACKAGING_BATCH_CODE,
        name: "E2E Packaging Batch",
        recipe_id: PACKAGING_IDS.recipe,
        status: "packaging",
        volume_bbl: 10,
      })
    ).error
  );
  assertOk(
    "insert packaging_session",
    (
      await seed.from("packaging_sessions").insert({
        id: PACKAGING_IDS.session,
        session_date: new Date().toISOString().slice(0, 10),
        status: "planned",
      })
    ).error
  );
}

// =============================================================================
// Customer-order spec fixtures (namespace e2e00004-…)
// =============================================================================

export const ORDER_IDS = {
  customer: "e2e00004-0000-4000-8000-000000000001",
  brand: "e2e00004-0000-4000-8000-000000000002",
  container: "e2e00004-0000-4000-8000-000000000003",
  format: "e2e00004-0000-4000-8000-000000000004",
  order: "e2e00004-0000-4000-8000-000000000005",
  orderItem: "e2e00004-0000-4000-8000-000000000006",
} as const;

const ORDER_CUSTOMER_NAME = "E2E Order Customer 437";
const ORDER_BRAND_NAME = "E2E Order Brand 437";
export const ORDER_FORMAT_NAME = "E2E Order 4-Pack 437";
export const ORDER_NUMBER = "E2E-ORD-437";
/** Units on the order's single line item. */
export const ORDER_QUANTITY = 10;
/** Units in the seeded finished-goods lot — more than the order needs. */
export const ORDER_LOT_QUANTITY = 40;

/**
 * The fixture format is a CAN 4-pack, deliberately not a keg.
 *
 * Fulfilling an order containing keg formats fires
 * `trigger_order_fulfillment_keg_transactions` ->
 * `create_keg_ship_transactions_from_order`, which refuses the transition
 * unless matching filled kegs have been recorded ("only 0 filled keg(s) are
 * recorded. Record the packaging fill before fulfilling this order."). That is
 * correct domain behaviour, and covering it properly means seeding keg fills —
 * a separate flow from the one this spec is about. A package format keeps this
 * test on the allocate-and-fulfil path.
 */
export const ORDER_CONTAINER_VOLUME_OZ = 16;
export const ORDER_FORMAT_UNIT_COUNT = 4;
/** Fluid ounces per US beer barrel — the divisor transition_entity_atomic uses. */
export const OZ_PER_BBL = 3968;

/**
 * Lot-number prefix for this spec's finished goods.
 *
 * The finished_goods row gets a FRESH id every run rather than a fixed one
 * from the namespace, and this prefix is how cleanup finds it — the same
 * find-by-prefix idiom `RECIPE_NAME_PREFIX` uses for UI-created rows.
 *
 * The freshness is load-bearing, not stylistic. Fulfilling the order flips its
 * `planned` allocations to `completed` (transition_entity_atomic), and
 * `prevent_completed_allocation_delete` then refuses to delete them — see the
 * note on cleanupPackagingFixtures. `finished_goods_with_availability`
 * subtracts allocations from a lot's quantity, so if the lot kept a fixed id
 * across runs, run N+1 would rediscover run N's undeletable allocation against
 * that same id, compute `available_quantity` as 0, and find nothing for
 * "Auto-allocate (FIFO)" to fill. A fresh lot id per run leaves those orphans
 * pointing at a finished_goods row that no longer exists, so they join to
 * nothing and cannot affect availability.
 */
export const ORDER_LOT_PREFIX = "E2E-ORD-437-";

/** Ids the order fixture generates per run (see ORDER_LOT_PREFIX). */
export type OrderFixture = {
  /** The finished_goods lot the spec allocates from. */
  finishedGoodId: string;
};

/**
 * Removes every row the customer-order spec creates, in FK-safe order.
 *
 * As with the packaging fixtures, `completed` allocations are left in place
 * rather than weakening `prevent_completed_allocation_delete`; they are made
 * harmless by the fresh-lot-id scheme described on ORDER_LOT_PREFIX.
 * Safe to run when nothing exists.
 */
export async function cleanupOrderFixtures(seed: SupabaseClient): Promise<void> {
  const { data: lotRows, error: lotLookupError } = await seed
    .from("finished_goods")
    .select("id")
    .like("lot_number", `${ORDER_LOT_PREFIX}%`);
  assertOk("lookup order finished_goods", lotLookupError);
  const lotIds = (lotRows ?? []).map((row) => row.id as string);

  // Order-side reservations first (polymorphic: no FK, so they are not
  // cascaded by deleting either endpoint).
  assertOk(
    "delete order allocations",
    (
      await seed
        .from("allocations")
        .delete()
        .eq("destination_id", ORDER_IDS.order)
        .neq("status", "completed")
    ).error
  );
  if (lotIds.length > 0) {
    assertOk(
      "delete order bin_inventory",
      (await seed.from("bin_inventory").delete().in("finished_good_id", lotIds)).error
    );
    assertOk(
      "delete lot allocations",
      (
        await seed
          .from("allocations")
          .delete()
          .in("source_id", lotIds)
          .neq("status", "completed")
      ).error
    );
    assertOk(
      "delete pick_list_items",
      (await seed.from("pick_list_items").delete().in("finished_good_id", lotIds)).error
    );
  }
  assertOk(
    "delete order_items",
    (await seed.from("order_items").delete().eq("order_id", ORDER_IDS.order)).error
  );
  assertOk(
    "delete order",
    (await seed.from("orders").delete().eq("id", ORDER_IDS.order)).error
  );
  assertOk(
    "delete order finished_goods",
    (await seed.from("finished_goods").delete().like("lot_number", `${ORDER_LOT_PREFIX}%`)).error
  );
  assertOk(
    "delete order selling_format",
    (await seed.from("selling_formats").delete().eq("id", ORDER_IDS.format)).error
  );
  assertOk(
    "delete order container",
    (await seed.from("containers").delete().eq("id", ORDER_IDS.container)).error
  );
  assertOk(
    "delete order brand",
    (await seed.from("brands").delete().eq("id", ORDER_IDS.brand)).error
  );
  assertOk(
    "delete order customer",
    (await seed.from("customers").delete().eq("id", ORDER_IDS.customer)).error
  );
}

/**
 * Seeds customer -> brand -> container -> selling format -> an in-stock
 * finished-goods lot, plus a `draft` order with one line item for
 * ORDER_QUANTITY units of that brand/format.
 *
 * The lot is seeded directly rather than produced by a packaging session:
 * this spec's subject is the sales flow, and packaging-session.spec.ts already
 * covers lot creation. It carries no batch_id, which also keeps it out of the
 * batch -> finished_good allocation the packaging trigger would otherwise add.
 */
export async function seedOrderFixtures(seed: SupabaseClient): Promise<OrderFixture> {
  assertOk(
    "insert order customer",
    (
      await seed.from("customers").insert({
        id: ORDER_IDS.customer,
        name: ORDER_CUSTOMER_NAME,
        customer_type: "wholesale",
        email: "e2e-order-437@brewery.test",
        is_active: true,
      })
    ).error
  );
  assertOk(
    "insert order brand",
    (await seed.from("brands").insert({ id: ORDER_IDS.brand, name: ORDER_BRAND_NAME, is_active: true })).error
  );
  assertOk(
    "insert order container",
    (
      await seed.from("containers").insert({
        id: ORDER_IDS.container,
        name: "E2E Order 16oz Can 437",
        type: "package", // NOT "keg" — see ORDER_CONTAINER_VOLUME_OZ
        volume_oz: ORDER_CONTAINER_VOLUME_OZ,
        is_active: true,
      })
    ).error
  );
  assertOk(
    "insert order selling_format",
    (
      await seed.from("selling_formats").insert({
        id: ORDER_IDS.format,
        container_id: ORDER_IDS.container,
        name: ORDER_FORMAT_NAME,
        unit_count: ORDER_FORMAT_UNIT_COUNT,
        is_active: true,
      })
    ).error
  );

  // Fresh lot id + lot number every run — see ORDER_LOT_PREFIX.
  const finishedGoodId = crypto.randomUUID();
  assertOk(
    "insert order finished_good",
    (
      await seed.from("finished_goods").insert({
        id: finishedGoodId,
        brand_id: ORDER_IDS.brand,
        selling_format_id: ORDER_IDS.format,
        quantity: ORDER_LOT_QUANTITY,
        lot_number: `${ORDER_LOT_PREFIX}${Date.now()}`,
        production_date: new Date().toISOString().slice(0, 10),
      })
    ).error
  );

  assertOk(
    "insert order",
    (
      await seed.from("orders").insert({
        id: ORDER_IDS.order,
        order_number: ORDER_NUMBER,
        customer_id: ORDER_IDS.customer,
        status: "draft",
        order_date: new Date().toISOString().slice(0, 10),
        requested_date: new Date().toISOString().slice(0, 10),
      })
    ).error
  );
  assertOk(
    "insert order_item",
    (
      await seed.from("order_items").insert({
        id: ORDER_IDS.orderItem,
        order_id: ORDER_IDS.order,
        brand_id: ORDER_IDS.brand,
        selling_format_id: ORDER_IDS.format,
        quantity: ORDER_QUANTITY,
        unit_price: 150,
      })
    ).error
  );

  return { finishedGoodId };
}

// =============================================================================
// Production-workflow spec fixtures (namespace e2e00005-…)
// =============================================================================

export const PRODUCTION_IDS = {
  brand: "e2e00005-0000-4000-8000-000000000001",
  container: "e2e00005-0000-4000-8000-000000000002",
  format: "e2e00005-0000-4000-8000-000000000003",
  recipe: "e2e00005-0000-4000-8000-000000000004",
  batch: "e2e00005-0000-4000-8000-000000000005",
} as const;

const PRODUCTION_BRAND_NAME = "E2E Production Brand 437";
const PRODUCTION_RECIPE_NAME = "E2E Production Recipe 437";
export const PRODUCTION_BATCH_CODE = "E2E-PROD-437";
export const PRODUCTION_FORMAT_NAME = "E2E Production 6-Pack 437";
/** Units the spec enters into the Start Packaging dialog. */
export const PRODUCTION_PACKAGE_QUANTITY = 12;

/**
 * Removes every row the production-workflow spec creates or causes to be
 * created. The UI creates the brew log and the packaging session with
 * generated ids, so both are resolved by lookup through their link to the
 * fixture batch. Safe to run when nothing exists.
 */
export async function cleanupProductionFixtures(seed: SupabaseClient): Promise<void> {
  // Brew log <- link row <- batch. The link is the only path back to the
  // UI-created brew_logs row.
  const { data: linkRows, error: linkLookupError } = await seed
    .from("brew_log_batches")
    .select("brew_log_id")
    .eq("batch_id", PRODUCTION_IDS.batch);
  assertOk("lookup brew_log_batches", linkLookupError);
  const brewLogIds = (linkRows ?? []).map((row) => row.brew_log_id as string);

  assertOk(
    "delete brew_log_batches",
    (await seed.from("brew_log_batches").delete().eq("batch_id", PRODUCTION_IDS.batch)).error
  );
  if (brewLogIds.length > 0) {
    assertOk(
      "delete brew_logs",
      (await seed.from("brew_logs").delete().in("id", brewLogIds)).error
    );
  }

  // Packaging session <- line items <- batch (created by the Start Packaging
  // dialog). Sessions stay `planned` here — this spec never completes one —
  // so no finished goods or completed allocations are involved.
  const { data: lineRows, error: lineLookupError } = await seed
    .from("session_line_items")
    .select("session_id")
    .eq("batch_id", PRODUCTION_IDS.batch);
  assertOk("lookup production session_line_items", lineLookupError);
  const sessionIds = [
    ...new Set((lineRows ?? []).map((row) => row.session_id as string)),
  ];

  assertOk(
    "delete production session_line_items",
    (await seed.from("session_line_items").delete().eq("batch_id", PRODUCTION_IDS.batch)).error
  );
  if (sessionIds.length > 0) {
    assertOk(
      "delete production packaging_sessions",
      (await seed.from("packaging_sessions").delete().in("id", sessionIds)).error
    );
  }

  // Planned ingredient allocations from the brew-consumption step, if any.
  assertOk(
    "delete production allocations",
    (
      await seed
        .from("allocations")
        .delete()
        .eq("destination_id", PRODUCTION_IDS.batch)
        .neq("status", "completed")
    ).error
  );
  assertOk(
    "delete production batch_logs",
    (await seed.from("batch_logs").delete().eq("batch_id", PRODUCTION_IDS.batch)).error
  );
  assertOk(
    "delete production batch",
    (await seed.from("batches").delete().eq("id", PRODUCTION_IDS.batch)).error
  );
  assertOk(
    "delete production recipe",
    (await seed.from("recipes").delete().eq("id", PRODUCTION_IDS.recipe)).error
  );
  assertOk(
    "delete production selling_format",
    (await seed.from("selling_formats").delete().eq("id", PRODUCTION_IDS.format)).error
  );
  assertOk(
    "delete production container",
    (await seed.from("containers").delete().eq("id", PRODUCTION_IDS.container)).error
  );
  assertOk(
    "delete production brand",
    (await seed.from("brands").delete().eq("id", PRODUCTION_IDS.brand)).error
  );
}

/**
 * Seeds brand -> container -> selling format -> recipe -> a `planned` batch
 * linked to that recipe.
 *
 * The batch is the entry point of the chain the spec drives; everything after
 * it (brew log, packaging session) is created through the UI, which is the
 * point of the test.
 */
export async function seedProductionFixtures(seed: SupabaseClient): Promise<void> {
  assertOk(
    "insert production brand",
    (await seed.from("brands").insert({ id: PRODUCTION_IDS.brand, name: PRODUCTION_BRAND_NAME, is_active: true })).error
  );
  assertOk(
    "insert production container",
    (
      await seed.from("containers").insert({
        id: PRODUCTION_IDS.container,
        name: "E2E Production 12oz Can 437",
        type: "package",
        volume_oz: 12,
        is_active: true,
      })
    ).error
  );
  assertOk(
    "insert production selling_format",
    (
      await seed.from("selling_formats").insert({
        id: PRODUCTION_IDS.format,
        container_id: PRODUCTION_IDS.container,
        name: PRODUCTION_FORMAT_NAME,
        unit_count: 6,
        is_active: true,
      })
    ).error
  );
  assertOk(
    "insert production recipe",
    (
      await seed.from("recipes").insert({
        id: PRODUCTION_IDS.recipe,
        name: PRODUCTION_RECIPE_NAME,
        brand_id: PRODUCTION_IDS.brand,
        volume_bbl: 10,
        is_active: true,
      })
    ).error
  );
  assertOk(
    "insert production batch",
    (
      await seed.from("batches").insert({
        id: PRODUCTION_IDS.batch,
        batch_code: PRODUCTION_BATCH_CODE,
        name: "E2E Production Batch",
        recipe_id: PRODUCTION_IDS.recipe,
        status: "planned",
        volume_bbl: 10,
      })
    ).error
  );
}

// =============================================================================
// Portal-auth fixtures (namespace e2e00006-…)
// =============================================================================

export const PORTAL_IDS = {
  customer: "e2e00006-0000-4000-8000-000000000001",
  order: "e2e00006-0000-4000-8000-000000000002",
  // Brand -> container -> selling format -> in-stock lot. A portal customer
  // can only order what `get_portal_available_products()` (00292) returns, so
  // placing an order needs real unallocated stock; without it the order
  // builder's picker is empty and the flow cannot start.
  brand: "e2e00006-0000-4000-8000-000000000003",
  container: "e2e00006-0000-4000-8000-000000000004",
  format: "e2e00006-0000-4000-8000-000000000005",
} as const;

export const PORTAL_BRAND_NAME = "E2E Portal Brand 706";
export const PORTAL_FORMAT_NAME = "E2E Portal 6-Pack 706";
/** Units in the seeded lot — the per-line cap the order builder enforces. */
export const PORTAL_LOT_QUANTITY = 40;

export const PORTAL_CUSTOMER_NAME = "E2E Portal Customer 706";
/**
 * The portal user's email, and the customer's.
 *
 * They must match: `create_user_profile()` grants the 'customer' role — the
 * only role the portal layout accepts — by comparing the new auth user's email
 * against `customers.email` (migration 00201). A mismatch produces a 'viewer'
 * staff account that the portal locks out.
 */
export const PORTAL_USER_EMAIL = "e2e-portal-706@brewery.test";
export const PORTAL_ORDER_NUMBER = "E2E-PORTAL-706";

/**
 * Removes the portal user, its customer, and the seeded order.
 *
 * The auth user goes last: `customer_portal_users.user_id` and
 * `user_profiles.id` both cascade from `auth.users`, so deleting it cleans up
 * the link and the profile too. Safe to run when nothing exists.
 */
export async function cleanupPortalFixtures(seed: SupabaseClient): Promise<void> {
  // Every order for this customer, not just PORTAL_IDS.order: the placement
  // spec creates orders with server-generated ids and ORD- numbers, and those
  // would otherwise pin the customer row and fail the delete below.
  assertOk(
    "delete portal orders",
    (await seed.from("orders").delete().eq("customer_id", PORTAL_IDS.customer))
      .error
  );
  // Stock teardown runs child -> parent: finished_goods references both the
  // brand and the selling format, and selling_formats references the container.
  assertOk(
    "delete portal finished_goods",
    (await seed.from("finished_goods").delete().eq("brand_id", PORTAL_IDS.brand))
      .error
  );
  assertOk(
    "delete portal selling_format",
    (await seed.from("selling_formats").delete().eq("id", PORTAL_IDS.format))
      .error
  );
  assertOk(
    "delete portal container",
    (await seed.from("containers").delete().eq("id", PORTAL_IDS.container)).error
  );
  assertOk(
    "delete portal brand",
    (await seed.from("brands").delete().eq("id", PORTAL_IDS.brand)).error
  );
  assertOk(
    "delete portal customer",
    (await seed.from("customers").delete().eq("id", PORTAL_IDS.customer)).error
  );

  // listUsers() defaults to perPage: 50. On a local dev database with more
  // auth users than that, the portal user falls off page 1, cleanup silently
  // no-ops, and the createUser below then hard-fails on the duplicate email —
  // an error that never names the real cause.
  const { data: list, error: listError } = await seed.auth.admin.listUsers({ perPage: 1000 });
  assertOk("list auth users", listError);
  const existing = list?.users.find(
    (user) => user.email?.toLowerCase() === PORTAL_USER_EMAIL
  );
  if (existing) {
    assertOk("delete portal auth user", (await seed.auth.admin.deleteUser(existing.id)).error);
  }
}

/**
 * Seeds a portal customer, an auth user for it, the junction row that grants
 * portal access, and one order so the orders list has a row to assert on.
 *
 * Order matters: the customer row must exist BEFORE the auth user is created,
 * because the profile trigger reads it to decide the role (see
 * PORTAL_USER_EMAIL). `email_confirm: true` skips the confirmation mail, so
 * the only email in the mailbox is the sign-in code the setup project reads.
 *
 * The link row is written explicitly rather than left to the portal layout's
 * first-login auto-link, so the fixture is one deterministic state instead of
 * a side effect of the page under test.
 */
export async function seedPortalFixtures(seed: SupabaseClient): Promise<void> {
  assertOk(
    "insert portal customer",
    (
      await seed.from("customers").insert({
        id: PORTAL_IDS.customer,
        name: PORTAL_CUSTOMER_NAME,
        customer_type: "wholesale",
        email: PORTAL_USER_EMAIL,
        is_active: true,
      })
    ).error
  );

  const { data: created, error: createError } = await seed.auth.admin.createUser({
    email: PORTAL_USER_EMAIL,
    email_confirm: true,
  });
  assertOk("create portal auth user", createError);
  const userId = created?.user?.id;
  if (!userId) throw new Error('E2E seed step "create portal auth user" returned no user.');

  assertOk(
    "insert portal link",
    (
      await seed.from("customer_portal_users").insert({
        customer_id: PORTAL_IDS.customer,
        user_id: userId,
      })
    ).error
  );
  assertOk(
    "insert portal order",
    (
      await seed.from("orders").insert({
        id: PORTAL_IDS.order,
        customer_id: PORTAL_IDS.customer,
        order_number: PORTAL_ORDER_NUMBER,
        status: "draft",
      })
    ).error
  );

  // Orderable stock. Seeded directly rather than produced by a packaging
  // session — packaging-session.spec.ts already covers lot creation, and the
  // subject here is order placement. No batch_id, which keeps it out of the
  // batch -> finished_good allocation the packaging trigger would add.
  assertOk(
    "insert portal brand",
    (
      await seed
        .from("brands")
        .insert({ id: PORTAL_IDS.brand, name: PORTAL_BRAND_NAME, is_active: true })
    ).error
  );
  assertOk(
    "insert portal container",
    (
      await seed.from("containers").insert({
        id: PORTAL_IDS.container,
        name: "E2E Portal 12oz Can 706",
        type: "package",
        volume_oz: 12,
        is_active: true,
      })
    ).error
  );
  assertOk(
    "insert portal selling_format",
    (
      await seed.from("selling_formats").insert({
        id: PORTAL_IDS.format,
        container_id: PORTAL_IDS.container,
        name: PORTAL_FORMAT_NAME,
        unit_count: 6,
        is_active: true,
      })
    ).error
  );
  assertOk(
    "insert portal finished_good",
    (
      await seed.from("finished_goods").insert({
        brand_id: PORTAL_IDS.brand,
        selling_format_id: PORTAL_IDS.format,
        quantity: PORTAL_LOT_QUANTITY,
        lot_number: `E2E-PORTAL-LOT-${Date.now()}`,
        production_date: new Date().toISOString().slice(0, 10),
      })
    ).error
  );
}
