/** Shared contracts for Beer Orders spreadsheet parsing and reconciliation. */

export type BeerOrderFormatKey = "half" | "sixtel" | "case";

export type RawBeerOrderLine = {
  beer: string;
  formatKey: BeerOrderFormatKey;
  quantity: number;
  tier: number | null;
  styleLabel: string;
};

export type RawBeerOrder = {
  sheet: string;
  customerLabel: string;
  orderDate: string;
  requestedDate: string | null;
  lines: RawBeerOrderLine[];
};

export type BeerOrderPriceMatrix = Record<
  number,
  Record<BeerOrderFormatKey, number>
>;

export type ParsedBeerOrderWorkbook = {
  orders: RawBeerOrder[];
  prices: BeerOrderPriceMatrix;
  skippedInternalBlocks: number;
  skippedInactiveBlocks: number;
};

export type BeerOrderBrandRow = {
  id: string;
  name: string;
  variant: string | null;
};

export type BeerOrderCustomerRow = {
  id: string;
  name: string;
  customer_type: string | null;
  sales_channel_id: string | null;
  price_tier_id: string | null;
};

export type BeerOrderFormatRow = {
  id: string;
  name: string;
  unit_count: number | null;
  container: { name: string | null; type: string | null } | null;
};

export type BeerOrderChannelRow = { id: string; name: string };

export type BeerOrderKegOwnerRow = {
  id: string;
  name: string;
  is_active: boolean;
};

export type ExistingBeerOrderRow = {
  id: string;
  order_number: string;
  customer_id: string | null;
  status: string;
  order_date: string;
  requested_date: string | null;
  scheduled_date: string | null;
  notes: string | null;
  is_export: boolean | null;
};

export type ExistingBeerOrderItemRow = {
  id: string;
  order_id: string;
  brand_id: string | null;
  selling_format_id: string | null;
  quantity: number;
  unit_price: number | null;
  keg_owner_id: string | null;
  notes: string | null;
};

export type SavedBeerOrderCustomerMapping = {
  source_key: string;
  source_label: string;
  customer_id: string;
};

export type SavedBeerOrderBrandMapping = {
  source_key: string;
  source_label: string;
  brand_id: string;
  distributor_tier: number | null;
};

export type BeerOrderReferenceData = {
  brands: BeerOrderBrandRow[];
  customers: BeerOrderCustomerRow[];
  formats: BeerOrderFormatRow[];
  channels: BeerOrderChannelRow[];
  kegOwners: BeerOrderKegOwnerRow[];
  existingOrders: ExistingBeerOrderRow[];
  existingItems: ExistingBeerOrderItemRow[];
  customerMappings: SavedBeerOrderCustomerMapping[];
  brandMappings: SavedBeerOrderBrandMapping[];
};

export type BeerOrderCustomerOverride = {
  customerId?: string;
  createName?: string;
};

export type BeerOrderBrandOverride = {
  brandId: string;
  tier?: number;
};

export type BeerOrderMappingOverrides = {
  customers?: Record<string, BeerOrderCustomerOverride>;
  brands?: Record<string, BeerOrderBrandOverride>;
};

export type UnresolvedBeerOrderCustomer = {
  sourceKey: string;
  sourceLabel: string;
};

export type UnresolvedBeerOrderBrand = {
  sourceKey: string;
  sourceLabel: string;
  brandId: string | null;
  requiresBrand: boolean;
  requiresTier: boolean;
};

export type PlannedBeerOrderCustomer = {
  id: string;
  name: string;
  customerType: "distributor";
  salesChannelId: string;
  priceTierId: string | null;
  isActive: true;
  notes: string;
};

export type PlannedBeerOrderCustomerMapping = {
  sourceKey: string;
  sourceLabel: string;
  customerId: string;
};

export type PlannedBeerOrderBrandMapping = {
  sourceKey: string;
  sourceLabel: string;
  brandId: string;
  distributorTier: number | null;
};

export type PlannedBeerOrderLine = {
  id: string;
  orderId: string;
  brandId: string;
  brandName: string;
  sellingFormatId: string;
  formatKey: BeerOrderFormatKey;
  quantity: number;
  tier: number;
  unitPrice: number;
  kegOwnerId: string | null;
  notes: string;
};

export type PlannedBeerOrder = {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  orderDate: string;
  requestedDate: string | null;
  notes: string;
  isExport: boolean;
  sheet: string;
  status: "draft";
  change: "create" | "update" | "unchanged";
  lines: PlannedBeerOrderLine[];
};

export type BeerOrderStaleOrder = {
  id: string;
  orderNumber: string;
  status: string;
};

export type BeerOrderImportSummary = {
  sourceOrders: number;
  sourceLines: number;
  plannedOrders: number;
  plannedLines: number;
  createdOrders: number;
  updatedOrders: number;
  unchangedOrders: number;
  customersToCreate: number;
  staleOrders: number;
  skippedInternalBlocks: number;
  skippedInactiveBlocks: number;
};

export type BeerOrderImportPlan = {
  version: 1;
  ready: boolean;
  summary: BeerOrderImportSummary;
  unresolved: {
    customers: UnresolvedBeerOrderCustomer[];
    brands: UnresolvedBeerOrderBrand[];
  };
  options: {
    customers: Array<{ id: string; name: string }>;
    brands: Array<{ id: string; name: string; variant: string | null }>;
  };
  customersToCreate: PlannedBeerOrderCustomer[];
  customerMappings: PlannedBeerOrderCustomerMapping[];
  brandMappings: PlannedBeerOrderBrandMapping[];
  orders: PlannedBeerOrder[];
  staleOrders: BeerOrderStaleOrder[];
};

export type BeerOrderImportRun = {
  id: string;
  filename: string;
  file_sha256: string;
  status: "previewed" | "applied" | "failed";
  summary: BeerOrderImportSummary;
  error: string | null;
  created_at: string;
  applied_at: string | null;
};
