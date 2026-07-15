/**
 * MongoDB sync orchestrator tests — syncRecipes destructive re-sync safety
 * (audit SF-5).
 *
 * syncRecipes is delete-then-rebuild (recipes + recipe_malts/hops/yeasts have
 * no UNIQUE(name) to upsert against). These tests pin the hardened contract:
 *
 *   (1) Happy path: all FK lookups resolve, junctions cleared then rebuilt
 *       with resolved PG UUIDs, sync log completed as success.
 *   (2) A FAILED FK-lookup read (Supabase error) aborts BEFORE any delete —
 *       previously a transient read failure was treated as "no rows" and every
 *       recipe was rebuilt with NULL FKs after the originals were gone.
 *   (3) An EMPTY lookup map that the Mongo data references (e.g. phase 1 never
 *       ran, so `brands` is empty) also refuses the destructive rebuild.
 *
 * createAdminClient is faked with the shared admin mock
 * (src/test/supabase-admin-mock.ts); the Mongo Db handle with a tiny
 * collection stub. The logger is silenced.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { makeAdminMock, type TableData, type Write } from "@/test/supabase-admin-mock";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../client", () => ({
  getMongoDb: vi.fn(),
  getMongoClient: vi.fn(),
  closeMongoClient: vi.fn(),
  testConnection: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { getMongoDb } from "../client";
import { syncEntity } from "../sync";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedGetMongoDb = vi.mocked(getMongoDb);
const mockedLoggerWarn = vi.mocked(logger.warn);
const mockedLoggerError = vi.mocked(logger.error);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STYLE_OID = new ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa");
const BEER_OID = new ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb");
const MALT_OID = new ObjectId("cccccccccccccccccccccccc");
const HOP_OID = new ObjectId("dddddddddddddddddddddddd");
const YEAST_OID = new ObjectId("eeeeeeeeeeeeeeeeeeeeeeee");
const RECIPE_OID = new ObjectId("ffffffffffffffffffffffff");

/** One Mongo recipe referencing every FK-lookup kind (style/brand/malt/hop/yeast). */
const MONGO_COLLECTIONS: Record<string, unknown[]> = {
  recipes: [
    {
      _id: RECIPE_OID,
      name: "Hazy IPA",
      beer: BEER_OID,
      style: STYLE_OID,
      yeast: YEAST_OID,
      malts: [{ malt: MALT_OID, weight: 10 }],
      hops: [{ hop: HOP_OID, weight: 1, hopTiming: "dry-hop" }],
    },
  ],
  styles: [{ _id: STYLE_OID, name: "IPA" }],
  beers: [{ _id: BEER_OID, name: "Cloud Cover" }],
  malts: [{ _id: MALT_OID, name: "Pilsner" }],
  hops: [{ _id: HOP_OID, name: "Citra" }],
  yeasts: [{ _id: YEAST_OID, name: "London Ale III" }],
};

/** Minimal Mongo Db stub: collection(name).find()[.sort()].toArray(). */
function makeDb(collections: Record<string, unknown[]>): Db {
  const cursor = (name: string) => ({
    toArray: async () => collections[name] ?? [],
    sort: () => ({ toArray: async () => collections[name] ?? [] }),
  });
  return {
    collection: (name: string) => ({ find: () => cursor(name) }),
  } as unknown as Db;
}

/** PG tables with every FK lookup resolving; override per test. */
function pgTables(overrides: TableData = {}): TableData {
  return {
    mongodb_sync_log: { data: { id: "log-1" }, error: null },
    beer_styles: { data: [{ id: "pg-style-1", name: "IPA" }], error: null },
    brands: { data: [{ id: "pg-brand-1", name: "Cloud Cover" }], error: null },
    malts: { data: [{ id: "pg-malt-1", name: "Pilsner" }], error: null },
    hops: { data: [{ id: "pg-hop-1", name: "Citra" }], error: null },
    yeasts: { data: [{ id: "pg-yeast-1", name: "London Ale III" }], error: null },
    // Served to the post-insert name → UUID read for junction FKs.
    recipes: { data: [{ id: "pg-recipe-1", name: "Hazy IPA" }], error: null },
    recipe_malts: { data: [], error: null },
    recipe_hops: { data: [], error: null },
    recipe_yeasts: { data: [], error: null },
    ...overrides,
  };
}

