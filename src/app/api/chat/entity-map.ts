/**
 * Server-Safe Entity Map for AI Chat
 *
 * Lightweight entity metadata for the chat API route handler. Unlike the full
 * entity registry (src/entities/index.ts), this file imports NO React client
 * components, making it safe for use in server route handlers.
 *
 * The entityService only needs: name, table, viewTable, displayName,
 * displayNamePlural, searchableFields, defaultSort, and formSchema (for
 * validation). For read-only chat operations we skip formSchema.
 */

import type { EntityConfig } from "@/types/entity";
import { z } from "zod";

/**
 * Minimal entity config sufficient for entityService.list() and
 * entityService.getById(). Only includes fields the service layer reads.
 */
type ChatEntityConfig = {
  name: string;
  table: string;
  viewTable?: string;
  displayName: string;
  displayNamePlural: string;
  searchableFields?: string[];
  defaultSort?: { column: string; direction: "asc" | "desc" };
  /** Used by route.ts to build context summaries */
  detailHeader?: {
    title?: string;
    subtitle?: string;
    badge?: string;
  };
  keyFields?: string[];
}

function entry(e: ChatEntityConfig): EntityConfig<Record<string, unknown>> {
  return {
    ...e,
    domain: "production" as const,
    description: "",
    formSchema: z.object({}),
    listColumns: [],
  } as EntityConfig<Record<string, unknown>>;
}

/**
 * Server-safe entity map. Maps entity name → minimal EntityConfig.
 * Sufficient for entityService.list() and entityService.getById().
 */
