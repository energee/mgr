/**
 * Inventory cycle-count math (pure).
 *
 * A physical count compares counted stock against the system's expected
 * on-hand (inventory_lots_with_quantities.remaining_quantity) and produces
 * a plan describing how to reconcile the difference:
 *
 * - "decrease" (shrinkage): recorded as a completed allocation
 *   (source_type='inventory_lot', destination_type='adjustment',
 *   reason_code='count_adjustment'). Allocations can only ever SUBTRACT
 *   from a lot — allocations.quantity has CHECK (quantity >= 0) and the
 *   lots view only subtracts allocations sourced from the lot — so...
 * - "increase" (found stock): cannot be an allocation; it is applied by
 *   raising inventory_lots.quantity directly, with an audit note appended
 *   to the lot's notes.
 * - "none": counted matches expected; nothing is written.
 *
 * Supabase writes live in src/services/inventory-count-service.ts; the
 * guided UI is src/components/domain/inventory/count-adjust-dialog.tsx.
 */

/** Reconciliation plan for a single lot count. `delta` is always >= 0. */
export type CountAdjustmentPlan =
  | { kind: "none"; delta: 0 }
  | { kind: "decrease"; delta: number }
  | { kind: "increase"; delta: number };

/**
 * Compare expected on-hand vs. the physically counted quantity.
 *
 * Tiny float residue (< 1e-9) counts as a match so unit-converted
 * expectations don't generate noise adjustments.
 */
export function planCountAdjustment(
  expectedQuantity: number,
  countedQuantity: number
): CountAdjustmentPlan {
  if (!Number.isFinite(expectedQuantity) || !Number.isFinite(countedQuantity)) {
    throw new Error("Count quantities must be finite numbers");
  }
  if (countedQuantity < 0) {
    throw new Error("Counted quantity cannot be negative");
  }
  const delta = countedQuantity - expectedQuantity;
  if (Math.abs(delta) < 1e-9) return { kind: "none", delta: 0 };
  return delta < 0
    ? { kind: "decrease", delta: -delta }
    : { kind: "increase", delta };
}

/**
 * Audit line appended to inventory_lots.notes when a count INCREASES the
 * lot quantity (increases bypass the allocations audit trail, so the note
 * is the paper trail).
 */
export function buildCountIncreaseNote(params: {
  /** ISO date (yyyy-mm-dd) of the count. */
  countedOn: string;
  expectedQuantity: number;
  countedQuantity: number;
  /** Free-text reason/observation from the counter, if any. */
  notes?: string | null;
}): string {
  const base = `[${params.countedOn}] Count adjustment: +${formatQty(
    params.countedQuantity - params.expectedQuantity
  )} (counted ${formatQty(params.countedQuantity)}, expected ${formatQty(
    params.expectedQuantity
  )})`;
  const extra = params.notes?.trim();
  return extra ? `${base} — ${extra}` : base;
}

/** Append an audit line to a lot's existing notes (newline-separated). */
export function appendLotNote(
  existingNotes: string | null | undefined,
  note: string
): string {
  const existing = existingNotes?.trim();
  return existing ? `${existing}\n${note}` : note;
}

/** Compact quantity formatting for audit notes (up to 3 decimals, no trailing zeros). */
function formatQty(value: number): string {
  return String(Number(value.toFixed(3)));
}
