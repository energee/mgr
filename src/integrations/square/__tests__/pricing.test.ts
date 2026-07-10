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
type RecipeRow = { id: string; brand_id: string | null; pricing_tier_id: string | null };
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
      recipes: { data: fixtures.recipes, error: null },
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
    { id: "recipe-a", brand_id: BRAND_A, pricing_tier_id: "tier-1" },
    { id: "recipe-b", brand_id: BRAND_B, pricing_tier_id: "tier-2" },
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
});
