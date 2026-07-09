/**
 * Square bin-driven sync route tests (Milestone C5).
 *
 * Characterizes the rewrite of the catalog + inventory sync routes from the old
 * POS-on-location model to the POS-on-bin model:
 *   - POS targets are BINS with both bins.square_location_id and
 *     bins.pos_sales_channel_id set.
 *   - Sellable stock is read from the unified sellable_inventory view (00221),
 *     which UNIONs packaged finished goods in bins with filled-keg contents.
 *
 * Locked-in behaviors:
 *   Catalog:
 *     - prices each variation from its bin's pos_sales_channel_id (one
 *       resolveChannelPrices call per DISTINCT channel);
 *     - a variation stocked at bins on DIFFERENT channels deterministically takes
 *       the first channel by bin order (v1 single-price-per-variation).
 *   Inventory:
 *     - quantities are pushed AS-IS (NOT × unit_count — that over-reported on-hand;
 *       an FG quantity is already in selling units and a Square variation is
 *       counted per selling unit);
 *     - every mapped variation NOT stocked at a bin is zeroed (quantity 0) so
 *       sold-out variations drop to 0 on the POS instead of showing phantom stock;
 *     - counts are scoped to each bin's square_location_id;
 *     - all bins are pushed in parallel (Promise.all) with per-bin attribution;
 *     - square_sync_log rows are written in ONE batched insert; location_id is the
 *       view's location uuid (not the Square id).
 *
 * The Supabase admin client is faked with the shared admin mock
 * (src/test/supabase-admin-mock.ts). withPermission is stubbed to a pass-through
 * so the handler logic is exercised directly.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SquareSyncResult } from "@/integrations/square/types";
import { makeAdminMock, type TableData, type Write } from "@/test/supabase-admin-mock";

// -----------------------------------------------------------------------------
// Mocks (must precede route imports)
// -----------------------------------------------------------------------------

vi.mock("@/lib/api/auth", () => ({
  withPermission:
    (_perm: string, handler: (req: unknown, ctx: unknown) => unknown) =>
    (req: unknown) =>
      handler(req, { user: { id: "user-1" } }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/integrations/square/client", () => ({
  getSquareClient: vi.fn(),
  updateSquareSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/integrations/square/catalog", () => ({
  pushCatalog: vi.fn(),
  deleteStaleItems: vi.fn(),
}));

vi.mock("@/integrations/square/inventory", () => ({
  pushInventoryCounts: vi.fn(),
}));

vi.mock("@/integrations/square/pricing", () => ({
  resolveChannelPrices: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { getSquareClient, updateSquareSettings } from "@/integrations/square/client";
import { pushCatalog, deleteStaleItems } from "@/integrations/square/catalog";
import { pushInventoryCounts } from "@/integrations/square/inventory";
import { resolveChannelPrices } from "@/integrations/square/pricing";

import { POST as catalogPOST } from "@/app/api/square/sync/catalog/route";
import { POST as inventoryPOST } from "@/app/api/square/sync/inventory/route";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedGetSquareClient = vi.mocked(getSquareClient);
const mockedUpdateSquareSettings = vi.mocked(updateSquareSettings);
const mockedPushCatalog = vi.mocked(pushCatalog);
const mockedDeleteStaleItems = vi.mocked(deleteStaleItems);
const mockedPushInventoryCounts = vi.mocked(pushInventoryCounts);
const mockedResolveChannelPrices = vi.mocked(resolveChannelPrices);

// -----------------------------------------------------------------------------
// In-memory admin (shared mock)
// -----------------------------------------------------------------------------

/** Every write the handler performs, in order. Re-created by useTables. */
let writes: Write[];

/** Rows the handler inserted, filtered from the write log. */
const inserted = () => writes.filter((w) => w.op === "insert");

function useTables(tables: TableData) {
  const mock = makeAdminMock(tables);
  writes = mock.writes;
  mockedCreateAdminClient.mockResolvedValue(mock.admin as never);
}

