/**
 * Purchase-order receiving service.
 *
 * Orchestrates the receipt write path: insert the po_receives rows, re-read the order's
 * line items and receipts, decide the resulting status via the pure rules in
 * src/domain/purchasing/po-receipt-status.ts, validate the state-machine transition, and
 * write the new status.
 *
 * Extracted from src/components/domain/purchasing/po-receiving.tsx, where this whole
 * sequence lived inside a React `useMutation`. It is now callable with no React, so a new
 * frontend (or a server route) can receive against a PO without reimplementing the rule.
 *
 * An over-receipt is rejected before any row is written; the status-decision rules live in
 * po-receipt-status.ts.
 *
 * KNOWN DEFECT (still open — tracked separately):
 * - NOT ATOMIC. The po_receives rows are inserted BEFORE the status is read, validated, and
 *   written. An invalid transition or a failed status update throws AFTER the receipt rows
 *   are already persisted, and nothing rolls them back. Validating the over-receipt up
 *   front narrows the window but does not close it — fixing this properly means moving the
 *   whole sequence into a Postgres function/RPC so it commits or aborts as one transaction.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { purchaseOrderEntity } from "@/entities/purchase-order";
import {
  decideTargetStatus,
  findOverReceipts,
  sumReceivedByLineItem,
} from "@/domain/purchasing/po-receipt-status";

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

function isValidTransition(from: string, to: string): boolean {
  return purchaseOrderEntity.stateMachine?.transitions[from]?.includes(to) ?? false;
}

/**
 * Record a receipt against a purchase order and flip its status to `partial` or `fulfilled`.
 *
 * Throws when there is nothing to receive, when any query fails, or when the resulting
 * status is not a legal transition from the order's current status. Returns silently
 * without writing when the order is already in the target status.
 */
export async function receivePurchaseOrderItems(
  supabase: SupabaseClient,
  { poId, entries, globalNotes }: ReceivePurchaseOrderItemsInput
): Promise<void> {
  const receivesToInsert = entries
    .filter((e) => e.quantity > 0)
    .map((entry) => ({
      po_line_item_id: entry.po_line_item_id,
      quantity: entry.quantity,
      lot_number: entry.lot_number || null,
      expiration_date: entry.expiration_date || null,
      notes: globalNotes || entry.notes || null,
    }));

  if (receivesToInsert.length === 0) {
    throw new Error("No quantities to receive");
  }

  // Reject an over-receipt BEFORE writing anything. The UI clamps its inputs to the
  // outstanding quantity, but that clamp does not exist for any other caller, so without
  // this check a caller could record 999 against 10 ordered and silently close the order.
  const { data: orderedItems, error: orderedError } = await supabase
    .from("po_line_items")
    .select("id, quantity")
    .eq("po_id", poId);
  if (orderedError) throw orderedError;

  const { data: priorReceives, error: priorError } = await supabase
    .from("po_receives")
    .select("po_line_item_id, quantity")
    .in(
      "po_line_item_id",
      orderedItems.map((i) => i.id)
    );
  if (priorError) throw priorError;

  const overReceipts = findOverReceipts(
    orderedItems,
    sumReceivedByLineItem(priorReceives),
    receivesToInsert
  );
  if (overReceipts.length > 0) {
    const detail = overReceipts
      .map(
        (o) =>
          `line ${o.lineItemId}: ordered ${o.ordered}, already received ${o.alreadyReceived}, submitted ${o.submitted}`
      )
      .join("; ");
    throw new Error(`Cannot receive more than was ordered. ${detail}`);
  }

  const { error: receiveError } = await supabase.from("po_receives").insert(receivesToInsert);
  if (receiveError) throw receiveError;

  // NOTE: Inventory lot creation is intentionally NOT done here. PO receiving records what
  // was physically received (po_receives with lot_number/expiration). A separate inventory
  // receiving workflow creates inventory_lots, allowing QA/inspection between receipt and
  // inventory acceptance, and proper mapping to inventory_items (which may not match catalog
  // items 1:1). po_receives.id links via inventory_lots.po_receive_id when lots are created.

  const { data: currentPO, error: poFetchError } = await supabase
    .from("purchase_orders")
    .select("status")
    .eq("id", poId)
    .single();
  if (poFetchError) throw poFetchError;

  const currentStatus = currentPO.status;

  // Re-read totals from the database rather than trusting the submitted entries, so a
  // concurrent receipt cannot make this decision on stale numbers.
  const { data: updatedItems, error: itemsError } = await supabase
    .from("po_line_items")
    .select("id, quantity")
    .eq("po_id", poId);
  if (itemsError) throw itemsError;

  const { data: allReceives, error: receivesError } = await supabase
    .from("po_receives")
    .select("po_line_item_id, quantity")
    .in(
      "po_line_item_id",
      updatedItems.map((i) => i.id)
    );
  if (receivesError) throw receivesError;

  const targetStatus = decideTargetStatus(updatedItems, allReceives);

  if (!isValidTransition(currentStatus, targetStatus)) {
    // Already in the target state — nothing to write.
    if (currentStatus === targetStatus) return;
    throw new Error(
      `Cannot transition from "${currentStatus}" to "${targetStatus}". ` +
        `Valid transitions: ${purchaseOrderEntity.stateMachine?.transitions[currentStatus]?.join(", ") || "none"}`
    );
  }

  const { error: statusError } = await supabase
    .from("purchase_orders")
    .update({ status: targetStatus })
    .eq("id", poId);
  if (statusError) throw statusError;
}
