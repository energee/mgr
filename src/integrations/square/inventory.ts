import type { SquareClient } from "square";
import type { SquareSyncInventory, SquareSyncResult } from "./types";

/**
 * Push inventory counts to Square for a location.
 * Uses PHYSICAL_COUNT to set absolute quantities rather than incremental adjustments.
 *
 * Square physical counts require:
 *  - catalogObjectId (the ITEM_VARIATION Square ID)
 *  - locationId (the Square location ID)
 *  - quantity as a string
 *  - state: "IN_STOCK"
 *  - occurredAt: ISO 8601 timestamp
 */
export async function pushInventoryCounts(
  client: SquareClient,
  counts: SquareSyncInventory[]
): Promise<SquareSyncResult> {
  if (counts.length === 0) {
    return { success: true, itemsSynced: 0, itemsFailed: 0, errors: [] };
  }

  const errors: Array<{ itemId: string; error: string }> = [];
  let itemsSynced = 0;

  // Square batchChangeInventory has a limit per batch; process in chunks of 100
  const BATCH_SIZE = 100;

  for (let i = 0; i < counts.length; i += BATCH_SIZE) {
    const chunk = counts.slice(i, i + BATCH_SIZE);
    try {
      const occurredAt = new Date().toISOString();

      await client.inventory.batchCreateChanges({
        idempotencyKey: crypto.randomUUID(),
        changes: chunk.map((c) => ({
          type: "PHYSICAL_COUNT" as const,
          physicalCount: {
            catalogObjectId: c.squareVariationId,
            locationId: c.squareLocationId,
            quantity: String(c.quantity),
            state: "IN_STOCK" as const,
            occurredAt,
          },
        })),
      });

      itemsSynced += chunk.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Record error for each item in the failed chunk
      for (const c of chunk) {
        errors.push({
          itemId: c.squareVariationId,
          error: message,
        });
      }
    }
  }

  return {
    success: errors.length === 0,
    itemsSynced,
    itemsFailed: errors.length,
    errors,
  };
}
