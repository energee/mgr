/**
 * Purchase Order Generator
 *
 * Utilities for generating purchase orders from ingredient shortfalls.
 * Groups shortfalls by supplier and creates draft POs with line items.
 */

import type { IngredientShortfall } from "./demand-calculator";
import { log } from "@/lib/client-logger";
import { dynamicRpc } from "@/services/types";

/** Lazy-import supabase client to avoid env validation at module load time. */
async function getSupabase() {
  const { createClient } = await import("@/lib/supabase/client");
  return createClient();
}

// =============================================================================
// Types
// =============================================================================

export type POLineItemDraft = {
  catalog_type: string;
  catalog_id: string;
  catalog_name: string;
  quantity: number;
  unit: string;
  unit_price: number | null;
  estimated_total: number | null;
  shortfall_qty: number;
  min_order_qty: number | null;
  total_required: number;
  available_qty: number;
  on_order_qty: number;
  is_urgent: boolean;
  lead_time_days: number;
}

export type PODraft = {
  supplier_id: string;
  supplier_name: string;
  order_by_date: string;
  line_items: POLineItemDraft[];
  estimated_total: number;
  item_count: number;
  max_lead_time_days: number;
}

// =============================================================================
// Functions
// =============================================================================

/**
 * Group shortfalls by their preferred supplier
 */
export function groupShortfallsBySupplier(shortfalls: IngredientShortfall[]): PODraft[] {
  // Group by supplier
  const supplierMap = new Map<string, {
    supplier_id: string;
    supplier_name: string;
    order_by_dates: string[];
    items: POLineItemDraft[];
  }>();

  for (const shortfall of shortfalls) {
    if (!shortfall.preferred_supplier_id) continue;

    const supplierId = shortfall.preferred_supplier_id;

    let group = supplierMap.get(supplierId);
    if (!group) {
      group = {
        supplier_id: supplierId,
        supplier_name: shortfall.preferred_supplier_name || "Unknown Supplier",
        order_by_dates: [],
        items: [],
      };
      supplierMap.set(supplierId, group);
    }
    group.order_by_dates.push(shortfall.order_by_date);

    // Calculate quantity respecting MOQ
    const orderQty = shortfall.min_order_qty
      ? Math.max(shortfall.shortfall_qty, shortfall.min_order_qty)
      : shortfall.shortfall_qty;

    group.items.push({
      catalog_type: shortfall.catalog_type,
      catalog_id: shortfall.catalog_id,
      catalog_name: shortfall.catalog_name,
      quantity: orderQty,
      unit: shortfall.unit,
      unit_price: shortfall.unit_price,
      estimated_total: shortfall.unit_price ? orderQty * shortfall.unit_price : null,
      shortfall_qty: shortfall.shortfall_qty,
      min_order_qty: shortfall.min_order_qty,
      total_required: shortfall.total_required,
      available_qty: shortfall.available_qty,
      on_order_qty: shortfall.on_order_qty,
      is_urgent: shortfall.is_urgent,
      lead_time_days: shortfall.lead_time_days,
    });
  }

  // Convert to array and calculate totals
  return Array.from(supplierMap.values()).map((group) => ({
    supplier_id: group.supplier_id,
    supplier_name: group.supplier_name,
    // Use earliest order_by_date
    order_by_date: group.order_by_dates.sort()[0],
    line_items: group.items,
    estimated_total: group.items.reduce(
      (sum, item) => sum + (item.estimated_total || 0),
      0
    ),
    item_count: group.items.length,
    max_lead_time_days: Math.max(...group.items.map(i => i.lead_time_days ?? 7), 7),
  }));
}

/**
 * Generates the next PO number using the race-safe database function.
 *
 * Delegates to `generate_next_po_number()` in PostgreSQL which uses
 * pg_advisory_xact_lock to serialize concurrent callers. Returns
 * numbers in PO-YYYY-NNN format.
 */
export async function generateNextPONumber(): Promise<string> {
  const supabase = await getSupabase();
  const { data, error } = await dynamicRpc(supabase, "generate_next_po_number");

  if (error) {
    log.error("Error generating PO number:", error);
    throw error;
  }

  return data as string;
}

/**
 * Create a draft PO from a PODraft object (multiple line items)
 */
export async function createDraftPO(draft: PODraft): Promise<string> {
  const supabase = await getSupabase();

  // Generate PO number
  const poNumber = await generateNextPONumber();

  // Calculate expected date. `order_by_date` parses as UTC midnight, so the
  // offset must be applied with the UTC setters — mixing them with the local
  // getDate()/setDate() shifts the result by a day whenever the addition
  // crosses a DST transition (host-timezone dependent). Same rule as
  // src/integrations/quickbooks/sync-utils.ts's addDays.
  const orderByDate = new Date(draft.order_by_date);
  const expectedDate = new Date(orderByDate);
  expectedDate.setUTCDate(expectedDate.getUTCDate() + (draft.max_lead_time_days ?? 7));

  // Create the PO
  const { data: po, error: poError } = await supabase
    .from("purchase_orders")
    .insert({
      po_number: poNumber,
      supplier_id: draft.supplier_id,
      status: "draft",
      order_date: orderByDate.toISOString().split("T")[0],
      expected_date: expectedDate.toISOString().split("T")[0],
      notes: `Created from ingredient demand - ${draft.item_count} items`,
    })
    .select()
    .single();

  if (poError) {
    log.error("Error creating PO:", poError);
    throw poError;
  }

  // Create line items
  const lineItems = draft.line_items.map((item) => ({
    po_id: po.id,
    catalog_type: item.catalog_type,
    catalog_id: item.catalog_id,
    quantity: item.quantity,
    unit: item.unit,
    unit_price: item.unit_price,
  }));

  const { error: lineError } = await supabase
    .from("po_line_items")
    .insert(lineItems);

  if (lineError) {
    log.error("Error creating PO line items:", lineError);
    // Delete the PO if line items creation fails
    const { error: cleanupError } = await supabase
      .from("purchase_orders")
      .delete()
      .eq("id", po.id);
    if (cleanupError) {
      log.error(`Failed to clean up orphaned PO ${po.id} after line item insert failure:`, cleanupError);
    }
    throw lineError;
  }

  return po.id;
}
