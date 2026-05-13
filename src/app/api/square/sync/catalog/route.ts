/**
 * Square Catalog Sync
 *
 * POST: Push catalog (brands + selling format variations) to Square.
 *
 * 1. Queries POS-configured locations (those with both square_location_id and pos_bin_id)
 * 2. Gathers packaged FG from bin_inventory at POS bins
 * 3. Gathers draft kegs (filled state) at POS locations
 * 4. Resolves taproom prices for all active brands
 * 5. Builds SquareSyncProduct array and pushes to Square
 * 6. Cleans up stale catalog items no longer in inventory
 * 7. Logs sync result
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/server";
import { getSquareClient, updateSquareSettings } from "@/lib/square/client";
import { pushCatalog, deleteStaleItems } from "@/lib/square/catalog";
import { resolveTaproomPrices } from "@/lib/square/pricing";
import type { SquareSyncProduct, SquareSyncVariation } from "@/lib/square/types";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "/api/square/sync/catalog" });

// Supabase nested join shapes (not reflected in generated types)
type BrandJoin = {
  id: string;
  name: string;
  description: string | null;
}

type FGWithBrand = {
  id: string;
  brand_id: string;
  selling_format_id: string | null;
  brands: BrandJoin;
}

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
    // 1. Get POS-configured locations
    const { data: locations, error: locError } = await admin
      .from("locations")
      .select("id, name, square_location_id, pos_bin_id")
      .not("square_location_id", "is", null)
      .not("pos_bin_id", "is", null);

    if (locError) {
      // Audit F-065: log the upstream PG error but return a generic message
      // so internal details (column names, RLS hints) don't reach the client.
      log.error({ err: locError }, "Failed to query locations");
      throw new Error("Failed to query locations for Square sync");
    }

    if (!locations || locations.length === 0) {
      return errorResponse(
        "CONFIGURATION_ERROR",
        "No locations configured with Square location ID and POS bin",
        undefined,
        400
      );
    }

    const posBinIds = locations.map((l) => l.pos_bin_id!);

    // 2. Get bin inventory for POS bins (packaged goods)
    const { data: inventory, error: invError } = await admin
      .from("bin_inventory")
      .select(
        `
        bin_id,
        finished_good_id,
        quantity,
        finished_goods!inner(
          id,
          brand_id,
          selling_format_id,
          brands(id, name, description)
        )
      `
      )
      .in("bin_id", posBinIds)
      .gt("quantity", 0);

    if (invError) {
      log.error({ err: invError }, "Failed to query bin inventory");
      throw new Error("Failed to query bin inventory for Square sync");
    }

    // 3. Get draft kegs at POS locations (filled kegs)
    const locationIds = locations.map((l) => l.id);
    const { data: draftKegs, error: kegError } = await admin
      .from("keg_inventory")
      .select(
        `
        selling_format_id,
        location_id,
        quantity,
        finished_good_id,
        finished_goods(
          id,
          brand_id,
          brands(id, name, description)
        )
      `
      )
      .in("location_id", locationIds)
      .eq("state", "filled")
      .gt("quantity", 0);

    if (kegError) {
      // Draft keg query is optional; log and continue
      logger.error("Failed to query keg inventory: %s", kegError.message);
    }

    // 4. Build unique brand + variation combinations
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

    // Process packaged goods from bin inventory
    for (const item of inventory ?? []) {
      const fg = item.finished_goods as unknown as FGWithBrand | null;
      if (!fg?.brand_id || !fg?.brands) continue;

      const { brands: brand } = fg;

      if (!brandMap.has(fg.brand_id)) {
        brandMap.set(fg.brand_id, {
          brandId: fg.brand_id,
          brandName: brand.name,
          description: brand.description ?? undefined,
          variations: new Map(),
        });
      }

      if (fg.selling_format_id) {
        const varKey = `fmt-${fg.selling_format_id}`;
        if (!brandMap.get(fg.brand_id)!.variations.has(varKey)) {
          brandMap.get(fg.brand_id)!.variations.set(varKey, {
            sellingFormatId: fg.selling_format_id,
            name: fg.selling_format_id, // placeholder, will be enriched with price
          });
        }
      }
    }

    // Process draft kegs
    for (const keg of draftKegs ?? []) {
      const fg = keg.finished_goods as unknown as FGWithBrand | null;
      if (!fg?.brand_id || !fg?.brands) continue;

      const { brands: brand } = fg;

      if (!brandMap.has(fg.brand_id)) {
        brandMap.set(fg.brand_id, {
          brandId: fg.brand_id,
          brandName: brand.name,
          description: brand.description ?? undefined,
          variations: new Map(),
        });
      }

      const sellingFormatId = keg.selling_format_id as string;
      if (sellingFormatId) {
        const varKey = `fmt-${sellingFormatId}`;
        if (!brandMap.get(fg.brand_id)!.variations.has(varKey)) {
          brandMap.get(fg.brand_id)!.variations.set(varKey, {
            sellingFormatId,
            name: sellingFormatId, // placeholder
          });
        }
      }
    }

    const activeBrandIds = [...brandMap.keys()];

    // 5. Resolve taproom prices
    const prices = await resolveTaproomPrices(activeBrandIds);

    // Build price lookup: brandId -> varKey -> priceCents
    const priceLookup = new Map<string, Map<string, number>>();
    for (const p of prices) {
      if (!priceLookup.has(p.brandId)) {
        priceLookup.set(p.brandId, new Map());
      }
      priceLookup.get(p.brandId)!.set(`fmt-${p.sellingFormatId}`, p.priceCents);
    }

    // 6. Fetch selling_formats names for variation display names
    const sellingFormatIds = new Set<string>();
    for (const brand of brandMap.values()) {
      for (const [, variation] of brand.variations) {
        sellingFormatIds.add(variation.sellingFormatId);
      }
    }

    let formatNames: Record<string, string> = {};
    if (sellingFormatIds.size > 0) {
      const { data: sfData } = await admin
        .from("selling_formats")
        .select("id, name")
        .in("id", [...sellingFormatIds]);
      if (sfData) {
        formatNames = Object.fromEntries(sfData.map((sf) => [sf.id, sf.name]));
      }
    }

    // 7. Load existing catalog mappings for Square IDs and versions
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

    // 8. Build SquareSyncProduct array
    const products: SquareSyncProduct[] = [];

    for (const brand of brandMap.values()) {
      const itemMapping = mapLookup.get(`brand-${brand.brandId}`);
      const variations: SquareSyncVariation[] = [];

      for (const [varKey, variation] of brand.variations) {
        const varMapping = mapLookup.get(`var-${brand.brandId}-${varKey}`);
        const brandPrices = priceLookup.get(brand.brandId);
        const priceCents = brandPrices?.get(varKey) ?? 0;

        // Resolve display name from selling_formats
        const displayName = formatNames[variation.sellingFormatId] ?? "Unknown Format";

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

    // 9. Push catalog to Square
    const syncResult = await pushCatalog(client, products);

    // 10. Clean up stale items
    const deletedCount = await deleteStaleItems(client, activeBrandIds);

    // 11. Update last_catalog_sync_at
    const completedAt = new Date().toISOString();
    await updateSquareSettings({
      last_catalog_sync_at: completedAt,
    });

    // 12. Log to square_sync_log
    await admin.from("square_sync_log").insert({
      sync_type: "catalog_push",
      items_synced: syncResult.itemsSynced,
      items_failed: syncResult.itemsFailed,
      details: {
        productsCount: products.length,
        variationsCount: products.reduce((sum, p) => sum + p.variations.length, 0),
        staleDeleted: deletedCount,
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
