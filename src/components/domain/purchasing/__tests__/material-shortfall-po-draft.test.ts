/**
 * Tests for the Material Shortfall → PO Draft adapter used by the
 * Material Planning page's "Create POs for selected" action.
 */

import { describe, it, expect } from "vitest";
import {
  groupMaterialShortfallsBySupplier,
  isShortfallRowOrderable,
  materialShortfallRowKey,
} from "../material-shortfall-po-draft";
import type { MaterialShortfall } from "@/hooks/use-material-planning";

const makeRow = (
  overrides: Partial<MaterialShortfall> = {}
): MaterialShortfall => ({
  inventory_item_id: "item-1",
  inventory_item_name: "16oz Can",
  category: "packaging",
  demand_source: "packaging",
  needed_by_date: "2026-07-01",
  quantity_needed: 100,
  on_hand: 40,
  incoming_po: 0,
  shortfall: 60,
  unit: "each",
  best_supplier_id: "supplier-1",
  best_supplier_name: "Supplier A",
  lead_time_days: 14,
  drop_dead_date: "2026-06-17",
  is_past_due: false,
  source_count: 1,
  ...overrides,
});

describe("materialShortfallRowKey", () => {
  it("is unique per item x demand source", () => {
    expect(materialShortfallRowKey(makeRow())).toBe("item-1:packaging");
    expect(
      materialShortfallRowKey(makeRow({ demand_source: "brewing" }))
    ).toBe("item-1:brewing");
  });

  it("handles a null demand source", () => {
    expect(materialShortfallRowKey(makeRow({ demand_source: null }))).toBe(
      "item-1:unknown"
    );
  });
});

describe("isShortfallRowOrderable", () => {
  it("requires a positive shortfall and a supplier", () => {
    expect(isShortfallRowOrderable(makeRow())).toBe(true);
    expect(isShortfallRowOrderable(makeRow({ shortfall: 0 }))).toBe(false);
    expect(
      isShortfallRowOrderable(makeRow({ best_supplier_id: null }))
    ).toBe(false);
  });
});

describe("groupMaterialShortfallsBySupplier", () => {
  it("maps a row to an inventory_item PO line", () => {
    const drafts = groupMaterialShortfallsBySupplier([makeRow()]);

    expect(drafts).toHaveLength(1);
    expect(drafts[0].supplier_id).toBe("supplier-1");
    expect(drafts[0].supplier_name).toBe("Supplier A");
    expect(drafts[0].order_by_date).toBe("2026-06-17");
    expect(drafts[0].item_count).toBe(1);
    expect(drafts[0].estimated_total).toBe(0);
    expect(drafts[0].max_lead_time_days).toBe(14);

    const line = drafts[0].line_items[0];
    expect(line).toMatchObject({
      catalog_type: "inventory_item",
      catalog_id: "item-1",
      catalog_name: "16oz Can",
      quantity: 60,
      unit: "each",
      unit_price: null,
      estimated_total: null,
      shortfall_qty: 60,
      min_order_qty: null,
      total_required: 100,
      available_qty: 40,
      on_order_qty: 0,
      is_urgent: false,
      lead_time_days: 14,
    });
  });

  it("groups items from different suppliers into separate drafts", () => {
    const drafts = groupMaterialShortfallsBySupplier([
      makeRow(),
      makeRow({
        inventory_item_id: "item-2",
        inventory_item_name: "Pallet",
        best_supplier_id: "supplier-2",
        best_supplier_name: "Supplier B",
      }),
    ]);

    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => d.supplier_id).sort()).toEqual([
      "supplier-1",
      "supplier-2",
    ]);
  });

  it("aggregates duplicate item rows, netting on_hand/incoming_po once", () => {
    // Same item demanded by brewing AND packaging. Each RPC row nets the full
    // on_hand independently, so summing row shortfalls (60 + 0) would
    // under-order; the true combined shortfall is 100 + 30 - 40 - 10 = 80.
    const drafts = groupMaterialShortfallsBySupplier([
      makeRow({ incoming_po: 10, shortfall: 50 }),
      makeRow({
        demand_source: "brewing",
        quantity_needed: 30,
        incoming_po: 10,
        shortfall: 0,
      }),
    ]);

    expect(drafts).toHaveLength(1);
    expect(drafts[0].line_items).toHaveLength(1);
    expect(drafts[0].line_items[0].quantity).toBe(80);
    expect(drafts[0].line_items[0].total_required).toBe(130);
  });

  it("uses the earliest drop_dead_date across rows and items", () => {
    const drafts = groupMaterialShortfallsBySupplier([
      makeRow({ drop_dead_date: "2026-06-20" }),
      makeRow({ demand_source: "brewing", drop_dead_date: "2026-06-10" }),
      makeRow({
        inventory_item_id: "item-2",
        inventory_item_name: "Pallet",
        drop_dead_date: "2026-06-15",
      }),
    ]);

    expect(drafts).toHaveLength(1);
    expect(drafts[0].order_by_date).toBe("2026-06-10");
  });

  it("falls back to today when no row has a drop_dead_date", () => {
    const drafts = groupMaterialShortfallsBySupplier([
      makeRow({ drop_dead_date: null }),
    ]);
    expect(drafts[0].order_by_date).toBe(
      new Date().toISOString().split("T")[0]
    );
  });

  it("marks the line urgent when any source row is past due", () => {
    const drafts = groupMaterialShortfallsBySupplier([
      makeRow(),
      makeRow({ demand_source: "brewing", is_past_due: true }),
    ]);
    expect(drafts[0].line_items[0].is_urgent).toBe(true);
  });

  it("falls back to 'each' for null units and 7-day lead times", () => {
    const drafts = groupMaterialShortfallsBySupplier([
      makeRow({ unit: null, lead_time_days: null }),
    ]);
    expect(drafts[0].line_items[0].unit).toBe("each");
    expect(drafts[0].line_items[0].lead_time_days).toBe(7);
    expect(drafts[0].max_lead_time_days).toBe(7);
  });

  it("skips rows without a supplier", () => {
    const drafts = groupMaterialShortfallsBySupplier([
      makeRow({ best_supplier_id: null, best_supplier_name: null }),
    ]);
    expect(drafts).toHaveLength(0);
  });

  it("drops items whose aggregated quantity nets to zero", () => {
    const drafts = groupMaterialShortfallsBySupplier([
      makeRow({ quantity_needed: 30, on_hand: 40, shortfall: 0 }),
    ]);
    expect(drafts).toHaveLength(0);
  });
});
