/**
 * Unit tests for the extracted material-planning domain math
 * (backend-extraction T3.1).
 *
 * These call the functions directly — with no React, no QueryClient and no
 * Supabase — which is the point of the extraction: the hook-level
 * characterization suite in `src/hooks/__tests__/use-material-planning.test.tsx`
 * proves the split changed nothing, and this suite proves the result is
 * reachable without a frontend.
 *
 * The whole-unit block replays WHOLE_UNIT_PARITY_CASES, the same table the
 * `computeBomConsumption` and SQL parity assertions read, so the planned-
 * quantity preview cannot drift from the actual-quantity depletion path.
 */

import { describe, expect, it } from "vitest";
import { WHOLE_UNIT_PARITY_CASES } from "@/test/whole-unit-parity-fixtures";
import {
  applyOnHandToRequirements,
  collectSellingFormatIds,
  computeSessionMaterialRequirements,
  filterShortfallsByDemandSource,
  type MaterialShortfall,
  type SessionMaterialBomLine,
} from "@/domain/material-planning";

const item = (over: Record<string, unknown> = {}) => ({
  id: "tray",
  name: "Tray",
  sku: "TRY",
  category: "packaging",
  unit: "each",
  ...over,
});

const bomLine = (over: Partial<SessionMaterialBomLine> = {}): SessionMaterialBomLine => ({
  selling_format_id: "fmt-can",
  inventory_item_id: "tray",
  quantity_per_unit: 0.0417,
  inventory_item: item(),
  ...over,
});

describe("collectSellingFormatIds", () => {
  it("de-duplicates and drops nulls, preserving first-seen order", () => {
    expect(
      collectSellingFormatIds([
        { selling_format_id: "b", planned_quantity: 1, batch_id: null },
        { selling_format_id: null, planned_quantity: 1, batch_id: null },
        { selling_format_id: "a", planned_quantity: 1, batch_id: null },
        { selling_format_id: "b", planned_quantity: 1, batch_id: null },
      ]),
    ).toEqual(["b", "a"]);
  });

  it("returns [] for no line items", () => {
    expect(collectSellingFormatIds([])).toEqual([]);
  });
});

describe("filterShortfallsByDemandSource", () => {
  const rows = [
    { inventory_item_id: "a", demand_source: "order" },
    { inventory_item_id: "b", demand_source: "session" },
  ] as unknown as MaterialShortfall[];

  it("returns the input untouched with no source", () => {
    expect(filterShortfallsByDemandSource(rows)).toBe(rows);
  });

  it('treats "all" as no filter', () => {
    expect(filterShortfallsByDemandSource(rows, "all")).toBe(rows);
  });

  it("narrows to a single source", () => {
    expect(filterShortfallsByDemandSource(rows, "session")).toEqual([rows[1]]);
  });

  it("returns [] for an unknown source", () => {
    expect(filterShortfallsByDemandSource(rows, "nope")).toEqual([]);
  });
});

