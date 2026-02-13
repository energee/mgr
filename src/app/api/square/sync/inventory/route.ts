/**
 * Square Inventory Sync
 *
 * POST: Push inventory counts to Square for all POS-configured locations.
 *
 * For each location with square_location_id + pos_bin_id:
 * 1. Queries bin_inventory for the POS bin
 * 2. Converts case quantities to selling units (inner packs or individual units)
 * 3. Looks up Square variation IDs from square_catalog_map
 * 4. Pushes physical counts to Square
 * 5. Logs sync result
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/server";
import { getSquareClient, updateSquareSettings } from "@/lib/square/client";
import { pushInventoryCounts } from "@/lib/square/inventory";
import type { SquareSyncInventory, SquareSyncResult } from "@/lib/square/types";

// Supabase nested join shapes (not reflected in generated types)
interface PackageTypeJoin {
  id: string;
  inner_packs_per_case: number | null;
  units_per_case: number | null;
}

interface FGWithPackageType {
  id: string;
  brand_id: string;
  package_type_id: string;
  package_types: PackageTypeJoin | null;
}

interface FGBrandOnly {
  brand_id: string;
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
      throw new Error(`Failed to query locations: ${locError.message}`);
    }

    if (!locations || locations.length === 0) {
      return errorResponse(
        "CONFIGURATION_ERROR",
        "No locations configured with Square location ID and POS bin",
        undefined,
        400
      );
    }

    // 2. Load catalog mappings for ITEM_VARIATION entries
    //    We need: brand_id + package_type_id -> square_catalog_id
    const { data: catalogMaps, error: mapError } = await admin
      .from("square_catalog_map")
      .select("brand_id, package_type_id, keg_type_id, square_catalog_id")
      .eq("object_type", "ITEM_VARIATION");

    if (mapError) {
      throw new Error(`Failed to query catalog mappings: ${mapError.message}`);
    }

    // Build lookup: "brand-{brandId}-pkg-{pkgId}" or "brand-{brandId}-keg-{kegId}" -> squareVariationId
    const variationLookup = new Map<string, string>();
    for (const m of catalogMaps ?? []) {
      if (m.package_type_id) {
        variationLookup.set(
          `brand-${m.brand_id}-pkg-${m.package_type_id}`,
          m.square_catalog_id
        );
      }
      if (m.keg_type_id) {
        variationLookup.set(
          `brand-${m.brand_id}-keg-${m.keg_type_id}`,
          m.square_catalog_id
        );
      }
    }

    // 3. Process each location
    const locationResults: Array<{
      locationId: string;
      locationName: string;
      result: SquareSyncResult;
    }> = [];

    let totalSynced = 0;
    let totalFailed = 0;
    const allErrors: Array<{ itemId: string; error: string }> = [];

    for (const location of locations) {
      const squareLocationId = location.square_location_id!;
      const posBinId = location.pos_bin_id!;

      // 3a. Query bin inventory for this POS bin with package type details
      const { data: binItems, error: binError } = await admin
        .from("bin_inventory")
        .select(
          `
          bin_id,
          finished_good_id,
          quantity,
          finished_goods!inner(
            id,
            brand_id,
            package_type_id,
            package_types(
              id,
              inner_packs_per_case,
              units_per_case
            )
          )
        `
        )
        .eq("bin_id", posBinId)
        .gt("quantity", 0);

      if (binError) {
        allErrors.push({
          itemId: location.id,
          error: `Failed to query bin inventory for ${location.name}: ${binError.message}`,
        });
        continue;
      }

      // 3b. Convert to SquareSyncInventory
      const counts: SquareSyncInventory[] = [];

      // Aggregate by brand + package type (multiple FGs may share the same brand+package)
      // Use nested Map to avoid string-parsing UUIDs
      const aggregated = new Map<string, Map<string, number>>();

      for (const item of binItems ?? []) {
        const fg = item.finished_goods as unknown as FGWithPackageType | null;
        if (!fg?.brand_id || !fg?.package_type_id) continue;

        const { brand_id: brandId, package_type_id: packageTypeId, package_types: packageType } = fg;

        // Convert cases to selling units
        // The selling unit is the inner pack (e.g., 4-pack).
        // If no inner packs, the selling unit is individual unit.
        const sellingUnits =
          item.quantity *
          (packageType?.inner_packs_per_case ??
            packageType?.units_per_case ??
            1);

        if (!aggregated.has(brandId)) aggregated.set(brandId, new Map());
        const brandMap = aggregated.get(brandId)!;
        brandMap.set(packageTypeId, (brandMap.get(packageTypeId) ?? 0) + sellingUnits);
      }

      for (const [brandId, packageMap] of aggregated) {
        for (const [packageTypeId, quantity] of packageMap) {
          const lookupKey = `brand-${brandId}-pkg-${packageTypeId}`;
          const squareVariationId = variationLookup.get(lookupKey);

          if (!squareVariationId) {
            allErrors.push({
              itemId: `${brandId}/${packageTypeId}`,
              error: `No Square catalog mapping for brand ${brandId} / package ${packageTypeId} at ${location.name}`,
            });
            continue;
          }

          counts.push({
            squareVariationId,
            squareLocationId,
            quantity,
          });
        }
      }

      // 3c. Query keg inventory (filled kegs) at this location
      const { data: kegItems, error: kegError } = await admin
        .from("keg_inventory")
        .select(
          `
          keg_type_id,
          quantity,
          finished_good_id,
          finished_goods(brand_id)
        `
        )
        .eq("location_id", location.id)
        .eq("state", "filled")
        .gt("quantity", 0);

      if (kegError) {
        allErrors.push({
          itemId: location.id,
          error: `Failed to query keg inventory for ${location.name}: ${kegError.message}`,
        });
      } else {
        // Aggregate kegs by brand + keg_type using nested Map
        const kegAggregated = new Map<string, Map<string, number>>();
        for (const keg of kegItems ?? []) {
          const fg = keg.finished_goods as unknown as FGBrandOnly | null;
          const brandId = fg?.brand_id;
          if (!brandId || !keg.keg_type_id || !keg.quantity) continue;

          if (!kegAggregated.has(brandId)) kegAggregated.set(brandId, new Map());
          const brandMap = kegAggregated.get(brandId)!;
          brandMap.set(keg.keg_type_id, (brandMap.get(keg.keg_type_id) ?? 0) + keg.quantity);
        }

        for (const [brandId, kegMap] of kegAggregated) {
          for (const [kegTypeId, quantity] of kegMap) {
            const lookupKey = `brand-${brandId}-keg-${kegTypeId}`;
            const squareVariationId = variationLookup.get(lookupKey);

            if (!squareVariationId) {
              allErrors.push({
                itemId: `${brandId}/${kegTypeId}`,
                error: `No Square catalog mapping for brand ${brandId} / keg ${kegTypeId} at ${location.name}`,
              });
              continue;
            }

            counts.push({
              squareVariationId,
              squareLocationId,
              quantity,
            });
          }
        }
      }

      // 3d. Push counts for this location
      if (counts.length > 0) {
        const result = await pushInventoryCounts(client, counts);
        locationResults.push({
          locationId: location.id,
          locationName: location.name,
          result,
        });
        totalSynced += result.itemsSynced;
        totalFailed += result.itemsFailed;
        allErrors.push(...result.errors);
      }
    }

    // 4. Update last_inventory_sync_at
    const completedAt = new Date().toISOString();
    await updateSquareSettings({
      last_inventory_sync_at: completedAt,
    });

    // 5. Log to square_sync_log (one entry per location)
    for (const lr of locationResults) {
      await admin.from("square_sync_log").insert({
        sync_type: "inventory_push",
        location_id: lr.locationId,
        items_synced: lr.result.itemsSynced,
        items_failed: lr.result.itemsFailed,
        details: {
          locationName: lr.locationName,
          errors:
            lr.result.errors.length > 0 ? lr.result.errors : undefined,
          triggeredBy: user.id,
        },
        started_at: startedAt,
        completed_at: completedAt,
      });
    }

    // If no locations produced counts, log a single entry
    if (locationResults.length === 0) {
      await admin.from("square_sync_log").insert({
        sync_type: "inventory_push",
        items_synced: 0,
        items_failed: allErrors.length,
        details: {
          message: "No inventory counts to push",
          errors: allErrors.length > 0 ? allErrors : undefined,
          triggeredBy: user.id,
        },
        started_at: startedAt,
        completed_at: completedAt,
      });
    }

    return successResponse({
      success: allErrors.length === 0,
      totalSynced,
      totalFailed,
      locationsProcessed: locationResults.length,
      locations: locationResults.map((lr) => ({
        locationId: lr.locationId,
        locationName: lr.locationName,
        itemsSynced: lr.result.itemsSynced,
        itemsFailed: lr.result.itemsFailed,
      })),
      errors: allErrors,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Inventory sync failed";

    // Log the failed sync
    await admin.from("square_sync_log").insert({
      sync_type: "inventory_push",
      items_synced: 0,
      items_failed: 0,
      details: { error: message, triggeredBy: user.id },
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    });

    return errorResponse("SYNC_FAILED", message, undefined, 500);
  }
});
