/**
 * PO receipt status rules — does a purchase order become `partial` or `fulfilled`?
 *
 * Extracted verbatim from src/components/domain/purchasing/po-receiving.tsx, where this
 * rule lived inside a React mutation and existed in no service. Pure: no React, no
 * Supabase. The caller supplies the line items and the receipt rows it read.
 *
 * BEHAVIOR IS PRESERVED EXACTLY, quirks included — this module was extracted under
 * characterization tests and deliberately reproduces the current (buggy) semantics rather
 * than silently changing them. See the KNOWN QUIRKS block on isAllFullyReceived; each is
 * pinned by a test.
 */

export type POLineItemQuantity = {
  id: string;
  quantity: number;
};

export type POReceiveQuantity = {
  po_line_item_id: string;
  quantity: number;
};

export type POReceiptTargetStatus = "partial" | "fulfilled";

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
 * KNOWN QUIRKS (preserved from the original, each pinned by a test):
 * - Bare `>=` with no epsilon: a line ordered 0.8 and received 0.7 + 0.1 sums to
 *   0.7999999999999999 and so stays `partial` forever.
 * - An EMPTY line list returns true (`[].every()` is true), flipping the PO to `fulfilled`
 *   with nothing received.
 * - A line whose `quantity` is null or 0 counts as fully received (`0 >= null` is true).
 * - Over-receipt is not capped: 999 received against 10 ordered is accepted as `fulfilled`.
 */
export function isAllFullyReceived(
  lineItems: readonly POLineItemQuantity[],
  receivedByItem: ReadonlyMap<string, number>
): boolean {
  return lineItems.every((item) => {
    const totalReceived = receivedByItem.get(item.id) || 0;
    return totalReceived >= item.quantity;
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
