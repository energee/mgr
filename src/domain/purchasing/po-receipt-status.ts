/**
 * PO receipt status rules — does a purchase order become `partial` or `fulfilled`?
 *
 * Pure: no React, no Supabase. The caller supplies the line items and the receipt rows it
 * read back from the database.
 *
 * These rules were extracted from a React mutation in #412 with their original defects
 * pinned by characterization tests; this module fixes those defects. The guiding principle
 * is that `fulfilled` is a financially meaningful, hard-to-undo state, so the rule refuses
 * to reach it on absent or nonsensical data — it degrades to `partial`, which a human can
 * still resolve.
 */

/**
 * Tolerance for the received-vs-ordered comparison.
 *
 * Quantities are Postgres `numeric` read into JS floats, so summing receipts drifts: a line
 * ordered 0.8 and received 0.7 + 0.1 sums to 0.7999999999999999 and would never satisfy a
 * bare `>=`, leaving the order `partial` forever. 1e-6 is far below any real receipt
 * quantity and far above float noise at these magnitudes.
 */
export const RECEIPT_EPSILON = 1e-6;

export type POLineItemQuantity = {
  id: string;
  quantity: number;
};

export type POReceiveQuantity = {
  po_line_item_id: string;
  quantity: number;
};

export type POReceiptTargetStatus = "partial" | "fulfilled";

/** A submitted receipt that would push a line item past what was ordered. */
export type OverReceipt = {
  lineItemId: string;
  ordered: number;
  /** Already received before this submission. */
  alreadyReceived: number;
  /** Quantity submitted now. */
  submitted: number;
};

/**
 * Total received per line item, summed from the receipt rows.
 *
 * The sum is taken from the rows the caller read back from the database, NOT from the
 * quantities the user just submitted — that re-query is what makes the decision safe
 * against a concurrent receipt.
 */
export function sumReceivedByLineItem(
  receives: readonly POReceiveQuantity[] | null | undefined
): Map<string, number> {
  const receivedByItem = new Map<string, number>();
  for (const r of receives ?? []) {
    const current = receivedByItem.get(r.po_line_item_id) || 0;
    receivedByItem.set(r.po_line_item_id, current + r.quantity);
  }
  return receivedByItem;
}

/**
 * True when every line item has been received in full.
 *
 * A purchase order with NO line items is not fulfilled — there is nothing to have received.
 * Likewise a line whose ordered quantity is null, zero, or negative is never "fully
 * received": such a line is bad data, and closing a purchase order on the strength of it is
 * worse than leaving the order `partial` for a human to look at.
 *
 * The comparison carries RECEIPT_EPSILON so accumulated float drift cannot strand a line a
 * fraction of a unit short of complete.
 */
export function isAllFullyReceived(
  lineItems: readonly POLineItemQuantity[],
  receivedByItem: ReadonlyMap<string, number>
): boolean {
  if (lineItems.length === 0) return false;

  return lineItems.every((item) => {
    const ordered = item.quantity;
    if (!Number.isFinite(ordered) || ordered <= 0) return false;
    const totalReceived = receivedByItem.get(item.id) || 0;
    return totalReceived >= ordered - RECEIPT_EPSILON;
  });
}

/** The status a receipt should drive the purchase order to. */
export function decideTargetStatus(
  lineItems: readonly POLineItemQuantity[],
  receives: readonly POReceiveQuantity[] | null | undefined
): POReceiptTargetStatus {
  const receivedByItem = sumReceivedByLineItem(receives);
  return isAllFullyReceived(lineItems, receivedByItem) ? "fulfilled" : "partial";
}

/**
 * Find submitted entries that would push a line item past its ordered quantity.
 *
 * The old write path capped over-receipt only in the UI input, so any non-UI caller could
 * record 999 against 10 ordered and silently drive the order to `fulfilled`. This is the
 * server-side equivalent of that clamp; the write path rejects a receipt when the result is
 * non-empty.
 *
 * Entries naming a line item that is not on this order are reported with `ordered: 0` —
 * those cannot be legitimate either.
 */
export function findOverReceipts(
  lineItems: readonly POLineItemQuantity[],
  alreadyReceivedByItem: ReadonlyMap<string, number>,
  submitted: readonly POReceiveQuantity[]
): OverReceipt[] {
  const orderedById = new Map(lineItems.map((i) => [i.id, i.quantity]));

  const submittedByItem = new Map<string, number>();
  for (const entry of submitted) {
    const current = submittedByItem.get(entry.po_line_item_id) || 0;
    submittedByItem.set(entry.po_line_item_id, current + entry.quantity);
  }

  const overReceipts: OverReceipt[] = [];
  for (const [lineItemId, submittedQty] of submittedByItem) {
    const ordered = orderedById.get(lineItemId) ?? 0;
    const alreadyReceived = alreadyReceivedByItem.get(lineItemId) || 0;
    if (alreadyReceived + submittedQty > ordered + RECEIPT_EPSILON) {
      overReceipts.push({ lineItemId, ordered, alreadyReceived, submitted: submittedQty });
    }
  }
  return overReceipts;
}
