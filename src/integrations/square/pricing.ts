import { createAdminClient } from "@/lib/supabase/server";
import { dollarsToCents } from "./utils";
import { logger } from "@/lib/logger";

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

type ChannelPrice = {
  brandId: string;
  sellingFormatId: string;
  priceCents: number;
}

/**
 * Resolve the UUID of the `taproom` sales channel.
 *
 * Kept as a small helper so callers that specifically want taproom pricing
 * (e.g. the catalog sync route, until Milestone C5 wires per-POS-bin channels)
 * can resolve the channel id once and pass it to {@link resolveChannelPrices}.
 *
 * Returns `null` (and logs) when the channel row is missing.
 */
export async function resolveTaproomChannelId(
  admin: AdminClient
): Promise<string | null> {
  const { data: taproomChannel, error: channelError } = await admin
    .from("sales_channels")
    .select("id")
    .eq("code", "taproom")
    .single();

  if (channelError || !taproomChannel) {
    logger.error("Taproom sales channel not found: %s", channelError?.message ?? "no data");
    return null;
  }

  return taproomChannel.id;
}

/**
 * Query pricing_tier_prices for a specific sales channel.
 * Returns prices in cents for Square catalog sync.
 *
 * The pricing path is:
 *   Brand -> Recipe -> recipe.pricing_tier_id
 *   -> pricing_tier_prices WHERE pricing_tier_id AND sales_channel = salesChannelId
 *   -> price (in dollars) -> convert to cents (* 100)
 *
 * Selling formats are referenced via pricing_tier_prices.format_id
 * (which references selling_formats).
 *
 * @param brandIds      Brands to resolve prices for.
 * @param salesChannelId UUID of the sales channel whose prices to read.
 */
export async function resolveChannelPrices(
  brandIds: string[],
  salesChannelId: string
): Promise<ChannelPrice[]> {
  if (brandIds.length === 0) return [];

  const admin = await createAdminClient();

  // 1. Get brands with their recipes' pricing tier IDs
  //    A brand can have multiple recipes, but typically one "primary" recipe.
  //    We pick the first recipe with a pricing_tier_id set.
  const { data: brands, error: brandsError } = await admin
    .from("brands")
    .select("id, name")
    .in("id", brandIds);

  if (brandsError || !brands || brands.length === 0) {
    return [];
  }

  // 2. Get recipes for these brands that have a pricing_tier_id
  const { data: recipes, error: recipesError } = await admin
    .from("recipes")
    .select("id, brand_id, pricing_tier_id")
    .in("brand_id", brandIds)
    .not("pricing_tier_id", "is", null);

  if (recipesError || !recipes || recipes.length === 0) {
    return [];
  }

  // Build a map of brand_id -> pricing_tier_id (first recipe with a tier wins)
  const brandTierMap: Record<string, string> = {};
  for (const recipe of recipes) {
    if (recipe.brand_id && recipe.pricing_tier_id && !brandTierMap[recipe.brand_id]) {
      brandTierMap[recipe.brand_id] = recipe.pricing_tier_id;
    }
  }

  const tierIds = [...new Set(Object.values(brandTierMap))];
  if (tierIds.length === 0) {
    return [];
  }

  // 3. Get pricing_tier_prices for those tiers and the requested channel
  const { data: tierPrices, error: pricesError } = await admin
    .from("pricing_tier_prices")
    .select("pricing_tier_id, format_id, price")
    .in("pricing_tier_id", tierIds)
    .eq("sales_channel_id", salesChannelId);

  if (pricesError || !tierPrices || tierPrices.length === 0) {
    return [];
  }

  // 4. Build a lookup: tier_id -> { format_id -> price }
  const tierPriceMap: Record<string, Record<string, number>> = {};
  for (const tp of tierPrices) {
    if (!tierPriceMap[tp.pricing_tier_id]) {
      tierPriceMap[tp.pricing_tier_id] = {};
    }
    if (tp.format_id != null) {
      tierPriceMap[tp.pricing_tier_id][tp.format_id] = Number(tp.price);
    }
  }

  // 5. Map results back to brands
  // format_id references selling_formats directly
  const results: ChannelPrice[] = [];

  for (const [brandId, tierId] of Object.entries(brandTierMap)) {
    const pricesForTier = tierPriceMap[tierId];
    if (!pricesForTier) continue;

    for (const [formatId, priceDollars] of Object.entries(pricesForTier)) {
      results.push({
        brandId,
        sellingFormatId: formatId,
        priceCents: dollarsToCents(priceDollars),
      });
    }
  }

  return results;
}

/**
 * Resolve taproom-channel prices for the given brands.
 *
 * Thin wrapper over {@link resolveChannelPrices}: looks up the taproom sales
 * channel id, then delegates. Preserved for callers that want taproom pricing
 * without knowing the channel UUID; returns `[]` if the channel is missing
 * (matching the prior behavior of this function).
 */
export async function resolveTaproomPrices(
  brandIds: string[]
): Promise<ChannelPrice[]> {
  if (brandIds.length === 0) return [];

  const admin = await createAdminClient();

  const taproomChannelId = await resolveTaproomChannelId(admin);
  if (!taproomChannelId) return [];

  return resolveChannelPrices(brandIds, taproomChannelId);
}
