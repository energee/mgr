/**
 * Square pricing resolution tests.
 *
 * Characterizes the C4 channel-parameterized price resolver:
 *   - resolveChannelPrices(brandIds, salesChannelId) reads a specific channel.
 *
 * Parity guarantee (C4 acceptance): passing the taproom channel id reproduces
 * today's taproom prices byte-for-byte — asserted by the exact-cents case in
 * the "resolveChannelPrices" block below.
 *
 * Supabase is mocked at @/lib/supabase/server per the repo idiom
 * (see src/lib/__tests__/api-routes.test.ts). The mock builder is faithful
 * enough to honor the .eq("sales_channel_id", ...) filter so channel
 * parameterization is genuinely exercised, not stubbed away.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

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

type Thenable = {
  then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise<unknown>;
};

/**
 * Builds an object that mimics the Supabase admin client's chainable query
 * builder for the three tables resolveChannelPrices touches (brands, recipes,
 * pricing_tier_prices). The sales_channel_id filter is honored; the rest are
 * pass-through.
 */
function makeAdmin(fixtures: Fixtures) {
  return {
    from(table: string) {
      if (table === "brands") {
        const result = { data: fixtures.brands, error: null };
        const builder = {
          select: () => builder,
          in: () => builder,
          then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(onF, onR),
        };
        return builder;
      }

      if (table === "recipes") {
        const result = { data: fixtures.recipes, error: null };
        const builder = {
          select: () => builder,
          in: () => builder,
          not: () => builder,
          then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(onF, onR),
        };
        return builder;
      }

      if (table === "pricing_tier_prices") {
        let channelFilter: string | undefined;
        const builder = {
          select: () => builder,
          in: () => builder,
          eq: (col: string, val: string) => {
            if (col === "sales_channel_id") channelFilter = val;
            return builder;
          },
          then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
            const data = fixtures.prices.filter(
              (p) => p.sales_channel_id === channelFilter
            );
            return Promise.resolve({ data, error: null }).then(onF, onR);
          },
        };
        return builder as unknown as Thenable;
      }

      throw new Error(`unexpected table in mock: ${table}`);
    },
  };
}

function useFixtures(fixtures: Fixtures) {
  mockedCreateAdminClient.mockImplementation(
    async () => makeAdmin(fixtures) as unknown as Awaited<ReturnType<typeof createAdminClient>>
  );
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
    const result = await resolveChannelPrices(BRAND_IDS, TAPROOM_ID);
    expect(result).toEqual([
      { brandId: BRAND_A, sellingFormatId: "fmt-x", priceCents: 1000 },
      { brandId: BRAND_A, sellingFormatId: "fmt-y", priceCents: 1250 },
      { brandId: BRAND_B, sellingFormatId: "fmt-x", priceCents: 800 },
    ]);
  });

  it("is parameterized by channel: a different channel id yields that channel's prices", async () => {
    useFixtures(baseFixtures);
    const result = await resolveChannelPrices(BRAND_IDS, WHOLESALE_ID);
    expect(result).toEqual([
      { brandId: BRAND_A, sellingFormatId: "fmt-x", priceCents: 2000 },
    ]);
  });

  it("returns [] for empty brandIds without querying", async () => {
    useFixtures(baseFixtures);
    expect(await resolveChannelPrices([], TAPROOM_ID)).toEqual([]);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  it("returns [] when the channel has no prices", async () => {
    useFixtures(baseFixtures);
    expect(await resolveChannelPrices(BRAND_IDS, "chan-unknown-uuid")).toEqual([]);
  });
});
