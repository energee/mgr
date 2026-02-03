/**
 * Backward Planning Calculator
 *
 * TypeScript utilities for backward planning from orders.
 * Calculates demand from open orders and aggregates production requirements.
 */

import { createClient } from "@/lib/supabase/client";

// =============================================================================
// Types
// =============================================================================

/**
 * Order demand with line items for planning
 */
export interface OrderDemand {
  order_id: string;
  order_number: string;
  customer_id: string | null;
  customer_name: string | null;
  status: string;
  order_date: string;
  requested_date: string | null;
  scheduled_date: string | null;
  items: OrderItemDemand[];
}

/**
 * Order item with TBD support
 */
export interface OrderItemDemand {
  item_id: string;
  brand_id: string | null;
  brand_name: string | null;
  package_type_id: string | null;
  package_type_name: string | null;
  quantity: number;
  // TBD fields
  is_tbd: boolean;
  style_id: string | null;
  style_name: string | null;
  tbd_notes: string | null;
}

/**
 * Aggregated production requirement
 */
export interface ProductionRequirement {
  brand_id: string | null;
  brand_name: string | null;
  package_type_id: string | null;
  package_type_name: string | null;
  // TBD fields
  is_tbd: boolean;
  style_id: string | null;
  style_name: string | null;
  // Quantities
  total_demand: number;
  available_quantity: number;
  in_production: number;
  shortage: number;
  // Dates
  earliest_requested_date: string | null;
  latest_requested_date: string | null;
  // Order info
  order_count: number;
  order_numbers: string[];
}

/**
 * Summary statistics for backward planning
 */
export interface BackwardPlanningSummary {
  totalOrders: number;
  totalLineItems: number;
  tbdItems: number;
  shortageCount: number;
  totalDemandUnits: number;
  totalAvailable: number;
  totalShortage: number;
}

// =============================================================================
// Functions
// =============================================================================

/**
 * Fetch open orders with their items for demand planning.
 * Includes customer info and TBD fields.
 */
export async function getOrderDemand(horizonWeeks = 8): Promise<OrderDemand[]> {
  const supabase = createClient();

  // Calculate date range
  const today = new Date();
  const endDate = new Date();
  endDate.setDate(today.getDate() + horizonWeeks * 7);

  // Fetch orders with items - include draft through scheduled
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select(`
      id,
      order_number,
      customer_id,
      status,
      order_date,
      requested_date,
      scheduled_date,
      customers:customer_id (name)
    `)
    .in("status", ["draft", "confirmed", "scheduled", "picking"])
    .or(`requested_date.is.null,requested_date.lte.${endDate.toISOString().split("T")[0]}`)
    .order("requested_date", { ascending: true, nullsFirst: false });

  if (ordersError) {
    console.error("Error fetching orders:", ordersError);
    throw ordersError;
  }

  if (!orders || orders.length === 0) {
    return [];
  }

  // Fetch items for all orders
  const orderIds = orders.map((o) => o.id);
  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select(`
      id,
      order_id,
      brand_id,
      package_type_id,
      quantity,
      style_id,
      tbd_notes,
      brands:brand_id (name),
      package_types:package_type_id (name),
      beer_styles:style_id (name)
    `)
    .in("order_id", orderIds);

  if (itemsError) {
    console.error("Error fetching order items:", itemsError);
    throw itemsError;
  }

  // Map items by order
  const itemsByOrder = new Map<string, OrderItemDemand[]>();
  for (const item of items || []) {
    if (!itemsByOrder.has(item.order_id)) {
      itemsByOrder.set(item.order_id, []);
    }

    const brand = item.brands as { name: string } | null;
    const packageType = item.package_types as { name: string } | null;
    const style = item.beer_styles as { name: string } | null;

    itemsByOrder.get(item.order_id)!.push({
      item_id: item.id,
      brand_id: item.brand_id,
      brand_name: brand?.name ?? null,
      package_type_id: item.package_type_id,
      package_type_name: packageType?.name ?? null,
      quantity: item.quantity,
      is_tbd: !item.brand_id && !!item.style_id,
      style_id: item.style_id,
      style_name: style?.name ?? null,
      tbd_notes: item.tbd_notes,
    });
  }

  // Build result
  return orders.map((order) => {
    const customer = order.customers as { name: string } | null;
    return {
      order_id: order.id,
      order_number: order.order_number,
      customer_id: order.customer_id,
      customer_name: customer?.name ?? null,
      status: order.status,
      order_date: order.order_date,
      requested_date: order.requested_date,
      scheduled_date: order.scheduled_date,
      items: itemsByOrder.get(order.id) ?? [],
    };
  });
}

