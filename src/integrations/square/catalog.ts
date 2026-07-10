import type { SquareClient } from "square";
import { createAdminClient } from "@/lib/supabase/server";
import type { SquareSyncProduct, SquareSyncResult, SquareSyncVariation } from "./types";
import { log } from "@/lib/client-logger";

function variationKey(variation: SquareSyncVariation): string {
  return `fmt-${variation.sellingFormatId}`;
}

function optionalVersion(version: bigint | undefined): { version: bigint } | undefined {
  return version !== undefined ? { version } : undefined;
}

/**
 * Build Square CatalogObject array from MGR products.
 * Each brand becomes an ITEM with ITEM_VARIATION children for each package/keg type.
 */
export function buildCatalogObjects(products: SquareSyncProduct[]) {
  return products.map((product) => {
    const itemId = product.squareCatalogId ?? `#brand-${product.brandId}`;

    const variations = product.variations.map((variation) => {
      const variationId =
        variation.squareCatalogId ?? `#var-${product.brandId}-${variationKey(variation)}`;

      return {
        type: "ITEM_VARIATION" as const,
        id: variationId,
        ...optionalVersion(variation.squareVersion),
        itemVariationData: {
          itemId,
          name: variation.name,
          pricingType: "FIXED_PRICING" as const,
          priceMoney: {
            amount: BigInt(variation.priceCents),
            currency: "USD" as const,
          },
        },
      };
    });

    return {
      type: "ITEM" as const,
      id: itemId,
      ...optionalVersion(product.squareVersion),
      itemData: {
        name: product.brandName,
        description: product.description ?? undefined,
        variations,
      },
    };
  });
}

/**
 * Push catalog objects to Square and store mapping in square_catalog_map.
 *
 * Flow:
 *  1. Build CatalogObject array from products
 *  2. Call Square batchUpsertCatalogObjects
 *  3. Map returned IDs back to brands/selling formats
 *  4. Upsert into square_catalog_map
 *
 * C7 (no location dimension in v1): square_catalog_map is keyed only by
 * (brand_id, selling_format_id, object_type) — there is deliberately NO
 * square_location_id column. A brand/variation maps to ONE Square catalog
 * object shared across all Square locations, because v1 uses a single price per
 * variation (see resolveChannelPrices). Per-location price overrides (future)
 * would require a per-location catalog object, i.e. adding a location dimension
 * to this table and keying the map by it.
 */
