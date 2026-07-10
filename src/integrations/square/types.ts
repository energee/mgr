/** A product to push to Square catalog */
export type SquareSyncProduct = {
  brandId: string;
  brandName: string;
  description?: string;
  /** Existing Square catalog ID (for updates) */
  squareCatalogId?: string;
  squareVersion?: bigint;
  variations: SquareSyncVariation[];
}

export type SquareSyncVariation = {
  /** Selling format ID (unified identifier for all format types) */
  sellingFormatId: string;
  name: string; // e.g., "16oz 4-Pack", "1/2 BBL Draft"
  priceCents: number;
  /** Existing Square catalog ID */
  squareCatalogId?: string;
  squareVersion?: bigint;
}

export type SquareSyncInventory = {
  squareVariationId: string;
  squareLocationId: string;
  quantity: number; // in selling units
}

export type SquareSyncResult = {
  success: boolean;
  itemsSynced: number;
  itemsFailed: number;
  errors: Array<{ itemId: string; error: string }>;
}

/**
 * square_sync_log.sync_type values (CHECK constraint: 00091, relaxed in 00233).
 * catalog_push / inventory_push are MGR pushing OUT to Square; sale_ingest is a
 * sale coming IN via the payment webhook; inventory_event is Square's own
 * inventory.count.updated echo, logged for visibility only (00233 — previously
 * mislogged as inventory_push, polluting the push history).
 */
export type SquareSyncType = "catalog_push" | "inventory_push" | "sale_ingest" | "inventory_event";
