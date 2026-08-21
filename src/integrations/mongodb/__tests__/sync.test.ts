/**
 * MongoDB sync orchestrator tests — atomic recipe aggregate safety.
 *
 * syncRecipes is delete-then-rebuild (recipes + recipe_malts/hops/yeasts have
 * no UNIQUE(name) to upsert against). These tests pin the hardened contract:
 *
 *   (1) Happy path stages a complete source aggregate for one transactional RPC.
 *   (2) A failed FK lookup aborts before the RPC.
 *   (3) An empty referenced lookup also refuses reconciliation.
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
import { syncAll, syncEntity, syncPhase } from "../sync";
import { objectIdToUuid } from "../id";

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
  const { admin, writes, rpcCalls } = makeAdminMock(pgTables(overrides), {
    onUnknownTable: "throw",
    rpc: { data: 4, error: null },
  });
  aggregateRpcCalls = rpcCalls;
  mockedCreateAdminClient.mockResolvedValue(admin as never);
  mockedGetMongoDb.mockResolvedValue(makeDb(MONGO_COLLECTIONS));
  return writes;
}

let aggregateRpcCalls: Array<{ fn: string; args: unknown }> = [];

const deletes = (writes: Write[]) => writes.filter((w) => w.op === "delete");

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncRecipes (via syncEntity)", () => {
  it("reconciles the complete recipe aggregate through one transactional RPC", async () => {
    const writes = setup();

    const result = await syncEntity("recipes");

    expect(deletes(writes)).toEqual([]);
    expect(writes.filter((write) => write.op === "upsert")).toEqual([]);
    expect(aggregateRpcCalls).toEqual([{
      fn: "reconcile_mongodb_recipe_aggregate",
      args: expect.objectContaining({
        p_mongo_id: RECIPE_OID.toString(),
        p_recipe: expect.objectContaining({
        name: "Hazy IPA",
        style_id: "pg-style-1",
        brand_id: "pg-brand-1",
        }),
        p_malts: [expect.objectContaining({ malt_id: "pg-malt-1", weight_lbs: 10, position: 0 })],
        p_hops: [expect.objectContaining({
          hop_id: "pg-hop-1", weight_oz: 16, timing: "dry_hop", boil_time_min: null, position: 0,
        })],
        p_yeasts: [expect.objectContaining({ yeast_id: "pg-yeast-1", is_primary: true, position: 0 })],
      }),
    }]);

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
      /Refusing recipe re-sync: brands lookup resolved 0 entries/
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

describe("phase failure reporting", () => {
  it("counts a thrown entity failure and attributes its phase, entity, and operation", async () => {
    const { admin } = makeAdminMock({
      mongodb_sync_log: { data: null, error: { message: "sync log unavailable" } },
    });
    mockedCreateAdminClient.mockResolvedValue(admin as never);

    const results = await syncPhase(1);

    expect(results[0]).toMatchObject({
      entityType: "suppliers",
      phase: 1,
      synced: 0,
      failed: 1,
      errors: [{
        mongoId: "phase-error",
        error: expect.stringContaining("phase=1 entity=suppliers operation=sync"),
      }],
    });
  });

  it("stops sync-all before dependent phases after a phase reports a failure", async () => {
    const { admin } = makeAdminMock({
      mongodb_sync_log: { data: null, error: { message: "sync log unavailable" } },
    });
    mockedCreateAdminClient.mockResolvedValue(admin as never);

    const results = await syncAll();

    expect(results).toHaveLength(5);
    expect(new Set(results.map((result) => result.phase))).toEqual(new Set([1]));
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
    // A failed chunk upsert retries row-by-row (so one bad row doesn't fail
    // the whole chunk); with a single style in this fixture, the retry logs
    // the same underlying error again, now tagged with that row's identity.
    expect(mockedLoggerError).toHaveBeenCalledWith(
      {
        err: expect.objectContaining({
          message: "null value in column \"name\" violates not-null constraint",
        }),
        table: "beer_styles",
        batchIndex: 0,
      },
      "Upsert error, retrying chunk row-by-row"
    );
    expect(mockedLoggerError).toHaveBeenCalledWith(
      {
        err: expect.objectContaining({
          message: "null value in column \"name\" violates not-null constraint",
        }),
        table: "beer_styles",
        mongoId: "Stout",
      },
      "Upsert error (row retry)"
    );
  });

  it("isolates one bad row in a chunk instead of failing every row in it", async () => {
    // The batched upsert fails (simulating a trigger-raised error on one row);
    // the row-by-row retry then succeeds for the good rows and fails only the
    // bad one, instead of reporting all 3 as failed.
    mockedGetMongoDb.mockResolvedValue(
      makeDb({
        styles: [
          { _id: new ObjectId("111111111111111111111111"), name: "Pilsner" },
          { _id: new ObjectId("222222222222222222222222"), name: "" },
          { _id: new ObjectId("333333333333333333333333"), name: "Stout" },
        ],
      })
    );

    const responses = [
      { data: null, error: { message: "batch upsert failed" } }, // chunked upsert
      { data: [{}], error: null }, // retry: Pilsner
      { data: null, error: { message: "null value in column \"name\" violates not-null constraint" } }, // retry: ""
      { data: [{}], error: null }, // retry: Stout
    ];
    const { admin } = makeAdminMock(
      {
        mongodb_sync_log: { data: { id: "log-1" }, error: null },
        beer_styles: () => responses.shift()!,
      },
      { onUnknownTable: "throw" }
    );
    mockedCreateAdminClient.mockResolvedValue(admin as never);

    const result = await syncEntity("beer_styles");

    expect(result).toMatchObject({ entityType: "beer_styles", synced: 2, failed: 1 });
    expect(result.errors).toEqual([
      { mongoId: "", error: "null value in column \"name\" violates not-null constraint" },
    ]);
  });

  it("bails out of the row-by-row retry after consecutive failures instead of grinding through a systemically-broken chunk", async () => {
    // Every row fails the same way (e.g. a missing column) — after
    // MAX_CONSECUTIVE_FAILURES straight failures with nothing synced, the
    // retry gives up on the rest of the chunk rather than re-issuing all 5
    // rows as separate round-trips.
    mockedGetMongoDb.mockResolvedValue(
      makeDb({
        styles: [1, 2, 3, 4, 5].map((n) => ({
          _id: new ObjectId(n.toString().repeat(24).slice(0, 24)),
          name: `Bad${n}`,
        })),
      })
    );

    const systemicError = { message: "column \"category\" of relation \"beer_styles\" does not exist" };
    // Only 4 responses configured (1 batch + 3 individual retries): if the
    // implementation doesn't bail out after 3 consecutive failures, the 5th
    // call finds no queued response left and the test fails loudly.
    const responses = [
      { data: null, error: systemicError },
      { data: null, error: systemicError },
      { data: null, error: systemicError },
      { data: null, error: systemicError },
    ];
    const { admin } = makeAdminMock(
      {
        mongodb_sync_log: { data: { id: "log-1" }, error: null },
        beer_styles: () => responses.shift()!,
      },
      { onUnknownTable: "throw" }
    );
    mockedCreateAdminClient.mockResolvedValue(admin as never);

    const result = await syncEntity("beer_styles");

    expect(result).toMatchObject({ entityType: "beer_styles", synced: 0, failed: 5 });
    expect(result.errors).toEqual([
      { mongoId: "Bad1", error: systemicError.message },
      { mongoId: "Bad2", error: systemicError.message },
      { mongoId: "Bad3", error: systemicError.message },
      { mongoId: "chunk-aborted-after-3-consecutive-failures", error: systemicError.message },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 00288 replay fixes
// ---------------------------------------------------------------------------

// Status preservation is a DB-side property since 00297: the RPCs'
// ON CONFLICT update omits `status`, so existing rows keep their live value
// with no app-side read-modify-write TOCTOU window (#855; previously fd60d58
// for batches, #839 for vessels). App tests therefore pin the RPC name+args
// contract — rows go through the RPC untouched (Mongo status included, which
// the DB uses only on first insert), never through a direct table upsert.

describe("syncBatches status-preserving RPC (via syncEntity)", () => {
  it("routes rows through sync_upsert_batches instead of a direct upsert", async () => {
    const BATCH_OID = new ObjectId("abababababababababababab");
    const batchUuid = objectIdToUuid(BATCH_OID.toString());
    const { admin, writes, rpcCalls } = makeAdminMock(
      pgTables(),
      { onUnknownTable: "throw", rpc: { data: 1, error: null } }
    );
    mockedCreateAdminClient.mockResolvedValue(admin as never);
    mockedGetMongoDb.mockResolvedValue(
      makeDb({
        ...MONGO_COLLECTIONS,
        batches: [
          { _id: BATCH_OID, name: "B1", currentVessel: new ObjectId("acacacacacacacacacacacac") },
        ],
      })
    );

    const result = await syncEntity("batches");

    const rpc = rpcCalls.filter((c) => c.fn === "sync_upsert_batches");
    expect(rpc).toHaveLength(1);
    const rows = (rpc[0]!.args as { p_rows: Array<Record<string, unknown>> }).p_rows;
    expect(rows).toEqual([expect.objectContaining({
      id: batchUuid,
      name: "B1",
      // The transformed Mongo status ships as-is — the DB ignores it for
      // existing rows (ON CONFLICT omits status) and uses it on first insert.
      status: "fermenting",
    })]);
    // The batches table must never see a direct client-side upsert.
    expect(writes.filter((w) => w.table === "batches")).toHaveLength(0);
    expect(result).toMatchObject({ entityType: "batches", synced: 1, failed: 0, errors: [] });
  });
});

describe("syncVessels status-preserving RPC (via syncEntity)", () => {
  it("routes rows through sync_upsert_vessels instead of a direct upsert", async () => {
    const { admin, writes, rpcCalls } = makeAdminMock(
      pgTables(),
      { onUnknownTable: "throw", rpc: { data: 2, error: null } }
    );
    mockedCreateAdminClient.mockResolvedValue(admin as never);
    mockedGetMongoDb.mockResolvedValue(
      makeDb({
        ...MONGO_COLLECTIONS,
        vessels: [
          { _id: new ObjectId("afafafafafafafafafafafaf"), name: "FV1", state: "ready_for_use" },
          { _id: new ObjectId("bcbcbcbcbcbcbcbcbcbcbcbc"), name: "FV2", state: "dirty" },
        ],
      })
    );

    const result = await syncEntity("vessels");

    const rpc = rpcCalls.filter((c) => c.fn === "sync_upsert_vessels");
    expect(rpc).toHaveLength(1);
    const rows = (rpc[0]!.args as { p_rows: Array<Record<string, unknown>> }).p_rows;
    expect(rows).toEqual([
      expect.objectContaining({ name: "FV1", status: "ready_for_use" }),
      expect.objectContaining({ name: "FV2", status: "dirty" }),
    ]);
    expect(writes.filter((w) => w.table === "vessels")).toHaveLength(0);
    expect(result).toMatchObject({ entityType: "vessels", synced: 2, failed: 0, errors: [] });
  });

  it("falls back to row-by-row RPC calls when the whole-batch call fails", async () => {
    // First call (both rows) fails; the retry isolates the bad row: FV1's
    // single-row call fails again, FV2's succeeds — synced 1, failed 1,
    // mirroring upsertRows' retry philosophy.
    const responses = [
      { data: null, error: { message: "invalid input value for enum vessel_status" } },
      { data: null, error: { message: "invalid input value for enum vessel_status" } },
      { data: 1, error: null },
    ];
    const { admin, rpcCalls } = makeAdminMock(
      pgTables(),
      { onUnknownTable: "throw", rpc: () => responses.shift()! }
    );
    mockedCreateAdminClient.mockResolvedValue(admin as never);
    mockedGetMongoDb.mockResolvedValue(
      makeDb({
        ...MONGO_COLLECTIONS,
        vessels: [
          { _id: new ObjectId("afafafafafafafafafafafaf"), name: "FV1", state: "bogus" },
          { _id: new ObjectId("bcbcbcbcbcbcbcbcbcbcbcbc"), name: "FV2", state: "dirty" },
        ],
      })
    );

    const result = await syncEntity("vessels");

    expect(rpcCalls.filter((c) => c.fn === "sync_upsert_vessels")).toHaveLength(3);
    // Each retry call carries exactly one row.
    const retryRows = rpcCalls.slice(1).map((c) => (c.args as { p_rows: unknown[] }).p_rows.length);
    expect(retryRows).toEqual([1, 1]);
    expect(result).toMatchObject({ entityType: "vessels", synced: 1, failed: 1 });
    expect(result.errors).toEqual([
      { mongoId: "FV1", error: "invalid input value for enum vessel_status" },
    ]);
  });
});

describe("syncTransfers historical replay (via syncEntity)", () => {
  it("routes rows through reconcile_mongodb_transfers instead of a direct upsert", async () => {
    const VESSEL_OID = new ObjectId("adadadadadadadadadadadad");
    const { admin, writes, rpcCalls } = makeAdminMock(
      pgTables({ vessels: { data: [{ id: "pg-vessel-1", name: "FV1" }], error: null } }),
      { onUnknownTable: "throw", rpc: { data: 1, error: null } }
    );
    mockedCreateAdminClient.mockResolvedValue(admin as never);
    mockedGetMongoDb.mockResolvedValue(
      makeDb({
        ...MONGO_COLLECTIONS,
        vessels: [{ _id: VESSEL_OID, name: "FV1" }],
        transfers: [
          {
            _id: new ObjectId("aeaeaeaeaeaeaeaeaeaeaeae"),
            batch: new ObjectId("abababababababababababab"),
            transferTo: VESSEL_OID,
            quantity: 8,
            date: new Date("2025-06-01T12:00:00Z"),
          },
        ],
      })
    );

    await syncEntity("vessel_transfers");

    const rpc = rpcCalls.filter((c) => c.fn === "reconcile_mongodb_transfers");
    expect(rpc).toHaveLength(1);
    expect((rpc[0]!.args as { p_rows: unknown[] }).p_rows).toHaveLength(1);
    // The live occupancy trigger must not see a direct client-side upsert.
    expect(writes.filter((w) => w.table === "vessel_transfers")).toHaveLength(0);
  });
});