const SYNC_RESULT = (n: number): SquareSyncResult => ({
  success: true,
  itemsSynced: n,
  itemsFailed: 0,
  errors: [],
});

/** deleteStaleItems' new result shape (nothing deleted, no failures). */
const NO_STALE = { deleted: 0, failed: 0, errors: [] as Array<{ chunk: number; error: string }> };

/** resolveChannelPrices' new return: a per-channel Map. `byChannel` maps a
 *  channel id -> its ChannelPrice[]; any channel not present resolves to []. */
const channelMap = (
  byChannel: Record<string, Array<{ brandId: string; sellingFormatId: string; priceCents: number }>>
) => (channelIds: string[]) =>
  new Map(channelIds.map((id) => [id, byChannel[id] ?? []]));

const req = () => new NextRequest("http://localhost/api/square/sync");

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSquareClient.mockResolvedValue({} as never);
  mockedUpdateSquareSettings.mockResolvedValue(undefined as never);
});

// =============================================================================
// Catalog
// =============================================================================

describe("catalog sync (bin-driven)", () => {
  it("returns CONFIGURATION_ERROR when no POS bins are configured", async () => {
    useTables({ bins: { data: [], error: null } });
    const res = await catalogPOST(req());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("CONFIGURATION_ERROR");
    expect(mockedPushCatalog).not.toHaveBeenCalled();
  });

  it("prices each variation from its bin's channel; a variation across channels takes the first bin's channel", async () => {
    useTables({
      bins: {
        data: [
          { id: "bin-1", square_location_id: "SQ-LOC-1", pos_sales_channel_id: "chan-A" },
          { id: "bin-2", square_location_id: "SQ-LOC-2", pos_sales_channel_id: "chan-B" },
        ],
        error: null,
      },
      // brand-1/fmt-1 stocked at BOTH bins (chan-A first) -> must price via chan-A.
      // brand-2/fmt-2 (keg) only at bin-2 -> prices via chan-B.
      sellable_inventory: {
        data: [
          { bin_id: "bin-1", brand_id: "brand-1", selling_format_id: "fmt-1", quantity: 5 },
          { bin_id: "bin-2", brand_id: "brand-1", selling_format_id: "fmt-1", quantity: 2 },
          { bin_id: "bin-2", brand_id: "brand-2", selling_format_id: "fmt-2", quantity: 3 },
        ],
        error: null,
      },
      brands: {
        data: [
          { id: "brand-1", name: "Brand One", description: "d1" },
          { id: "brand-2", name: "Brand Two", description: null },
        ],
        error: null,
      },
      selling_formats: {
        data: [
          { id: "fmt-1", name: "16oz 4-Pack" },
          { id: "fmt-2", name: "1/2 BBL" },
        ],
        error: null,
      },
      square_catalog_map: { data: [], error: null },
      square_sync_log: { data: null, error: null },
    });

    const resolve = channelMap({
      "chan-A": [{ brandId: "brand-1", sellingFormatId: "fmt-1", priceCents: 1000 }],
      "chan-B": [
        { brandId: "brand-1", sellingFormatId: "fmt-1", priceCents: 2000 },
        { brandId: "brand-2", sellingFormatId: "fmt-2", priceCents: 3000 },
      ],
    });
    mockedResolveChannelPrices.mockImplementation(async (_brandIds, channelIds) => resolve(channelIds));
    mockedPushCatalog.mockResolvedValue(SYNC_RESULT(2));
    mockedDeleteStaleItems.mockResolvedValue(NO_STALE);

    const res = await catalogPOST(req());
    expect(res.status).toBe(200);

    // ONE batched resolveChannelPrices call covering every DISTINCT channel (E3)
    expect(mockedResolveChannelPrices).toHaveBeenCalledTimes(1);
    expect(mockedResolveChannelPrices).toHaveBeenCalledWith(
      expect.arrayContaining(["brand-1", "brand-2"]),
      expect.arrayContaining(["chan-A", "chan-B"])
    );

    const products = mockedPushCatalog.mock.calls[0][1];
    const brand1 = products.find((p) => p.brandId === "brand-1")!;
    const brand2 = products.find((p) => p.brandId === "brand-2")!;

    // brand-1/fmt-1 stocked at bin-1 (chan-A, order 0) and bin-2 (chan-B): chan-A wins
    expect(brand1.variations).toEqual([
      expect.objectContaining({ sellingFormatId: "fmt-1", name: "16oz 4-Pack", priceCents: 1000 }),
    ]);
    // brand-2/fmt-2 only at bin-2 -> chan-B
    expect(brand2.variations).toEqual([
      expect.objectContaining({ sellingFormatId: "fmt-2", name: "1/2 BBL", priceCents: 3000 }),
    ]);

    // stale cleanup scoped to the active brand set
    expect(mockedDeleteStaleItems).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(["brand-1", "brand-2"]));

    // log records the POS bin count
    const log = inserted().find((i) => i.table === "square_sync_log")!.row as {
      details: { posBinCount: number };
    };
    expect(log.details.posBinCount).toBe(2);

    expect(mockedUpdateSquareSettings).toHaveBeenCalledWith(
      expect.objectContaining({ last_catalog_sync_at: expect.any(String) })
    );
  });

  it("does NOT wipe the catalog when POS bins are configured but hold no stock", async () => {
    useTables({
      bins: {
        data: [{ id: "bin-1", square_location_id: "SQ-LOC-1", pos_sales_channel_id: "chan-A" }],
        error: null,
      },
      sellable_inventory: { data: [], error: null }, // configured bin, zero stock
      square_catalog_map: { data: [], error: null },
      square_sync_log: { data: null, error: null },
    });
    mockedPushCatalog.mockResolvedValue(SYNC_RESULT(0));
    mockedDeleteStaleItems.mockResolvedValue(NO_STALE);

    const res = await catalogPOST(req());
    expect(res.status).toBe(200);
    // Empty keep set (no stock AND no bin_inventory rows) must NOT reach
    // deleteStaleItems, which treats [] as "delete the ENTIRE catalog" — a
    // transient empty bin would otherwise nuke it.
    expect(mockedDeleteStaleItems).not.toHaveBeenCalled();
  });

  it("keeps a SOLD-OUT (not discontinued) brand in the catalog: absent from the push, present in the keep set", async () => {
    // brand-1 in stock; brand-2 sold out (absent from the positive-only view) but
    // still has a qty-0 bin_inventory row (debit clamps, never deletes — 00223),
    // so brand-2 must survive stale cleanup even though it isn't re-pushed.
    useTables({
      bins: {
        data: [{ id: "bin-1", square_location_id: "SQ-LOC-1", pos_sales_channel_id: "chan-A" }],
        error: null,
      },
      sellable_inventory: {
        data: [{ bin_id: "bin-1", brand_id: "brand-1", selling_format_id: "fmt-1", quantity: 5 }],
        error: null,
      },
      brands: { data: [{ id: "brand-1", name: "Brand One", description: null }], error: null },
      selling_formats: { data: [{ id: "fmt-1", name: "16oz 4-Pack" }], error: null },
      square_catalog_map: { data: [], error: null },
      // bin_inventory retains sold-out brand-2's finished good (fg-2) at a POS bin.
      bin_inventory: {
        data: [{ finished_good_id: "fg-1" }, { finished_good_id: "fg-2" }],
        error: null,
      },
      finished_goods: {
        data: [{ brand_id: "brand-1" }, { brand_id: "brand-2" }],
        error: null,
      },
      square_sync_log: { data: null, error: null },
    });
    mockedResolveChannelPrices.mockImplementation(async (_brandIds, channelIds) =>
      channelMap({ "chan-A": [{ brandId: "brand-1", sellingFormatId: "fmt-1", priceCents: 1000 }] })(channelIds)
    );
    mockedPushCatalog.mockResolvedValue(SYNC_RESULT(1));
    mockedDeleteStaleItems.mockResolvedValue(NO_STALE);

    const res = await catalogPOST(req());
    expect(res.status).toBe(200);

    // Only the in-stock brand is pushed.
    const products = mockedPushCatalog.mock.calls[0][1];
    expect(products.map((p) => p.brandId)).toEqual(["brand-1"]);

    // ...but the keep set passed to deleteStaleItems includes the SOLD-OUT brand-2,
    // so its Square item is NOT deleted.
    const keepSet = mockedDeleteStaleItems.mock.calls[0][1];
    expect(keepSet).toEqual(expect.arrayContaining(["brand-1", "brand-2"]));
  });

  it("keeps a KEG-ONLY brand whose last keg blew: no stock, no bin_inventory row, still in the keep set", async () => {
    // Regression: kegs are never in bin_inventory (00221's double-count guard) and
    // keg_filled_contents is positive-only, so a draft-only brand disappears from
    // BOTH the in-stock set and the bin_inventory set at zero kegs. It must still
    // survive stale cleanup — it's sold out, not discontinued.
    useTables({
      bins: {
        data: [{ id: "bin-1", square_location_id: "SQ-LOC-1", pos_sales_channel_id: "chan-A" }],
        error: null,
      },
      // brand-2 (draft-only) is absent: zero filled kegs.
      sellable_inventory: {
        data: [{ bin_id: "bin-1", brand_id: "brand-1", selling_format_id: "fmt-1", quantity: 5 }],
        error: null,
      },
      brands: { data: [{ id: "brand-1", name: "Brand One", description: null }], error: null },
      selling_formats: { data: [{ id: "fmt-1", name: "16oz 4-Pack" }], error: null },
      square_catalog_map: { data: [], error: null },
      bin_inventory: { data: [], error: null }, // kegs are never here
      // brand-2 has a keg-container finished good => sold on draft => keep.
      finished_goods_with_ttb_class: { data: [{ brand_id: "brand-2" }], error: null },
      square_sync_log: { data: null, error: null },
    });
    mockedResolveChannelPrices.mockImplementation(async (_brandIds, channelIds) =>
      channelMap({ "chan-A": [{ brandId: "brand-1", sellingFormatId: "fmt-1", priceCents: 1000 }] })(channelIds)
    );
    mockedPushCatalog.mockResolvedValue(SYNC_RESULT(1));
    mockedDeleteStaleItems.mockResolvedValue(NO_STALE);

    const res = await catalogPOST(req());
    expect(res.status).toBe(200);

    // Nothing to push for the empty brand...
    const products = mockedPushCatalog.mock.calls[0][1];
    expect(products.map((p) => p.brandId)).toEqual(["brand-1"]);

    // ...but its Square item survives.
    const keepSet = mockedDeleteStaleItems.mock.calls[0][1];
    expect(keepSet).toEqual(expect.arrayContaining(["brand-1", "brand-2"]));
  });

  it("flags a variation as unpriced (would push $0) when its channel has no price row", async () => {
    useTables({
      bins: {
        data: [{ id: "bin-1", square_location_id: "SQ-LOC-1", pos_sales_channel_id: "chan-A" }],
        error: null,
      },
      sellable_inventory: {
        data: [{ bin_id: "bin-1", brand_id: "brand-1", selling_format_id: "fmt-1", quantity: 5 }],
        error: null,
      },
      brands: { data: [{ id: "brand-1", name: "Brand One", description: null }], error: null },
      selling_formats: { data: [{ id: "fmt-1", name: "16oz 4-Pack" }], error: null },
      square_catalog_map: { data: [], error: null },
      square_sync_log: { data: null, error: null },
    });
    // Channel present in the map but with NO price rows -> variation pushes $0.
    mockedResolveChannelPrices.mockImplementation(async (_brandIds, channelIds) =>
      channelMap({})(channelIds)
    );
    mockedPushCatalog.mockResolvedValue(SYNC_RESULT(1));
    mockedDeleteStaleItems.mockResolvedValue(NO_STALE);

    const res = await catalogPOST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.unpricedVariations).toEqual(["Brand One / 16oz 4-Pack"]);
    // and it's durable in the sync log, not just the response
    const log = inserted().find((i) => i.table === "square_sync_log")!.row as {
      details: { unpricedVariations?: string[] };
    };
    expect(log.details.unpricedVariations).toEqual(["Brand One / 16oz 4-Pack"]);
  });
});

