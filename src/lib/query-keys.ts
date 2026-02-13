/**
 * Centralized Query Key Factory
 *
 * Provides type-safe query key factories for all data fetching.
 * Using a factory pattern prevents key collisions and enables
 * precise cache invalidation.
 *
 * Usage:
 *   queryKey: entityKeys.list("batches", { status: "active" })
 *   queryClient.invalidateQueries({ queryKey: entityKeys.all("batches") })
 */

// =============================================================================
// Entity Keys (for universal entity components)
// =============================================================================

export const entityKeys = {
  /** All queries for a table */
  all: (table: string) => [table] as const,

  /** List query with optional filters */
  list: (table: string, filters?: Record<string, unknown>) =>
    filters ? ([table, "list", filters] as const) : ([table, "list"] as const),

  /** Detail query for a single record */
  detail: (table: string, id: string) => [table, id] as const,

  /** Related records for a parent */
  related: (table: string, foreignKey: string, parentId: string) =>
    [table, "by", foreignKey, parentId] as const,

  /** Timeline view for a table */
  timeline: (table: string, startDate: string) =>
    [table, "list", "timeline", startDate] as const,

  /** Display values for relation fields (FK name resolution) */
  relationDisplay: (queries: { table: string; id: string }[]) =>
    ["relation-display", ...queries.map((q) => `${q.table}:${q.id}`)] as const,
};

// =============================================================================
// Dynamic Options Keys (for form select fields)
// =============================================================================

export const dynamicOptionsKeys = {
  /** All dynamic options queries */
  all: () => ["dynamic-options"] as const,

  /** Options for a specific field */
  field: (table: string, field: string) =>
    ["dynamic-options", table, field] as const,
};

// =============================================================================
// Recipe Keys
// =============================================================================

