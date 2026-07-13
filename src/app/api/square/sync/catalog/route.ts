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
 * 5. Builds SquareSyncProduct array and pushes to Square. Unpriced variations:
 *    UNMAPPED ones are omitted (nothing live to lose); MAPPED ones are preserved
 *    in the push at their CURRENT live Square price (the batch upsert replaces
 *    an item's full variation set, so omitting a mapped variation would delete
 *    it live and destroy its Item-Sales reporting continuity)
 * 6. Cleans up stale (DISCONTINUED) catalog items. The keep set is the ACTIVE
 *    brand set (brands.is_active, 00244) — pure config state, NEVER stock/bin
 *    inference (audit IN-9: a bin re-point shrank the derived keep set and
 *    bulk-deleted live Square items). Sold-out brands stay active, so their
 *    Square items/history survive; flipping a brand inactive is the
 *    intentional-removal path. deleteStaleItems additionally refuses oversized
 *    delete sets unless the request body carries { forceStaleDelete: true }
 *    (the IN-9 interim guard, kept as defense in depth).
 * 7. Logs sync result
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/server";
import { updateSquareSettings } from "@/integrations/square/client";
import {
  pushCatalog,
  deleteStaleItems,
  retrieveVariationPricing,
  type DeleteStaleResult,
  type LiveVariationPricing,
} from "@/integrations/square/catalog";
import { getPosBins, requireSquareClient, logSyncFailure } from "@/integrations/square/route-helpers";
import { resolveChannelPrices } from "@/integrations/square/pricing";
import { dynamicFrom } from "@/services/types";
import type { SquareSyncProduct, SquareSyncVariation } from "@/integrations/square/types";

const log = logger.child({ route: "/api/square/sync/catalog" });

