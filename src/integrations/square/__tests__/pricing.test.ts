/**
 * Square pricing resolution tests.
 *
 * Characterizes the batched channel price resolver (E3):
 *   - resolveChannelPrices(brandIds, salesChannelIds[]) fetches EVERY requested
 *     channel in one round of queries and returns a Map<channelId, ChannelPrice[]>.
 *
 * Parity guarantee: passing [taproom] reproduces today's taproom prices
 * byte-for-byte — asserted by the exact-cents case below. The multi-channel case
 * proves batching + no cross-channel leakage in a single call.
 *
 * Supabase is mocked at @/lib/supabase/server with the shared admin mock
 * (src/test/supabase-admin-mock.ts). The pricing_tier_prices response honors the
 * .in("sales_channel_id", [...]) filter, so channel parameterization is genuinely
 * exercised rather than stubbed away, and any table the resolver does not already
 * query throws instead of resolving vacuously empty.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeAdminMock } from "@/test/supabase-admin-mock";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { createAdminClient } from "@/lib/supabase/server";
import { resolveChannelPrices } from "@/integrations/square/pricing";

const mockedCreateAdminClient = vi.mocked(createAdminClient);

// -----------------------------------------------------------------------------
// Faithful in-memory Supabase mock
// -----------------------------------------------------------------------------

type BrandRow = { id: string; name: string };
type RecipeRow = {
  id: string;
  brand_id: string | null;
  pricing_tier_id: string | null;
  updated_at: string;
};
type PriceRow = {
  pricing_tier_id: string;
  format_id: string | null;
  price: number;
  sales_channel_id: string;
};

type Fixtures = {
  brands: BrandRow[];
  recipes: RecipeRow[];
  prices: PriceRow[];
};

/**
 * Installs an admin client over the three tables resolveChannelPrices touches
 * (brands, recipes, pricing_tier_prices). The sales_channel_id filter is honored;
 * the rest are pass-through. Any fourth table throws.
 */
function useFixtures(fixtures: Fixtures) {
  const { admin } = makeAdminMock(
    {
      brands: { data: fixtures.brands, error: null },
      // Honor the .order() chain, so the deterministic-tier tests below genuinely
      // exercise the resolver's ORDER BY instead of passing vacuously on
      // fixture insertion order.
      recipes: ({ calls }) => {
        const orders = calls.filter((c) => c.method === "order");
        const data = [...fixtures.recipes].sort((a, b) => {
          for (const { args } of orders) {
            const col = args[0] as keyof RecipeRow;
            const asc = (args[1] as { ascending?: boolean } | undefined)?.ascending !== false;
            const av = a[col] ?? "";
            const bv = b[col] ?? "";
            if (av === bv) continue;
            return (av < bv ? -1 : 1) * (asc ? 1 : -1);
          }
          return 0;
        });
        return { data, error: null };
      },
      // The resolver filters channels with .in("sales_channel_id", [...]); honor
      // that (and ignore the .in("pricing_tier_id", ...) which the fixture rows
      // already satisfy).
      pricing_tier_prices: ({ calls }) => {
        const channelFilter = calls.find(
          (c) => c.method === "in" && c.args[0] === "sales_channel_id"
        )?.args[1] as string[] | undefined;
        const data = fixtures.prices.filter((p) =>
          channelFilter ? channelFilter.includes(p.sales_channel_id) : true
        );
        return { data, error: null };
      },
    },
    { onUnknownTable: "throw" }
  );
  mockedCreateAdminClient.mockResolvedValue(admin as never);
}

const TAPROOM_ID = "chan-taproom-uuid";
const WHOLESALE_ID = "chan-wholesale-uuid";
const BRAND_A = "brand-a-uuid";
const BRAND_B = "brand-b-uuid";
const BRAND_IDS = [BRAND_A, BRAND_B];

