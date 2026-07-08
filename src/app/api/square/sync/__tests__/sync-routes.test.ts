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
 *     - packaged rows (source='packaged') are converted cases -> selling units
 *       (× unit_count); filled kegs (source='keg') are pushed as-is (NOT × unit_count);
 *     - counts are scoped to each bin's square_location_id;
 *     - square_sync_log.location_id is the view's location uuid (not the Square id).
 *
 * The Supabase admin client is mocked with a small faithful chainable builder
 * per the repo idiom (see src/integrations/square/__tests__/pricing.test.ts).
 * withPermission is stubbed to a pass-through so the handler logic is exercised
 * directly.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SquareSyncResult } from "@/integrations/square/types";

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
// In-memory admin builder
// -----------------------------------------------------------------------------

type QueryResult = { data: unknown; error: unknown };
type TableData = Record<string, QueryResult>;

const inserted: Array<{ table: string; row: unknown }> = [];

function makeAdmin(tables: TableData) {
  return {
    from(table: string) {
      const result: QueryResult = tables[table] ?? { data: [], error: null };
      const builder = {
        select: () => builder,
        not: () => builder,
        in: () => builder,
        gt: () => builder,
        eq: () => builder,
        single: () => Promise.resolve(result),
        insert: (row: unknown) => {
          inserted.push({ table, row });
          return {
            then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
              Promise.resolve({ error: null }).then(onF, onR),
          };
        },
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(onF, onR),
      };
      return builder;
    },
  };
}

function useTables(tables: TableData) {
  mockedCreateAdminClient.mockImplementation(
    async () => makeAdmin(tables) as unknown as Awaited<ReturnType<typeof createAdminClient>>
  );
}

const SYNC_RESULT = (n: number): SquareSyncResult => ({
  success: true,
  itemsSynced: n,
  itemsFailed: 0,
  errors: [],
});

const req = () => new NextRequest("http://localhost/api/square/sync");

beforeEach(() => {
  vi.clearAllMocks();
  inserted.length = 0;
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

    mockedResolveChannelPrices.mockImplementation(async (_brandIds, channelId) => {
      if (channelId === "chan-A") {
        return [{ brandId: "brand-1", sellingFormatId: "fmt-1", priceCents: 1000 }];
      }
      if (channelId === "chan-B") {
        return [
          { brandId: "brand-1", sellingFormatId: "fmt-1", priceCents: 2000 },
          { brandId: "brand-2", sellingFormatId: "fmt-2", priceCents: 3000 },
        ];
      }
      return [];
    });
    mockedPushCatalog.mockResolvedValue(SYNC_RESULT(2));
    mockedDeleteStaleItems.mockResolvedValue(0);

    const res = await catalogPOST(req());
    expect(res.status).toBe(200);

    // one resolveChannelPrices call per DISTINCT channel
    expect(mockedResolveChannelPrices).toHaveBeenCalledTimes(2);

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
    const log = inserted.find((i) => i.table === "square_sync_log")!.row as {
      details: { posBinCount: number };
    };
    expect(log.details.posBinCount).toBe(2);

    expect(mockedUpdateSquareSettings).toHaveBeenCalledWith(
      expect.objectContaining({ last_catalog_sync_at: expect.any(String) })
    );
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

  it("converts packaged cases by unit_count, pushes kegs as-is, scopes to bin square location, logs view location_id", async () => {
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
          // packaged: 5 cases × unit_count 6 = 30 selling units, at SQ-LOC-1
          { bin_id: "bin-1", location_id: "loc-1", brand_id: "brand-1", selling_format_id: "fmt-1", quantity: 5, source: "packaged" },
          // keg: 2 kegs pushed as-is (NOT × unit_count 12), at SQ-LOC-1
          { bin_id: "bin-1", location_id: "loc-1", brand_id: "brand-2", selling_format_id: "fmt-2", quantity: 2, source: "keg" },
          // packaged: 4 cases × 6 = 24, at SQ-LOC-2
          { bin_id: "bin-2", location_id: "loc-2", brand_id: "brand-1", selling_format_id: "fmt-1", quantity: 4, source: "packaged" },
        ],
        error: null,
      },
      selling_formats: {
        data: [
          { id: "fmt-1", unit_count: 6 },
          { id: "fmt-2", unit_count: 12 }, // keg format: proves keg is NOT multiplied
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

    // two pushes: one per bin that produced counts, in bin order
    expect(mockedPushInventoryCounts).toHaveBeenCalledTimes(2);

    const bin1Counts = mockedPushInventoryCounts.mock.calls[0][1];
    expect(bin1Counts).toEqual(
      expect.arrayContaining([
        { squareVariationId: "SQ-VAR-1", squareLocationId: "SQ-LOC-1", quantity: 30 },
        { squareVariationId: "SQ-VAR-2", squareLocationId: "SQ-LOC-1", quantity: 2 },
      ])
    );
    expect(bin1Counts).toHaveLength(2);

    const bin2Counts = mockedPushInventoryCounts.mock.calls[1][1];
    expect(bin2Counts).toEqual([
      { squareVariationId: "SQ-VAR-1", squareLocationId: "SQ-LOC-2", quantity: 24 },
    ]);

    // one log per bin; location_id is the view's location uuid, not the Square id
    const logs = inserted.filter((i) => i.table === "square_sync_log").map((i) => i.row as {
      location_id: string | null;
      details: { squareLocationId: string };
    });
    expect(logs).toHaveLength(2);
    expect(logs[0].location_id).toBe("loc-1");
    expect(logs[0].details.squareLocationId).toBe("SQ-LOC-1");
    expect(logs[1].location_id).toBe("loc-2");
    expect(logs[1].details.squareLocationId).toBe("SQ-LOC-2");

    expect(mockedUpdateSquareSettings).toHaveBeenCalledWith(
      expect.objectContaining({ last_inventory_sync_at: expect.any(String) })
    );
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
      selling_formats: { data: [{ id: "fmt-1", unit_count: 1 }], error: null },
      square_sync_log: { data: null, error: null },
    });

    const res = await inventoryPOST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.success).toBe(false);
    expect(body.data.errors).toEqual([
      expect.objectContaining({ itemId: "brand-1/fmt-1" }),
    ]);
    expect(mockedPushInventoryCounts).not.toHaveBeenCalled();
  });
});