export async function pushCatalog(
  client: SquareClient,
  products: SquareSyncProduct[]
): Promise<SquareSyncResult> {
  if (products.length === 0) {
    return { success: true, itemsSynced: 0, itemsFailed: 0, errors: [] };
  }

  const objects = buildCatalogObjects(products);
  const errors: Array<{ itemId: string; error: string }> = [];
  let itemsSynced = 0;

  try {
    const response = await client.catalog.batchUpsert({
      idempotencyKey: crypto.randomUUID(),
      batches: [{ objects }],
    });

    const admin = await createAdminClient();
    const idMappings = response.idMappings ?? [];
    const upsertedObjects = response.objects ?? [];

    // Build a lookup from temp ID (#brand-xxx) -> real Square ID
    const tempToRealId: Record<string, string> = {};
    for (const mapping of idMappings) {
      if (mapping.clientObjectId && mapping.objectId) {
        tempToRealId[mapping.clientObjectId] = mapping.objectId;
      }
    }

    // Build a lookup from Square ID -> version from the upserted objects
    const idToVersion: Record<string, bigint> = {};
    for (const obj of upsertedObjects) {
      if (obj.id && obj.version !== undefined) {
        idToVersion[obj.id] = obj.version;
      }
      // Also capture variations nested in items
      if (obj.type === "ITEM" && obj.itemData?.variations) {
        for (const v of obj.itemData.variations) {
          if (v.id && v.version !== undefined) {
            idToVersion[v.id] = v.version;
          }
        }
      }
    }

    // Persist mappings back to square_catalog_map
    const now = new Date().toISOString();

    for (const product of products) {
      const tempItemId = `#brand-${product.brandId}`;
      const realItemId =
        product.squareCatalogId ?? tempToRealId[tempItemId] ?? null;
      const itemVersion = realItemId ? idToVersion[realItemId] : undefined;

      if (!realItemId) {
        errors.push({
          itemId: product.brandId,
          error: `No Square ID returned for brand ${product.brandName}`,
        });
        continue;
      }

      // Upsert ITEM mapping -- try INSERT first, fall back to UPDATE on conflict
      const { error: insertError } = await admin
        .from("square_catalog_map")
        .insert({
          brand_id: product.brandId,
          selling_format_id: null,
          square_catalog_id: realItemId,
          square_version: itemVersion ? Number(itemVersion) : null,
          object_type: "ITEM",
          last_synced_at: now,
          updated_at: now,
        });

      if (insertError) {
        await admin
          .from("square_catalog_map")
          .update({
            square_catalog_id: realItemId,
            square_version: itemVersion ? Number(itemVersion) : null,
            last_synced_at: now,
            updated_at: now,
          })
          .eq("brand_id", product.brandId)
          .eq("object_type", "ITEM");
      }
      itemsSynced++;

      // Upsert each variation mapping
      for (const variation of product.variations) {
        const varKey = variationKey(variation);
        const tempVarId = `#var-${product.brandId}-${varKey}`;
        const realVarId =
          variation.squareCatalogId ?? tempToRealId[tempVarId] ?? null;
        const varVersion = realVarId ? idToVersion[realVarId] : undefined;

        if (!realVarId) {
          errors.push({
            itemId: `${product.brandId}/${varKey}`,
            error: `No Square ID returned for variation ${variation.name}`,
          });
          continue;
        }

        const { error: varInsertError } = await admin
          .from("square_catalog_map")
          .insert({
            brand_id: product.brandId,
            selling_format_id: variation.sellingFormatId,
            square_catalog_id: realVarId,
            square_version: varVersion ? Number(varVersion) : null,
            object_type: "ITEM_VARIATION",
            last_synced_at: now,
            updated_at: now,
          });

        if (varInsertError) {
          await admin
            .from("square_catalog_map")
            .update({
              square_catalog_id: realVarId,
              square_version: varVersion ? Number(varVersion) : null,
              last_synced_at: now,
              updated_at: now,
            })
            .eq("brand_id", product.brandId)
            .eq("object_type", "ITEM_VARIATION")
            .eq("selling_format_id", variation.sellingFormatId);
        }
        itemsSynced++;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push({ itemId: "*", error: message });
  }

  return {
    success: errors.length === 0,
    itemsSynced,
    itemsFailed: errors.length,
    errors,
  };
}

/** Outcome of {@link deleteStaleItems}. */
export type DeleteStaleResult = {
  /** Map rows removed locally (only for chunks Square actually deleted). */
  deleted: number;
  /** Objects whose delete failed on Square; their map rows were RETAINED. */
  failed: number;
  /** Per-failed-chunk error messages, surfaced so the route can report them. */
  errors: Array<{ chunk: number; error: string }>;
};

/** Square's BatchDeleteCatalogObjects caps object_ids at 200; we mirror
 *  pushInventoryCounts' 100 for symmetry across the two batch paths. */
const DELETE_BATCH_SIZE = 100;

/**
 * Remove catalog items from Square whose brands are no longer in the KEEP set.
 *
 * `keepBrandIds` is the set of brands that SHOULD remain in the Square catalog
 * (see the catalog route's discontinued-vs-sold-out split). Every map row whose
 * brand is NOT in that set is treated as stale and deleted from BOTH Square and
 * square_catalog_map. An empty keep set means "delete the entire catalog" — the
 * route guards against calling with [] so a transient empty inventory can't wipe
 * everything.
 *
 * Failure handling (data-loss guard): the Square delete is chunked
 * (DELETE_BATCH_SIZE). A local map row is deleted ONLY for a chunk that Square
 * successfully deleted. When a chunk's Square delete fails we KEEP its map rows
 * (so the objects stay tracked and can be retried) and surface the failure via
 * the returned `failed`/`errors`. Previously the local delete ran unconditionally
 * even when Square's delete threw, orphaning the Square objects and causing the
 * next sync to recreate them as duplicates under fresh `#brand-` temp ids.
 *
 * @param client        Square SDK client.
 * @param keepBrandIds  brands to KEEP; every other mapped brand is deleted.
 * @returns counts + per-chunk errors for the caller to log/report.
 */
export async function deleteStaleItems(
  client: SquareClient,
  keepBrandIds: string[]
): Promise<DeleteStaleResult> {
  const admin = await createAdminClient();

  // Find catalog map entries for brands not in the keep set.
  let query = admin
    .from("square_catalog_map")
    .select("id, brand_id, square_catalog_id, object_type");

  // If there are brands to keep, exclude them; otherwise, delete everything.
  if (keepBrandIds.length > 0) {
    query = query.not("brand_id", "in", `(${keepBrandIds.join(",")})`);
  }

  const { data: staleEntries, error } = await query;

  if (error || !staleEntries || staleEntries.length === 0) {
    return { deleted: 0, failed: 0, errors: [] };
  }

  let deleted = 0;
  let failed = 0;
  const errors: Array<{ chunk: number; error: string }> = [];

  for (let i = 0; i < staleEntries.length; i += DELETE_BATCH_SIZE) {
    const chunk = staleEntries.slice(i, i + DELETE_BATCH_SIZE);
    const chunkIndex = Math.floor(i / DELETE_BATCH_SIZE);
    const squareIds = chunk.map((e) => e.square_catalog_id);
    const dbIds = chunk.map((e) => e.id);

    try {
      await client.catalog.batchDelete({ objectIds: squareIds });
    } catch (err) {
      // Square delete failed: KEEP this chunk's map rows so the objects remain
      // tracked and retryable. Do NOT delete the local rows.
      const message = err instanceof Error ? err.message : String(err);
      log.error("Square catalog batch delete error:", message);
      failed += chunk.length;
      errors.push({ chunk: chunkIndex, error: message });
      continue;
    }

    // Square deleted this chunk — now (and only now) drop the local map rows.
    const { error: delError } = await admin
      .from("square_catalog_map")
      .delete()
      .in("id", dbIds);
    if (delError) {
      // Square objects are gone but the local rows survived; report it (they'll
      // be retried on the next sync as no-op deletes).
      failed += chunk.length;
      errors.push({ chunk: chunkIndex, error: `local map delete failed: ${delError.message}` });
      continue;
    }

    deleted += chunk.length;
  }

  return { deleted, failed, errors };
}