export const recipeKeys = {
  all: () => ["recipes"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters ? (["recipes", "list", filters] as const) : (["recipes", "list"] as const),
  detail: (id: string) => ["recipes", id] as const,
  byBrand: (brandId: string) => ["recipes", "by-brand", brandId] as const,
  summary: (id: string) => ["recipes", id, "summary"] as const,
  estimates: (id: string) => ["recipes", id, "estimates"] as const,
  grainBill: (id: string) => ["recipes", id, "grain-bill"] as const,
  hopSchedule: (id: string) => ["recipes", id, "hop-schedule"] as const,
  yeasts: (id: string) => ["recipes", id, "yeasts"] as const,
  additions: (id: string) => ["recipes", id, "additions"] as const,
  styleCompliance: (id: string) => ["recipe-style-compliance", id] as const,
  suggestions: (id: string) => ["recipe-suggestions", id] as const,
  cogs: (id: string) => ["recipe-cogs", id] as const,
  fermentationAdditions: (id: string) =>
    ["recipe-fermentation-additions", id] as const,
};

// =============================================================================
// Recipe Variant Keys
// =============================================================================

export const recipeVariantKeys = {
  all: ["recipe-variants"] as const,
  byRecipe: (recipeId: string) => ["recipe-variants", "by-recipe", recipeId] as const,
  detail: (id: string) => ["recipe-variants", "detail", id] as const,
  costDetail: (id: string) => ["recipe-variants", "cost-detail", id] as const,
  withCosts: (recipeId: string) => ["recipe-variants", "with-costs", recipeId] as const,
};

// =============================================================================
// Batch Keys
// =============================================================================

export const batchKeys = {
  all: () => ["batches"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters ? (["batches", "list", filters] as const) : (["batches", "list"] as const),
  detail: (id: string) => ["batches", id] as const,
  nextNumber: () => ["batches", "next-number"] as const,
  logs: (id: string) => ["batches", id, "logs"] as const,
  readings: (id: string) => ["batches", id, "readings"] as const,
  allocations: (id: string) => ["batches", id, "allocations"] as const,
  blends: (id: string) => ["batches", id, "blends"] as const,
  blendInfo: (id: string) => ["batches", id, "blend-info"] as const,
  additions: (id: string) => ["batch-additions", id] as const,
  performance: (id: string) => ["batch-performance", id] as const,
  brewLogs: (id: string) => ["batch-brew-logs", id] as const,
  availableBrewLogs: (id: string) => ["available-brew-logs", id] as const,
};

// =============================================================================
// Batch Addition Keys
// =============================================================================

export const batchAdditionKeys = {
  all: ["batch-additions"] as const,
  byBatch: (batchId: string) => ["batch-additions", "by-batch", batchId] as const,
  withCosts: (batchId: string) => ["batch-additions", "with-costs", batchId] as const,
};

// =============================================================================
// Order Keys
// =============================================================================

export const orderKeys = {
  all: () => ["orders"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters ? (["orders", "list", filters] as const) : (["orders", "list"] as const),
  detail: (id: string) => ["orders", id] as const,
  items: (id: string) => ["orders", id, "items"] as const,
  allocations: (id: string) => ["order-allocations", id] as const,
  pickList: (id: string, subKey?: string) =>
    subKey
      ? (["order-pick-list", id, subKey] as const)
      : (["order-pick-list", id] as const),
};

// =============================================================================
// Change Request Keys
// =============================================================================

export const changeRequestKeys = {
  all: () => ["change-requests"] as const,
  forOrder: (orderId: string) => ["change-requests", "for-order", orderId] as const,
  detail: (id: string) => ["change-requests", id] as const,
  items: (id: string) => ["change-requests", id, "items"] as const,
  pendingForOrder: (orderId: string) => ["change-requests", "pending", orderId] as const,
};

// =============================================================================
// Inventory Keys
// =============================================================================

export const inventoryKeys = {
  all: () => ["inventory"] as const,
  items: () => ["inventory", "items"] as const,
  lots: () => ["inventory", "lots"] as const,
  allocations: () => ["allocations"] as const,
  summary: () => ["inventory", "summary"] as const,
  overview: () => ["inventory-overview"] as const,
  finishedGoods: () => ["finished-goods"] as const,
  finishedGoodsAvailable: () => ["finished-goods-available"] as const,
};

// =============================================================================
// Customer Keys
// =============================================================================

export const customerKeys = {
  all: () => ["customers"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters ? (["customers", "list", filters] as const) : (["customers", "list"] as const),
  detail: (id: string) => ["customers", id] as const,
  orders: (id: string) => ["customers", id, "orders"] as const,
  kegBalance: (id: string) => ["customers", id, "keg-balance"] as const,
};

// =============================================================================
// User/Settings Keys
// =============================================================================

export const userKeys = {
  current: () => ["user", "current"] as const,
  preferences: () => ["user", "preferences"] as const,
  brewery: () => ["user", "brewery"] as const,
  units: () => ["user", "preferences", "units"] as const,
  full: () => ["user", "preferences", "full"] as const,
};

export const settingsKeys = {
  all: () => ["settings"] as const,
  system: () => ["settings", "system"] as const,
  enums: () => ["settings", "enums"] as const,
  enumValues: (enumType: string) => ["settings", "enums", enumType] as const,
  systemSettings: () => ["system-settings"] as const,
  pricingChannels: () => ["pricing-channels"] as const,
  pricingMatrix: (channelId?: string) =>
    channelId
      ? (["pricing-matrix", channelId] as const)
      : (["pricing-matrix"] as const),
  pricingTiers: () => ["pricing-tiers"] as const,
  pricingFormats: () => ["pricing-formats"] as const,
  notificationPreferences: () => ["notification-preferences"] as const,
  slackSettings: () => ["settings", "slack"] as const,
  slackLog: (filters?: Record<string, unknown>) =>
    filters
      ? (["settings", "slack", "log", filters] as const)
      : (["settings", "slack", "log"] as const),
};

// =============================================================================
// Report Keys
// =============================================================================

export const reportKeys = {
  ttb: (period?: { year: number; month: number }) =>
    period ? (["reports", "ttb", period] as const) : (["reports", "ttb"] as const),
  inventory: () => ["reports", "inventory"] as const,
  production: () => ["reports", "production"] as const,
  ttbBatches: (year: number, month: number) =>
    ["ttb-batches", year, month] as const,
};

// =============================================================================
// Dashboard Keys
// =============================================================================

export const dashboardKeys = {
  all: () => ["dashboard"] as const,
  batchCounts: () => ["dashboard", "batch-counts"] as const,
  activeBatches: () => ["dashboard", "active-batches"] as const,
  vessels: () => ["dashboard", "vessels"] as const,
  lowStock: () => ["dashboard", "low-stock"] as const,
  expiringLots: () => ["dashboard", "expiring-lots"] as const,
  inventorySummary: () => ["dashboard", "inventory-summary"] as const,
  sales: {
    orderCounts: () => ["dashboard", "sales", "order-counts"] as const,
    recentOrders: () => ["dashboard", "sales", "recent-orders"] as const,
    customerRevenue: () => ["dashboard", "sales", "customer-revenue"] as const,
    productMix: () => ["dashboard", "sales", "product-mix"] as const,
  },
};

// =============================================================================
// Notification Keys
// =============================================================================

export const notificationKeys = {
  all: () => ["notifications"] as const,
  unread: () => ["notifications", "unread"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters ? (["notifications", "list", filters] as const) : (["notifications", "list"] as const),
};

// =============================================================================
// Catalog Keys (for ingredient/item catalogs)
// =============================================================================

export const catalogKeys = {
  all: () => ["catalog"] as const,
  malts: () => ["malts-catalog"] as const,
  hops: () => ["hops-catalog"] as const,
  yeasts: () => ["yeasts-catalog"] as const,
  adjuncts: () => ["adjuncts-catalog"] as const,
  fruits: () => ["fruits-catalog"] as const,
  spices: () => ["spices-catalog"] as const,
  sugars: () => ["sugars-catalog"] as const,
  additives: () => ["additives-catalog"] as const,
  table: (table: string) => ["catalog", table] as const,
  items: (type: string) => ["catalog-items", type] as const,
};

// =============================================================================
// Supplier Keys
// =============================================================================

export const supplierKeys = {
  all: () => ["suppliers"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters ? (["suppliers", "list", filters] as const) : (["suppliers", "list"] as const),
  active: () => ["suppliers", "active"] as const,
  detail: (id: string) => ["suppliers", id] as const,
};

// =============================================================================
// Purchase Order Keys
// =============================================================================

export const purchaseOrderKeys = {
  all: () => ["purchase-orders"] as const,
  detail: (id: string) => ["purchase-order", id] as const,
  lineItems: (poId: string) => ["po-line-items", poId] as const,
  lineItemsForReceive: (poId: string) => ["po-line-items-for-receive", poId] as const,
  nextNumber: () => ["purchase-orders", "next-number"] as const,
  landedCost: (poId: string) => ["purchase-order", poId, "landed-cost"] as const,
};

// =============================================================================
// Yeast Keys
// =============================================================================

export const yeastKeys = {
  all: () => ["yeast-pitches"] as const,
  detail: (id: string) => ["yeast-pitches", id] as const,
  lineageRoot: (pitchId: string) => ["yeast-lineage-root", pitchId] as const,
  lineage: (rootId: string | undefined) => ["yeast-lineage", rootId] as const,
  lineageSummary: (rootId: string | undefined) => ["yeast-lineage-summary", rootId] as const,
};

// =============================================================================
// Revision History Keys
// =============================================================================

export const revisionKeys = {
  all: () => ["entity_revisions"] as const,
  forEntity: (entityType: string, entityId: string) =>
    ["entity_revisions", entityType, entityId] as const,
  forEntityCompact: (entityType: string, entityId: string) =>
    ["entity_revisions", entityType, entityId, "compact"] as const,
};

// =============================================================================
// Production Planning Keys
// =============================================================================

export const planningKeys = {
  all: () => ["planning"] as const,
  shortfalls: (options?: { includeDrafts?: boolean; horizonWeeks?: number }) =>
    options
      ? (["planning", "shortfalls", options] as const)
      : (["planning", "shortfalls"] as const),
  demandByProduct: () => ["planning", "demand-by-product"] as const,
  supplyByProduct: () => ["planning", "supply-by-product"] as const,
  batchesInProduction: () => ["planning", "batches-in-production"] as const,
  demandDetail: (brandId: string, packageTypeId: string, week: string) =>
    ["planning", "demand-detail", brandId, packageTypeId, week] as const,
  // Backward planning from orders
  orderDemand: (horizonWeeks: number) =>
    [...planningKeys.all(), "orderDemand", horizonWeeks] as const,
  productionRequirements: (horizonWeeks: number) =>
    [...planningKeys.all(), "productionRequirements", horizonWeeks] as const,
  materialRequirements: (horizonWeeks: number) =>
    [...planningKeys.all(), "materialRequirements", horizonWeeks] as const,
};

// =============================================================================
// Pick List Keys
// =============================================================================

export const pickListKeys = {
  all: () => ["pick-lists"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters ? (["pick-lists", "list", filters] as const) : (["pick-lists", "list"] as const),
  detail: (id: string) => ["pick-lists", id] as const,
  items: (pickListId: string) => ["pick-lists", pickListId, "items"] as const,
  forOrder: (orderId: string) => ["pick-lists", "for-order", orderId] as const,
};

// =============================================================================
// Purchasing/Demand Keys
// =============================================================================

export const purchasingKeys = {
  all: () => ["purchasing"] as const,
  ingredientDemand: (options?: { horizonWeeks?: number }) =>
    options
      ? (["purchasing", "ingredient-demand", options] as const)
      : (["purchasing", "ingredient-demand"] as const),
  ingredientShortfalls: (options?: { horizonWeeks?: number }) =>
    options
      ? (["purchasing", "ingredient-shortfalls", options] as const)
      : (["purchasing", "ingredient-shortfalls"] as const),
  demandSummary: () => ["purchasing", "demand-summary"] as const,
};

// =============================================================================
// Chat Keys
// =============================================================================

export const chatKeys = {
  all: () => ["chat"] as const,
  messages: () => ["chat", "messages"] as const,
};

// =============================================================================
// Brand Keys
// =============================================================================

export const brandKeys = {
  all: () => ["brands"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters
      ? (["brands", "list", filters] as const)
      : (["brands", "list"] as const),
};

// =============================================================================
// Package Type Keys
// =============================================================================

export const packageTypeKeys = {
  all: () => ["package-types"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters
      ? (["package-types", "list", filters] as const)
      : (["package-types", "list"] as const),
};

// =============================================================================
// Keg Keys
// =============================================================================

export const kegKeys = {
  fleetSummary: () => ["keg_fleet_summary"] as const,
  turnoverMetrics: () => ["keg_turnover_metrics"] as const,
  agingReport: () => ["keg_aging_report"] as const,
  customerBalances: (customerId?: string) =>
    customerId
      ? (["customer_keg_balances", customerId] as const)
      : (["customer_keg_balances"] as const),
  ownerDeposits: (ownerId: string) =>
    ["keg_owner_deposits", ownerId] as const,
};

// =============================================================================
// Brew Log Keys
// =============================================================================

export const brewLogKeys = {
  all: () => ["brew_logs"] as const,
  detail: (id: string) => ["brew_logs", id] as const,
  batches: (id: string) => ["brew_log_batches", id] as const,
  batchesForCompletion: (id: string) => ["brew_log_batches", id, "completion"] as const,
};

// =============================================================================
// Session Line Item Keys
// =============================================================================

export const sessionLineItemKeys = {
  all: (sessionId: string) => ["session-line-items", sessionId] as const,
};

// =============================================================================
// Packaging Keys
// =============================================================================

export const packagingKeys = {
  batchesForBrand: (brandId: string) =>
    ["packaging", "batches-for-brand", brandId] as const,
};

// =============================================================================
// Packaging Format Keys (union of package_types + keg_types)
// =============================================================================

export const packagingFormatKeys = {
  all: () => ["packaging-formats"] as const,
};

// =============================================================================
// Vessel Keys
// =============================================================================

export const vesselKeys = {
  all: () => ["vessels"] as const,
  available: () => ["vessels", "available"] as const,
  availableForCompletion: () => ["vessels", "available", "completion"] as const,
  transfers: () => ["vessel_transfers"] as const,
};

// =============================================================================
// Bin Keys
// =============================================================================

export const binKeys = {
  all: () => ["bins"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters ? (["bins", "list", filters] as const) : (["bins", "list"] as const),
  detail: (id: string) => ["bins", id] as const,
  contents: (binId: string) => ["bins", binId, "contents"] as const,
};

// =============================================================================
// Transfer Keys
// =============================================================================

export const transferKeys = {
  all: () => ["transfers"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters
      ? (["transfers", "list", filters] as const)
      : (["transfers", "list"] as const),
  detail: (id: string) => ["transfers", id] as const,
  lines: (transferId: string) => ["transfers", transferId, "lines"] as const,
};

// =============================================================================
// Delivery Keys
// =============================================================================

export const deliveryKeys = {
  all: () => ["deliveries"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters
      ? (["deliveries", "list", filters] as const)
      : (["deliveries", "list"] as const),
  detail: (id: string) => ["deliveries", id] as const,
  stops: (deliveryId: string) =>
    ["deliveries", deliveryId, "stops"] as const,
};

// =============================================================================
// Portal Keys (customer portal)
// =============================================================================

export const portalKeys = {
  all: () => ["portal"] as const,
  orders: (customerIds: string[]) => ["portal", "orders", ...customerIds] as const,
  cutoff: (orderId: string) => ["portal", "cutoff", orderId] as const,
};

// =============================================================================
// Finished Good Keys
// =============================================================================

export const finishedGoodKeys = {
  all: () => ["finished-goods"] as const,
  brandAvailability: () => ["finished-goods", "brand-availability"] as const,
  availability: (brandId: string, packageTypeId: string) =>
    ["finished-goods", "availability", brandId, packageTypeId] as const,
  binInventory: (fgId: string) => ["finished-goods", fgId, "bins"] as const,
  commitments: (fgId: string) =>
    ["finished-goods", fgId, "commitments"] as const,
};

// =============================================================================
// Permission Keys
// =============================================================================

export const permissionKeys = {
  all: () => ["permissions"] as const,
  current: () => ["permissions", "current"] as const,
};

// =============================================================================
// QuickBooks Integration Keys
// =============================================================================

export const qboKeys = {
  all: () => ["qbo"] as const,
  status: () => ["qbo", "status"] as const,
  syncStatus: (entityType: string, entityId: string) =>
    ["qbo", "sync-status", entityType, entityId] as const,
  syncLog: (filters?: Record<string, unknown>) =>
    filters
      ? (["qbo", "sync-log", filters] as const)
      : (["qbo", "sync-log"] as const),
  accounts: () => ["qbo", "accounts"] as const,
  accountMappings: () => ["qbo", "account-mappings"] as const,
};

// =============================================================================
// Square Integration Keys
// =============================================================================

export const squareKeys = {
  all: () => ["square"] as const,
  settings: () => ["square", "settings"] as const,
  syncStatus: () => ["square", "sync-status"] as const,
  catalogMap: () => ["square", "catalog-map"] as const,
  syncLog: (filters?: Record<string, unknown>) =>
    filters
      ? (["square", "sync-log", filters] as const)
      : (["square", "sync-log"] as const),
  draftSales: (locationId?: string) =>
    locationId
      ? (["square", "draft-sales", locationId] as const)
      : (["square", "draft-sales"] as const),
};
