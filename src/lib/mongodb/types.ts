/**
 * MongoDB Document Types
 *
 * TypeScript types for lolev-manager MongoDB documents.
 * Used by transformers to map Mongo docs to Postgres rows.
 */

import type { ObjectId } from "mongodb";

// =============================================================================
// Phase 1 — Standalone entities
// =============================================================================

export type MongoSupplier = {
  _id: ObjectId;
  name: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type MongoMalt = {
  _id: ObjectId;
  name: string;
  supplier?: ObjectId;
  weight?: number;
  color?: number;
  srm?: number;
  diastaticPower?: number;
  moisture?: number;
  protein?: number;
  yieldOnGrind?: number;
  price?: number;
  brand?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type MongoHop = {
  _id: ObjectId;
  name: string;
  alphaAcid?: number;
  betaAcid?: number;
  totalOil?: number;
  pricePerPound?: number;
  weight?: number;
  brand?: string;
  supplier?: ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export type MongoYeast = {
  _id: ObjectId;
  name: string;
  supplier?: ObjectId;
  temperatureRange?: { low?: number; high?: number };
  attenuation?: { low?: number; high?: number };
  flocculation?: string;
  alcoholTolerance?: number;
  brand?: string;
  pitchRate?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export type MongoStyle = {
  _id: ObjectId;
  name: string;
  glass?: string;
  draftPrice?: number;
  canPrice?: number;
  fourPackPrice?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

// =============================================================================
// Phase 2 — First-level dependencies
// =============================================================================

export type MongoBeer = {
  _id: ObjectId;
  name: string;
  abv?: number;
  style?: ObjectId;
  upc?: string;
  untappdUrl?: string;
  untappdRatingValue?: number;
  hops?: ObjectId[];
  description?: string;
  variant?: string;
  priceGroup?: ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export type MongoVessel = {
  _id: ObjectId;
  name: string;
  type: string;
  capacity: number;
  units: string;
  state?: string;
  currentBatch?: ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export type MongoRecipeMalt = {
  weight: number;
  malt: ObjectId;
  id?: string;
}

export type MongoRecipeHop = {
  weight: number;
  hop: ObjectId;
  boilTime?: number;
  hopTiming?: string;
  id?: string;
}

export type MongoRecipe = {
  _id: ObjectId;
  name: string;
  beer?: ObjectId;
  yeast?: ObjectId;
  style?: ObjectId;
  volume?: number;
  batchSize?: number;
  preboilBatchSize?: number;
  boilTime?: number;
  mashTemp?: number;
  targetAttenuation?: number;
  malts?: MongoRecipeMalt[];
  hops?: MongoRecipeHop[];
  cogs?: number;
  conditioningTime?: number;
  fermentationTime?: number;
  notes?: Record<string, unknown> | string;
  createdAt?: Date;
  updatedAt?: Date;
}

// =============================================================================
// Phase 3 — Production chain
// =============================================================================

export type MongoBatch = {
  _id: ObjectId;
  name?: string;
  date?: Date;
  beer?: ObjectId;
  recipe?: ObjectId;
  currentVessel?: ObjectId;
  yeastPitch?: ObjectId;
  canningDay?: ObjectId[];
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type MongoTransfer = {
  _id: ObjectId;
  date: Date;
  transferFrom?: ObjectId;
  transferTo: ObjectId;
  quantity: number;
  batch: ObjectId;
  operator?: ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export type MongoOrderProduct = {
  id?: string;
  quantity: number;
  packagingFormat?: ObjectId;
  product?: { relationTo: string; value: ObjectId };
  pricing?: { unitPrice?: number; totalPrice?: number };
  fulfillmentStatus?: string;
}

export type MongoOrder = {
  _id: ObjectId;
  date?: Date;
  customer?: ObjectId;
  customerName?: string;
  status?: string;
  type?: string;
  products?: MongoOrderProduct[];
  notes?: string;
  completedDate?: Date;
  salesChannel?: ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export type MongoBrewLog = {
  _id: ObjectId;
  batch?: ObjectId;
  recipe?: ObjectId;
  brewDate?: Date;
  events?: Array<Record<string, unknown>>;
  summary?: Record<string, unknown>;
  actualOG?: number;
  actualMashEfficiency?: number;
  notes?: string;
  strikeWater?: Record<string, unknown>;
  mashIn?: Record<string, unknown>;
  mashRest?: Record<string, unknown>;
  vorlauf?: Record<string, unknown>;
  runoff?: Record<string, unknown>;
  sparge?: Record<string, unknown>;
  boil?: Record<string, unknown>;
  whirlpool?: Record<string, unknown>;
  knockOut?: Record<string, unknown>;
  yeastPitching?: Record<string, unknown>;
  additions?: unknown[];
  hourlyChecks?: unknown[];
  createdAt?: Date;
  updatedAt?: Date;
}

// =============================================================================
// Phase 4 — Batch readings
// =============================================================================

export type MongoTest = {
  _id: ObjectId;
  batch: ObjectId;
  time: Date;
  type: string;
  temperature?: number;
  ph?: number;
  name?: string;
}

// =============================================================================
// Sync types
// =============================================================================

export type SyncPhase = 1 | 2 | 3 | 4;

export type SyncEntityType =
  | "suppliers"
  | "malts"
  | "hops"
  | "yeasts"
  | "beer_styles"
  | "brands"
  | "vessels"
  | "recipes"
  | "recipe_malts"
  | "recipe_hops"
  | "recipe_yeasts"
  | "batches"
  | "vessel_transfers"
  | "orders"
  | "order_items"
  | "brew_logs"
  | "brew_log_batches"
  | "batch_logs";

export type SyncResult = {
  entityType: SyncEntityType;
  phase: SyncPhase;
  synced: number;
  failed: number;
  errors: Array<{ mongoId: string; error: string }>;
}
