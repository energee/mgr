/**
 * Utility functions for vessel transfer duplicate detection.
 * Separated from vessel-transfer-dialog.tsx to allow unit testing
 * without importing React/Supabase dependencies.
 */

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
