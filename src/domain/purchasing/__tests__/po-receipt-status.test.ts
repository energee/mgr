/**
 * Tests for the PO receipt-status rules.
 *
 * These began as characterization tests pinning the behavior extracted from po-receiving.tsx,
 * quirks and all. The quirk cases have since been flipped to assert correct behavior as each
 * defect was fixed (empty line list, null/zero ordered quantity, float drift, over-receipt);
 * the section below is kept together so the fixed defects stay visible and regression-tested.
 */

import { describe, it, expect } from "vitest";
import {
  sumReceivedByLineItem,
  isAllFullyReceived,
  decideTargetStatus,
  findOverReceipts,
  type POLineItemQuantity,
} from "../po-receipt-status";

describe("sumReceivedByLineItem", () => {
  it("sums multiple receipts against the same line item", () => {
    const sums = sumReceivedByLineItem([
      { po_line_item_id: "a", quantity: 3 },
      { po_line_item_id: "a", quantity: 4 },
      { po_line_item_id: "b", quantity: 1 },
    ]);
    expect(sums.get("a")).toBe(7);
    expect(sums.get("b")).toBe(1);
  });

  it("returns an empty map for null/undefined/empty input", () => {
    expect(sumReceivedByLineItem(null).size).toBe(0);
    expect(sumReceivedByLineItem(undefined).size).toBe(0);
    expect(sumReceivedByLineItem([]).size).toBe(0);
  });
});

describe("decideTargetStatus", () => {
  const lines: POLineItemQuantity[] = [
    { id: "a", quantity: 10 },
    { id: "b", quantity: 5 },
  ];

  it("is fulfilled when every line is received in full", () => {
    expect(
      decideTargetStatus(lines, [
        { po_line_item_id: "a", quantity: 10 },
        { po_line_item_id: "b", quantity: 5 },
      ])
    ).toBe("fulfilled");
  });

  it("is partial when any line is short", () => {
    expect(
      decideTargetStatus(lines, [
        { po_line_item_id: "a", quantity: 10 },
        { po_line_item_id: "b", quantity: 4 },
      ])
    ).toBe("partial");
  });

  it("is partial when nothing has been received", () => {
    expect(decideTargetStatus(lines, [])).toBe("partial");
  });

  // --- Defects fixed (each of these used to report "fulfilled") ----------------

  it("float drift does not strand a line short of complete (0.7 + 0.1 vs 0.8)", () => {
    expect(
      decideTargetStatus(
        [{ id: "a", quantity: 0.8 }],
        [
          { po_line_item_id: "a", quantity: 0.7 },
          { po_line_item_id: "a", quantity: 0.1 },
        ]
      )
    ).toBe("fulfilled");
  });

  it("an EMPTY line list is not fulfilled — there is nothing to have received", () => {
    expect(decideTargetStatus([], [])).toBe("partial");
  });

  it("a null quantity does not count as fully received", () => {
    const nullQty = [{ id: "a", quantity: null }] as unknown as POLineItemQuantity[];
    expect(decideTargetStatus(nullQty, [])).toBe("partial");
  });

  it("a zero-quantity line does not count as fully received", () => {
    expect(decideTargetStatus([{ id: "a", quantity: 0 }], [])).toBe("partial");
  });

  it("a bad line keeps an otherwise-complete order out of 'fulfilled'", () => {
    expect(
      decideTargetStatus(
        [
          { id: "a", quantity: 10 },
          { id: "bad", quantity: 0 },
        ],
        [{ po_line_item_id: "a", quantity: 10 }]
      )
    ).toBe("partial");
  });

  it("over-receipt still reports fulfilled — the write path rejects it, not this rule", () => {
    expect(
      decideTargetStatus([{ id: "a", quantity: 10 }], [{ po_line_item_id: "a", quantity: 999 }])
    ).toBe("fulfilled");
  });
});

describe("findOverReceipts", () => {
  const lines: POLineItemQuantity[] = [{ id: "a", quantity: 10 }];

  it("accepts a receipt up to the ordered quantity", () => {
    expect(findOverReceipts(lines, new Map(), [{ po_line_item_id: "a", quantity: 10 }])).toEqual(
      []
    );
  });

  it("rejects a receipt beyond the ordered quantity", () => {
    expect(findOverReceipts(lines, new Map(), [{ po_line_item_id: "a", quantity: 999 }])).toEqual([
      { lineItemId: "a", ordered: 10, alreadyReceived: 0, submitted: 999 },
    ]);
  });

  it("counts what was already received against the order", () => {
    expect(
      findOverReceipts(lines, new Map([["a", 8]]), [{ po_line_item_id: "a", quantity: 3 }])
    ).toEqual([{ lineItemId: "a", ordered: 10, alreadyReceived: 8, submitted: 3 }]);
    expect(
      findOverReceipts(lines, new Map([["a", 8]]), [{ po_line_item_id: "a", quantity: 2 }])
    ).toEqual([]);
  });

  it("sums multiple entries for the same line item", () => {
    expect(
      findOverReceipts(lines, new Map(), [
        { po_line_item_id: "a", quantity: 6 },
        { po_line_item_id: "a", quantity: 6 },
      ])
    ).toEqual([{ lineItemId: "a", ordered: 10, alreadyReceived: 0, submitted: 12 }]);
  });

  it("tolerates float drift rather than rejecting an exact receipt", () => {
    expect(
      findOverReceipts([{ id: "a", quantity: 0.8 }], new Map([["a", 0.7]]), [
        { po_line_item_id: "a", quantity: 0.1 },
      ])
    ).toEqual([]);
  });

  it("rejects an entry for a line item that is not on the order", () => {
    expect(findOverReceipts(lines, new Map(), [{ po_line_item_id: "ghost", quantity: 1 }])).toEqual(
      [{ lineItemId: "ghost", ordered: 0, alreadyReceived: 0, submitted: 1 }]
    );
  });
});

describe("isAllFullyReceived", () => {
  it("treats a missing receipt entry as zero received", () => {
    expect(isAllFullyReceived([{ id: "a", quantity: 1 }], new Map())).toBe(false);
  });

  it("accepts exact equality", () => {
    expect(isAllFullyReceived([{ id: "a", quantity: 5 }], new Map([["a", 5]]))).toBe(true);
  });
});