export const POST = withPermission("integrations:manage", async (request, { user }) => {
  const guard = await requireSquareClient();
  if (!guard.ok) return guard.response;
  const client = guard.client;

  // Optional body: { forceStaleDelete?: boolean } — human confirmation that an
  // oversized stale-delete set (see deleteStaleItems' IN-9 guard) is a real
  // mass retirement. No/invalid JSON body = false (guard armed).
  const body = (await request.json().catch(() => null)) as {
    forceStaleDelete?: boolean;
  } | null;
  const forceStaleDelete = body?.forceStaleDelete === true;

  const admin = await createAdminClient();
  const startedAt = new Date().toISOString();

  try {
    // 1. Get POS-configured bins (both square_location_id and pos_sales_channel_id
    //    set => a Square POS sync target). Replaces the old POS-on-location model.
    //    Stable total order (id is the non-null unique PK) so the multi-channel
    //    price tie-break below is deterministic across syncs. created_at is
    //    nullable/non-unique and can't guarantee a total order.
    const { data: posBins, error: binsError } = await getPosBins<{
      id: string;
      square_location_id: string | null;
      pos_sales_channel_id: string | null;
    }>(admin, { select: "id, square_location_id, pos_sales_channel_id", orderBy: "id" });

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

    // 3. Read ALL ACTIVE brands (00244) — one query doing double duty:
    //    - enriches brand metadata for the push (the view exposes only ids);
    //    - IS the catalog KEEP set for stale cleanup (step 9). The keep set
    //      must be config state (is_active), never a function of what the
    //      stock read happened to return — audit IN-9: re-pointing a bin's POS
    //      target shrank the derived keep set and bulk-deleted the live Square
    //      catalog. A failed read throws (sync aborts); an INACTIVE brand is
    //      excluded here, which both drops its stock rows from the push below
    //      (the brandInfo lookup misses) and lets deleteStaleItems remove its
    //      mapped Square objects — discontinuing is the ONLY removal path.
    //    dynamicFrom: is_active is a 00244 column not yet in the generated
    //    types (regenerate after the migration is applied live).
    const formatIds = [
      ...new Set((stock ?? []).map((s) => s.selling_format_id).filter((v): v is string => !!v)),
    ];

    const { data: brandRows, error: brandError } = await dynamicFrom(admin, "brands")
      .select("id, name, description")
      .eq("is_active", true);
    if (brandError) {
      throw new Error(`Failed to query brands: ${brandError.message}`);
    }
    const brandInfo = new Map<string, { name: string; description: string | null }>();
    for (const b of (brandRows ?? []) as Array<{
      id: string;
      name: string;
      description: string | null;
    }>) {
      brandInfo.set(b.id, { name: b.name, description: b.description });
    }

    let formatNames: Record<string, string> = {};
    if (formatIds.length > 0) {
      const { data: sfData, error: sfError } = await admin
        .from("selling_formats")
        .select("id, name")
        .in("id", formatIds);
      // A swallowed failure here would fall back to "Unknown Format" as the
      // LIVE variation name on every pushed object — throw like brandError.
      if (sfError) {
        throw new Error(`Failed to query selling formats: ${sfError.message}`);
      }
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
      // Keep the binIndex tie-break: it looks like YAGNI, but the stock query has
      // no bin ordering, so without it the chosen channel would flip between syncs
      // on DB row order — removing it is NOT behavior-preserving.
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

    // In-stock brands drive the catalog/pricing PUSH (we only have variations +
    // prices for what the view returns, i.e. quantity > 0).
    const activeBrandIds = [...brandMap.keys()];

    // 5. Resolve prices for ALL DISTINCT POS channels in a single batched call
    //    (resolveChannelPrices runs the channel-independent brand->tier queries
    //    once and fetches every channel's prices with one IN query). Replaces the
    //    old per-channel loop that re-ran those queries each iteration.
    //    channelId -> brandId -> varKey -> priceCents
    const distinctChannels = [...new Set(posBins.map((b) => b.pos_sales_channel_id!))];
    const pricesByChannel = await resolveChannelPrices(activeBrandIds, distinctChannels);
    const channelPriceLookup = new Map<string, Map<string, Map<string, number>>>();
    for (const [channelId, prices] of pricesByChannel) {
      const brandLookup = new Map<string, Map<string, number>>();
      for (const p of prices) {
        if (!brandLookup.has(p.brandId)) {
          brandLookup.set(p.brandId, new Map());
        }
        brandLookup.get(p.brandId)!.set(`fmt-${p.sellingFormatId}`, p.priceCents);
      }
      channelPriceLookup.set(channelId, brandLookup);
    }

    // 6. Load existing catalog mappings for Square IDs and versions. A swallowed
    //    failure here is CATASTROPHIC, not cosmetic: an empty map lookup makes
    //    every object below push with a temp "#brand-…" id, so Square creates a
    //    FULL DUPLICATE catalog instead of updating in place — throw like
    //    binsError/stockError.
    const { data: existingMaps, error: mapsError } = await admin
      .from("square_catalog_map")
      .select("*");
    if (mapsError) {
      throw new Error(`Failed to query catalog mappings: ${mapsError.message}`);
    }

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

    // 7. Build SquareSyncProduct array.
    //
    // Unpriced variations (no price row on their channel, or an explicit $0)
    // split on mapping state — Square's batch upsert REPLACES an item's full
    // variation set, so what "skip" means differs:
    //   - UNMAPPED (never pushed): safely OMITTED. Square holds no object for
    //     it, so there is nothing to lose. Pushing it would publish it at
    //     FIXED_PRICING $0.00 — sellable for free at the live register.
    //   - MAPPED (live on Square): MUST stay in the push. Omitting it would
    //     DELETE the live variation (destroying Item-Sales reporting continuity
    //     and leaving square_catalog_map pointing at a dead object with a stale
    //     version). It is re-included with its CURRENT live pricing, read back
    //     via retrieveVariationPricing — preserved, never repriced.
    // Both lists are surfaced (log + response) so staff can price them in MGR.
    // NOTE: a deliberately-$0 comp price set in MGR is indistinguishable from
    // "unpriced" here, so comps cannot be (re)published FROM MGR — price them
    // directly in Square; once mapped, this preservation keeps them intact.
    const products: SquareSyncProduct[] = [];
    const unpricedVariations: string[] = [];
    const preservedVariations: string[] = [];

    // Pass 1: price what MGR can price; queue mapped-but-unpriced variations
    // for live-price preservation.
    type PendingPreserve = {
      sellingFormatId: string;
      displayName: string;
      label: string;
      squareCatalogId: string;
      squareVersion?: bigint;
    };
    const pendingBrands: Array<{
      brand: NonNullable<ReturnType<typeof brandMap.get>>;
      itemMapping: { squareCatalogId: string; squareVersion: bigint | undefined } | undefined;
      variations: SquareSyncVariation[];
      pending: PendingPreserve[];
    }> = [];

    for (const brand of brandMap.values()) {
      const itemMapping = mapLookup.get(`brand-${brand.brandId}`);
      const variations: SquareSyncVariation[] = [];
      const pending: PendingPreserve[] = [];

      for (const [varKey, variation] of brand.variations) {
        const varMapping = mapLookup.get(`var-${brand.brandId}-${varKey}`);
        const displayName = formatNames[variation.sellingFormatId] ?? "Unknown Format";
        const label = `${brand.brandName} / ${displayName}`;

        // Price from the channel of the bin(s) that stock this variation.
        const chan = variationChannel.get(`${brand.brandId}-${varKey}`);
        const resolvedPrice = chan
          ? channelPriceLookup.get(chan.channelId)?.get(brand.brandId)?.get(varKey)
          : undefined;

        if (resolvedPrice == null || resolvedPrice === 0) {
          if (varMapping) {
            // Mapped: must be preserved (see block comment above).
            pending.push({
              sellingFormatId: variation.sellingFormatId,
              displayName,
              label,
              squareCatalogId: varMapping.squareCatalogId,
              squareVersion: varMapping.squareVersion,
            });
          } else {
            // Unmapped: omission is safe — nothing live to delete.
            unpricedVariations.push(label);
          }
          continue;
        }

        variations.push({
          sellingFormatId: variation.sellingFormatId,
          name: displayName,
          priceCents: resolvedPrice,
          squareCatalogId: varMapping?.squareCatalogId,
          squareVersion: varMapping?.squareVersion,
        });
      }

      pendingBrands.push({ brand, itemMapping, variations, pending });
    }

    // Fetch live pricing for every queued preservation in one Square read. A
    // failure here must ABORT the sync (throw -> catch -> 500): pushing without
    // the preserved variations is exactly the deletion this exists to prevent.
    const preserveIds = pendingBrands.flatMap((b) => b.pending.map((p) => p.squareCatalogId));
    const livePricing =
      preserveIds.length > 0
        ? await retrieveVariationPricing(client, preserveIds)
        : new Map<string, LiveVariationPricing>();

    // Pass 2: fold preserved variations back in and assemble the products.
    for (const { brand, itemMapping, variations, pending } of pendingBrands) {
      for (const p of pending) {
        const live = livePricing.get(p.squareCatalogId);
        if (!live) {
          // The mapped object no longer exists on Square (deleted out-of-band):
          // treat as unmapped — omission deletes nothing.
          unpricedVariations.push(p.label);
          continue;
        }
        variations.push({
          sellingFormatId: p.sellingFormatId,
          name: p.displayName,
          // Echo the live pricing block back verbatim (a live $0 comp price is
          // a real price; null = live VARIABLE_PRICING, omits price_money).
          priceCents: live.priceCents,
          pricingType: live.pricingType,
          squareCatalogId: p.squareCatalogId,
          // Prefer the LIVE version — the map's copy can be stale, and a stale
          // version fails Square's optimistic concurrency check on upsert.
          squareVersion: live.version ?? p.squareVersion,
        });
        preservedVariations.push(p.label);
      }

      // A brand with nothing to publish (every variation unpriced AND unmapped)
      // is skipped. It is still an ACTIVE brand (00244 keep set), so
      // deleteStaleItems will not treat it as stale and delete its live Square
      // item. A brand with only PRESERVED variations is still pushed — that is
      // what keeps its live variations alive.
      if (variations.length === 0) continue;

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

    // 9. The catalog KEEP set for stale cleanup. "Stale" must mean
    //    DISCONTINUED, not merely SOLD OUT — deleting a Square item destroys its
    //    variations, images, modifier lists, and Item-Sales reporting continuity.
    //    Since 00244 the keep set IS the active-brand set read in step 3: pure
    //    config state. The pre-00244 derivation (in-stock brands ∪ bin_inventory
    //    rows at POS bins ∪ any keg-format FG brand) shrank with the reads it
    //    was built from — a bin re-point or transient empty read mass-deleted
    //    live Square objects (audit IN-9). Sold-out active brands are kept by
    //    construction; flipping is_active off is the intentional removal.
    const keepBrandIdList = [...brandInfo.keys()];

    // Guard the empty keep set: deleteStaleItems treats [] as "delete the ENTIRE
    // catalog". No active brands at all is far more plausibly an unseeded or
    // misread brands table than a full product-line shutdown — skip cleanup
    // rather than wipe everything.
    const staleResult: DeleteStaleResult =
      keepBrandIdList.length > 0
        ? await deleteStaleItems(client, keepBrandIdList, { force: forceStaleDelete })
        : { deleted: 0, failed: 0, errors: [] };

    // 10. Update last_catalog_sync_at
    const completedAt = new Date().toISOString();
    await updateSquareSettings({
      last_catalog_sync_at: completedAt,
    });

    // 11. Log to square_sync_log. Fold stale-delete failures (Square objects that
    //     could not be removed and whose map rows were retained) into items_failed
    //     so they surface in the count, and record their detail. A failed log
    //     write must not fail the completed sync, but not stay silent either.
    const { error: logError } = await admin.from("square_sync_log").insert({
      sync_type: "catalog_push",
      items_synced: syncResult.itemsSynced,
      items_failed: syncResult.itemsFailed + staleResult.failed,
      details: {
        posBinCount: posBins.length,
        productsCount: products.length,
        variationsCount: products.reduce((sum, p) => sum + p.variations.length, 0),
        staleDeleted: staleResult.deleted,
        staleFailed: staleResult.failed > 0 ? staleResult.failed : undefined,
        staleErrors: staleResult.errors.length > 0 ? staleResult.errors : undefined,
        staleAborted: staleResult.aborted,
        unpricedVariations: unpricedVariations.length > 0 ? unpricedVariations : undefined,
        preservedVariations: preservedVariations.length > 0 ? preservedVariations : undefined,
        errors: syncResult.errors.length > 0 ? syncResult.errors : undefined,
        triggeredBy: user.id,
      },
      started_at: startedAt,
      completed_at: completedAt,
    });
    if (logError) {
      log.error({ err: logError.message }, "Failed to write catalog sync log row");
    }

    return successResponse({
      // staleResult.errors also covers the failed===0 case where the stale-entry
      // SELECT itself failed (chunk -1) and cleanup never ran — not a success.
      // An IN-9 guard abort (staleAborted) is likewise not a success: cleanup
      // was refused pending human confirmation (re-POST with forceStaleDelete).
      success:
        syncResult.success &&
        staleResult.failed === 0 &&
        staleResult.errors.length === 0 &&
        !staleResult.aborted,
      itemsSynced: syncResult.itemsSynced,
      itemsFailed: syncResult.itemsFailed + staleResult.failed,
      staleDeleted: staleResult.deleted,
      staleFailed: staleResult.failed,
      staleErrors: staleResult.errors,
      staleAborted: staleResult.aborted ?? null,
      productsCount: products.length,
      unpricedVariations,
      preservedVariations,
      errors: syncResult.errors,
    });
  } catch (err) {
    return logSyncFailure(admin, {
      syncType: "catalog_push",
      startedAt,
      userId: user.id,
      err,
    });
  }
});
