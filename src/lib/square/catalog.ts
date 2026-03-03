import type { SquareClient } from "square";
import { createAdminClient } from "@/lib/supabase/server";
import type { SquareSyncProduct, SquareSyncResult, SquareSyncVariation } from "./types";

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

/**
 * Remove catalog items from Square that are no longer in the active brand set.
 *
 * Flow:
 *  1. Query square_catalog_map for ITEM entries not in activeBrandIds
 *  2. Call Square batchDeleteCatalogObjects for those IDs
 *  3. Delete from square_catalog_map
 *  4. Return count deleted
 */
export async function deleteStaleItems(
  client: SquareClient,
  activeBrandIds: string[]
): Promise<number> {
  const admin = await createAdminClient();

  // Find catalog map entries for brands not in the active set
  let query = admin
    .from("square_catalog_map")
    .select("id, brand_id, square_catalog_id, object_type");

  // If there are active brands, exclude them; otherwise, delete everything
  if (activeBrandIds.length > 0) {
    query = query.not("brand_id", "in", `(${activeBrandIds.join(",")})`);
  }

  const { data: staleEntries, error } = await query;

  if (error || !staleEntries || staleEntries.length === 0) {
    return 0;
  }

  const squareIdsToDelete = staleEntries.map((e) => e.square_catalog_id);
  const dbIdsToDelete = staleEntries.map((e) => e.id);

  try {
    await client.catalog.batchDelete({ objectIds: squareIdsToDelete });
  } catch (err) {
    // Log but continue to clean up local mappings even if Square delete fails
    console.error(
      "Square catalog batch delete error:",
      err instanceof Error ? err.message : err
    );
  }

  await admin.from("square_catalog_map").delete().in("id", dbIdsToDelete);

  return staleEntries.length;
}
