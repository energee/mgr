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

export type SquareSyncType = "catalog_push" | "inventory_push" | "sale_ingest";