export const CHAT_ENTITY_MAP = new Map<string, EntityConfig<Record<string, unknown>>>([
  ["batch", entry({
    name: "batch",
    table: "batches",
    viewTable: "batches_with_brew_info",
    displayName: "Batch",
    displayNamePlural: "Batches",
    searchableFields: ["batch_code", "name"],
    defaultSort: { column: "planned_start_date", direction: "desc" },
    detailHeader: { title: "batch_code", subtitle: "name", badge: "status" },
    // batches_with_brew_info has no recipe name column (only recipe_id).
    keyFields: ["volume_bbl", "planned_start_date", "brew_date", "current_vessel_name", "recipe_id"],
  })],
  ["recipe", entry({
    name: "recipe",
    table: "recipes",
    viewTable: "recipes_with_estimates",
    displayName: "Recipe",
    displayNamePlural: "Recipes",
    searchableFields: ["name"],
    defaultSort: { column: "name", direction: "asc" },
    detailHeader: { title: "name", badge: "status" },
    keyFields: ["volume_bbl", "est_og", "est_fg", "est_abv", "est_ibu", "est_srm"],
  })],
  ["brew_log", entry({
    name: "brew_log",
    table: "brew_logs",
    displayName: "Brew Log",
    displayNamePlural: "Brew Logs",
    searchableFields: ["brew_number"],
    defaultSort: { column: "brew_date", direction: "desc" },
    detailHeader: { title: "brew_number", badge: "status" },
    keyFields: ["brew_date"],
  })],
  ["vessel", entry({
    name: "vessel",
    table: "vessels",
    viewTable: "vessels_with_batch",
    displayName: "Vessel",
    displayNamePlural: "Vessels",
    searchableFields: ["name"],
    defaultSort: { column: "name", direction: "asc" },
    detailHeader: { title: "name", badge: "status" },
    // vessels_with_batch exposes the occupying batch's code as batch_number.
    keyFields: ["vessel_type", "capacity_bbl", "batch_number"],
  })],
  ["vessel_transfer", entry({
    name: "vessel_transfer",
    table: "vessel_transfers",
    displayName: "Vessel Transfer",
    displayNamePlural: "Vessel Transfers",
    defaultSort: { column: "transferred_at", direction: "desc" },
  })],
  ["order", entry({
    name: "order",
    table: "orders",
    displayName: "Order",
    displayNamePlural: "Orders",
    searchableFields: ["order_number"],
    defaultSort: { column: "order_date", direction: "desc" },
    detailHeader: { title: "order_number", badge: "status" },
    keyFields: ["order_date", "requested_date"],
  })],
  ["customer", entry({
    name: "customer",
    table: "customers",
    viewTable: "customers_with_order_summary",
    displayName: "Customer",
    displayNamePlural: "Customers",
    searchableFields: ["name", "contact_name"],
    defaultSort: { column: "name", direction: "asc" },
    detailHeader: { title: "name", subtitle: "customer_type" },
    keyFields: ["email", "phone", "total_orders"],
  })],
  ["supplier", entry({
    name: "supplier",
    table: "suppliers",
    displayName: "Supplier",
    displayNamePlural: "Suppliers",
    searchableFields: ["name", "contact_name"],
    defaultSort: { column: "name", direction: "asc" },
    detailHeader: { title: "name" },
    keyFields: ["contact_email", "payment_terms"],
  })],
  ["purchase_order", entry({
    name: "purchase_order",
    table: "purchase_orders",
    displayName: "Purchase Order",
    displayNamePlural: "Purchase Orders",
    searchableFields: ["po_number"],
    defaultSort: { column: "order_date", direction: "desc" },
    detailHeader: { title: "po_number", badge: "status" },
    keyFields: ["order_date", "expected_date"],
  })],
  ["packaging_session", entry({
    name: "packaging_session",
    table: "packaging_sessions",
    viewTable: "packaging_sessions_with_summary",
    displayName: "Packaging Session",
    displayNamePlural: "Packaging Sessions",
    defaultSort: { column: "session_date", direction: "desc" },
    detailHeader: { title: "session_date", badge: "status" },
  })],
  ["allocation", entry({
    name: "allocation",
    table: "allocations",
    displayName: "Allocation",
    displayNamePlural: "Allocations",
    defaultSort: { column: "created_at", direction: "desc" },
    detailHeader: { title: "lot_number", badge: "status" },
    keyFields: ["source_type", "destination_type", "quantity"],
  })],
  ["delivery", entry({
    name: "delivery",
    table: "deliveries",
    viewTable: "deliveries_with_summary",
    displayName: "Delivery",
    displayNamePlural: "Deliveries",
    searchableFields: ["delivery_number"],
    defaultSort: { column: "scheduled_date", direction: "desc" },
    detailHeader: { title: "delivery_number", badge: "status" },
    keyFields: ["scheduled_date", "driver_name"],
  })],
  ["location_transfer", entry({
    name: "location_transfer",
    table: "location_transfers",
    viewTable: "location_transfers_with_details",
    displayName: "Location Transfer",
    displayNamePlural: "Location Transfers",
    defaultSort: { column: "ship_date", direction: "desc" },
    detailHeader: { badge: "status" },
    keyFields: ["ship_date", "from_location_name", "to_location_name"],
  })],
  ["finished_good", entry({
    name: "finished_good",
    table: "finished_goods",
    viewTable: "finished_goods_with_availability",
    displayName: "Finished Good",
    displayNamePlural: "Finished Goods",
    searchableFields: ["lot_number", "brand_name"],
    defaultSort: { column: "production_date", direction: "desc" },
    detailHeader: { title: "lot_number", subtitle: "brand_name" },
    keyFields: ["available_quantity", "best_by_date"],
  })],
  ["pick_list", entry({
    name: "pick_list",
    table: "pick_lists",
    viewTable: "pick_list_details",
    displayName: "Pick List",
    displayNamePlural: "Pick Lists",
    defaultSort: { column: "generated_at", direction: "desc" },
    detailHeader: { badge: "status" },
    keyFields: ["order_number", "customer_name"],
  })],
  ["yeast_pitch", entry({
    name: "yeast_pitch",
    table: "yeast_pitches",
    // Matches the registry config; replaced yeast_pitches_with_details (00158).
    viewTable: "yeast_pitches_with_remaining",
    displayName: "Yeast Pitch",
    displayNamePlural: "Yeast Pitches",
    defaultSort: { column: "created_at", direction: "desc" },
    detailHeader: { badge: "status" },
    keyFields: ["strain_name", "generation", "estimated_viability"],
  })],
  ["yeast_strain", entry({
    name: "yeast_strain",
    // Yeast strains live in the "yeasts" table (see src/entities/yeast-strain.tsx).
    table: "yeasts",
    displayName: "Yeast Strain",
    displayNamePlural: "Yeast Strains",
    searchableFields: ["name", "product_code"],
    defaultSort: { column: "name", direction: "asc" },
    detailHeader: { title: "name", subtitle: "product_code" },
    keyFields: ["manufacturer", "type"],
  })],
  ["brand", entry({
    name: "brand",
    table: "brands",
    displayName: "Brand",
    displayNamePlural: "Brands",
    searchableFields: ["name"],
    defaultSort: { column: "name", direction: "asc" },
    detailHeader: { title: "name", subtitle: "variant" },
    keyFields: ["abv"],
  })],
  ["keg_inventory", entry({
    name: "keg_inventory",
    table: "keg_inventory",
    viewTable: "keg_inventory_with_details",
    displayName: "Keg",
    displayNamePlural: "Kegs",
    defaultSort: { column: "keg_type_name", direction: "asc" },
    detailHeader: { title: "keg_type_name", badge: "state" },
    keyFields: ["keg_owner_name", "location_name", "quantity"],
  })],
  ["keg_transaction", entry({
    name: "keg_transaction",
    table: "keg_transactions",
    displayName: "Keg Transaction",
    displayNamePlural: "Keg Transactions",
    // keg_transactions has no transaction_date column; created_at is the event time.
    defaultSort: { column: "created_at", direction: "desc" },
    detailHeader: { badge: "transaction_type" },
    keyFields: ["created_at", "quantity"],
  })],
  ["inventory_item", entry({
    name: "inventory_item",
    table: "inventory_items",
    displayName: "Inventory Item",
    displayNamePlural: "Inventory Items",
    searchableFields: ["name"],
    defaultSort: { column: "name", direction: "asc" },
    detailHeader: { title: "name", subtitle: "category" },
    keyFields: ["unit", "reorder_point"],
  })],
  ["inventory_lot", entry({
    name: "inventory_lot",
    table: "inventory_lots",
    viewTable: "inventory_lots_with_quantities",
    displayName: "Inventory Lot",
    displayNamePlural: "Inventory Lots",
    searchableFields: ["lot_number"],
    defaultSort: { column: "received_date", direction: "desc" },
    detailHeader: { title: "lot_number" },
    keyFields: ["quantity", "expiration_date"],
  })],
  ["bin", entry({
    name: "bin",
    table: "bins",
    displayName: "Bin",
    displayNamePlural: "Bins",
    searchableFields: ["name"],
    defaultSort: { column: "name", direction: "asc" },
    detailHeader: { title: "name", subtitle: "bin_type" },
  })],
  ["location", entry({
    name: "location",
    table: "locations",
    displayName: "Location",
    displayNamePlural: "Locations",
    searchableFields: ["name"],
    defaultSort: { column: "name", direction: "asc" },
    detailHeader: { title: "name", subtitle: "location_type" },
  })],
  ["beer_style", entry({
    name: "beer_style",
    table: "beer_styles",
    displayName: "Beer Style",
    displayNamePlural: "Beer Styles",
    searchableFields: ["name", "category"],
    defaultSort: { column: "name", direction: "asc" },
    detailHeader: { title: "name", subtitle: "category" },
  })],
  ["package_type", entry({
    name: "package_type",
    table: "package_types",
    displayName: "Package Type",
    displayNamePlural: "Package Types",
    searchableFields: ["name"],
    defaultSort: { column: "name", direction: "asc" },
    detailHeader: { title: "name" },
    keyFields: ["volume_oz", "container_type"],
  })],
  ["keg_type", entry({
    name: "keg_type",
    table: "keg_types",
    displayName: "Keg Type",
    displayNamePlural: "Keg Types",
    searchableFields: ["name", "code"],
    defaultSort: { column: "name", direction: "asc" },
    detailHeader: { title: "name", subtitle: "code" },
    keyFields: ["volume_bbl"],
  })],
  ["keg_owner", entry({
    name: "keg_owner",
    table: "keg_owners",
    displayName: "Keg Owner",
    displayNamePlural: "Keg Owners",
    searchableFields: ["name"],
    defaultSort: { column: "name", direction: "asc" },
    detailHeader: { title: "name" },
  })],
  ["order_item", entry({
    name: "order_item",
    table: "order_items",
    displayName: "Order Item",
    displayNamePlural: "Order Items",
    defaultSort: { column: "created_at", direction: "desc" },
  })],
  ["session_line_item", entry({
    name: "session_line_item",
    table: "session_line_items",
    displayName: "Session Line Item",
    displayNamePlural: "Session Line Items",
    defaultSort: { column: "created_at", direction: "desc" },
  })],
  ["po_line_item", entry({
    name: "po_line_item",
    table: "po_line_items",
    displayName: "PO Line Item",
    displayNamePlural: "PO Line Items",
    defaultSort: { column: "created_at", direction: "desc" },
  })],
  ["po_receive", entry({
    name: "po_receive",
    table: "po_receives",
    displayName: "PO Receive",
    displayNamePlural: "PO Receives",
    defaultSort: { column: "received_date", direction: "desc" },
    detailHeader: { title: "received_date" },
  })],
  ["sales_channel", entry({
    name: "sales_channel",
    table: "sales_channels",
    displayName: "Sales Channel",
    displayNamePlural: "Sales Channels",
    searchableFields: ["name"],
    defaultSort: { column: "name", direction: "asc" },
    detailHeader: { title: "name" },
  })],
  ["pricing_tier", entry({
    name: "pricing_tier",
    table: "pricing_tiers",
    displayName: "Pricing Tier",
    displayNamePlural: "Pricing Tiers",
    searchableFields: ["name"],
    defaultSort: { column: "name", direction: "asc" },
    detailHeader: { title: "name" },
  })],
  ["pricing_tier_price", entry({
    name: "pricing_tier_price",
    table: "pricing_tier_prices",
    displayName: "Pricing Tier Price",
    displayNamePlural: "Pricing Tier Prices",
    defaultSort: { column: "created_at", direction: "desc" },
  })],
  ["water_profile", entry({
    name: "water_profile",
    table: "water_profiles",
    displayName: "Water Profile",
    displayNamePlural: "Water Profiles",
    searchableFields: ["name", "description"],
    defaultSort: { column: "name", direction: "asc" },
    detailHeader: { title: "name" },
    keyFields: ["calcium_ppm", "sulfate_ppm", "chloride_ppm", "ph"],
  })],
  ["user_profile", entry({
    name: "user_profile",
    table: "user_profiles",
    displayName: "User",
    displayNamePlural: "Users",
    searchableFields: ["display_name", "email"],
    defaultSort: { column: "display_name", direction: "asc" },
    detailHeader: { title: "display_name", subtitle: "email", badge: "status" },
    // user_profiles stores roles as an array column, not a singular role.
    keyFields: ["roles"],
  })],
  ["enum_value", entry({
    name: "enum_value",
    table: "enum_values",
    displayName: "Enum Value",
    displayNamePlural: "Enum Values",
    searchableFields: ["label", "value"],
    defaultSort: { column: "sort_order", direction: "asc" },
    detailHeader: { title: "label", subtitle: "enum_type" },
  })],
]);
