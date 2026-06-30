/**
 * Pure parse/validation helpers for inline edits in the order items editor
 * (order-items-editor.tsx).
 *
 * Existing-row qty/price inputs buffer keystrokes locally and only commit to
 * Supabase on blur/Enter (mirroring the pendingPicks pattern in
 * pick-list-items.tsx). These helpers decide whether a raw input string is
 * committable. Invalid input (empty/NaN/out-of-range) returns null so the
 * editor reverts to the last-saved value instead of coercing — the old
 * per-keystroke onChange path coerced a cleared qty field to 1 and a "0"
 * price to null mid-edit.
 */

/** Numeric fields on an existing order item row that use buffered editing. */
export type EditableItemField = "quantity" | "unit_price";

/**
 * Parse a raw input string for the given field.
 *
 * Returns the numeric value to save, or null when the input is not
 * committable: empty/whitespace, NaN, non-integer or sub-1 quantity,
 * or negative price.
 */
export function parseItemFieldEdit(
  field: EditableItemField,
  raw: string
): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  if (field === "quantity") {
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
  }
  // unit_price: any non-negative amount (0 is a legitimate price)
  return parsed >= 0 ? parsed : null;
}
