/**
 * Pure scan-resolution logic for the pick list screen.
 *
 * A scanned (or typed) lot number is matched against the loaded pick lines
 * (case-insensitive, see shared/scan-match.ts). When several lines share a
 * lot number — the same finished-good lot allocated to multiple order
 * items — the first line that still needs picking wins, so repeated scans
 * of one lot walk through its lines in pick order. Once every matching
 * line is fully picked the scan reports `already_picked` instead of
 * silently re-marking.
 *
 * Kept free of React/Supabase so it can be unit tested
 * (__tests__/pick-list-scan.test.ts); pick-list-items.tsx applies the
 * result (mutation + row focus + toast).
 */

import { matchScanCode } from "@/components/domain/shared/scan-match";

/** Minimal pick-line shape the scan resolver needs. */
export type ScanPickCandidate = {
  lot_number?: string | null;
  quantity_picked: number;
  quantity_requested: number;
};

export type ScanPickResult<T> =
  | { kind: "not_found" }
  | { kind: "already_picked"; item: T }
  | { kind: "pick"; item: T };

/**
 * Resolve a scanned code against pick lines by lot number.
 *
 * - `not_found` — no line carries this lot number
 * - `pick` — `item` is the first matching line with remaining quantity;
 *   the caller should mark it fully picked
 * - `already_picked` — every matching line is complete; `item` is the
 *   first match (for row focus/feedback)
 */
export function resolvePickScan<T extends ScanPickCandidate>(
  items: readonly T[],
  code: string
): ScanPickResult<T> {
  const matches = matchScanCode(items, code, (i) => i.lot_number);
  if (matches.length === 0) return { kind: "not_found" };

  const unpicked = matches.find(
    (i) => i.quantity_picked < i.quantity_requested
  );
  if (unpicked) return { kind: "pick", item: unpicked };
  return { kind: "already_picked", item: matches[0] };
}
