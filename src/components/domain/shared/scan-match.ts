/**
 * Pure matching helpers for keyboard-wedge barcode scanning.
 *
 * Scanners emulate a keyboard, so a "scan" is just a string (typically a
 * lot number) that must be matched against rows already loaded on screen.
 * Matching is trimmed and case-insensitive — labels are printed in varying
 * cases and scanners occasionally include stray whitespace.
 *
 * Consumers: ScanInput (shared/scan-input.tsx) emits the raw code;
 * pick-list-scan.ts (mark pick lines picked) and the PO accept-into-
 * inventory dialog (select received rows) resolve it with these helpers.
 */

/** Canonical form used for scan comparison: trimmed, lowercased. */
export function normalizeScanCode(code: string): string {
  return code.trim().toLowerCase();
}

/**
 * Return every row whose code (via `getCode`) matches the scanned string.
 * Rows with empty/null codes never match; an empty scan matches nothing.
 */
export function matchScanCode<T>(
  rows: readonly T[],
  code: string,
  getCode: (row: T) => string | null | undefined
): T[] {
  const normalized = normalizeScanCode(code);
  if (!normalized) return [];
  return rows.filter((row) => {
    const rowCode = getCode(row);
    return !!rowCode && normalizeScanCode(rowCode) === normalized;
  });
}