// =============================================================================
// Inventory
// =============================================================================

describe("inventory sync (bin-driven)", () => {
  it("returns CONFIGURATION_ERROR when no POS bins are configured", async () => {
    useTables({ bins: { data: [], error: null } });
    const res = await inventoryPOST(req());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("CONFIGURATION_ERROR");
    expect(mockedPushInventoryCounts).not.toHaveBeenCalled();
  });

  it("pushes quantities as-is (no × unit_count), zeroes unstocked mapped variations, scopes to bin location, batches the log", async () => {
    useTables({
      bins: {
        data: [
          { id: "bin-1", name: "Bin 1", square_location_id: "SQ-LOC-1" },
          { id: "bin-2", name: "Bin 2", square_location_id: "SQ-LOC-2" },
        ],
        error: null,
      },
      square_catalog_map: {
        data: [
          { brand_id: "brand-1", selling_format_id: "fmt-1", square_catalog_id: "SQ-VAR-1" },
          { brand_id: "brand-2", selling_format_id: "fmt-2", square_catalog_id: "SQ-VAR-2" },
        ],
        error: null,
      },
      sellable_inventory: {
        data: [
          // packaged: 5 cases pushed as 5 (NOT × any unit_count), at SQ-LOC-1
          { bin_id: "bin-1", location_id: "loc-1", brand_id: "brand-1", selling_format_id: "fmt-1", quantity: 5, source: "packaged" },
          // keg: 2 kegs pushed as 2, at SQ-LOC-1
          { bin_id: "bin-1", location_id: "loc-1", brand_id: "brand-2", selling_format_id: "fmt-2", quantity: 2, source: "keg" },
          // packaged: 4 cases pushed as 4, at SQ-LOC-2 (SQ-VAR-2 NOT stocked here)
          { bin_id: "bin-2", location_id: "loc-2", brand_id: "brand-1", selling_format_id: "fmt-1", quantity: 4, source: "packaged" },
        ],
        error: null,
      },
      square_sync_log: { data: null, error: null },
    });

    mockedPushInventoryCounts.mockImplementation(async (_client, counts) => SYNC_RESULT(counts.length));

    const res = await inventoryPOST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.binsProcessed).toBe(2);

    // one push per bin (Promise.all preserves bin order)
    expect(mockedPushInventoryCounts).toHaveBeenCalledTimes(2);

    // bin-1 stocks both mapped variations -> both non-zero, no zero-fill needed
    const bin1Counts = mockedPushInventoryCounts.mock.calls[0][1];
    expect(bin1Counts).toEqual(
      expect.arrayContaining([
        { squareVariationId: "SQ-VAR-1", squareLocationId: "SQ-LOC-1", quantity: 5 },
        { squareVariationId: "SQ-VAR-2", squareLocationId: "SQ-LOC-1", quantity: 2 },
      ])
    );
    expect(bin1Counts).toHaveLength(2);

    // bin-2 stocks only SQ-VAR-1 -> SQ-VAR-2 is zeroed (phantom-stock fix)
    const bin2Counts = mockedPushInventoryCounts.mock.calls[1][1];
    expect(bin2Counts).toEqual(
      expect.arrayContaining([
        { squareVariationId: "SQ-VAR-1", squareLocationId: "SQ-LOC-2", quantity: 4 },
        { squareVariationId: "SQ-VAR-2", squareLocationId: "SQ-LOC-2", quantity: 0 },
      ])
    );
    expect(bin2Counts).toHaveLength(2);

    // E2: ONE batched insert whose payload is the array of per-bin rows.
    const logInserts = inserted().filter((i) => i.table === "square_sync_log");
    expect(logInserts).toHaveLength(1);
    const logs = logInserts[0].row as Array<{
      location_id: string | null;
      details: { squareLocationId: string };
    }>;
    expect(logs).toHaveLength(2);
    // location_id is the view's location uuid, not the Square id
    expect(logs[0].location_id).toBe("loc-1");
    expect(logs[0].details.squareLocationId).toBe("SQ-LOC-1");
    expect(logs[1].location_id).toBe("loc-2");
    expect(logs[1].details.squareLocationId).toBe("SQ-LOC-2");

    expect(mockedUpdateSquareSettings).toHaveBeenCalledWith(
      expect.objectContaining({ last_inventory_sync_at: expect.any(String) })
    );
  });

  it("pushes an explicit quantity 0 for a mapped variation that sold out in MGR (no phantom stock)", async () => {
    // fmt-1 in stock; fmt-2 mapped in the catalog but sold out at this bin -> must
    // be pushed as quantity 0 so Square stops showing its last non-zero count.
    useTables({
      bins: {
        data: [{ id: "bin-1", name: "Bin 1", square_location_id: "SQ-LOC-1" }],
        error: null,
      },
      square_catalog_map: {
        data: [
          { brand_id: "brand-1", selling_format_id: "fmt-1", square_catalog_id: "SQ-VAR-1" },
          { brand_id: "brand-1", selling_format_id: "fmt-2", square_catalog_id: "SQ-VAR-2" },
        ],
        error: null,
      },
      sellable_inventory: {
        data: [
          { bin_id: "bin-1", location_id: "loc-1", brand_id: "brand-1", selling_format_id: "fmt-1", quantity: 7, source: "packaged" },
        ],
        error: null,
      },
      square_sync_log: { data: null, error: null },
    });

    mockedPushInventoryCounts.mockImplementation(async (_client, counts) => SYNC_RESULT(counts.length));

    const res = await inventoryPOST(req());
    expect(res.status).toBe(200);

    const counts = mockedPushInventoryCounts.mock.calls[0][1];
    expect(counts).toEqual(
      expect.arrayContaining([
        { squareVariationId: "SQ-VAR-1", squareLocationId: "SQ-LOC-1", quantity: 7 },
        { squareVariationId: "SQ-VAR-2", squareLocationId: "SQ-LOC-1", quantity: 0 },
      ])
    );
    expect(counts).toHaveLength(2);
  });

  it("reports an error (no push) when a stocked format has no catalog mapping", async () => {
    useTables({
      bins: {
        data: [{ id: "bin-1", name: "Bin 1", square_location_id: "SQ-LOC-1" }],
        error: null,
      },
      square_catalog_map: { data: [], error: null },
      sellable_inventory: {
        data: [
          { bin_id: "bin-1", location_id: "loc-1", brand_id: "brand-1", selling_format_id: "fmt-1", quantity: 5, source: "packaged" },
        ],
        error: null,
      },
      square_sync_log: { data: null, error: null },
    });

    const res = await inventoryPOST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.success).toBe(false);
    expect(body.data.errors).toEqual([
      expect.objectContaining({ itemId: "brand-1/fmt-1" }),
    ]);
    // Empty catalog map -> no mapped variations -> nothing (not even zeros) to push.
    expect(mockedPushInventoryCounts).not.toHaveBeenCalled();
    // F4: the mapping error is durably logged per-bin (batched insert), not just
    // in the response.
    const logRows = inserted().find((i) => i.table === "square_sync_log")!.row as Array<{
      details: { errors?: Array<{ itemId: string }> };
    }>;
    expect(logRows[0].details.errors).toEqual([
      expect.objectContaining({ itemId: "brand-1/fmt-1" }),
    ]);
  });
});
