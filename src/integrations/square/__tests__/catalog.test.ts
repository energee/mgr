/**
 * Square catalog helper tests — pushCatalog mapping persistence and
 * deleteStaleItems (data-loss + chunking guards).
 *
 * pushCatalog (audit SF-4/IN-8 + PERF-1): the square_catalog_map write is ONE
 * batched, error-checked upsert targeting the 00242 unique index
 * (brand_id, object_type, selling_format_id) NULLS NOT DISTINCT:
 *   (1) success persists every ITEM + ITEM_VARIATION mapping in a single call
 *       and counts them all in itemsSynced;
 *   (2) an upsert failure marks EVERY row in the batch failed, surfaces the
 *       error per row, and counts NONE in itemsSynced — a silently dropped
 *       mapping makes the next sync push temp "#brand-…" ids and duplicate the
 *       whole Square catalog.
 *
 * deleteStaleItems:
 *   (1) A Square batchDelete failure must NOT delete the local square_catalog_map
 *       rows — otherwise the Square objects survive but MGR forgets their ids, so
 *       the next sync recreates them as duplicates. The failed chunk's map rows
 *       are retained and the failure is surfaced via the returned result.
 *   (2) The Square delete is chunked (Square caps object_ids at 200; we chunk at
 *       100). A chunk that fails retains its map rows while succeeded chunks still
 *       drop theirs.
 *   (3) A failure of the initial stale-entry SELECT is surfaced as a chunk -1
 *       error (SF-6/IN-11) while deletion stays fail-safely skipped — previously
 *       it was folded into the silent empty-result return.
 *
 * createAdminClient is faked with the shared admin mock (src/test/supabase-admin-mock.ts);
 * the Square SDK client with a small in-memory stub. The client-logger is silenced.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SquareClient } from "square";
import type { SquareSyncProduct } from "@/integrations/square/types";
import { makeAdminMock, type QueryResult, type Write } from "@/test/supabase-admin-mock";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/client-logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { createAdminClient } from "@/lib/supabase/server";
import { pushCatalog, deleteStaleItems } from "@/integrations/square/catalog";

const mockedCreateAdminClient = vi.mocked(createAdminClient);

type StaleEntry = {
  id: string;
  brand_id: string;
  square_catalog_id: string;
  object_type: string;
};

/**
 * Admin whose square_catalog_map select resolves to `staleEntries`. Installs it
 * as createAdminClient's result and returns the recorder's write log.
 */
function useStaleEntries(staleEntries: StaleEntry[]): Write[] {
  const { admin, writes } = makeAdminMock({
    square_catalog_map: { data: staleEntries, error: null },
  });
  mockedCreateAdminClient.mockResolvedValue(admin as never);
  return writes;
}

/** The ids each `.delete().in("id", ids)` removed, flattened in chunk order. */
const deletedIds = (writes: Write[]): string[] =>
  writes.filter((w) => w.op === "delete").flatMap((w) => (w.row ?? []) as string[]);

/**
 * Fake Square client. `failOnCall` is the 0-based index of the batchDelete call
 * that should throw (or undefined for none). Records the objectIds of each call.
 */
