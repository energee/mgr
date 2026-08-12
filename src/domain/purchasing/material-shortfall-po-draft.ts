/**
 * Material Shortfall → PO Draft adapter
 *
 * Converts MaterialShortfall rows (from the calculate_material_shortfalls RPC,
 * rendered on /purchasing/material-planning) into the PODraft shape consumed
 * by createDraftPO in src/domain/purchasing/po-generator.ts, so material
 * shortfalls can be turned into draft purchase orders directly from the
 * Material Planning page.
 *
 * The RPC returns one row per (inventory_item, demand_source), so the same
 * item can appear up to three times (brewing/packaging/shipping). Each row
 * independently nets the item's full on_hand and incoming_po, so rows for the
 * same item must be aggregated before ordering: quantity_needed is summed
 * across the selected rows and inventory/incoming PO quantities are netted
 * once per item.
 *
 * Line items use catalog_type "inventory_item" with catalog_id =
 * inventory_item_id — supported end-to-end: supplier_catalog rows since
 * migration 00161, netted against open POs by the shortfall RPC since 00164,
 * and displayed by resolveCatalogNames via the CATALOG_TABLES mapping in
 * src/entities/po-line-item.tsx.
 */

import type { MaterialShortfall } from "@/domain/material-planning";
import type { PODraft, POLineItemDraft } from "@/domain/purchasing/po-generator";

/** Unit written to PO lines when the inventory item has no unit set. */
const FALLBACK_UNIT = "each";

/** Lead time assumed when the RPC returns a null lead time. */
const FALLBACK_LEAD_TIME_DAYS = 7;

/**
 * Stable selection key for a shortfall row. The RPC emits at most one row per
 * (inventory_item, demand_source) pair, so this key is unique per row.
 */
export function materialShortfallRowKey(row: MaterialShortfall): string {
  return `${row.inventory_item_id}:${row.demand_source ?? "unknown"}`;
}

/**
 * A row can become a PO line when there is something to order (positive
 * shortfall) and a supplier to order it from.
 */
export function isShortfallRowOrderable(row: MaterialShortfall): boolean {
  return row.shortfall > 0 && row.best_supplier_id != null;
}

/** Per-item accumulator used while aggregating duplicate item rows. */
type ItemAggregate = {
  inventory_item_id: string;
  inventory_item_name: string;
  supplier_id: string;
  supplier_name: string;
  /** Sum of quantity_needed across the item's selected rows. */
  total_needed: number;
  /** Item-level values — identical on every row for the same item. */
  on_hand: number;
  incoming_po: number;
  unit: string | null;
  lead_time_days: number;
  /** Earliest drop_dead_date across the item's rows (null if none set). */
  order_by_date: string | null;
  is_past_due: boolean;
};

/**
 * Group material shortfall rows into per-supplier PO drafts.
 *
 * Mirrors groupShortfallsBySupplier (po-generator.ts) for the material
 * planning data shape:
 * - Rows without a best supplier are skipped (callers should pre-filter via
 *   isShortfallRowOrderable; this is a defensive backstop).
 * - Rows are first aggregated per inventory_item_id; the order quantity is
 *   max(0, Σ quantity_needed − on_hand − incoming_po). Items that net to
 *   zero are dropped.
 * - order_by_date comes from the earliest drop_dead_date in the group,
 *   falling back to today when no row has one.
 * - unit_price/min_order_qty are null (the RPC carries no pricing data), so
 *   estimated totals are 0.
 */
export function groupMaterialShortfallsBySupplier(
  rows: MaterialShortfall[],
): PODraft[] {
  // Pass 1: aggregate rows per inventory item.
  const itemMap = new Map<string, ItemAggregate>();

  for (const row of rows) {
    if (!row.best_supplier_id) continue;

    const existing = itemMap.get(row.inventory_item_id);
    if (!existing) {
      itemMap.set(row.inventory_item_id, {
        inventory_item_id: row.inventory_item_id,
        inventory_item_name: row.inventory_item_name,
        supplier_id: row.best_supplier_id,
        supplier_name: row.best_supplier_name ?? "Unknown Supplier",
        total_needed: row.quantity_needed,
        on_hand: row.on_hand,
        incoming_po: row.incoming_po,
        unit: row.unit,
        lead_time_days: row.lead_time_days ?? FALLBACK_LEAD_TIME_DAYS,
        order_by_date: row.drop_dead_date,
        is_past_due: row.is_past_due,
      });
      continue;
    }

    existing.total_needed += row.quantity_needed;
    // on_hand/incoming_po are item-level on every row; max() guards against
    // drift instead of double-counting them.
    existing.on_hand = Math.max(existing.on_hand, row.on_hand);
    existing.incoming_po = Math.max(existing.incoming_po, row.incoming_po);
    existing.unit ??= row.unit;
    existing.lead_time_days = Math.max(
      existing.lead_time_days,
      row.lead_time_days ?? FALLBACK_LEAD_TIME_DAYS,
    );
    if (
      row.drop_dead_date &&
      (!existing.order_by_date || row.drop_dead_date < existing.order_by_date)
    ) {
      existing.order_by_date = row.drop_dead_date;
    }
    existing.is_past_due = existing.is_past_due || row.is_past_due;
  }

  // Pass 2: group aggregated items per supplier.
  const supplierMap = new Map<
    string,
    {
      supplier_id: string;
      supplier_name: string;
      order_by_dates: string[];
      items: POLineItemDraft[];
    }
  >();

  for (const item of itemMap.values()) {
    const orderQty = Math.max(
      0,
      item.total_needed - item.on_hand - item.incoming_po,
    );
    if (orderQty <= 0) continue; // Fully covered once aggregated — nothing to order.

    let group = supplierMap.get(item.supplier_id);
    if (!group) {
      group = {
        supplier_id: item.supplier_id,
        supplier_name: item.supplier_name,
        order_by_dates: [],
        items: [],
      };
      supplierMap.set(item.supplier_id, group);
    }
    if (item.order_by_date) {
      group.order_by_dates.push(item.order_by_date);
    }

    group.items.push({
      catalog_type: "inventory_item",
      catalog_id: item.inventory_item_id,
      catalog_name: item.inventory_item_name,
      quantity: orderQty,
      unit: item.unit ?? FALLBACK_UNIT,
      unit_price: null,
      estimated_total: null,
      shortfall_qty: orderQty,
      min_order_qty: null,
      total_required: item.total_needed,
      available_qty: item.on_hand,
      on_order_qty: item.incoming_po,
      is_urgent: item.is_past_due,
      lead_time_days: item.lead_time_days,
    });
  }

  const today = new Date().toISOString().split("T")[0];

  return Array.from(supplierMap.values()).map((group) => ({
    supplier_id: group.supplier_id,
    supplier_name: group.supplier_name,
    // Earliest drop-dead date in the group; today when none is known.
    order_by_date: group.order_by_dates.sort()[0] ?? today,
    line_items: group.items,
    estimated_total: 0, // No pricing data on material shortfall rows.
    item_count: group.items.length,
    max_lead_time_days: Math.max(
      ...group.items.map((i) => i.lead_time_days ?? FALLBACK_LEAD_TIME_DAYS),
      FALLBACK_LEAD_TIME_DAYS,
    ),
  }));
}