describe("computeSessionMaterialRequirements", () => {
  it.each(WHOLE_UNIT_PARITY_CASES)(
    "quantity_per_unit %s x %s units requires %s whole units",
    (qpu, units, expected) => {
      const [req] = computeSessionMaterialRequirements(
        [{ selling_format_id: "fmt-can", planned_quantity: units, batch_id: "b1" }],
        [bomLine({ quantity_per_unit: qpu })],
      );
      expect(req.total_required).toBe(expected);
      expect(req.is_whole_unit).toBe(true);
    },
  );

  it("ceils per batch, not across the session", () => {
    const [req] = computeSessionMaterialRequirements(
      [
        { selling_format_id: "fmt-can", planned_quantity: 12, batch_id: "b1" },
        { selling_format_id: "fmt-can", planned_quantity: 12, batch_id: "b2" },
      ],
      [bomLine()],
    );
    expect(req.total_required).toBe(2);
  });

  it("shares one bucket for line items with no batch", () => {
    const [req] = computeSessionMaterialRequirements(
      [
        { selling_format_id: "fmt-can", planned_quantity: 12, batch_id: null },
        { selling_format_id: "fmt-can", planned_quantity: 12, batch_id: null },
      ],
      [bomLine()],
    );
    expect(req.total_required).toBe(1);
  });

  it("keeps decimals for bulk units", () => {
    const [req] = computeSessionMaterialRequirements(
      [{ selling_format_id: "fmt-can", planned_quantity: 10, batch_id: "b1" }],
      [bomLine({ quantity_per_unit: 0.25, inventory_item: item({ unit: "gal" }) })],
    );
    expect(req.total_required).toBe(2.5);
    expect(req.is_whole_unit).toBe(false);
  });

  it("skips line items with no format or no planned quantity", () => {
    expect(
      computeSessionMaterialRequirements(
        [
          { selling_format_id: null, planned_quantity: 100, batch_id: "b1" },
          { selling_format_id: "fmt-can", planned_quantity: null, batch_id: "b1" },
        ],
        [bomLine()],
      ),
    ).toEqual([]);
  });

  it("returns [] when the formats have no BOM lines", () => {
    expect(
      computeSessionMaterialRequirements(
        [{ selling_format_id: "fmt-can", planned_quantity: 24, batch_id: "b1" }],
        [],
      ),
    ).toEqual([]);
  });

  it("keeps a zero-quantity row so the operator still sees the material", () => {
    // Deliberate divergence from computeBomConsumption, which drops these.
    const [req] = computeSessionMaterialRequirements(
      [{ selling_format_id: "fmt-can", planned_quantity: 0, batch_id: "b1" }],
      [bomLine()],
    );
    // Exactly -0: `Math.ceil(0 - 1e-9)`. Longstanding behavior, and harmless —
    // it formats as "0" and compares equal to 0 everywhere but `Object.is`.
    expect(req.total_required).toBeCloseTo(0, 10);
  });

  it("falls back to the item id when the join yields no name", () => {
    const [req] = computeSessionMaterialRequirements(
      [{ selling_format_id: "fmt-can", planned_quantity: 24, batch_id: "b1" }],
      [bomLine({ quantity_per_unit: 1, inventory_item: null })],
    );
    expect(req).toMatchObject({
      inventory_item_name: "tray",
      sku: null,
      category: null,
      unit: null,
      is_whole_unit: false,
    });
  });
});

describe("applyOnHandToRequirements", () => {
  const wholeReq = {
    inventory_item_id: "tray",
    inventory_item_name: "Tray",
    sku: null,
    category: null,
    unit: "each",
    total_required: 10,
    is_whole_unit: true,
  };

  it("sums lots then floors whole-unit on-hand", () => {
    const [row] = applyOnHandToRequirements(
      [wholeReq],
      [
        { inventory_item_id: "tray", remaining_quantity: 2.4 },
        { inventory_item_id: "tray", remaining_quantity: 1.4 },
      ],
    );
    expect(row.on_hand_quantity).toBe(3);
    expect(row.shortfall).toBe(7);
  });

  it("leaves bulk on-hand unrounded", () => {
    const [row] = applyOnHandToRequirements(
      [{ ...wholeReq, is_whole_unit: false, total_required: 2.5 }],
      [{ inventory_item_id: "tray", remaining_quantity: 1.75 }],
    );
    expect(row.on_hand_quantity).toBe(1.75);
    expect(row.shortfall).toBeCloseTo(0.75, 10);
  });

  it("treats a missing item as zero on hand", () => {
    const [row] = applyOnHandToRequirements([wholeReq], []);
    expect(row.on_hand_quantity).toBe(0);
    expect(row.shortfall).toBe(10);
  });

  it("clamps shortfall at zero", () => {
    const [row] = applyOnHandToRequirements(
      [wholeReq],
      [{ inventory_item_id: "tray", remaining_quantity: 99 }],
    );
    expect(row.shortfall).toBe(0);
  });

  it("sorts by shortfall descending", () => {
    const rows = applyOnHandToRequirements(
      [
        { ...wholeReq, inventory_item_id: "tray", total_required: 10 },
        { ...wholeReq, inventory_item_id: "lid", total_required: 40 },
      ],
      [],
    );
    expect(rows.map((r) => r.inventory_item_id)).toEqual(["lid", "tray"]);
  });
});
