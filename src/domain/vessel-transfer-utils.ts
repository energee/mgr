/**
 * Utility functions for vessel transfers: duplicate detection and
 * destination grouping. Separated from vessel-transfer-dialog.tsx to allow
 * unit testing without importing React/Supabase dependencies.
 */

/**
 * Destination vessel types that are the expected next stop for a batch in a
 * given status — these groups are listed first in the transfer dialog's
 * destination picker. Mirrors getSuggestedState in the dialog (fermenting →
 * brite suggests "conditioning", etc.); everything else stays selectable
 * below, just not promoted.
 */
const PREFERRED_DESTINATIONS: Record<string, string[]> = {
  planned: ["fermenter", "foeder"],
  fermenting: ["brite", "foeder"],
  conditioning: ["brite"],
};

/** One destination group for the transfer dialog's vessel picker. */
export type VesselTypeGroup<T> = {
  vesselType: string;
  vessels: T[];
  /** True when this type is the expected next stage for the batch status. */
  preferred: boolean;
};

/**
 * Group destination vessels by type, with the batch's expected next-stage
 * types first (in preference order) and the remaining types alphabetically.
 * Vessel order within a group is preserved from the input (name-sorted by
 * the caller's query).
 */
export function groupVesselsForTransfer<T extends { vessel_type: string }>(
  vessels: T[],
  batchStatus?: string | null
): VesselTypeGroup<T>[] {
  const preferredTypes = (batchStatus && PREFERRED_DESTINATIONS[batchStatus]) || [];
  const byType = new Map<string, T[]>();
  for (const v of vessels) {
    const group = byType.get(v.vessel_type);
    if (group) group.push(v);
    else byType.set(v.vessel_type, [v]);
  }
  const rest = [...byType.keys()]
    .filter((t) => !preferredTypes.includes(t))
    .sort((a, b) => a.localeCompare(b));
  return [...preferredTypes.filter((t) => byType.has(t)), ...rest].map((vesselType) => ({
    vesselType,
    vessels: byType.get(vesselType)!,
    preferred: preferredTypes.includes(vesselType),
  }));
}

/**
 * Checks whether a transfer is a likely duplicate based on time proximity.
 * Used by VesselTransferDialog to pre-check before inserting.
 */
export function isDuplicateTransfer(
  lastTransferredAt: string | null,
  windowMinutes: number = 5,
): boolean {
  if (!lastTransferredAt) return false;
  const lastTime = new Date(lastTransferredAt);
  const now = new Date();
  const minutesAgo = (now.getTime() - lastTime.getTime()) / 60000;
  return minutesAgo < windowMinutes;
}
