/**
 * Interprets the combined Square sync response for the operator (#610).
 *
 * `POST /api/square/sync` encodes a partial sync as HTTP 200 with the failure
 * inside the body (`data.inventory.success === false`, or a non-zero
 * `totalFailed`, or `{ success: false, error }` when the inventory handler
 * returned non-ok / threw). That is a deliberate transport choice — the two
 * legs are independently reportable — but it means `res.ok` alone is NOT a
 * statement about whether inventory counts reached Square. The Sync button
 * used to toast "Square sync completed" over an expired-token push that landed
 * nothing.
 *
 * This is the decision on its own so it can be unit-tested; the settings page
 * renders the returned level/message.
 */

export type SquareInventorySyncSummary = {
  success?: boolean;
  totalSynced?: number;
  totalFailed?: number;
  binsProcessed?: number;
  error?: string;
};

export type SquareCombinedSyncData = {
  catalog?: unknown;
  inventory?: SquareInventorySyncSummary | null;
};

export type SquareSyncOutcome = {
  level: "success" | "warning";
  message: string;
};

/**
 * @param data the `data` payload of the combined sync response.
 * @returns the toast level and copy to show. A missing inventory leg is a
 *   warning, not a success — silence about a write is not evidence it happened.
 */
export function squareSyncOutcome(
  data: SquareCombinedSyncData | null | undefined,
): SquareSyncOutcome {
  const inventory = data?.inventory;

  if (!inventory) {
    return {
      level: "warning",
      message:
        "Catalog synced, but the inventory push reported nothing — see the Square sync log",
    };
  }

  const failedCount = inventory.totalFailed ?? 0;
  if (inventory.success !== false && failedCount === 0) {
    return { level: "success", message: "Square sync completed" };
  }

  const reason =
    inventory.error ??
    (failedCount > 0
      ? `${failedCount} item${failedCount === 1 ? "" : "s"} failed`
      : "the push did not complete");
  return {
    level: "warning",
    message: `Catalog synced; inventory push failed: ${reason} — see the Square sync log`,
  };
}
