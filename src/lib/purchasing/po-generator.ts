/**
 * Purchase Order Generator
 *
 * Utilities for generating purchase orders from ingredient shortfalls.
 * Groups shortfalls by supplier and creates draft POs with line items.
 */

import type { IngredientShortfall } from "./demand-calculator";
import { log } from "@/lib/client-logger";

/** Lazy-import supabase client to avoid env validation at module load time. */
async function getSupabase() {
  const { createClient } = await import("@/lib/supabase/client");
  return createClient();
}

// =============================================================================
// Types
// =============================================================================

export interface POLineItemDraft {
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

export interface PODraft {
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

    if (!supplierMap.has(supplierId)) {
      supplierMap.set(supplierId, {
        supplier_id: supplierId,
        supplier_name: shortfall.preferred_supplier_name || "Unknown Supplier",
        order_by_dates: [],
        items: [],
      });
    }

    const group = supplierMap.get(supplierId)!;
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
 * Generates the next PO number by reading the highest existing number and incrementing.
 *
 * TODO: This has a read-then-write race condition — concurrent calls can generate
 * duplicate PO numbers. Should be replaced with a database sequence or atomic
 * server-side function. See review branch findings C5.
 */
export async function generateNextPONumber(): Promise<string> {
  const supabase = await getSupabase();
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;

  const { data, error } = await supabase
    .from("purchase_orders")
    .select("po_number")
    .ilike("po_number", `${prefix}%`)
    .order("po_number", { ascending: false })
    .limit(1);

  if (error) {
    log.error("Error getting last PO number:", error);
    throw error;
  }

  if (data && data.length > 0) {
    const lastNumber = data[0].po_number;
    const match = lastNumber.match(/PO-\d+-(\d+)/);
    if (match) {
      const next = parseInt(match[1]) + 1;
      return `${prefix}${next.toString().padStart(3, "0")}`;
    }
  }

  return `${prefix}001`;
}

/**
 * Create a draft purchase order from a shortfall
 */
export async function createDraftPOFromShortfall(
  shortfall: IngredientShortfall,
  poNumber?: string
): Promise<string> {
  const supabase = await getSupabase();

  // Generate PO number if not provided
  const finalPONumber = poNumber || await generateNextPONumber();

  // Calculate order quantity respecting MOQ
  const orderQty = shortfall.min_order_qty
    ? Math.max(shortfall.shortfall_qty, shortfall.min_order_qty)
    : shortfall.shortfall_qty;

  // Calculate expected date from order_by_date + lead_time
  const orderByDate = new Date(shortfall.order_by_date);
  const expectedDate = new Date(orderByDate);
  expectedDate.setDate(expectedDate.getDate() + shortfall.lead_time_days);

  // Create the PO
  const { data: po, error: poError } = await supabase
    .from("purchase_orders")
    .insert({
      po_number: finalPONumber,
      supplier_id: shortfall.preferred_supplier_id,
      status: "draft",
      order_date: orderByDate.toISOString().split("T")[0],
      expected_date: expectedDate.toISOString().split("T")[0],
      notes: `Created from ingredient demand - shortfall of ${shortfall.shortfall_qty} ${shortfall.unit} ${shortfall.catalog_name}`,
    })
    .select()
    .single();

  if (poError) {
    log.error("Error creating PO:", poError);
    throw poError;
  }

  // Create the line item
  const { error: lineError } = await supabase
    .from("po_line_items")
    .insert({
      po_id: po.id,
      catalog_type: shortfall.catalog_type,
      catalog_id: shortfall.catalog_id,
      quantity: orderQty,
      unit: shortfall.unit,
      unit_price: shortfall.unit_price,
    });

  if (lineError) {
    log.error("Error creating PO line item:", lineError);
    // Delete the PO if line item creation fails
    await supabase.from("purchase_orders").delete().eq("id", po.id);
    throw lineError;
  }

  return po.id;
}

/**
 * Create a draft PO from a PODraft object (multiple line items)
 */
export async function createDraftPO(draft: PODraft): Promise<string> {
  const supabase = await getSupabase();

  // Generate PO number
  const poNumber = await generateNextPONumber();

  // Calculate expected date
  const orderByDate = new Date(draft.order_by_date);
  const expectedDate = new Date(orderByDate);
  expectedDate.setDate(expectedDate.getDate() + (draft.max_lead_time_days ?? 7));

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
    await supabase.from("purchase_orders").delete().eq("id", po.id);
    throw lineError;
  }

  return po.id;
}
