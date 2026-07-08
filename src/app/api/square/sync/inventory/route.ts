/**
 * Square Inventory Sync
 *
 * POST: Push inventory counts to Square for every POS-configured bin.
 *
 * Bin-driven (Milestone C5): Square POS configuration lives on the BIN, not the
 * location (00222 dropped locations.square_location_id / locations.pos_bin_id).
 * A bin is a POS sync target IFF it has BOTH bins.square_location_id and
 * bins.pos_sales_channel_id set. Square inventory is per-location, so each bin's
 * counts are scoped to that bin's square_location_id.
 *
 * For each POS-configured bin:
 * 1. Reads sellable stock (packaged FG + filled kegs, unified) from the
 *    sellable_inventory view (00221)
 * 2. Converts packaged case quantities to selling units (× unit_count); filled
 *    kegs (source='keg') are already per-keg and pushed as-is
 * 3. Looks up Square variation IDs from square_catalog_map
 * 4. Pushes physical counts to Square scoped to the bin's square_location_id
 * 5. Logs sync result (square_sync_log.location_id = the view's location uuid)
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/server";
import { getSquareClient, updateSquareSettings } from "@/integrations/square/client";
import { pushInventoryCounts } from "@/integrations/square/inventory";
import type { SquareSyncInventory, SquareSyncResult } from "@/integrations/square/types";

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
      .select("id, name, square_location_id")
      .not("square_location_id", "is", null)
      .not("pos_sales_channel_id", "is", null);

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

    // 2. Load catalog mappings for ITEM_VARIATION entries
    //    We need: brand_id + selling_format_id -> square_catalog_id
    const { data: catalogMaps, error: mapError } = await admin
      .from("square_catalog_map")
      .select("brand_id, selling_format_id, square_catalog_id")
      .eq("object_type", "ITEM_VARIATION");

    if (mapError) {
      throw new Error(`Failed to query catalog mappings: ${mapError.message}`);
    }

    // Build lookup: "brand-{brandId}-fmt-{formatId}" -> squareVariationId
    const variationLookup = new Map<string, string>();
    for (const m of catalogMaps ?? []) {
      if (m.selling_format_id) {
        variationLookup.set(
          `brand-${m.brand_id}-fmt-${m.selling_format_id}`,
          m.square_catalog_id
        );
      }
    }

    // 3. Read sellable stock across all POS bins from the unified read model
    //    (packaged finished goods in bins + filled-keg contents, double-count
    //    guard baked in). Single query replacing the old bin_inventory +
    //    keg_filled_contents dance.
    const posBinIds = posBins.map((b) => b.id);
    const { data: stock, error: stockError } = await admin
      .from("sellable_inventory")
      .select("bin_id, location_id, brand_id, selling_format_id, quantity, source")
      .in("bin_id", posBinIds)
      .gt("quantity", 0);

    if (stockError) {
      throw new Error(`Failed to query sellable inventory: ${stockError.message}`);
    }

    // 4. unit_count per format — packaged bin_inventory is in CASES; convert to
    //    selling units (× unit_count). Filled kegs (source='keg') are already
    //    per-keg and are pushed as-is, matching the prior location-based behavior.
    const rows = stock ?? [];
    const formatIds = [
      ...new Set(rows.map((r) => r.selling_format_id).filter((v): v is string => !!v)),
    ];
    const unitCounts = new Map<string, number>();
    if (formatIds.length > 0) {
      const { data: sfData, error: sfError } = await admin
        .from("selling_formats")
        .select("id, unit_count")
        .in("id", formatIds);
      if (sfError) {
        throw new Error(`Failed to query selling formats: ${sfError.message}`);
      }
      for (const f of sfData ?? []) {
        unitCounts.set(f.id, f.unit_count ?? 1);
      }
    }

    // Group stock rows by bin.
    const stockByBin = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!r.bin_id) continue;
      if (!stockByBin.has(r.bin_id)) stockByBin.set(r.bin_id, []);
      stockByBin.get(r.bin_id)!.push(r);
    }

    // 5. Process each POS bin
    const binResults: Array<{
      binId: string;
      binName: string;
      squareLocationId: string;
      locationId: string | null;
      result: SquareSyncResult;
    }> = [];

    let totalSynced = 0;
    let totalFailed = 0;
    const allErrors: Array<{ itemId: string; error: string }> = [];

    for (const bin of posBins) {
      const squareLocationId = bin.square_location_id!;
      const binRows = stockByBin.get(bin.id) ?? [];

      // The view's location_id for this bin (all rows share it, since a bin has one
      // location). Used for square_sync_log.location_id, which FKs locations(id) —
      // a real location uuid, NOT the Square location id.
      const locationId = binRows.find((r) => r.location_id)?.location_id ?? null;

      // Aggregate by brand + selling_format, converting packaged cases -> selling
      // units. A selling_format's container is either keg or not, so a given
      // selling_format_id is entirely packaged or entirely keg — no source mixing
      // per (brand, format), so the per-row conversion is unambiguous.
      const aggregated = new Map<string, Map<string, number>>();
      for (const r of binRows) {
        if (!r.brand_id || !r.selling_format_id || r.quantity == null) continue;

        const units =
          r.source === "packaged"
            ? r.quantity * (unitCounts.get(r.selling_format_id) ?? 1)
            : r.quantity;

        if (!aggregated.has(r.brand_id)) aggregated.set(r.brand_id, new Map());
        const brandAgg = aggregated.get(r.brand_id)!;
        brandAgg.set(r.selling_format_id, (brandAgg.get(r.selling_format_id) ?? 0) + units);
      }

      const counts: SquareSyncInventory[] = [];
      for (const [brandId, formatMap] of aggregated) {
        for (const [formatId, quantity] of formatMap) {
          const squareVariationId = variationLookup.get(`brand-${brandId}-fmt-${formatId}`);

          if (!squareVariationId) {
            allErrors.push({
              itemId: `${brandId}/${formatId}`,
              error: `No Square catalog mapping for brand ${brandId} / format ${formatId} at bin ${bin.name}`,
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

      // Push counts for this bin
      if (counts.length > 0) {
        const result = await pushInventoryCounts(client, counts);
        binResults.push({
          binId: bin.id,
          binName: bin.name,
          squareLocationId,
          locationId,
          result,
        });
        totalSynced += result.itemsSynced;
        totalFailed += result.itemsFailed;
        allErrors.push(...result.errors);
      }
    }

    // 6. Update last_inventory_sync_at
    const completedAt = new Date().toISOString();
    await updateSquareSettings({
      last_inventory_sync_at: completedAt,
    });

    // 7. Log to square_sync_log (one entry per bin that produced counts)
    for (const br of binResults) {
      await admin.from("square_sync_log").insert({
        sync_type: "inventory_push",
        location_id: br.locationId,
        items_synced: br.result.itemsSynced,
        items_failed: br.result.itemsFailed,
        details: {
          binId: br.binId,
          binName: br.binName,
          squareLocationId: br.squareLocationId,
          errors: br.result.errors.length > 0 ? br.result.errors : undefined,
          triggeredBy: user.id,
        },
        started_at: startedAt,
        completed_at: completedAt,
      });
    }

    // If no bins produced counts, log a single entry
    if (binResults.length === 0) {
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
      binsProcessed: binResults.length,
      bins: binResults.map((br) => ({
        binId: br.binId,
        binName: br.binName,
        squareLocationId: br.squareLocationId,
        itemsSynced: br.result.itemsSynced,
        itemsFailed: br.result.itemsFailed,
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
