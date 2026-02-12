/** A product to push to Square catalog */
export interface SquareSyncProduct {
  brandId: string;
  brandName: string;
  description?: string;
  /** Existing Square catalog ID (for updates) */
  squareCatalogId?: string;
  squareVersion?: bigint;
  variations: SquareSyncVariation[];
}

export interface SquareSyncVariation {
  /** Package type for packaged goods, null for draft */
  packageTypeId?: string;
  /** Keg type for draft goods, null for packaged */
  kegTypeId?: string;
  name: string; // e.g., "16oz 4-Pack", "1/2 BBL Draft"
  priceCents: number;
  /** Existing Square catalog ID */
  squareCatalogId?: string;
  squareVersion?: bigint;
}

export interface SquareSyncInventory {
  squareVariationId: string;
  squareLocationId: string;
  quantity: number; // in selling units
}

export interface SquareSyncResult {
  success: boolean;
  itemsSynced: number;
  itemsFailed: number;
  errors: Array<{ itemId: string; error: string }>;
}

export type SquareSyncType = "catalog_push" | "inventory_push" | "sale_ingest";
