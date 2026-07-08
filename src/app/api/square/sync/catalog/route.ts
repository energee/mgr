/**
 * Square Catalog Sync
 *
 * POST: Push catalog (brands + selling format variations) to Square.
 *
 * Bin-driven (Milestone C5): Square POS configuration lives on the BIN, not the
 * location (00222 dropped locations.square_location_id / locations.pos_bin_id and
 * the locations_with_pos view). A bin is a POS sync target IFF it has BOTH
 * bins.square_location_id and bins.pos_sales_channel_id set.
 *
 * 1. Queries POS-configured bins (both columns set)
 * 2. Reads sellable stock (packaged FG + filled kegs, unified) from the
 *    sellable_inventory view (00221) for those bins
 * 3. Enriches brand + selling-format metadata (the view exposes only ids)
 * 4. Prices each variation via its bin's pos_sales_channel_id (one
 *    resolveChannelPrices call per DISTINCT channel — the common single-channel
 *    setup makes exactly one call)
 * 5. Builds SquareSyncProduct array and pushes to Square
 * 6. Cleans up stale catalog items no longer in inventory
 * 7. Logs sync result
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/server";
import { getSquareClient, updateSquareSettings } from "@/integrations/square/client";
import { pushCatalog, deleteStaleItems } from "@/integrations/square/catalog";
import { resolveChannelPrices } from "@/integrations/square/pricing";
import type { SquareSyncProduct, SquareSyncVariation } from "@/integrations/square/types";

export const POST = withPermission("integrations:manage", async (_request, { user }) => {
  const client = await getSquareClient();
  if (!client) {
    return errorResponse(
      "INTEGRATION_DISABLED",
      "Square integration is not connected or not enabled",
      undefined,
      400
    );
  }

  const admin = await createAdminClient();
  const startedAt = new Date().toISOString();

  try {
    // 1. Get POS-configured bins (both square_location_id and pos_sales_channel_id
    //    set => a Square POS sync target). Replaces the old POS-on-location model.
    const { data: posBins, error: binsError } = await admin
      .from("bins")
      .select("id, square_location_id, pos_sales_channel_id")
      .not("square_location_id", "is", null)
      .not("pos_sales_channel_id", "is", null)
      // Stable total order (id is the non-null unique PK) so the multi-channel
      // price tie-break below is deterministic across syncs. created_at is
      // nullable/non-unique and can't guarantee a total order.
      .order("id");

    if (binsError) {
      throw new Error(`Failed to query POS bins: ${binsError.message}`);
    }

    if (!posBins || posBins.length === 0) {
      return errorResponse(
        "CONFIGURATION_ERROR",
        "No bins configured with a Square location and POS sales channel",
        undefined,
        400
      );
    }

    const posBinIds = posBins.map((b) => b.id);
    // bin -> pricing channel (both non-null by the query filter) and bin ordering
    // for the deterministic multi-channel tie-break below.
    const binChannel = new Map<string, string>();
    const binOrder = new Map<string, number>();
    posBins.forEach((b, i) => {
      binChannel.set(b.id, b.pos_sales_channel_id!);
      binOrder.set(b.id, i);
    });

    // 2. Read sellable stock across the POS bins from the unified read model
    //    (packaged finished goods in bins + filled-keg contents, double-count
    //    guard baked in). Single query replacing the old bin_inventory +
    //    keg_filled_contents dance.
    const { data: stock, error: stockError } = await admin
      .from("sellable_inventory")
      .select("bin_id, brand_id, selling_format_id, quantity")
      .in("bin_id", posBinIds)
      .gt("quantity", 0);

    if (stockError) {
      throw new Error(`Failed to query sellable inventory: ${stockError.message}`);
    }

    // 3. Enrich brand + selling-format metadata (the view exposes only ids).
    const brandIds = [
      ...new Set((stock ?? []).map((s) => s.brand_id).filter((v): v is string => !!v)),
    ];
    const formatIds = [
      ...new Set((stock ?? []).map((s) => s.selling_format_id).filter((v): v is string => !!v)),
    ];

    const brandInfo = new Map<string, { name: string; description: string | null }>();
    if (brandIds.length > 0) {
      const { data: brandRows, error: brandError } = await admin
        .from("brands")
        .select("id, name, description")
        .in("id", brandIds);
      if (brandError) {
        throw new Error(`Failed to query brands: ${brandError.message}`);
      }
      for (const b of brandRows ?? []) {
        brandInfo.set(b.id, { name: b.name, description: b.description });
      }
    }

    let formatNames: Record<string, string> = {};
    if (formatIds.length > 0) {
      const { data: sfData } = await admin
        .from("selling_formats")
        .select("id, name")
        .in("id", formatIds);
      if (sfData) {
        formatNames = Object.fromEntries(sfData.map((sf) => [sf.id, sf.name]));
      }
    }

    // 4. Build unique brand + variation combinations, and record each variation's
    //    pricing channel.
    //    Map: brandId -> { brand info, variations: Map<sellingFormatId, variation> }
    const brandMap = new Map<
      string,
      {
        brandId: string;
        brandName: string;
        description?: string;
        variations: Map<string, { sellingFormatId: string; name: string }>;
      }
    >();

    // variation pricing channel: `${brandId}-${varKey}` -> { channelId, binIndex }
    const variationChannel = new Map<string, { channelId: string; binIndex: number }>();

    for (const item of stock ?? []) {
      if (!item.brand_id || !item.selling_format_id || !item.bin_id) continue;
      const brand = brandInfo.get(item.brand_id);
      if (!brand) continue;

      if (!brandMap.has(item.brand_id)) {
        brandMap.set(item.brand_id, {
          brandId: item.brand_id,
          brandName: brand.name,
          description: brand.description ?? undefined,
          variations: new Map(),
        });
      }

      const varKey = `fmt-${item.selling_format_id}`;
      if (!brandMap.get(item.brand_id)!.variations.has(varKey)) {
        brandMap.get(item.brand_id)!.variations.set(varKey, {
          sellingFormatId: item.selling_format_id,
          name: item.selling_format_id, // placeholder, enriched from formatNames
        });
      }

      // Price this variation from the channel of the earliest-ordered POS bin that
      // stocks it. When all POS bins share a channel (the common case) this is
      // unambiguous; the bin-order tie-break only matters for mixed-channel setups.
      // ponytail: v1 Square catalog is single-price-per-variation. Per-location
      // price overrides are deferred, so a variation stocked at bins on DIFFERENT
      // channels deterministically takes the first channel by bin order.
      const chanKey = `${item.brand_id}-${varKey}`;
      const binIndex = binOrder.get(item.bin_id) ?? Number.MAX_SAFE_INTEGER;
      const existing = variationChannel.get(chanKey);
      if (!existing || binIndex < existing.binIndex) {
        variationChannel.set(chanKey, {
          channelId: binChannel.get(item.bin_id)!,
          binIndex,
        });
      }
    }

    const activeBrandIds = [...brandMap.keys()];

    // 5. Resolve prices for each DISTINCT POS channel (one call per channel; the
    //    common single-channel setup makes exactly one call). Replaces the old
    //    hardcoded taproom-channel lookup.
    //    channelId -> brandId -> varKey -> priceCents
    const distinctChannels = [...new Set(posBins.map((b) => b.pos_sales_channel_id!))];
    const channelPriceLookup = new Map<string, Map<string, Map<string, number>>>();
    for (const channelId of distinctChannels) {
      const prices = await resolveChannelPrices(activeBrandIds, channelId);
      const brandLookup = new Map<string, Map<string, number>>();
      for (const p of prices) {
        if (!brandLookup.has(p.brandId)) {
          brandLookup.set(p.brandId, new Map());
        }
        brandLookup.get(p.brandId)!.set(`fmt-${p.sellingFormatId}`, p.priceCents);
      }
      channelPriceLookup.set(channelId, brandLookup);
    }

    // 6. Load existing catalog mappings for Square IDs and versions
    const { data: existingMaps } = await admin
      .from("square_catalog_map")
      .select("*");

    // Build lookup: "brand-{brandId}" -> mapping, "var-{brandId}-fmt-{id}" -> mapping
    const mapLookup = new Map<string, { squareCatalogId: string; squareVersion: bigint | undefined }>();
    for (const m of existingMaps ?? []) {
      if (m.object_type === "ITEM") {
        mapLookup.set(`brand-${m.brand_id}`, {
          squareCatalogId: m.square_catalog_id,
          squareVersion: m.square_version != null ? BigInt(m.square_version) : undefined,
        });
      } else if (m.object_type === "ITEM_VARIATION" && m.selling_format_id) {
        const varKey = `fmt-${m.selling_format_id}`;
        mapLookup.set(`var-${m.brand_id}-${varKey}`, {
          squareCatalogId: m.square_catalog_id,
          squareVersion: m.square_version != null ? BigInt(m.square_version) : undefined,
        });
      }
    }

    // 7. Build SquareSyncProduct array
    const products: SquareSyncProduct[] = [];
    // Variations whose channel has no price row -> pushed at $0. Collected and
    // surfaced (log + response) rather than silently shipping free product.
    const unpricedVariations: string[] = [];

    for (const brand of brandMap.values()) {
      const itemMapping = mapLookup.get(`brand-${brand.brandId}`);
      const variations: SquareSyncVariation[] = [];

      for (const [varKey, variation] of brand.variations) {
        const varMapping = mapLookup.get(`var-${brand.brandId}-${varKey}`);
        const displayName = formatNames[variation.sellingFormatId] ?? "Unknown Format";

        // Price from the channel of the bin(s) that stock this variation.
        const chan = variationChannel.get(`${brand.brandId}-${varKey}`);
        const resolvedPrice = chan
          ? channelPriceLookup.get(chan.channelId)?.get(brand.brandId)?.get(varKey)
          : undefined;
        // No price configured for this variation on its channel -> Square would
        // show $0. Push it (behavior-preserving) but flag it loudly.
        if (resolvedPrice == null || resolvedPrice === 0) {
          unpricedVariations.push(`${brand.brandName} / ${displayName}`);
        }
        const priceCents = resolvedPrice ?? 0;

        variations.push({
          sellingFormatId: variation.sellingFormatId,
          name: displayName,
          priceCents,
          squareCatalogId: varMapping?.squareCatalogId,
          squareVersion: varMapping?.squareVersion,
        });
      }

      products.push({
        brandId: brand.brandId,
        brandName: brand.brandName,
        description: brand.description,
        squareCatalogId: itemMapping?.squareCatalogId,
        squareVersion: itemMapping?.squareVersion,
        variations,
      });
    }

    // 8. Push catalog to Square
    const syncResult = await pushCatalog(client, products);

    // 9. Clean up stale items. Guard the empty active set: deleteStaleItems treats
    //    [] as "delete the ENTIRE catalog", and the bin-driven model makes a
    //    transient all-empty state reachable (POS bins configured but momentarily
    //    holding no sellable stock). Skip cleanup rather than wipe everything.
    const deletedCount =
      activeBrandIds.length > 0 ? await deleteStaleItems(client, activeBrandIds) : 0;

    // 10. Update last_catalog_sync_at
    const completedAt = new Date().toISOString();
    await updateSquareSettings({
      last_catalog_sync_at: completedAt,
    });

    // 11. Log to square_sync_log
    await admin.from("square_sync_log").insert({
      sync_type: "catalog_push",
      items_synced: syncResult.itemsSynced,
      items_failed: syncResult.itemsFailed,
      details: {
        posBinCount: posBins.length,
        productsCount: products.length,
        variationsCount: products.reduce((sum, p) => sum + p.variations.length, 0),
        staleDeleted: deletedCount,
        unpricedVariations: unpricedVariations.length > 0 ? unpricedVariations : undefined,
        errors: syncResult.errors.length > 0 ? syncResult.errors : undefined,
        triggeredBy: user.id,
      },
      started_at: startedAt,
      completed_at: completedAt,
    });

    return successResponse({
      success: syncResult.success,
      itemsSynced: syncResult.itemsSynced,
      itemsFailed: syncResult.itemsFailed,
      staleDeleted: deletedCount,
      productsCount: products.length,
      unpricedVariations,
      errors: syncResult.errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Catalog sync failed";

    // Log the failed sync
    await admin
      .from("square_sync_log")
      .insert({
        sync_type: "catalog_push",
        items_synced: 0,
        items_failed: 0,
        details: { error: message, triggeredBy: user.id },
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      })
      .then(() => {});

    return errorResponse("SYNC_FAILED", message, undefined, 500);
  }
});
