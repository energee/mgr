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
  /**
   * Price to publish, in cents. `null` omits price_money from the pushed
   * object — used when PRESERVING a mapped variation whose live Square object
   * has no fixed price (e.g. VARIABLE_PRICING), so the push cannot invent one.
   */
  priceCents: number | null;
  /**
   * Square pricing type to publish; defaults to FIXED_PRICING. Set from the
   * live object when preserving a mapped-but-locally-unpriced variation
   * (see the catalog route: omitting a mapped variation from the batch upsert
   * would DELETE it on Square, since the upsert replaces the full variation set).
   */
  pricingType?: "FIXED_PRICING" | "VARIABLE_PRICING";
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
 * square_sync_log.sync_type values (CHECK constraint: 00091, relaxed in 00233
 * 00241, and 00243). catalog_push / inventory_push are MGR pushing OUT to
 * Square; sale_ingest is a sale coming IN via the payment webhook;
 * inventory_event is Square's own inventory.count.updated echo, logged for
 * visibility only (00233 — previously mislogged as inventory_push, polluting
 * the push history); refund_ingest is a refund coming IN via the refund
 * webhook, reversing a previously ingested sale (00241, audit IN-3);
 * draft_reconcile is a run of api/square/reconcile-draft-sales converting
 * staged keg pours into TTB taproom_sale removals (00243 — audit BD-2).
 */
export type SquareSyncType =
  | "catalog_push"
  | "inventory_push"
  | "sale_ingest"
  | "inventory_event"
  | "refund_ingest"
  | "draft_reconcile";
