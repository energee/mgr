/**
 * Tests for the order allocation dialog's FIFO fill math
 * (order-allocation-utils.ts), which must mirror the generate_pick_list RPC
 * (supabase/migrations/00182_fix_generate_pick_list.sql): match by
 * brand+selling format, skip TBD lines, consume oldest lots first
 * (NULLS LAST), cap at LEAST(remaining, available), and count existing
 * planned/completed allocations (including pick-list ones) against demand.
 */
import { describe, it, expect } from "vitest";
import {
  comboKey,
  computeDemandLines,
  computeFifoFill,
  type AllocatableLot,
} from "@/domain/sales/order-allocation-utils";

const BRAND_A = "brand-a";
const BRAND_B = "brand-b";
const FMT_CAN = "fmt-can";
const FMT_KEG = "fmt-keg";

function lot(
  id: string,
  brandId: string,
  formatId: string,
  available: number,
  productionDate: string | null
): AllocatableLot {
  return {
    id,
    brand_id: brandId,
    selling_format_id: formatId,
    available_quantity: available,
    production_date: productionDate,
  };
}

describe("computeDemandLines", () => {
  it("groups items by brand+format and sums quantities", () => {
    const lines = computeDemandLines(
      [
        { brand_id: BRAND_A, selling_format_id: FMT_CAN, quantity: 10 },
        { brand_id: BRAND_A, selling_format_id: FMT_CAN, quantity: 5 },
        { brand_id: BRAND_B, selling_format_id: FMT_KEG, quantity: 2 },
      ],
      []
    );
    expect(lines).toHaveLength(2);
    const canLine = lines.find((l) => l.brandId === BRAND_A)!;
    expect(canLine.ordered).toBe(15);
    expect(canLine.remaining).toBe(15);
  });

  it("skips TBD lines missing brand or format", () => {
    const lines = computeDemandLines(
      [
        { brand_id: null, selling_format_id: FMT_CAN, quantity: 10 },
        { brand_id: BRAND_A, selling_format_id: null, quantity: 10 },
      ],
      []
    );
    expect(lines).toHaveLength(0);
  });

  it("subtracts existing allocations (incl. pick-list ones) from remaining", () => {
    const lines = computeDemandLines(
      [{ brand_id: BRAND_A, selling_format_id: FMT_CAN, quantity: 10 }],
      [
        // e.g. created manually
        { brand_id: BRAND_A, selling_format_id: FMT_CAN, quantity: 3 },
        // e.g. created by generate_pick_list (carries pick_list_item_id —
        // shape is identical for this math)
        { brand_id: BRAND_A, selling_format_id: FMT_CAN, quantity: 4 },
      ]
    );
    expect(lines[0].allocated).toBe(7);
    expect(lines[0].remaining).toBe(3);
  });

  it("clamps remaining at zero when over-allocated", () => {
    const lines = computeDemandLines(
      [{ brand_id: BRAND_A, selling_format_id: FMT_CAN, quantity: 5 }],
      [{ brand_id: BRAND_A, selling_format_id: FMT_CAN, quantity: 9 }]
    );
    expect(lines[0].remaining).toBe(0);
  });

  it("ignores allocations for combos not on the order", () => {
    const lines = computeDemandLines(
      [{ brand_id: BRAND_A, selling_format_id: FMT_CAN, quantity: 5 }],
      [{ brand_id: BRAND_B, selling_format_id: FMT_KEG, quantity: 9 }]
    );
    expect(lines[0].remaining).toBe(5);
  });
});

describe("computeFifoFill", () => {
  it("fills oldest lots first and caps at the line's remaining quantity", () => {
    const lines = computeDemandLines(
      [{ brand_id: BRAND_A, selling_format_id: FMT_CAN, quantity: 12 }],
      []
    );
    const fill = computeFifoFill(lines, [
      lot("new", BRAND_A, FMT_CAN, 100, "2026-05-01"),
      lot("old", BRAND_A, FMT_CAN, 10, "2026-01-01"),
    ]);
    expect(fill).toEqual({ old: 10, new: 2 });
  });

  it("only fills lots matching the order's brand+format combos", () => {
    const lines = computeDemandLines(
      [{ brand_id: BRAND_A, selling_format_id: FMT_CAN, quantity: 5 }],
      []
    );
    const fill = computeFifoFill(lines, [
      lot("other-brand", BRAND_B, FMT_CAN, 50, "2026-01-01"),
      lot("other-format", BRAND_A, FMT_KEG, 50, "2026-01-01"),
      lot("match", BRAND_A, FMT_CAN, 50, "2026-02-01"),
    ]);
    expect(fill).toEqual({ match: 5 });
  });

  it("sorts undated lots last (NULLS LAST, matching the RPC)", () => {
    const lines = computeDemandLines(
      [{ brand_id: BRAND_A, selling_format_id: FMT_CAN, quantity: 6 }],
      []
    );
    const fill = computeFifoFill(lines, [
      lot("undated", BRAND_A, FMT_CAN, 10, null),
      lot("dated", BRAND_A, FMT_CAN, 4, "2026-03-01"),
    ]);
    expect(fill).toEqual({ dated: 4, undated: 2 });
  });

  it("skips lots already allocated to the order", () => {
    const lines = computeDemandLines(
      [{ brand_id: BRAND_A, selling_format_id: FMT_CAN, quantity: 6 }],
      []
    );
    const fill = computeFifoFill(
      lines,
      [
        lot("taken", BRAND_A, FMT_CAN, 10, "2026-01-01"),
        lot("free", BRAND_A, FMT_CAN, 10, "2026-02-01"),
      ],
      new Set(["taken"])
    );
    expect(fill).toEqual({ free: 6 });
  });

  it("returns an empty fill when all lines are already covered", () => {
    const lines = computeDemandLines(
      [{ brand_id: BRAND_A, selling_format_id: FMT_CAN, quantity: 5 }],
      [{ brand_id: BRAND_A, selling_format_id: FMT_CAN, quantity: 5 }]
    );
    const fill = computeFifoFill(lines, [
      lot("a", BRAND_A, FMT_CAN, 10, "2026-01-01"),
    ]);
    expect(fill).toEqual({});
  });

  it("fills multiple lines independently", () => {
    const lines = computeDemandLines(
      [
        { brand_id: BRAND_A, selling_format_id: FMT_CAN, quantity: 8 },
        { brand_id: BRAND_B, selling_format_id: FMT_KEG, quantity: 3 },
      ],
      [{ brand_id: BRAND_B, selling_format_id: FMT_KEG, quantity: 1 }]
    );
    const fill = computeFifoFill(lines, [
      lot("can-1", BRAND_A, FMT_CAN, 5, "2026-01-01"),
      lot("can-2", BRAND_A, FMT_CAN, 5, "2026-02-01"),
      lot("keg-1", BRAND_B, FMT_KEG, 10, "2026-01-15"),
    ]);
    expect(fill).toEqual({ "can-1": 5, "can-2": 3, "keg-1": 2 });
  });
});

describe("comboKey", () => {
  it("produces distinct keys for distinct combos", () => {
    expect(comboKey(BRAND_A, FMT_CAN)).not.toBe(comboKey(BRAND_A, FMT_KEG));
    expect(comboKey(BRAND_A, FMT_CAN)).toBe(comboKey(BRAND_A, FMT_CAN));
  });
});
