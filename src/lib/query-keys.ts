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
  summary: (id: string) => ["recipes", id, "summary"] as const,
  estimates: (id: string) => ["recipes", id, "estimates"] as const,
  grainBill: (id: string) => ["recipes", id, "grain-bill"] as const,
  hopSchedule: (id: string) => ["recipes", id, "hop-schedule"] as const,
  yeasts: (id: string) => ["recipes", id, "yeasts"] as const,
  additions: (id: string) => ["recipes", id, "additions"] as const,
};

// =============================================================================
// Batch Keys
// =============================================================================

export const batchKeys = {
  all: () => ["batches"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters ? (["batches", "list", filters] as const) : (["batches", "list"] as const),
  detail: (id: string) => ["batches", id] as const,
  logs: (id: string) => ["batches", id, "logs"] as const,
  readings: (id: string) => ["batches", id, "readings"] as const,
  allocations: (id: string) => ["batches", id, "allocations"] as const,
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
};

export const settingsKeys = {
  all: () => ["settings"] as const,
  system: () => ["settings", "system"] as const,
  enums: () => ["settings", "enums"] as const,
  enumValues: (enumType: string) => ["settings", "enums", enumType] as const,
};

// =============================================================================
// Report Keys
// =============================================================================

export const reportKeys = {
  ttb: (period?: { year: number; month: number }) =>
    period ? (["reports", "ttb", period] as const) : (["reports", "ttb"] as const),
  inventory: () => ["reports", "inventory"] as const,
  production: () => ["reports", "production"] as const,
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
  table: (table: string) => ["catalog", table] as const,
  items: (type: string) => ["catalog-items", type] as const,
};

// =============================================================================
// Purchase Order Keys
// =============================================================================

export const purchaseOrderKeys = {
  all: () => ["purchase-orders"] as const,
  detail: (id: string) => ["purchase-order", id] as const,
  lineItems: (poId: string) => ["po-line-items", poId] as const,
  lineItemsForReceive: (poId: string) => ["po-line-items-for-receive", poId] as const,
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
