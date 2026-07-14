/**
 * Pure FIFO-fill math for the order allocation dialog (order-allocation.tsx).
 *
 * Mirrors the matching rules of the generate_pick_list RPC
 * (supabase/migrations/00182_fix_generate_pick_list.sql) so the dialog's
 * client-side auto-fill and the server-side pick-list path agree:
 * - order lines are matched to lots by brand_id + selling_format_id
 * - TBD lines (missing either id) are skipped
 * - lots are consumed oldest production_date first (NULLS LAST)
 * - each lot contributes LEAST(remaining, available)
 *
 * Existing planned/completed allocations — including those created by pick
 * lists, which carry pick_list_item_id — count against a line's demand, so
 * "remaining" is the truly open quantity.
 */

/** Open demand for one brand+format combination on an order. */
export type DemandLine = {
  brandId: string;
  sellingFormatId: string;
  /** Sum of order_items.quantity for this combo */
  ordered: number;
  /** Sum of existing planned/completed allocation quantities for this combo */
  allocated: number;
  /** max(0, ordered - allocated) */
  remaining: number;
};

/** Minimal lot shape needed for FIFO fill (finished_goods_with_availability). */
export type AllocatableLot = {
  id: string;
  brand_id: string;
  selling_format_id: string;
  available_quantity: number;
  production_date: string | null;
};

/** Stable map key for a brand+selling-format combination. */
export function comboKey(brandId: string, sellingFormatId: string): string {
  return `${brandId}:${sellingFormatId}`;
}

/**
 * Group order items by brand+format and net out existing allocations.
 *
 * Items missing brand or format (TBD lines) are skipped — they cannot be
 * matched to inventory, same as in generate_pick_list. Allocations whose lot
 * combo does not appear on any line are ignored for line math (they still
 * reduce lot availability via the view).
 */
export function computeDemandLines(
  items: Array<{
    brand_id: string | null;
    selling_format_id: string | null;
    quantity: number | null;
  }>,
  existingAllocations: Array<{
    brand_id: string | null;
    selling_format_id: string | null;
    quantity: number | null;
  }>
): DemandLine[] {
  const lines = new Map<string, DemandLine>();

  for (const item of items) {
    if (!item.brand_id || !item.selling_format_id) continue; // TBD line
    const key = comboKey(item.brand_id, item.selling_format_id);
    const line = lines.get(key) ?? {
      brandId: item.brand_id,
      sellingFormatId: item.selling_format_id,
      ordered: 0,
      allocated: 0,
      remaining: 0,
    };
    line.ordered += item.quantity ?? 0;
    lines.set(key, line);
  }

  for (const alloc of existingAllocations) {
    if (!alloc.brand_id || !alloc.selling_format_id) continue;
    const line = lines.get(comboKey(alloc.brand_id, alloc.selling_format_id));
    if (line) line.allocated += alloc.quantity ?? 0;
  }

  for (const line of lines.values()) {
    line.remaining = Math.max(0, line.ordered - line.allocated);
  }

  return [...lines.values()];
}

/**
 * Compute FIFO quantities per lot to cover each demand line's remaining
 * quantity. Returns a map of lot id -> quantity to allocate.
 *
 * `excludedLotIds` should contain lots already allocated to this order: the
 * save path rejects a second allocation of the same lot to the same order, so
 * pre-filling them would be silently dropped.
 */
export function computeFifoFill(
  lines: DemandLine[],
  lots: AllocatableLot[],
  excludedLotIds: ReadonlySet<string> = new Set()
): Record<string, number> {
  // Sum, don't overwrite: computeDemandLines already dedupes by combo, but a
  // caller passing two lines for the same combo means their demands add up.
  const remainingByCombo = new Map<string, number>();
  for (const line of lines) {
    const key = comboKey(line.brandId, line.sellingFormatId);
    remainingByCombo.set(key, (remainingByCombo.get(key) ?? 0) + line.remaining);
  }

  // Oldest production date first, undated lots last — matches the RPC's
  // ORDER BY production_date ASC NULLS LAST.
  const sorted = [...lots].sort((a, b) => {
    if (a.production_date === b.production_date) return 0;
    if (a.production_date === null) return 1;
    if (b.production_date === null) return -1;
    return a.production_date < b.production_date ? -1 : 1;
  });

  const fill: Record<string, number> = {};
  for (const lot of sorted) {
    if (excludedLotIds.has(lot.id)) continue;
    const key = comboKey(lot.brand_id, lot.selling_format_id);
    const remaining = remainingByCombo.get(key) ?? 0;
    if (remaining <= 0) continue;
    const qty = Math.min(remaining, lot.available_quantity);
    if (qty <= 0) continue;
    fill[lot.id] = qty;
    remainingByCombo.set(key, remaining - qty);
  }
  return fill;
}