const baseFixtures: Fixtures = {
  brands: [
    { id: BRAND_A, name: "Brand A" },
    { id: BRAND_B, name: "Brand B" },
  ],
  recipes: [
    { id: "recipe-a", brand_id: BRAND_A, pricing_tier_id: "tier-1", updated_at: "2026-01-01T00:00:00Z" },
    { id: "recipe-b", brand_id: BRAND_B, pricing_tier_id: "tier-2", updated_at: "2026-01-01T00:00:00Z" },
  ],
  prices: [
    // taproom prices
    { pricing_tier_id: "tier-1", format_id: "fmt-x", price: 10, sales_channel_id: TAPROOM_ID },
    { pricing_tier_id: "tier-1", format_id: "fmt-y", price: 12.5, sales_channel_id: TAPROOM_ID },
    { pricing_tier_id: "tier-2", format_id: "fmt-x", price: 8, sales_channel_id: TAPROOM_ID },
    // wholesale price (different channel — must NOT leak into taproom result)
    { pricing_tier_id: "tier-1", format_id: "fmt-x", price: 20, sales_channel_id: WHOLESALE_ID },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveChannelPrices", () => {
  it("resolves prices for the taproom channel", async () => {
    useFixtures(baseFixtures);
    const result = await resolveChannelPrices(BRAND_IDS, [TAPROOM_ID]);
    expect(result.get(TAPROOM_ID)).toEqual([
      { brandId: BRAND_A, sellingFormatId: "fmt-x", priceCents: 1000 },
      { brandId: BRAND_A, sellingFormatId: "fmt-y", priceCents: 1250 },
      { brandId: BRAND_B, sellingFormatId: "fmt-x", priceCents: 800 },
    ]);
  });

  it("batches multiple channels in one call with no cross-channel leakage", async () => {
    useFixtures(baseFixtures);
    const result = await resolveChannelPrices(BRAND_IDS, [TAPROOM_ID, WHOLESALE_ID]);
    // taproom prices (unchanged by the presence of the wholesale channel)
    expect(result.get(TAPROOM_ID)).toEqual([
      { brandId: BRAND_A, sellingFormatId: "fmt-x", priceCents: 1000 },
      { brandId: BRAND_A, sellingFormatId: "fmt-y", priceCents: 1250 },
      { brandId: BRAND_B, sellingFormatId: "fmt-x", priceCents: 800 },
    ]);
    // wholesale channel gets ONLY its own price — no taproom bleed-through
    expect(result.get(WHOLESALE_ID)).toEqual([
      { brandId: BRAND_A, sellingFormatId: "fmt-x", priceCents: 2000 },
    ]);
  });

  it("seeds an empty array for every requested channel; empty brandIds does not query", async () => {
    useFixtures(baseFixtures);
    const result = await resolveChannelPrices([], [TAPROOM_ID]);
    expect(result.get(TAPROOM_ID)).toEqual([]);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  it("returns an empty array for a channel that has no prices", async () => {
    useFixtures(baseFixtures);
    const result = await resolveChannelPrices(BRAND_IDS, ["chan-unknown-uuid"]);
    expect(result.get("chan-unknown-uuid")).toEqual([]);
  });

  // A transient DB error must PROPAGATE, not degrade to an empty price map —
  // the catalog sync would push every variation at $0 to the live register.
  it("throws on a recipes read error instead of returning an empty price map", async () => {
    const { admin } = makeAdminMock(
      { recipes: { data: null, error: { message: "recipes read boom" } } },
      { onUnknownTable: "throw" }
    );
    mockedCreateAdminClient.mockResolvedValue(admin as never);

    await expect(resolveChannelPrices(BRAND_IDS, [TAPROOM_ID])).rejects.toMatchObject({
      message: "recipes read boom",
    });
  });

  it("throws on a pricing_tier_prices read error instead of returning an empty price map", async () => {
    const { admin } = makeAdminMock(
      {
        recipes: { data: baseFixtures.recipes, error: null },
        pricing_tier_prices: { data: null, error: { message: "prices read boom" } },
      },
      { onUnknownTable: "throw" }
    );
    mockedCreateAdminClient.mockResolvedValue(admin as never);

    await expect(resolveChannelPrices(BRAND_IDS, [TAPROOM_ID])).rejects.toMatchObject({
      message: "prices read boom",
    });
  });

  // recipes.brand_id is a plain FK, so a brand may carry several priced recipes.
  // "First row wins" is only safe because the query orders the rows; without the
  // ORDER BY the chosen tier — and so the live Square price — is plan-dependent.
  it("picks the most recently updated priced recipe when a brand has several", async () => {
    useFixtures({
      ...baseFixtures,
      recipes: [
        // Listed oldest-first: an unordered query would pick tier-2 ($8).
        { id: "recipe-old", brand_id: BRAND_A, pricing_tier_id: "tier-2", updated_at: "2026-01-01T00:00:00Z" },
        { id: "recipe-new", brand_id: BRAND_A, pricing_tier_id: "tier-1", updated_at: "2026-06-01T00:00:00Z" },
      ],
    });

    const result = await resolveChannelPrices([BRAND_A], [TAPROOM_ID]);
    expect(result.get(TAPROOM_ID)).toEqual([
      { brandId: BRAND_A, sellingFormatId: "fmt-x", priceCents: 1000 },
      { brandId: BRAND_A, sellingFormatId: "fmt-y", priceCents: 1250 },
    ]);
  });

  it("breaks a same-updated_at tie on recipe id, so the price is stable", async () => {
    useFixtures({
      ...baseFixtures,
      recipes: [
        { id: "recipe-z", brand_id: BRAND_A, pricing_tier_id: "tier-2", updated_at: "2026-01-01T00:00:00Z" },
        { id: "recipe-a", brand_id: BRAND_A, pricing_tier_id: "tier-1", updated_at: "2026-01-01T00:00:00Z" },
      ],
    });

    // recipe-a sorts first on id, so tier-1 wins regardless of row order.
    const result = await resolveChannelPrices([BRAND_A], [TAPROOM_ID]);
    expect(result.get(TAPROOM_ID)).toEqual([
      { brandId: BRAND_A, sellingFormatId: "fmt-x", priceCents: 1000 },
      { brandId: BRAND_A, sellingFormatId: "fmt-y", priceCents: 1250 },
    ]);
  });
});