function makeClient(calls: string[][], failOnCall?: number): SquareClient {
  let n = 0;
  return {
    catalog: {
      batchDelete: async ({ objectIds }: { objectIds: string[] }) => {
        const idx = n++;
        calls.push(objectIds);
        if (failOnCall !== undefined && idx === failOnCall) {
          throw new Error("Square batchDelete failed");
        }
        return {};
      },
    },
  } as unknown as SquareClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// pushCatalog — batched, error-checked square_catalog_map upsert (SF-4/IN-8)
// =============================================================================

/** Admin whose square_catalog_map upsert resolves to `response`. */
function useCatalogMapResponse(response: QueryResult): Write[] {
  const { admin, writes } = makeAdminMock({ square_catalog_map: response });
  mockedCreateAdminClient.mockResolvedValue(admin as never);
  return writes;
}

/** One brand with one variation — produces one ITEM + one ITEM_VARIATION row. */
const PRODUCT: SquareSyncProduct = {
  brandId: "b1",
  brandName: "Brand One",
  variations: [{ sellingFormatId: "f1", name: "16oz 4-Pack", priceCents: 1000 }],
};

/** Square's batchUpsert response: temp-id mappings + versioned objects. */
const BATCH_RESPONSE = {
  idMappings: [
    { clientObjectId: "#brand-b1", objectId: "SQ-ITEM-1" },
    { clientObjectId: "#var-b1-fmt-f1", objectId: "SQ-VAR-1" },
  ],
  objects: [
    {
      type: "ITEM",
      id: "SQ-ITEM-1",
      version: BigInt(3),
      itemData: { variations: [{ id: "SQ-VAR-1", version: BigInt(4) }] },
    },
  ],
};

function makePushClient(): SquareClient {
  return {
    catalog: { batchUpsert: async () => BATCH_RESPONSE },
  } as unknown as SquareClient;
}

describe("pushCatalog", () => {
  it("persists all mappings in ONE batched upsert onto the 00242 key and counts them synced", async () => {
    const writes = useCatalogMapResponse({ data: [], error: null });

    const result = await pushCatalog(makePushClient(), [PRODUCT]);

    // ONE upsert (not 2N inserts/updates — PERF-1), carrying both rows and
    // targeting the NULLS NOT DISTINCT unique index by its column list.
    const upserts = writes.filter((w) => w.table === "square_catalog_map" && w.op === "upsert");
    expect(upserts).toHaveLength(1);
    expect(writes).toHaveLength(1);
    expect(upserts[0].options).toEqual({ onConflict: "brand_id,object_type,selling_format_id" });
    expect(upserts[0].row).toEqual([
      expect.objectContaining({
        brand_id: "b1",
        selling_format_id: null, // ITEM rows carry NULL — collides via NULLS NOT DISTINCT
        square_catalog_id: "SQ-ITEM-1",
        square_version: 3,
        object_type: "ITEM",
      }),
      expect.objectContaining({
        brand_id: "b1",
        selling_format_id: "f1",
        square_catalog_id: "SQ-VAR-1",
        square_version: 4,
        object_type: "ITEM_VARIATION",
      }),
    ]);

    expect(result).toEqual({ success: true, itemsSynced: 2, itemsFailed: 0, errors: [] });
  });

  it("on upsert failure marks EVERY row in the batch failed and counts NONE synced", async () => {
    // A silently-unpersisted mapping is the duplicate-catalog vector: the next
    // sync would push temp "#brand-…" ids and Square would create everything anew.
    useCatalogMapResponse({ data: null, error: { message: "upsert boom" } });

    const result = await pushCatalog(makePushClient(), [PRODUCT]);

    expect(result.success).toBe(false);
    expect(result.itemsSynced).toBe(0);
    expect(result.itemsFailed).toBe(2);
    expect(result.errors).toEqual([
      { itemId: "b1", error: "catalog map upsert failed: upsert boom" },
      { itemId: "b1/fmt-f1", error: "catalog map upsert failed: upsert boom" },
    ]);
  });
});

describe("deleteStaleItems", () => {
  it("KEEPS the local map rows when Square's batchDelete fails (no orphan/duplicate)", async () => {
    const stale: StaleEntry[] = [
      { id: "row-1", brand_id: "b1", square_catalog_id: "SQ-1", object_type: "ITEM" },
      { id: "row-2", brand_id: "b1", square_catalog_id: "SQ-2", object_type: "ITEM_VARIATION" },
    ];
    const writes = useStaleEntries(stale);

    const deleteCalls: string[][] = [];
    const client = makeClient(deleteCalls, /* failOnCall */ 0);

    const result = await deleteStaleItems(client, ["keep-brand"]);

    // Square was asked to delete the objects...
    expect(deleteCalls).toEqual([["SQ-1", "SQ-2"]]);
    // ...but since that failed, NO local map rows were deleted.
    expect(deletedIds(writes)).toEqual([]);
    // ...and the failure is surfaced to the caller.
    expect(result.deleted).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.errors).toHaveLength(1);
  });

  it("deletes local rows only for chunks Square deleted; chunks over 100 are split", async () => {
    // 150 stale entries -> chunk 0 (100) + chunk 1 (50). Fail chunk 1.
    const stale: StaleEntry[] = Array.from({ length: 150 }, (_, i) => ({
      id: `row-${i}`,
      brand_id: "b1",
      square_catalog_id: `SQ-${i}`,
      object_type: "ITEM_VARIATION",
    }));
    const writes = useStaleEntries(stale);

    const deleteCalls: string[][] = [];
    const client = makeClient(deleteCalls, /* failOnCall */ 1);

    const result = await deleteStaleItems(client, ["keep-brand"]);

    // Chunked at 100: two batchDelete calls of 100 and 50.
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls[0]).toHaveLength(100);
    expect(deleteCalls[1]).toHaveLength(50);

    // Chunk 0 succeeded -> its 100 rows removed locally; chunk 1 failed -> its 50
    // rows RETAINED.
    expect(deletedIds(writes)).toHaveLength(100);
    expect(deletedIds(writes)).toEqual(stale.slice(0, 100).map((e) => e.id));
    expect(result.deleted).toBe(100);
    expect(result.failed).toBe(50);
    expect(result.errors).toHaveLength(1);
  });

  it("surfaces a stale-entry SELECT failure as a chunk -1 error and deletes NOTHING (fail-safe)", async () => {
    // SF-6/IN-11: previously the SELECT error was folded into the silent
    // empty-result return — the route reported success while cleanup never ran.
    const writes = useCatalogMapResponse({ data: null, error: { message: "select boom" } });
    const deleteCalls: string[][] = [];

    const result = await deleteStaleItems(makeClient(deleteCalls), ["keep-brand"]);

    expect(result.deleted).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([
      { chunk: -1, error: "stale-entry select failed: select boom" },
    ]);
    // Fail-safe: nothing was deleted on Square OR locally.
    expect(deleteCalls).toEqual([]);
    expect(deletedIds(writes)).toEqual([]);
  });

  it("deletes every chunk's rows when all Square deletes succeed", async () => {
    const stale: StaleEntry[] = [
      { id: "row-1", brand_id: "b1", square_catalog_id: "SQ-1", object_type: "ITEM" },
    ];
    const writes = useStaleEntries(stale);
    const deleteCalls: string[][] = [];

    const result = await deleteStaleItems(makeClient(deleteCalls), ["keep-brand"]);

    expect(deletedIds(writes)).toEqual(["row-1"]);
    expect(result).toEqual({ deleted: 1, failed: 0, errors: [] });
  });
});
