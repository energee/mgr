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
 * 2. Aggregates per (brand, selling_format). Quantities are pushed AS-IS: a
 *    finished-goods quantity is already a count of SELLING UNITS (cases/packs)
 *    and buildCatalogObjects makes exactly ONE ITEM_VARIATION per selling_format
 *    priced per selling unit, so a Square line-item quantity is in the same unit.
 *    (Historic note: an earlier version multiplied packaged rows by
 *    selling_formats.unit_count — that OVER-reports on-hand by unit_count, since
 *    unit_count is containers-per-case, not cases; removed.)
 * 3. Looks up Square variation IDs from square_catalog_map
 * 4. Emits an explicit quantity-0 PHYSICAL_COUNT for every mapped variation NOT
 *    stocked at the bin, so a variation that sold out in MGR drops to 0 on the
 *    POS instead of displaying its last non-zero count forever (phantom stock).
 * 5. Pushes physical counts to Square scoped to the bin's square_location_id
 * 6. Logs sync result (square_sync_log.location_id = the view's location uuid)
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/server";
import { updateSquareSettings } from "@/integrations/square/client";
import { pushInventoryCounts } from "@/integrations/square/inventory";
import { getPosBins, requireSquareClient, logSyncFailure } from "@/integrations/square/route-helpers";
import type { SquareSyncInventory, SquareSyncResult } from "@/integrations/square/types";

const log = logger.child({ route: "/api/square/sync/inventory" });

const EMPTY_RESULT: SquareSyncResult = {
  success: true,
  itemsSynced: 0,
  itemsFailed: 0,
  errors: [],
};

export const POST = withPermission("integrations:manage", async (_request, { user }) => {
  const guard = await requireSquareClient();
  if (!guard.ok) return guard.response;
  const client = guard.client;

  const admin = await createAdminClient();
  const startedAt = new Date().toISOString();

  try {
    // 1. Get POS-configured bins (both square_location_id and pos_sales_channel_id
    //    set => a Square POS sync target). Stable total order (id is the non-null
    //    unique PK) — deterministic bin processing/log order across syncs.
    const { data: posBins, error: binsError } = await getPosBins<{
      id: string;
      name: string;
      square_location_id: string | null;
      // NOT NULL on bins in the live-regenerated types; must match Row exactly
      // for getPosBins' Partial<Row> constraint.
      location_id: string;
    }>(admin, { select: "id, name, square_location_id, location_id", orderBy: "id" });

    if (binsError) {
      throw new Error(`Failed to query POS bins: ${binsError.message}`);
    }

    if (!posBins || posBins.length === 0) {
      // A client configuration error, not a sync failure.
      return errorResponse(
        "CONFIGURATION_ERROR",
        "No bins configured with a Square location and POS sales channel",
        undefined,
        400
      );
    }

    // 2. Load catalog mappings for ITEM_VARIATION entries.
    //    We need: brand_id + selling_format_id -> square_catalog_id, AND the full
    //    set of mapped variations (for the zero-count sweep in step 5).
    const { data: catalogMaps, error: mapError } = await admin
      .from("square_catalog_map")
      .select("brand_id, selling_format_id, square_catalog_id")
      .eq("object_type", "ITEM_VARIATION");

    if (mapError) {
      throw new Error(`Failed to query catalog mappings: ${mapError.message}`);
    }

    // Build lookup: "brand-{brandId}-fmt-{formatId}" -> squareVariationId, plus a
    // flat list of every mapped variation (square_catalog_map has no location
    // dimension — one catalog object is shared across all Square locations).
    const variationLookup = new Map<string, string>();
    const mappedVariations: Array<{ brandId: string; formatId: string; squareVariationId: string }> = [];
    for (const m of catalogMaps ?? []) {
      if (m.brand_id && m.selling_format_id) {
        variationLookup.set(
          `brand-${m.brand_id}-fmt-${m.selling_format_id}`,
          m.square_catalog_id
        );
        mappedVariations.push({
          brandId: m.brand_id,
          formatId: m.selling_format_id,
          squareVariationId: m.square_catalog_id,
        });
      }
    }

    // 3. Read sellable stock across all POS bins from the unified read model
    //    (packaged finished goods in bins + filled-keg contents, double-count
    //    guard baked in). The view is already positive-only (bi.quantity > 0);
    //    the .gt here is belt-and-suspenders. The sold-out set is derived by
    //    DIFFERENCING the catalog map against this in-stock set (step 5), not by
    //    reading zero rows.
    const posBinIds = posBins.map((b) => b.id);
    const { data: stock, error: stockError } = await admin
      .from("sellable_inventory")
      .select("bin_id, location_id, brand_id, selling_format_id, quantity, source")
      .in("bin_id", posBinIds)
      .gt("quantity", 0);

    if (stockError) {
      throw new Error(`Failed to query sellable inventory: ${stockError.message}`);
    }

    const rows = stock ?? [];

    // Group stock rows by bin.
    const stockByBin = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!r.bin_id) continue;
      if (!stockByBin.has(r.bin_id)) stockByBin.set(r.bin_id, []);
      stockByBin.get(r.bin_id)!.push(r);
    }

    // 4. Build a per-bin push plan (counts + mapping errors + attribution). Counts
    //    are accumulated but NOT pushed yet, so all bins can be pushed together
    //    (step 5).
    type BinPlan = {
      binId: string;
      binName: string;
      squareLocationId: string;
      locationId: string | null;
      counts: SquareSyncInventory[];
      mappingErrors: Array<{ itemId: string; error: string }>;
    };
    const plans: BinPlan[] = [];

    for (const bin of posBins) {
      const squareLocationId = bin.square_location_id!;
      const binRows = stockByBin.get(bin.id) ?? [];

      // The BIN's own location. Used for square_sync_log.location_id, which FKs
      // locations(id) — a real location uuid, NOT the Square location id. Taken
      // from the bin rather than from a stock row: keg rows carry
      // keg_transactions.to_location_id, set independently of the bin, so they
      // can name a location that does not own this bin.
      const locationId = bin.location_id;

      // Aggregate by brand + selling_format. Quantity is pushed AS-IS (see the
      // module header): a selling_format's Square variation is priced/counted per
      // selling unit, and the FG quantity is already in selling units.
      const aggregated = new Map<string, Map<string, number>>();
      for (const r of binRows) {
        if (!r.brand_id || !r.selling_format_id || r.quantity == null) continue;
        if (!aggregated.has(r.brand_id)) aggregated.set(r.brand_id, new Map());
        const brandAgg = aggregated.get(r.brand_id)!;
        brandAgg.set(r.selling_format_id, (brandAgg.get(r.selling_format_id) ?? 0) + r.quantity);
      }

      const counts: SquareSyncInventory[] = [];
      const mappingErrors: Array<{ itemId: string; error: string }> = [];
      const stockedKeys = new Set<string>();

      for (const [brandId, formatMap] of aggregated) {
        for (const [formatId, quantity] of formatMap) {
          stockedKeys.add(`${brandId}::${formatId}`);
          const squareVariationId = variationLookup.get(`brand-${brandId}-fmt-${formatId}`);

          if (!squareVariationId) {
            mappingErrors.push({
              itemId: `${brandId}/${formatId}`,
              error: `No Square catalog mapping for brand ${brandId} / format ${formatId} at bin ${bin.name}`,
            });
            continue;
          }

          counts.push({ squareVariationId, squareLocationId, quantity });
        }
      }

      // Zero out every mapped variation NOT stocked at this bin, so sold-out
      // variations drop to 0 on the POS (phantom-stock fix). pushInventoryCounts
      // already accepts quantity 0 (it stringifies).
      // ponytail: this is a full mapped-variation x bin sweep each sync (bounded,
      // fine at taproom scale). Upgrade path if that grows: track the last-pushed
      // (bin, variation) set and only zero the ones that transitioned to 0.
      for (const mv of mappedVariations) {
        if (stockedKeys.has(`${mv.brandId}::${mv.formatId}`)) continue;
        counts.push({ squareVariationId: mv.squareVariationId, squareLocationId, quantity: 0 });
      }

      plans.push({
        binId: bin.id,
        binName: bin.name,
        squareLocationId,
        locationId,
        counts,
        mappingErrors,
      });
    }

    // 5. Push all bins' counts. Each SquareSyncInventory carries its own
    //    squareLocationId, so pushInventoryCounts already scopes per change and
    //    chunks internally at 100.
    //    E1 note: the reviewer suggested concatenating every bin's counts into ONE
    //    call. We deliberately use Promise.all over per-bin pushes instead:
    //    pushInventoryCounts reports errors per failed CHUNK keyed only by
    //    catalogObjectId (no location), so a concatenated call could not attribute
    //    a failure back to a specific bin/location for per-bin square_sync_log
    //    rows. Per-bin pushes parallelize (removing the old sequential awaits) AND
    //    keep exact per-bin attribution.
    const pushResults = await Promise.all(
      plans.map((p) =>
        p.counts.length > 0
          ? pushInventoryCounts(client, p.counts)
          : Promise.resolve(EMPTY_RESULT)
      )
    );

    // Combine push result + mapping errors per bin.
    const binResults = plans
      .map((p, i) => {
        const pr = pushResults[i];
        return {
          binId: p.binId,
          binName: p.binName,
          squareLocationId: p.squareLocationId,
          locationId: p.locationId,
          hasWork: p.counts.length > 0 || p.mappingErrors.length > 0,
          itemsSynced: pr.itemsSynced,
          itemsFailed: pr.itemsFailed + p.mappingErrors.length,
          errors: [...pr.errors, ...p.mappingErrors],
        };
      })
      // Keep a bin only if it pushed counts or hit a mapping error, so unmapped-
      // format errors are durable in square_sync_log even when other bins succeeded.
      .filter((br) => br.hasWork);

    let totalSynced = 0;
    let totalFailed = 0;
    const allErrors: Array<{ itemId: string; error: string }> = [];
    for (const br of binResults) {
      totalSynced += br.itemsSynced;
      totalFailed += br.itemsFailed;
      allErrors.push(...br.errors);
    }

    // 6. Update last_inventory_sync_at
    const completedAt = new Date().toISOString();
    await updateSquareSettings({ last_inventory_sync_at: completedAt });

    // 7. Log to square_sync_log — ONE batched insert of the per-bin rows (E2).
    //    A failed log write must not fail the sync (the push to Square already
    //    happened), but it must not be SILENT either — log it (observability).
    if (binResults.length > 0) {
      const { error: logError } = await admin.from("square_sync_log").insert(
        binResults.map((br) => ({
          sync_type: "inventory_push" as const,
          location_id: br.locationId,
          items_synced: br.itemsSynced,
          items_failed: br.itemsFailed,
          details: {
            binId: br.binId,
            binName: br.binName,
            squareLocationId: br.squareLocationId,
            errors: br.errors.length > 0 ? br.errors : undefined,
            triggeredBy: user.id,
          },
          started_at: startedAt,
          completed_at: completedAt,
        }))
      );
      if (logError) {
        log.error({ err: logError.message }, "Failed to write inventory sync log rows");
      }
    } else {
      // No bins produced counts — log a single entry.
      const { error: logError } = await admin.from("square_sync_log").insert({
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
      if (logError) {
        log.error({ err: logError.message }, "Failed to write inventory sync log row");
      }
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
        itemsSynced: br.itemsSynced,
        itemsFailed: br.itemsFailed,
      })),
      errors: allErrors,
    });
  } catch (err) {
    return logSyncFailure(admin, {
      syncType: "inventory_push",
      startedAt,
      userId: user.id,
      err,
    });
  }
});
