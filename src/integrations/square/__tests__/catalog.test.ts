/**
 * Square catalog helper tests — deleteStaleItems (data-loss + chunking guards).
 *
 * Covers the two defects fixed in deleteStaleItems:
 *   (1) A Square batchDelete failure must NOT delete the local square_catalog_map
 *       rows — otherwise the Square objects survive but MGR forgets their ids, so
 *       the next sync recreates them as duplicates. The failed chunk's map rows
 *       are retained and the failure is surfaced via the returned result.
 *   (2) The Square delete is chunked (Square caps object_ids at 200; we chunk at
 *       100). A chunk that fails retains its map rows while succeeded chunks still
 *       drop theirs.
 *
 * createAdminClient is faked with the shared admin mock (src/test/supabase-admin-mock.ts);
 * the Square SDK client with a small in-memory stub. The client-logger is silenced.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SquareClient } from "square";
import { makeAdminMock, type Write } from "@/test/supabase-admin-mock";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/client-logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { createAdminClient } from "@/lib/supabase/server";
import { deleteStaleItems } from "@/integrations/square/catalog";

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