/**
 * Aggregate demand into production requirements.
 * Groups by brand/package (or style for TBD) and calculates shortages.
 */
export async function getProductionRequirements(
  horizonWeeks = 8
): Promise<ProductionRequirement[]> {
  const supabase = createClient();
  const orders = await getOrderDemand(horizonWeeks);

  // Aggregate by brand/package or style/package
  const requirementMap = new Map<string, ProductionRequirement>();

  for (const order of orders) {
    for (const item of order.items) {
      // Create key: either brand/package or style/package for TBD
      const key = item.is_tbd
        ? `tbd:${item.style_id}:${item.package_type_id}`
        : `brand:${item.brand_id}:${item.package_type_id}`;

      if (!requirementMap.has(key)) {
        requirementMap.set(key, {
          brand_id: item.brand_id,
          brand_name: item.brand_name,
          package_type_id: item.package_type_id,
          package_type_name: item.package_type_name,
          is_tbd: item.is_tbd,
          style_id: item.style_id,
          style_name: item.style_name,
          total_demand: 0,
          available_quantity: 0,
          in_production: 0,
          shortage: 0,
          earliest_requested_date: null,
          latest_requested_date: null,
          order_count: 0,
          order_numbers: [],
        });
      }

      const req = requirementMap.get(key)!;
      req.total_demand += item.quantity;

      // Track order info
      if (!req.order_numbers.includes(order.order_number)) {
        req.order_numbers.push(order.order_number);
        req.order_count++;
      }

      // Track dates
      const reqDate = order.requested_date || order.scheduled_date;
      if (reqDate) {
        if (!req.earliest_requested_date || reqDate < req.earliest_requested_date) {
          req.earliest_requested_date = reqDate;
        }
        if (!req.latest_requested_date || reqDate > req.latest_requested_date) {
          req.latest_requested_date = reqDate;
        }
      }
    }
  }

  // Fetch available inventory for non-TBD items
  const brandPackageKeys = Array.from(requirementMap.values())
    .filter((r) => !r.is_tbd && r.brand_id && r.package_type_id);

  if (brandPackageKeys.length > 0) {
    // Get finished goods availability
    const { data: inventory, error: invError } = await supabase
      .from("finished_goods_with_availability")
      .select("brand_id, package_type_id, available_quantity");

    if (invError) {
      console.error("Error fetching inventory:", invError);
    } else if (inventory) {
      for (const inv of inventory) {
        const key = `brand:${inv.brand_id}:${inv.package_type_id}`;
        const req = requirementMap.get(key);
        if (req) {
          req.available_quantity = inv.available_quantity || 0;
        }
      }
    }
  }

  // Calculate shortages
  for (const req of requirementMap.values()) {
    req.shortage = Math.max(0, req.total_demand - req.available_quantity - req.in_production);
  }

  // Sort by shortage (descending), then by date
  return Array.from(requirementMap.values()).sort((a, b) => {
    // Shortages first
    if (a.shortage !== b.shortage) return b.shortage - a.shortage;
    // Then by earliest date
    if (a.earliest_requested_date && b.earliest_requested_date) {
      return a.earliest_requested_date.localeCompare(b.earliest_requested_date);
    }
    if (a.earliest_requested_date) return -1;
    if (b.earliest_requested_date) return 1;
    return 0;
  });
}

/**
 * Get summary statistics for backward planning
 */
export async function getBackwardPlanningSummary(
  horizonWeeks = 8
): Promise<BackwardPlanningSummary> {
  const orders = await getOrderDemand(horizonWeeks);
  const requirements = await getProductionRequirements(horizonWeeks);

  let totalLineItems = 0;
  let tbdItems = 0;

  for (const order of orders) {
    totalLineItems += order.items.length;
    tbdItems += order.items.filter((i) => i.is_tbd).length;
  }

  return {
    totalOrders: orders.length,
    totalLineItems,
    tbdItems,
    shortageCount: requirements.filter((r) => r.shortage > 0).length,
    totalDemandUnits: requirements.reduce((sum, r) => sum + r.total_demand, 0),
    totalAvailable: requirements.reduce((sum, r) => sum + r.available_quantity, 0),
    totalShortage: requirements.reduce((sum, r) => sum + r.shortage, 0),
  };
}

/**
 * Format date for display
 */
export function formatPlanningDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Get product display name (handles TBD)
 */
export function getProductDisplayName(req: ProductionRequirement): string {
  return req.is_tbd
    ? `TBD: ${req.style_name ?? "Unknown Style"}`
    : req.brand_name ?? "Unknown Brand";
}
