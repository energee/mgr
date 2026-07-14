/**
 * Purchase-order receiving service.
 *
 * A thin wrapper over the `receive_purchase_order_items` Postgres function
 * (supabase/migrations/00248_receive_purchase_order_items.sql), which records the receipts,
 * decides the resulting status, validates the state-machine transition, and writes the new
 * status — all in ONE transaction.
 *
 * The rule used to live here, in TypeScript, spread over a sequence of separate queries. That
 * was not atomic: the po_receives rows were inserted before the status was read and validated,
 * so an illegal transition or a failed status update threw after the receipts were already
 * persisted, with no rollback. It was also decided from reads taken outside any transaction,
 * so a concurrent receipt could commit a status computed from stale numbers. Both are closed
 * by moving the whole sequence into the database.
 *
 * The function — not this file — is the single source of truth for the fulfilled/partial
 * rule. Do not reintroduce a client-side copy of it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ReceiveEntry = {
  po_line_item_id: string;
  quantity: number;
  lot_number?: string | null;
  expiration_date?: string | null;
  notes?: string | null;
};

export type ReceivePurchaseOrderItemsInput = {
  poId: string;
  entries: readonly ReceiveEntry[];
  /** Applied to every receipt row, taking precedence over a per-entry note. */
  globalNotes?: string | null;
};

/** The status the purchase order ended up in. */
export type POReceiptTargetStatus = "partial" | "fulfilled";

/**
 * Record a receipt against a purchase order and flip its status to `partial` or `fulfilled`.
 *
 * Nothing is written unless the whole operation succeeds. The function rejects (and this
 * throws) when there is nothing to receive, when an entry would take a line past its ordered
 * quantity or names a line item that is not on the order, or when the resulting status is not
 * a legal transition from the order's current status. An order already in the target status is
 * left alone.
 *
 * Zero and negative quantities are dropped as no-ops rather than rejected, matching what the
 * UI submits for untouched rows.
 */
export async function receivePurchaseOrderItems(
  supabase: SupabaseClient,
  { poId, entries, globalNotes }: ReceivePurchaseOrderItemsInput
): Promise<POReceiptTargetStatus> {
  const payload = entries.map((entry) => ({
    po_line_item_id: entry.po_line_item_id,
    quantity: entry.quantity,
    lot_number: entry.lot_number || null,
    expiration_date: entry.expiration_date || null,
    notes: globalNotes || entry.notes || null,
  }));

  // NOTE: Inventory lot creation is intentionally NOT done here. PO receiving records what was
  // physically received (po_receives with lot_number/expiration). A separate inventory
  // receiving workflow creates inventory_lots, allowing QA/inspection between receipt and
  // inventory acceptance, and proper mapping to inventory_items (which may not match catalog
  // items 1:1). po_receives.id links via inventory_lots.po_receive_id when lots are created.
  const { data, error } = await supabase.rpc("receive_purchase_order_items", {
    p_po_id: poId,
    p_entries: payload,
  });

  if (error) throw error;
  return data as POReceiptTargetStatus;
}
