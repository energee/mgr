/**
 * Tests for the PO accept-into-inventory pure helpers: prefilling the
 * catalog→inventory-item/bin mapping from prior accepted lots, and
 * building structured bin_inventory_items placement rows.
 */

import { describe, it, expect } from "vitest";
import {
  buildMappingDefaults,
  buildBinPlacements,
  catalogKey,
  type PriorLotRow,
} from "@/components/domain/purchasing/po-accept-utils";

function lotRow(overrides: Partial<PriorLotRow> = {}): PriorLotRow {
  return {
    inventory_item_id: "item-1",
    po_receive: {
      po_line_item: { catalog_type: "hop", catalog_id: "cat-1" },
    },
    bin_inventory_items: [{ bin_id: "bin-1" }],
    ...overrides,
  };
}

describe("catalogKey", () => {
  it("joins type and id with a colon", () => {
    expect(catalogKey("hop", "abc")).toBe("hop:abc");
  });
});

describe("buildMappingDefaults", () => {
  it("maps a catalog item to its prior inventory item and bin", () => {
    const map = buildMappingDefaults([lotRow()]);
    expect(map.get("hop:cat-1")).toEqual({
      inventory_item_id: "item-1",
      bin_id: "bin-1",
    });
  });

  it("keeps the first (most recent) row per catalog key", () => {
    const map = buildMappingDefaults([
      lotRow({ inventory_item_id: "item-new" }),
      lotRow({ inventory_item_id: "item-old" }),
    ]);
    expect(map.get("hop:cat-1")?.inventory_item_id).toBe("item-new");
  });

  it("returns null bin_id when the lot has no bin placement", () => {
    const map = buildMappingDefaults([lotRow({ bin_inventory_items: [] })]);
    expect(map.get("hop:cat-1")?.bin_id).toBeNull();

    const mapNull = buildMappingDefaults([
      lotRow({ bin_inventory_items: null }),
    ]);
    expect(mapNull.get("hop:cat-1")?.bin_id).toBeNull();
  });

  it("uses the first placement when a lot is split across bins", () => {
    const map = buildMappingDefaults([
      lotRow({ bin_inventory_items: [{ bin_id: "bin-a" }, { bin_id: "bin-b" }] }),
    ]);
    expect(map.get("hop:cat-1")?.bin_id).toBe("bin-a");
  });

  it("skips rows missing the receive→line-item chain", () => {
    const map = buildMappingDefaults([
      lotRow({ po_receive: null }),
      lotRow({ po_receive: { po_line_item: null } }),
    ]);
    expect(map.size).toBe(0);
  });

  it("tracks distinct catalog items independently", () => {
    const map = buildMappingDefaults([
      lotRow(),
      lotRow({
        inventory_item_id: "item-2",
        po_receive: {
          po_line_item: { catalog_type: "grain", catalog_id: "cat-2" },
        },
        bin_inventory_items: [{ bin_id: "bin-2" }],
      }),
    ]);
    expect(map.get("hop:cat-1")?.inventory_item_id).toBe("item-1");
    expect(map.get("grain:cat-2")).toEqual({
      inventory_item_id: "item-2",
      bin_id: "bin-2",
    });
  });
});

describe("buildBinPlacements", () => {
  const placementByReceiveId = new Map([
    ["rcv-1", { bin_id: "bin-1", quantity: 50 }],
    ["rcv-2", { bin_id: "bin-2", quantity: 10 }],
  ]);

  it("builds one placement row per lot with a chosen bin", () => {
    const placements = buildBinPlacements(
      [
        { id: "lot-1", po_receive_id: "rcv-1" },
        { id: "lot-2", po_receive_id: "rcv-2" },
      ],
      placementByReceiveId
    );
    expect(placements).toEqual([
      { bin_id: "bin-1", inventory_lot_id: "lot-1", quantity: 50 },
      { bin_id: "bin-2", inventory_lot_id: "lot-2", quantity: 10 },
    ]);
  });

  it("skips lots without a chosen bin", () => {
    const placements = buildBinPlacements(
      [
        { id: "lot-1", po_receive_id: "rcv-1" },
        { id: "lot-3", po_receive_id: "rcv-3" },
      ],
      placementByReceiveId
    );
    expect(placements).toEqual([
      { bin_id: "bin-1", inventory_lot_id: "lot-1", quantity: 50 },
    ]);
  });

  it("skips lots with no po_receive_id", () => {
    const placements = buildBinPlacements(
      [{ id: "lot-x", po_receive_id: null }],
      placementByReceiveId
    );
    expect(placements).toEqual([]);
  });
});
