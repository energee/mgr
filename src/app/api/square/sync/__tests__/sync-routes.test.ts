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
 *       the first channel by bin order (v1 single-price-per-variation);
 *     - the stale-cleanup KEEP set is the ACTIVE brand set (brands.is_active,
 *       00244 — audit IN-9), never derived from stock/bin reads; an INACTIVE
 *       brand is excluded from both the push and the keep set (intentional
 *       removal), and { forceStaleDelete } threads from the request body to
 *       deleteStaleItems' bulk-delete guard.
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
  retrieveVariationPricing: vi.fn(),
}));

vi.mock("@/integrations/square/inventory", () => ({
  pushInventoryCounts: vi.fn(),
}));

vi.mock("@/integrations/square/pricing", () => ({
  resolveChannelPrices: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { getSquareClient, updateSquareSettings } from "@/integrations/square/client";
import { pushCatalog, deleteStaleItems, retrieveVariationPricing } from "@/integrations/square/catalog";
import { pushInventoryCounts } from "@/integrations/square/inventory";
import { resolveChannelPrices } from "@/integrations/square/pricing";

import { POST as catalogPOST } from "@/app/api/square/sync/catalog/route";
import { POST as inventoryPOST } from "@/app/api/square/sync/inventory/route";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedGetSquareClient = vi.mocked(getSquareClient);
const mockedUpdateSquareSettings = vi.mocked(updateSquareSettings);
const mockedPushCatalog = vi.mocked(pushCatalog);
const mockedDeleteStaleItems = vi.mocked(deleteStaleItems);
const mockedRetrieveVariationPricing = vi.mocked(retrieveVariationPricing);
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
  // Default: no mapped-but-unpriced variations need live-price preservation.
  mockedRetrieveVariationPricing.mockResolvedValue(new Map());
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

    // stale cleanup keyed off the ACTIVE brand set (00244); guard armed by default
    expect(mockedDeleteStaleItems).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(["brand-1", "brand-2"]),
      { force: false }
    );

    // log records the POS bin count
    const log = inserted().find((i) => i.table === "square_sync_log")!.row as {
      details: { posBinCount: number };
    };
    expect(log.details.posBinCount).toBe(2);

    expect(mockedUpdateSquareSettings).toHaveBeenCalledWith(
      expect.objectContaining({ last_catalog_sync_at: expect.any(String) })
    );
  });

  it("aborts (500 SYNC_FAILED, no push) when the square_catalog_map read fails — a swallowed error would duplicate the whole catalog", async () => {
    // With an empty map lookup every object pushes with a temp "#brand-…" id,
    // creating a FULL DUPLICATE catalog in Square. The read error must abort.
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
      square_catalog_map: { data: null, error: { message: "map read boom" } },
      square_sync_log: { data: null, error: null },
    });
    mockedResolveChannelPrices.mockResolvedValue(new Map([["chan-A", []]]));

    const res = await catalogPOST(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("SYNC_FAILED");
    expect(body.error.message).toContain("map read boom");
    expect(mockedPushCatalog).not.toHaveBeenCalled();
    expect(mockedDeleteStaleItems).not.toHaveBeenCalled();
  });

  it("aborts (500 SYNC_FAILED, no push) when the selling_formats read fails — would push 'Unknown Format' as live variation names", async () => {
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
      selling_formats: { data: null, error: { message: "formats read boom" } },
      square_sync_log: { data: null, error: null },
    });

    const res = await catalogPOST(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("SYNC_FAILED");
    expect(body.error.message).toContain("formats read boom");
    expect(mockedPushCatalog).not.toHaveBeenCalled();
    expect(mockedDeleteStaleItems).not.toHaveBeenCalled();
  });

  it("skips stale cleanup entirely when the active-brand read returns NO brands", async () => {
    useTables({
      bins: {
        data: [{ id: "bin-1", square_location_id: "SQ-LOC-1", pos_sales_channel_id: "chan-A" }],
        error: null,
      },
      sellable_inventory: { data: [], error: null },
      brands: { data: [], error: null }, // unseeded/empty — NOT a product-line shutdown
      square_catalog_map: { data: [], error: null },
      square_sync_log: { data: null, error: null },
    });
    mockedResolveChannelPrices.mockResolvedValue(new Map());
    mockedPushCatalog.mockResolvedValue(SYNC_RESULT(0));
    mockedDeleteStaleItems.mockResolvedValue(NO_STALE);

    const res = await catalogPOST(req());
    expect(res.status).toBe(200);
    // An empty keep set must NOT reach deleteStaleItems, which treats [] as
    // "delete the ENTIRE catalog".
    expect(mockedDeleteStaleItems).not.toHaveBeenCalled();
  });

  it("keeps the keep set at the FULL active-brand set when the stock read is empty — a bin re-point or transient zero-stock cannot shrink it (IN-9)", async () => {
    // Pre-00244 the keep set was derived from stock/bin_inventory reads, so a
    // POS-bin re-point (stock not yet moved) dropped every packaged brand from
    // it and deleteStaleItems destroyed the live Square catalog. Now the keep
    // set is brands.is_active — config state the stock read cannot touch.
    useTables({
      bins: {
        data: [{ id: "bin-1", square_location_id: "SQ-LOC-1", pos_sales_channel_id: "chan-A" }],
        error: null,
      },
      sellable_inventory: { data: [], error: null }, // re-pointed bin: zero stock visible
      brands: {
        data: [
          { id: "brand-1", name: "Brand One", description: null },
          { id: "brand-2", name: "Brand Two", description: null },
        ],
        error: null,
      },
      square_catalog_map: { data: [], error: null },
      square_sync_log: { data: null, error: null },
    });
    mockedResolveChannelPrices.mockResolvedValue(new Map());
    mockedPushCatalog.mockResolvedValue(SYNC_RESULT(0));
    mockedDeleteStaleItems.mockResolvedValue(NO_STALE);

    const res = await catalogPOST(req());
    expect(res.status).toBe(200);

    expect(mockedDeleteStaleItems).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(["brand-1", "brand-2"]),
      { force: false }
    );
  });

  it("keeps a SOLD-OUT (still active) brand in the catalog: absent from the push, present in the keep set", async () => {
    // brand-1 in stock; brand-2 sold out (absent from the positive-only view).
    // Sold out is NOT discontinued: brand-2 is still active, so it stays in the
    // keep set even though it isn't re-pushed. (Covers the old packaged qty-0
    // and keg-blew cases alike — the keep set no longer infers from stock.)
    useTables({
      bins: {
        data: [{ id: "bin-1", square_location_id: "SQ-LOC-1", pos_sales_channel_id: "chan-A" }],
        error: null,
      },
      sellable_inventory: {
        data: [{ bin_id: "bin-1", brand_id: "brand-1", selling_format_id: "fmt-1", quantity: 5 }],
        error: null,
      },
      brands: {
        data: [
          { id: "brand-1", name: "Brand One", description: null },
          { id: "brand-2", name: "Brand Two", description: null },
        ],
        error: null,
      },
      selling_formats: { data: [{ id: "fmt-1", name: "16oz 4-Pack" }], error: null },
      square_catalog_map: { data: [], error: null },
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

  it("excludes an INACTIVE brand from the push AND the keep set even while stocked — discontinuing is the intentional removal path", async () => {
    // brand-2 still has stock at a POS bin but is_active = false: it must not
    // be (re)published, and dropping out of the keep set is what lets
    // deleteStaleItems remove its mapped Square objects. The brands response
    // honors the route's .eq("is_active", true) filter, so the filter itself
    // is exercised, not just the resulting row set.
    const brandRows = [
      { id: "brand-1", name: "Brand One", description: null, is_active: true },
      { id: "brand-2", name: "Brand Two", description: null, is_active: false },
    ];
    useTables({
      bins: {
        data: [{ id: "bin-1", square_location_id: "SQ-LOC-1", pos_sales_channel_id: "chan-A" }],
        error: null,
      },
      sellable_inventory: {
        data: [
          { bin_id: "bin-1", brand_id: "brand-1", selling_format_id: "fmt-1", quantity: 5 },
          { bin_id: "bin-1", brand_id: "brand-2", selling_format_id: "fmt-1", quantity: 3 },
        ],
        error: null,
      },
      brands: ({ calls }) => {
        const active = calls.find((c) => c.method === "eq" && c.args[0] === "is_active");
        return {
          data: active ? brandRows.filter((r) => r.is_active === active.args[1]) : brandRows,
          error: null,
        };
      },
      selling_formats: { data: [{ id: "fmt-1", name: "16oz 4-Pack" }], error: null },
      square_catalog_map: { data: [], error: null },
      square_sync_log: { data: null, error: null },
    });
    mockedResolveChannelPrices.mockImplementation(async (_brandIds, channelIds) =>
      channelMap({ "chan-A": [{ brandId: "brand-1", sellingFormatId: "fmt-1", priceCents: 1000 }] })(channelIds)
    );
    mockedPushCatalog.mockResolvedValue(SYNC_RESULT(1));
    mockedDeleteStaleItems.mockResolvedValue(NO_STALE);

    const res = await catalogPOST(req());
    expect(res.status).toBe(200);

    // The inactive brand's stock rows are dropped from the push...
    const products = mockedPushCatalog.mock.calls[0][1];
    expect(products.map((p) => p.brandId)).toEqual(["brand-1"]);

    // ...and it is NOT in the keep set: stale cleanup will delete its objects.
    expect(mockedDeleteStaleItems).toHaveBeenCalledWith(expect.anything(), ["brand-1"], {
      force: false,
    });
  });

  it("threads forceStaleDelete from the request body to deleteStaleItems' guard override", async () => {
    useTables({
      bins: {
        data: [{ id: "bin-1", square_location_id: "SQ-LOC-1", pos_sales_channel_id: "chan-A" }],
        error: null,
      },
      sellable_inventory: { data: [], error: null },
      brands: { data: [{ id: "brand-1", name: "Brand One", description: null }], error: null },
      square_catalog_map: { data: [], error: null },
      square_sync_log: { data: null, error: null },
    });
    mockedResolveChannelPrices.mockResolvedValue(new Map());
    mockedPushCatalog.mockResolvedValue(SYNC_RESULT(0));
    mockedDeleteStaleItems.mockResolvedValue(NO_STALE);

    const res = await catalogPOST(
      new NextRequest("http://localhost/api/square/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ forceStaleDelete: true }),
      })
    );
    expect(res.status).toBe(200);

    expect(mockedDeleteStaleItems).toHaveBeenCalledWith(expect.anything(), ["brand-1"], {
      force: true,
    });
  });

  it("surfaces a guard ABORT: success false, staleAborted in the response and the sync log", async () => {
    useTables({
      bins: {
        data: [{ id: "bin-1", square_location_id: "SQ-LOC-1", pos_sales_channel_id: "chan-A" }],
        error: null,
      },
      sellable_inventory: { data: [], error: null },
      brands: { data: [{ id: "brand-1", name: "Brand One", description: null }], error: null },
      square_catalog_map: { data: [], error: null },
      square_sync_log: { data: null, error: null },
    });
    mockedResolveChannelPrices.mockResolvedValue(new Map());
    mockedPushCatalog.mockResolvedValue(SYNC_RESULT(0));
    const aborted = {
      staleCount: 12,
      mappedCount: 20,
      reason: "stale set of 12 exceeds the absolute cap of 10 mapped objects",
    };
    mockedDeleteStaleItems.mockResolvedValue({ deleted: 0, failed: 0, aborted, errors: [] });

    const res = await catalogPOST(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    // Refused-pending-confirmation is NOT a success...
    expect(body.data.success).toBe(false);
    expect(body.data.staleAborted).toEqual(aborted);
    // ...and it is durable in the sync log, not just the response.
    const log = inserted().find((i) => i.table === "square_sync_log")!.row as {
      details: { staleAborted?: typeof aborted };
    };
    expect(log.details.staleAborted).toEqual(aborted);
  });

  it("skips an UNMAPPED unpriced brand entirely instead of publishing it at $0, and keeps it active", async () => {
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

    // Square reads priceCents 0 as FIXED_PRICING $0.00 — sellable for free at the
    // register. An UNMAPPED unpriced variation must never reach pushCatalog, and
    // with nothing mapped there is no live price to preserve either.
    const pushed = mockedPushCatalog.mock.calls[0][1];
    expect(pushed.flatMap((p) => p.variations)).toEqual([]);
    expect(mockedRetrieveVariationPricing).not.toHaveBeenCalled();

    // ...but the brand IS active, so deleteStaleItems must not treat it as
    // stale and delete its live Square item.
    expect(mockedDeleteStaleItems).toHaveBeenCalledWith(expect.anything(), ["brand-1"], {
      force: false,
    });
    // and it's durable in the sync log, not just the response
    const log = inserted().find((i) => i.table === "square_sync_log")!.row as {
      details: { unpricedVariations?: string[] };
    };
    expect(log.details.unpricedVariations).toEqual(["Brand One / 16oz 4-Pack"]);
  });

  /** Fixture: brand-1 stocks fmt-1 (priced $10) and fmt-2 (NO price row). */
  const twoVariationTables = (catalogMap: Array<Record<string, unknown>>): TableData => ({
    bins: {
      data: [{ id: "bin-1", square_location_id: "SQ-LOC-1", pos_sales_channel_id: "chan-A" }],
      error: null,
    },
    sellable_inventory: {
      data: [
        { bin_id: "bin-1", brand_id: "brand-1", selling_format_id: "fmt-1", quantity: 5 },
        { bin_id: "bin-1", brand_id: "brand-1", selling_format_id: "fmt-2", quantity: 3 },
      ],
      error: null,
    },
    brands: { data: [{ id: "brand-1", name: "Brand One", description: null }], error: null },
    selling_formats: {
      data: [
        { id: "fmt-1", name: "16oz 4-Pack" },
        { id: "fmt-2", name: "1/2 BBL Draft" },
      ],
      error: null,
    },
    square_catalog_map: { data: catalogMap, error: null },
    square_sync_log: { data: null, error: null },
  });

  const priceOnlyFmt1 = () =>
    mockedResolveChannelPrices.mockImplementation(async (_brandIds, channelIds) =>
      channelMap({
        "chan-A": [{ brandId: "brand-1", sellingFormatId: "fmt-1", priceCents: 1000 }],
      })(channelIds)
    );

  it("preserves a MAPPED unpriced sibling variation at its CURRENT live price — Square's upsert replaces the full variation set, so omitting it would delete it live", async () => {
    useTables(
      twoVariationTables([
        {
          object_type: "ITEM_VARIATION",
          brand_id: "brand-1",
          selling_format_id: "fmt-2",
          square_catalog_id: "SQ-VAR-2",
          square_version: 5,
        },
      ])
    );
    priceOnlyFmt1();
    // Live Square says fmt-2 currently sells at $8.50, object version 9.
    mockedRetrieveVariationPricing.mockResolvedValue(
      new Map([["SQ-VAR-2", { pricingType: "FIXED_PRICING" as const, priceCents: 850, version: BigInt(9) }]])
    );
    mockedPushCatalog.mockResolvedValue(SYNC_RESULT(1));
    mockedDeleteStaleItems.mockResolvedValue(NO_STALE);

    const res = await catalogPOST(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    // The live price was read for exactly the mapped-unpriced variation.
    expect(mockedRetrieveVariationPricing).toHaveBeenCalledWith(expect.anything(), ["SQ-VAR-2"]);

    // Both variations reach the push: fmt-1 at its MGR price, fmt-2 PRESERVED
    // with its existing Square id, LIVE price (not repriced), and LIVE version.
    const pushed = mockedPushCatalog.mock.calls[0][1];
    const variations = pushed.flatMap((p) => p.variations);
    expect(variations).toHaveLength(2);
    expect(variations.find((v) => v.sellingFormatId === "fmt-1")?.priceCents).toBe(1000);
    const preserved = variations.find((v) => v.sellingFormatId === "fmt-2");
    expect(preserved).toMatchObject({
      squareCatalogId: "SQ-VAR-2",
      priceCents: 850,
      pricingType: "FIXED_PRICING",
      squareVersion: BigInt(9),
    });

    // Surfaced as preserved, NOT as omitted.
    expect(body.data.preservedVariations).toEqual(["Brand One / 1/2 BBL Draft"]);
    expect(body.data.unpricedVariations).toEqual([]);
  });

  it("omits an UNMAPPED unpriced sibling from the push (nothing live to delete) while the priced sibling still publishes", async () => {
    useTables(twoVariationTables([]));
    priceOnlyFmt1();
    mockedPushCatalog.mockResolvedValue(SYNC_RESULT(1));
    mockedDeleteStaleItems.mockResolvedValue(NO_STALE);

    const res = await catalogPOST(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    const pushed = mockedPushCatalog.mock.calls[0][1];
    const variations = pushed.flatMap((p) => p.variations);
    expect(variations.map((v) => v.sellingFormatId)).toEqual(["fmt-1"]);
    expect(mockedRetrieveVariationPricing).not.toHaveBeenCalled();
    expect(body.data.unpricedVariations).toEqual(["Brand One / 1/2 BBL Draft"]);
    expect(body.data.preservedVariations).toEqual([]);
  });

  it("treats a mapped unpriced variation whose live object is GONE as unmapped: omitted and surfaced, not pushed with a dead id", async () => {
    useTables(
      twoVariationTables([
        {
          object_type: "ITEM_VARIATION",
          brand_id: "brand-1",
          selling_format_id: "fmt-2",
          square_catalog_id: "SQ-VAR-GONE",
          square_version: 5,
        },
      ])
    );
    priceOnlyFmt1();
    // batchGet omits deleted objects -> empty map.
    mockedRetrieveVariationPricing.mockResolvedValue(new Map());
    mockedPushCatalog.mockResolvedValue(SYNC_RESULT(1));
    mockedDeleteStaleItems.mockResolvedValue(NO_STALE);

    const res = await catalogPOST(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    const pushed = mockedPushCatalog.mock.calls[0][1];
    expect(pushed.flatMap((p) => p.variations).map((v) => v.sellingFormatId)).toEqual(["fmt-1"]);
    expect(body.data.unpricedVariations).toEqual(["Brand One / 1/2 BBL Draft"]);
    expect(body.data.preservedVariations).toEqual([]);
  });

  it("aborts (500 SYNC_FAILED, no push) when the live-pricing read fails — pushing without the preserved variations is exactly the deletion being prevented", async () => {
    useTables(
      twoVariationTables([
        {
          object_type: "ITEM_VARIATION",
          brand_id: "brand-1",
          selling_format_id: "fmt-2",
          square_catalog_id: "SQ-VAR-2",
          square_version: 5,
        },
      ])
    );
    priceOnlyFmt1();
    mockedRetrieveVariationPricing.mockRejectedValue(new Error("square read boom"));
    mockedPushCatalog.mockResolvedValue(SYNC_RESULT(1));
    mockedDeleteStaleItems.mockResolvedValue(NO_STALE);

    const res = await catalogPOST(req());
    expect(res.status).toBe(500);
    expect(mockedPushCatalog).not.toHaveBeenCalled();
    expect(mockedDeleteStaleItems).not.toHaveBeenCalled();
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

  it("pushes quantities as-is (no × unit_count), skips keg rows (BD-4), zeroes unstocked mapped packaged variations, scopes to bin location, batches the log", async () => {
    useTables({
      bins: {
        data: [
          { id: "bin-1", name: "Bin 1", square_location_id: "SQ-LOC-1", location_id: "loc-1" },
          { id: "bin-2", name: "Bin 2", square_location_id: "SQ-LOC-2", location_id: "loc-2" },
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
      // fmt-2 is a KEG selling format (the route queries selling_formats
      // filtered to containers.type = 'keg'; the mock returns the keg set).
      selling_formats: { data: [{ id: "fmt-2" }], error: null },
      sellable_inventory: {
        data: [
          // packaged: 5 cases pushed as 5 (NOT × any unit_count), at SQ-LOC-1
          { bin_id: "bin-1", location_id: "loc-1", brand_id: "brand-1", selling_format_id: "fmt-1", quantity: 5, source: "packaged" },
          // keg: 2 whole kegs — NOT pushed (BD-4: the Square variation sells
          // POURS; pushing "2" would mark the tap sold out after two pints).
          // This keg row's location_id deliberately disagrees with bin-1's: keg
          // rows carry keg_transactions.to_location_id, which is set
          // independently of the bin. The sync log must record the BIN's
          // location (loc-1), never a stock row's.
          { bin_id: "bin-1", location_id: "loc-9", brand_id: "brand-2", selling_format_id: "fmt-2", quantity: 2, source: "keg" },
          // packaged: 4 cases pushed as 4, at SQ-LOC-2
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
    // The skipped keg row is surfaced, never silent (BD-4).
    expect(body.data.kegRowsSkipped).toBe(1);

    // one push per bin (Promise.all preserves bin order)
    expect(mockedPushInventoryCounts).toHaveBeenCalledTimes(2);

    // bin-1: only the packaged variation pushes; the keg row is skipped AND the
    // keg variation is NOT zero-swept (its Square count is not MGR-managed).
    const bin1Counts = mockedPushInventoryCounts.mock.calls[0][1];
    expect(bin1Counts).toEqual([
      { squareVariationId: "SQ-VAR-1", squareLocationId: "SQ-LOC-1", quantity: 5 },
    ]);

    // bin-2: packaged count only; SQ-VAR-2 (keg) again absent, not zeroed.
    const bin2Counts = mockedPushInventoryCounts.mock.calls[1][1];
    expect(bin2Counts).toEqual([
      { squareVariationId: "SQ-VAR-1", squareLocationId: "SQ-LOC-2", quantity: 4 },
    ]);

    // E2: ONE batched insert whose payload is the array of per-bin rows.
    const logInserts = inserted().filter((i) => i.table === "square_sync_log");
    expect(logInserts).toHaveLength(1);
    const logs = logInserts[0].row as Array<{
      location_id: string | null;
      details: { squareLocationId: string; kegRowsSkipped?: number };
    }>;
    expect(logs).toHaveLength(2);
    // location_id is the view's location uuid, not the Square id
    expect(logs[0].location_id).toBe("loc-1");
    expect(logs[0].details.squareLocationId).toBe("SQ-LOC-1");
    // ... and the keg skip is durable in the bin's log details.
    expect(logs[0].details.kegRowsSkipped).toBe(1);
    expect(logs[1].location_id).toBe("loc-2");
    expect(logs[1].details.squareLocationId).toBe("SQ-LOC-2");
    expect(logs[1].details.kegRowsSkipped).toBeUndefined();

    expect(mockedUpdateSquareSettings).toHaveBeenCalledWith(
      expect.objectContaining({ last_inventory_sync_at: expect.any(String) })
    );
  });

  it("keg-only bin: every row skipped -> nothing pushed, skip count still surfaced (BD-4)", async () => {
    // A taproom bin holding ONLY filled kegs must not push any PHYSICAL_COUNT
    // (neither the keg count nor a zero for the keg variation) — Square's
    // count for keg variations is not MGR-managed at all.
    useTables({
      bins: {
        data: [{ id: "bin-1", name: "Taproom", square_location_id: "SQ-LOC-1", location_id: "loc-1" }],
        error: null,
      },
      square_catalog_map: {
        data: [{ brand_id: "brand-1", selling_format_id: "fmt-keg", square_catalog_id: "SQ-VAR-KEG" }],
        error: null,
      },
      selling_formats: { data: [{ id: "fmt-keg" }], error: null },
      sellable_inventory: {
        data: [
          { bin_id: "bin-1", location_id: "loc-1", brand_id: "brand-1", selling_format_id: "fmt-keg", quantity: 3, source: "keg" },
        ],
        error: null,
      },
      square_sync_log: { data: null, error: null },
    });

    const res = await inventoryPOST(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    // No counts at all — not even a zero for the keg variation.
    expect(mockedPushInventoryCounts).not.toHaveBeenCalled();
    expect(body.data.kegRowsSkipped).toBe(1);
    expect(body.data.totalSynced).toBe(0);
    expect(body.data.errors).toEqual([]);

    // The no-work log entry still records the skip durably.
    const logRow = inserted().find((i) => i.table === "square_sync_log")!.row as {
      details: { kegRowsSkipped?: number };
    };
    expect(logRow.details.kegRowsSkipped).toBe(1);
  });

  it("pushes an explicit quantity 0 for a mapped variation that sold out in MGR (no phantom stock)", async () => {
    // fmt-1 in stock; fmt-2 mapped in the catalog but sold out at this bin -> must
    // be pushed as quantity 0 so Square stops showing its last non-zero count.
    useTables({
      bins: {
        data: [{ id: "bin-1", name: "Bin 1", square_location_id: "SQ-LOC-1", location_id: "loc-1" }],
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
        data: [{ id: "bin-1", name: "Bin 1", square_location_id: "SQ-LOC-1", location_id: "loc-1" }],
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

  // #610: the timestamp is the operator's "the push landed" signal. Stamping it
  // at a fixed point in the happy path recorded "the handler reached step 6"
  // instead — an expired Square token produced a fresh "Inventory: <now>" while
  // nothing reached the POS.
  it("withholds last_inventory_sync_at when the push to Square failed (#610)", async () => {
    useTables({
      bins: {
        data: [{ id: "bin-1", name: "Bin 1", square_location_id: "SQ-LOC-1", location_id: "loc-1" }],
        error: null,
      },
      square_catalog_map: {
        data: [{ brand_id: "brand-1", selling_format_id: "fmt-1", square_catalog_id: "SQ-VAR-1" }],
        error: null,
      },
      selling_formats: { data: [{ id: "fmt-1" }], error: null },
      sellable_inventory: {
        data: [
          { bin_id: "bin-1", location_id: "loc-1", brand_id: "brand-1", selling_format_id: "fmt-1", quantity: 5, source: "packaged" },
        ],
        error: null,
      },
      square_sync_log: { data: null, error: null },
    });
    // pushInventoryCounts never throws on a Square API error — it catches per
    // chunk and reports success: false.
    mockedPushInventoryCounts.mockResolvedValue({
      success: false,
      itemsSynced: 0,
      itemsFailed: 1,
      errors: [{ itemId: "SQ-VAR-1", error: "UNAUTHORIZED" }],
    });

    const res = await inventoryPOST(req());
    expect(res.status).toBe(200);
    expect((await res.json()).data.success).toBe(false);
    expect(mockedUpdateSquareSettings).not.toHaveBeenCalled();
  });

  it("records a hard inventory failure distinguishably from a clean no-op run (#610)", async () => {
    useTables({
      bins: {
        data: [{ id: "bin-1", name: "Bin 1", square_location_id: "SQ-LOC-1", location_id: "loc-1" }],
        error: null,
      },
      square_catalog_map: {
        data: [{ brand_id: "brand-1", selling_format_id: "fmt-1", square_catalog_id: "SQ-VAR-1" }],
        error: null,
      },
      selling_formats: { data: [{ id: "fmt-1" }], error: null },
      sellable_inventory: {
        data: [
          { bin_id: "bin-1", location_id: "loc-1", brand_id: "brand-1", selling_format_id: "fmt-1", quantity: 5, source: "packaged" },
        ],
        error: null,
      },
      square_sync_log: { data: null, error: null },
    });
    mockedPushInventoryCounts.mockRejectedValue(new Error("square exploded"));

    const res = await inventoryPOST(req());
    expect(res.status).toBe(500);
    const logRow = inserted().find((i) => i.table === "square_sync_log")!.row as {
      items_failed: number;
      details: { error: string };
    };
    // items_failed: 0 made this row read as a clean no-op in Recent Activity.
    expect(logRow.items_failed).toBeGreaterThan(0);
    expect(logRow.details.error).toBe("square exploded");
    expect(mockedUpdateSquareSettings).not.toHaveBeenCalled();
  });
});
