import { createAdminClient } from "@/lib/supabase/server";
import { dollarsToCents } from "./utils";

type ChannelPrice = {
  brandId: string;
  sellingFormatId: string;
  priceCents: number;
}

/**
 * Query pricing_tier_prices for one or more sales channels in a SINGLE round of
 * queries, returning a per-channel map of prices (in cents) for Square catalog
 * sync.
 *
 * The pricing path is:
 *   Brand -> Recipe -> recipe.pricing_tier_id
 *   -> pricing_tier_prices WHERE pricing_tier_id AND sales_channel_id IN (...)
 *   -> price (in dollars) -> convert to cents (* 100)
 *
 * Selling formats are referenced via pricing_tier_prices.format_id (which
 * references selling_formats).
 *
 * Batching (E3): the brand->tier resolution is channel-INDEPENDENT, so it runs
 * ONCE here rather than once per channel. Only the final pricing_tier_prices
 * read is channel-dependent, and it uses `.in("sales_channel_id", ...)` to fetch
 * every requested channel in one query. Callers that need multiple channels
 * (mixed-channel POS bins) previously looped this function, re-running the
 * brands/recipes queries on every call.
 *
 * @param brandIds        Brands to resolve prices for.
 * @param salesChannelIds UUIDs of the sales channels whose prices to read.
 * @returns Map keyed by sales_channel_id -> ChannelPrice[] (every requested
 *          channel is present as a key, with an empty array when it has no
 *          matching prices).
 */
export async function resolveChannelPrices(
  brandIds: string[],
  salesChannelIds: string[]
): Promise<Map<string, ChannelPrice[]>> {
  // Seed every requested channel so callers can index the result unconditionally.
  const result = new Map<string, ChannelPrice[]>();
  for (const id of salesChannelIds) result.set(id, []);

  if (brandIds.length === 0 || salesChannelIds.length === 0) return result;

  const admin = await createAdminClient();

  // 1. Get recipes for these brands that have a pricing_tier_id (channel-
  //    independent). A brand can have several priced recipes, so row order
  //    decides its price. ORDER BY makes that deterministic — most recently
  //    updated recipe wins, id breaking ties — the same ordering 00191's
  //    preferred-recipe view uses. (Not full parity: 00191 also filters
  //    is_active = true; here an inactive recipe's tier still prices the brand
  //    rather than turning its variations "unpriced" mid-catalog. Deliberate —
  //    tighten only together with the catalog route's unpriced handling.)
  //    Without the ORDER BY Postgres returns a plan-dependent order and the
  //    brand's live Square price flips between syncs.
  const { data: recipes, error: recipesError } = await admin
    .from("recipes")
    .select("id, brand_id, pricing_tier_id")
    .in("brand_id", brandIds)
    .not("pricing_tier_id", "is", null)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true });

  // A transient read failure must NOT degrade to an empty price map: the
  // catalog sync would push every variation at $0 to the LIVE register.
  // Throw so the sync aborts (the route's catch logs + 500s) instead.
  if (recipesError) throw recipesError;
  if (!recipes || recipes.length === 0) {
    return result;
  }

  // Build a map of brand_id -> pricing_tier_id (first recipe with a tier wins).
  const brandTierMap: Record<string, string> = {};
  for (const recipe of recipes) {
    if (recipe.brand_id && recipe.pricing_tier_id && !brandTierMap[recipe.brand_id]) {
      brandTierMap[recipe.brand_id] = recipe.pricing_tier_id;
    }
  }

  const tierIds = [...new Set(Object.values(brandTierMap))];
  if (tierIds.length === 0) {
    return result;
  }

  // 2. Get pricing_tier_prices for those tiers across ALL requested channels in
  //    one query (channel-dependent).
  const { data: tierPrices, error: pricesError } = await admin
    .from("pricing_tier_prices")
    .select("pricing_tier_id, format_id, price, sales_channel_id")
    .in("pricing_tier_id", tierIds)
    .in("sales_channel_id", salesChannelIds);

  // Same $0-catastrophe rationale as recipesError above.
  if (pricesError) throw pricesError;
  if (!tierPrices || tierPrices.length === 0) {
    return result;
  }

  // 3. Build a lookup: channel_id -> tier_id -> { format_id -> price }
  const channelTierPriceMap: Record<string, Record<string, Record<string, number>>> = {};
  for (const tp of tierPrices) {
    if (tp.format_id == null || tp.sales_channel_id == null) continue;
    const byTier = (channelTierPriceMap[tp.sales_channel_id] ??= {});
    (byTier[tp.pricing_tier_id] ??= {})[tp.format_id] = Number(tp.price);
  }

  // 4. Map results back to brands, per channel. format_id references
  //    selling_formats directly.
  for (const channelId of salesChannelIds) {
    const tierPriceMap = channelTierPriceMap[channelId];
    if (!tierPriceMap) continue; // stays [] from the seed

    const prices: ChannelPrice[] = [];
    for (const [brandId, tierId] of Object.entries(brandTierMap)) {
      const pricesForTier = tierPriceMap[tierId];
      if (!pricesForTier) continue;

      for (const [formatId, priceDollars] of Object.entries(pricesForTier)) {
        prices.push({
          brandId,
          sellingFormatId: formatId,
          priceCents: dollarsToCents(priceDollars),
        });
      }
    }
    result.set(channelId, prices);
  }

  return result;
}