function setup(overrides: TableData = {}): Write[] {
  const { admin, writes } = makeAdminMock(pgTables(overrides), { onUnknownTable: "throw" });
  mockedCreateAdminClient.mockResolvedValue(admin as never);
  mockedGetMongoDb.mockResolvedValue(makeDb(MONGO_COLLECTIONS));
  return writes;
}

const deletes = (writes: Write[]) => writes.filter((w) => w.op === "delete");
const upsertFor = (writes: Write[], table: string) =>
  writes.find((w) => w.op === "upsert" && w.table === table);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncRecipes (via syncEntity)", () => {
  it("rebuilds recipes + junctions with resolved FKs; deletes happen only after verified reads", async () => {
    const writes = setup();

    const result = await syncEntity("recipes");

    // All four tables cleared, in junction-first order.
    expect(deletes(writes).map((w) => w.table)).toEqual([
      "recipe_malts",
      "recipe_hops",
      "recipe_yeasts",
      "recipes",
    ]);
    // Deletes precede the recipes rebuild insert.
    const firstDeleteIdx = writes.findIndex((w) => w.op === "delete");
    const recipesUpsertIdx = writes.findIndex((w) => w.op === "upsert" && w.table === "recipes");
    expect(firstDeleteIdx).toBeGreaterThan(-1);
    expect(recipesUpsertIdx).toBeGreaterThan(firstDeleteIdx);

    // Recipe row carries resolved style + brand FKs.
    expect(upsertFor(writes, "recipes")?.row).toEqual([
      expect.objectContaining({
        name: "Hazy IPA",
        style_id: "pg-style-1",
        brand_id: "pg-brand-1",
      }),
    ]);

    // Junction rows carry the post-insert recipe UUID and resolved ingredient UUIDs.
    expect(upsertFor(writes, "recipe_malts")?.row).toEqual([
      { recipe_id: "pg-recipe-1", malt_id: "pg-malt-1", weight_lbs: 10, position: 0 },
    ]);
    expect(upsertFor(writes, "recipe_hops")?.row).toEqual([
      {
        recipe_id: "pg-recipe-1",
        hop_id: "pg-hop-1",
        weight_oz: 16,
        timing: "dry_hop",
        boil_time_min: null,
        position: 0,
      },
    ]);
    expect(upsertFor(writes, "recipe_yeasts")?.row).toEqual([
      { recipe_id: "pg-recipe-1", yeast_id: "pg-yeast-1", is_primary: true, position: 0 },
    ]);

    // 1 recipe + 3 junction rows, no failures; sync log completed as success.
    expect(result).toMatchObject({ entityType: "recipes", synced: 4, failed: 0, errors: [] });
    expect(writes.at(-1)).toMatchObject({
      table: "mongodb_sync_log",
      op: "update",
      row: expect.objectContaining({ status: "success", records_synced: 4 }),
    });
  });

  it("aborts BEFORE any delete when a FK-lookup read fails (no NULL-FK rebuild)", async () => {
    const writes = setup({
      brands: { data: null, error: { message: "connection reset" } },
    });

    await expect(syncEntity("recipes")).rejects.toThrow(
      /Failed to read brands for FK resolution: connection reset/
    );

    // Nothing was deleted and nothing was rebuilt — only the sync-log insert ran.
    expect(deletes(writes)).toEqual([]);
    expect(writes.filter((w) => w.op === "upsert")).toEqual([]);
    expect(writes.map((w) => w.table)).toEqual(["mongodb_sync_log"]);
  });

  it("refuses the destructive rebuild when a referenced lookup resolves 0 entries", async () => {
    // brands read succeeds but is empty (e.g. phase 2 brands sync never ran)
    // while the Mongo recipes reference a beer — rebuilding would null every
    // brand FK after the delete.
    const writes = setup({ brands: { data: [], error: null } });

    await expect(syncEntity("recipes")).rejects.toThrow(
      /Refusing destructive recipe re-sync: brands lookup resolved 0 entries/
    );

    expect(deletes(writes)).toEqual([]);
    expect(writes.filter((w) => w.op === "upsert")).toEqual([]);
  });
});

