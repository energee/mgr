/**
 * Characterization tests for the PO accept-into-inventory pure helpers.
 * Locks in current behavior ahead of the src/domain/ move.
 */

import { describe, it, expect } from "vitest";
import {
  catalogKey,
  buildMappingDefaults,
  buildBinPlacements,
  type PriorLotRow,
} from "../po-accept-utils";

const row = (o: Partial<PriorLotRow> = {}): PriorLotRow => ({
  inventory_item_id: "item-1",
  po_receive: {
    po_line_item: { catalog_type: "material", catalog_id: "cat-1" },
  },
  bin_inventory_items: [{ bin_id: "bin-1" }],
  ...o,
});

describe("catalogKey", () => {
  it("joins type and id with a colon", () => {
    expect(catalogKey("material", "cat-1")).toBe("material:cat-1");
  });
});

describe("buildMappingDefaults", () => {
  it("returns an empty map for no rows", () => {
    expect(buildMappingDefaults([]).size).toBe(0);
  });

  it("maps catalog key to inventory item and first bin", () => {
    const map = buildMappingDefaults([row()]);
    expect(map.get("material:cat-1")).toEqual({
      inventory_item_id: "item-1",
      bin_id: "bin-1",
    });
  });

  it("first row per key wins (rows are most-recent-first)", () => {
    const map = buildMappingDefaults([
      row({ inventory_item_id: "newest" }),
      row({ inventory_item_id: "older", bin_inventory_items: [{ bin_id: "bin-9" }] }),
    ]);
    expect(map.get("material:cat-1")).toEqual({
      inventory_item_id: "newest",
      bin_id: "bin-1",
    });
    expect(map.size).toBe(1);
  });

  it("uses only the first bin placement when several exist", () => {
    const map = buildMappingDefaults([
      row({ bin_inventory_items: [{ bin_id: "b1" }, { bin_id: "b2" }] }),
    ]);
    expect(map.get("material:cat-1")?.bin_id).toBe("b1");
  });

  it("falls back to null bin for empty or null placements", () => {
    expect(
      buildMappingDefaults([row({ bin_inventory_items: [] })]).get("material:cat-1")
        ?.bin_id
    ).toBeNull();
    expect(
      buildMappingDefaults([row({ bin_inventory_items: null })]).get(
        "material:cat-1"
      )?.bin_id
    ).toBeNull();
  });

  it("skips rows missing the receive → line-item chain", () => {
    expect(buildMappingDefaults([row({ po_receive: null })]).size).toBe(0);
    expect(
      buildMappingDefaults([row({ po_receive: { po_line_item: null } })]).size
    ).toBe(0);
  });

  it("skips rows with a falsy inventory_item_id", () => {
    expect(buildMappingDefaults([row({ inventory_item_id: "" })]).size).toBe(0);
  });

  it("keys separately per catalog type and id", () => {
    const map = buildMappingDefaults([
      row(),
      row({
        inventory_item_id: "item-2",
        po_receive: {
          po_line_item: { catalog_type: "ingredient", catalog_id: "cat-1" },
        },
      }),
    ]);
    expect(map.size).toBe(2);
    expect(map.get("ingredient:cat-1")?.inventory_item_id).toBe("item-2");
  });
});

describe("buildBinPlacements", () => {
  it("returns [] for no lots", () => {
    expect(buildBinPlacements([], new Map())).toEqual([]);
  });

  it("builds a placement row per lot with a chosen bin", () => {
    const placements = buildBinPlacements(
      [
        { id: "lot-1", po_receive_id: "rec-1" },
        { id: "lot-2", po_receive_id: "rec-2" },
      ],
      new Map([
        ["rec-1", { bin_id: "bin-1", quantity: 5 }],
        ["rec-2", { bin_id: "bin-2", quantity: 0 }],
      ])
    );
    expect(placements).toEqual([
      { bin_id: "bin-1", inventory_lot_id: "lot-1", quantity: 5 },
      { bin_id: "bin-2", inventory_lot_id: "lot-2", quantity: 0 },
    ]);
  });

  it("skips lots without a po_receive_id", () => {
    expect(
      buildBinPlacements(
        [{ id: "lot-1", po_receive_id: null }],
        new Map([["rec-1", { bin_id: "bin-1", quantity: 5 }]])
      )
    ).toEqual([]);
  });

  it("skips lots with no placement chosen", () => {
    expect(
      buildBinPlacements([{ id: "lot-1", po_receive_id: "rec-1" }], new Map())
    ).toEqual([]);
  });

  it("places a receive's quantity once when two lots share a receive id", () => {
    expect(
      buildBinPlacements(
        [
          { id: "lot-1", po_receive_id: "rec-1" },
          { id: "lot-2", po_receive_id: "rec-1" },
        ],
        new Map([["rec-1", { bin_id: "bin-1", quantity: 5 }]])
      )
    ).toEqual([{ bin_id: "bin-1", inventory_lot_id: "lot-1", quantity: 5 }]);
  });
});
