import { createAdminClient } from "@/lib/supabase/server";

interface TaproomPrice {
  brandId: string;
  packageTypeId?: string;
  kegTypeId?: string;
  priceCents: number;
}

/**
 * Query pricing_tier_prices for the taproom sales channel.
 * Returns prices in cents for Square catalog sync.
 *
 * The pricing path is:
 *   Brand -> Recipe -> recipe.pricing_tier_id
 *   -> pricing_tier_prices WHERE pricing_tier_id AND sales_channel = taproom
 *   -> price (in dollars) -> convert to cents (* 100)
 *
 * Package formats come from package_types and keg_types referenced
 * via pricing_tier_prices.format_id (which references packaging_formats).
 */
export async function resolveTaproomPrices(
  brandIds: string[]
): Promise<TaproomPrice[]> {
  if (brandIds.length === 0) return [];

  const admin = await createAdminClient();

  // 1. Find the taproom sales channel
  const { data: taproomChannel, error: channelError } = await admin
    .from("sales_channels")
    .select("id")
    .eq("code", "taproom")
    .single();

  if (channelError || !taproomChannel) {
    console.error(
      "Taproom sales channel not found:",
      channelError?.message ?? "no data"
    );
    return [];
  }

  const taproomChannelId = taproomChannel.id;

  // 2. Get brands with their recipes' pricing tier IDs
  //    A brand can have multiple recipes, but typically one "primary" recipe.
  //    We pick the first recipe with a pricing_tier_id set.
  const { data: brands, error: brandsError } = await admin
    .from("brands")
    .select("id, name")
    .in("id", brandIds);

  if (brandsError || !brands || brands.length === 0) {
    return [];
  }

  // 3. Get recipes for these brands that have a pricing_tier_id
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

  // 4. Get pricing_tier_prices for those tiers and the taproom channel
  // Cast needed: auto-generated types still reference old column name (package_format_id)
  // until supabase types are regenerated after migration 00092.
  const { data: tierPrices, error: pricesError } = await admin
    .from("pricing_tier_prices")
    .select("pricing_tier_id, format_id, price")
    .in("pricing_tier_id", tierIds)
    .eq("sales_channel_id", taproomChannelId) as unknown as {
      data: { pricing_tier_id: string; format_id: string; price: number }[] | null;
      error: Error | null;
    };

  if (pricesError || !tierPrices || tierPrices.length === 0) {
    return [];
  }

  // 5. Build a lookup: tier_id -> { format_id -> price }
  const tierPriceMap: Record<string, Record<string, number>> = {};
  for (const tp of tierPrices) {
    if (!tierPriceMap[tp.pricing_tier_id]) {
      tierPriceMap[tp.pricing_tier_id] = {};
    }
    if (tp.format_id != null) {
      tierPriceMap[tp.pricing_tier_id][tp.format_id] = Number(tp.price);
    }
  }

  // 6. Map results back to brands
  // format_id references the packaging_formats view which includes both
  // package_types and keg_types. We treat all as packageTypeId for now.
  // TODO: Use format_source from packaging_formats to distinguish package vs keg.
  const results: TaproomPrice[] = [];

  for (const [brandId, tierId] of Object.entries(brandTierMap)) {
    const pricesForTier = tierPriceMap[tierId];
    if (!pricesForTier) continue;

    for (const [formatId, priceDollars] of Object.entries(pricesForTier)) {
      results.push({
        brandId,
        packageTypeId: formatId,
        priceCents: Math.round(priceDollars * 100),
      });
    }
  }

  return results;
}
