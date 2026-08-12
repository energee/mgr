/**
 * Pure helpers for the PO Accept-into-Inventory dialog
 * (po-accept-inventory-dialog.tsx).
 *
 * Extracted so the catalog→inventory-item mapping prefill and the
 * bin-placement row construction can be unit tested without React or a
 * Supabase client. The mapping prefill works entirely off the existing
 * chain inventory_lots.po_receive_id → po_receives.po_line_item_id →
 * po_line_items.catalog_type/catalog_id — no mapping table or schema
 * change is involved.
 */

/**
 * One unaccepted po_receive row as returned by the
 * `get_unaccepted_po_receives` RPC, with its catalog name resolved
 * client-side. Lives here rather than in a component file so the dialog,
 * the receive grid and the accept-mutation hook all import the RPC row
 * contract from the same React-free leaf.
 */
export type UnacceptedReceive = {
  receive_id: string;
  po_line_item_id: string;
  catalog_type: string;
  catalog_id: string;
  catalog_name: string; // resolved client-side
  quantity: number;
  unit: string;
  unit_price: number | null;
  lot_number: string | null;
  expiration_date: string | null;
  received_date: string | null;
};

/**
 * Per-row acceptance state: whether the row is selected, which
 * inventory_item it maps to, and the storage bin it goes into (`bin_id`
 * writes a bin_inventory_items row on accept; empty means no placement).
 *
 * This is view state, not domain data — nothing in this module consumes it
 * (`buildBinPlacements` deliberately takes a structural map instead). It is
 * parked here only so the dialog, the grid and the accept hook share one
 * declaration; if it grows more UI concerns, move it to the component layer.
 */
export type RowState = {
  selected: boolean;
  inventory_item_id: string;
  bin_id: string;
};

/**
 * Shape of a prior accepted-lot row returned by the dialog's
 * prior-mapping query (inventory_lots with embedded po_receive →
 * po_line_item and bin_inventory_items placements).
 */
export type PriorLotRow = {
  inventory_item_id: string;
  po_receive: {
    po_line_item: {
      catalog_type: string;
      catalog_id: string;
    } | null;
  } | null;
  bin_inventory_items: { bin_id: string }[] | null;
};

/** Default mapping derived from the most recent prior acceptance */
export type MappingDefault = {
  inventory_item_id: string;
  bin_id: string | null;
};

/** Lookup key for a received line's catalog item */
export function catalogKey(catalogType: string, catalogId: string): string {
  return `${catalogType}:${catalogId}`;
}

/**
 * Build catalog→(inventory item, bin) defaults from prior accepted lots.
 *
 * `rows` must be ordered most-recent-first; the first row seen per catalog
 * key wins, so each received line prefills with the way the same catalog
 * item was mapped last time. Rows missing the receive→line-item chain are
 * skipped.
 */
export function buildMappingDefaults(
  rows: PriorLotRow[]
): Map<string, MappingDefault> {
  const map = new Map<string, MappingDefault>();
  for (const row of rows) {
    const lineItem = row.po_receive?.po_line_item;
    if (!lineItem || !row.inventory_item_id) continue;
    const key = catalogKey(lineItem.catalog_type, lineItem.catalog_id);
    if (map.has(key)) continue;
    map.set(key, {
      inventory_item_id: row.inventory_item_id,
      bin_id: row.bin_inventory_items?.[0]?.bin_id ?? null,
    });
  }
  return map;
}

/**
 * Build bin_inventory_items insert rows for newly created lots.
 *
 * `insertedLots` come back from the inventory_lots insert (id +
 * po_receive_id, which is unique per accepted lot in this flow);
 * `placementByReceiveId` carries the user's bin selection and the lot
 * quantity per receive. Lots without a chosen bin produce no placement row.
 *
 * A receive's quantity is placed at most once. Should two lots ever share a
 * po_receive_id, emitting a row for each would place that quantity twice and
 * overstate on-hand inventory, so only the first lot gets the placement.
 */
export function buildBinPlacements(
  insertedLots: { id: string; po_receive_id: string | null }[],
  placementByReceiveId: Map<string, { bin_id: string; quantity: number }>
): { bin_id: string; inventory_lot_id: string; quantity: number }[] {
  const placements: {
    bin_id: string;
    inventory_lot_id: string;
    quantity: number;
  }[] = [];
  const placedReceiveIds = new Set<string>();
  for (const lot of insertedLots) {
    if (!lot.po_receive_id) continue;
    if (placedReceiveIds.has(lot.po_receive_id)) continue;
    const placement = placementByReceiveId.get(lot.po_receive_id);
    if (!placement) continue;
    placedReceiveIds.add(lot.po_receive_id);
    placements.push({
      bin_id: placement.bin_id,
      inventory_lot_id: lot.id,
      quantity: placement.quantity,
    });
  }
  return placements;
}