describe("spreadsheet-owned orders", () => {
  it("rejects MongoDB order syncs before reading the legacy database", async () => {
    await expect(syncEntity("orders" as never)).rejects.toThrow(
      "Unknown entity type: orders"
    );

    expect(mockedGetMongoDb).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// upsertRows duplicate-conflict-key handling (Sentry MGR-A / issue 7542174707)
//
// A single upsert() call is one INSERT ... ON CONFLICT statement. Postgres
// rejects the WHOLE statement — "ON CONFLICT DO UPDATE command cannot affect
// row a second time" — if two rows in it share an onConflict key. Mongo
// source collections (styles, beers, vessels) have no uniqueness guarantee on
// `name`, which is exactly what beer_styles/brands/vessels upsert against, so
// legacy duplicate-name documents reliably reproduce this on every sync run
// until the duplicates are deduped client-side before the upsert call.
// ---------------------------------------------------------------------------

describe("upsertRows duplicate-key handling (via syncEntity('beer_styles'))", () => {
  it("drops duplicate-name rows before upserting, instead of failing the whole batch", async () => {
    const STYLE_A = new ObjectId("111111111111111111111111");
    const STYLE_B = new ObjectId("222222222222222222222222");

    mockedGetMongoDb.mockResolvedValue(
      makeDb({
        // Two distinct legacy Mongo documents that both derive the same
        // beer_styles.name — the real-world duplicate this fix targets.
        styles: [
          { _id: STYLE_A, name: "IPA" },
          { _id: STYLE_B, name: "IPA" },
        ],
      })
    );

    // Simulates the real Postgres error a same-key duplicate would cause
    // inside a single INSERT ... ON CONFLICT statement, without a real DB.
    let writesRef: Write[] = [];
    const { admin, writes } = makeAdminMock(
      {
        mongodb_sync_log: { data: { id: "log-1" }, error: null },
        beer_styles: () => {
          const lastUpsert = writesRef.findLast((w) => w.op === "upsert" && w.table === "beer_styles");
          const rows = (lastUpsert?.row ?? []) as Array<{ name: string }>;
          const names = rows.map((r) => r.name);
          if (new Set(names).size !== names.length) {
            return { data: null, error: { message: "ON CONFLICT DO UPDATE command cannot affect row a second time" } };
          }
          return { data: rows, error: null };
        },
      },
      { onUnknownTable: "throw" }
    );
    writesRef = writes;
    mockedCreateAdminClient.mockResolvedValue(admin as never);

    const result = await syncEntity("beer_styles");

    expect(result).toMatchObject({ entityType: "beer_styles", synced: 1, failed: 0, errors: [] });

    const upsertCall = writes.find((w) => w.op === "upsert" && w.table === "beer_styles");
    expect(upsertCall?.row).toEqual([expect.objectContaining({ name: "IPA" })]);

    expect(mockedLoggerWarn).toHaveBeenCalledWith(
      "Dropping %d duplicate-key row(s) for %s before upsert (onConflict=%s)",
      1,
      "beer_styles",
      "name"
    );
  });
});

// ---------------------------------------------------------------------------
// SENTRY-7542174707 regression: upsertRows must log a genuine (non-dedupable)
// Postgres upsert error as a structured { err, table, batchIndex } object,
// not a printf template string. Passing the bare template dropped every
// diagnostic value (table name, batch index, real Postgres message) once it
// reached Sentry — logger.ts's Sentry-forwarding hook only interpolates
// pino printf placeholders for the *log* output, not (pre-fix) for the
// message it forwards to Sentry.captureMessage. Passing a structured object
// with the real PostgrestError instance routes to Sentry.captureException
// instead, preserving message + stack + code.
// ---------------------------------------------------------------------------

describe("upsertRows error logging (via syncEntity('beer_styles'))", () => {
  it("logs a genuine upsert failure as a structured object carrying the real error instance", async () => {
    const STYLE_A = new ObjectId("333333333333333333333333");

    mockedGetMongoDb.mockResolvedValue(
      makeDb({ styles: [{ _id: STYLE_A, name: "Stout" }] })
    );

    const { admin } = makeAdminMock(
      {
        mongodb_sync_log: { data: { id: "log-1" }, error: null },
        beer_styles: {
          data: null,
          error: { message: "null value in column \"name\" violates not-null constraint" },
        },
      },
      { onUnknownTable: "throw" }
    );
    mockedCreateAdminClient.mockResolvedValue(admin as never);

    const result = await syncEntity("beer_styles");

    expect(result).toMatchObject({ entityType: "beer_styles", synced: 0, failed: 1 });
    expect(mockedLoggerError).toHaveBeenCalledWith(
      {
        err: expect.objectContaining({
          message: "null value in column \"name\" violates not-null constraint",
        }),
        table: "beer_styles",
        batchIndex: 0,
      },
      "Upsert error"
    );
  });
});
