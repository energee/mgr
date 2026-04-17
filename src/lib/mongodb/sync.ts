/**
 * MongoDB Sync Orchestrator
 *
 * Coordinates phased sync from MongoDB to PostgreSQL.
 * Each phase runs entities in dependency order with FK validation.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { dynamicFrom } from "@/services/types";
import { logger } from "@/lib/logger";
import { type Db } from "mongodb";
import { getMongoDb } from "./client";
import { objectIdToUuid } from "./id";
import {
  transformSupplier,
  transformMalt,
  transformHop,
  transformYeast,
  transformStyle,
  transformBeer,
  transformVessel,
  transformRecipe,
  transformBatch,
  transformTransfer,
  transformBrewLog,
  transformOrder,
  transformOrderItem,
  transformPackagingSession,
  transformTest,
  type HopLookup,
} from "./transformers";
import type {
  MongoBatch,
  MongoBeer,
  MongoBrewLog,
  MongoFormat,
  MongoHop,
  MongoMalt,
  MongoOrder,
  MongoPackagingSession,
  MongoRecipe,
  MongoStyle,
  MongoSupplier,
  MongoTest,
  MongoTransfer,
  MongoVessel,
  MongoYeast,
  SyncEntityType,
  SyncPhase,
  SyncResult,
} from "./types";

/** Merge multiple partial sync results into one. */
function mergeResults(...parts: Array<{ synced: number; failed: number; errors: Array<{ mongoId: string; error: string }> }>) {
  return {
    synced: parts.reduce((s, p) => s + p.synced, 0),
    failed: parts.reduce((s, p) => s + p.failed, 0),
    errors: parts.flatMap((p) => p.errors),
  };
}

/** Typical brew volume when knockout volume wasn't recorded in Mongo. */
const DEFAULT_BREW_VOLUME_BBL = 22;

const HOP_TIMING_MAP: Record<string, string> = {
  boil: "boil", whirlpool: "whirlpool", "dry-hop": "dry_hop",
  dryHop: "dry_hop", firstWort: "first_wort", mash: "mash",
};

// =============================================================================
// Sync log helpers
// =============================================================================

async function createSyncLog(entityType: SyncEntityType, phase: SyncPhase): Promise<string> {
  const admin = await createAdminClient();
  const { data, error } = await dynamicFrom(admin, "mongodb_sync_log")
    .insert({ entity_type: entityType, phase, status: "pending" })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create sync log: ${error.message}`);
  return data.id;
}

async function completeSyncLog(
  logId: string,
  result: Pick<SyncResult, "synced" | "failed" | "errors">
) {
  const admin = await createAdminClient();
  await dynamicFrom(admin, "mongodb_sync_log")
    .update({
      status: result.failed > 0 ? "error" : "success",
      records_synced: result.synced,
      records_failed: result.failed,
      error_details: result.errors.length > 0 ? result.errors : null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", logId);
}

// =============================================================================
// Generic upsert helper
// =============================================================================

async function upsertRows(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string = "id"
): Promise<{ synced: number; failed: number; errors: Array<{ mongoId: string; error: string }> }> {
  if (rows.length === 0) return { synced: 0, failed: 0, errors: [] };

  const admin = await createAdminClient();
  const BATCH_SIZE = 50;
  let synced = 0;
  let failed = 0;
  const errors: Array<{ mongoId: string; error: string }> = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await dynamicFrom(admin, table)
      .upsert(batch, { onConflict, ignoreDuplicates: false });

    if (error) {
      logger.error("Upsert error for %s batch %d: %s", table, i / BATCH_SIZE, error.message);
      failed += batch.length;
      errors.push({
        mongoId: `batch-${i / BATCH_SIZE}`,
        error: error.message,
      });
    } else {
      synced += batch.length;
    }
  }

  return { synced, failed, errors };
}

async function requireMongoDb(): Promise<Db> {
  const db = await getMongoDb();
  if (!db) throw new Error("MongoDB not connected");
  return db;
}

// =============================================================================
// Shared lookup builders (avoid duplicating across sync functions)
// =============================================================================

async function buildSupplierNameMap(db: Db): Promise<Map<string, string>> {
  const suppliers = await db.collection<MongoSupplier>("suppliers").find().toArray();
  return new Map(suppliers.map((s) => [s._id.toString(), s.name]));
}

/** Resolve MongoDB style ObjectIds → PG beer_styles UUIDs (case-insensitive name match). */
async function buildStyleLookup(db: Db): Promise<Map<string, string>> {
  const admin = await createAdminClient();
  const { data: existingStyles } = await dynamicFrom(admin, "beer_styles").select("id, name");

  const byExact = new Map(
    (existingStyles ?? []).map((s: { id: string; name: string }) => [s.name, s.id])
  );
  const byLower = new Map(
    (existingStyles ?? []).map((s: { id: string; name: string }) => [s.name.toLowerCase(), s.id])
  );

  const mongoStyles = await db.collection<MongoStyle>("styles").find().toArray();
  const result = new Map<string, string>();
  const unmatched: string[] = [];

  for (const ms of mongoStyles) {
    const pgId = (byExact.get(ms.name) ?? byLower.get(ms.name.toLowerCase())) as string | undefined;
    if (pgId) {
      result.set(ms._id.toString(), pgId);
    } else {
      unmatched.push(ms.name);
    }
  }
  if (unmatched.length > 0) {
    logger.warn("Unmatched MongoDB styles: %s", unmatched.join(", "));
  }

  return result;
}

async function buildVesselLookups(db: Db) {
  const admin = await createAdminClient();
  const mongoVessels = await db.collection<MongoVessel>("vessels").find().toArray();
  const { data: pgVessels } = await dynamicFrom(admin, "vessels").select("id, name");

  const vesselNameToId = new Map(
    (pgVessels ?? []).map((v: { id: string; name: string }) => [v.name, v.id])
  );
  const mongoVesselIdToName = new Map(
    mongoVessels.map((v) => [v._id.toString(), v.name])
  );

  return { vesselNameToId, mongoVesselIdToName };
}

// =============================================================================
// Phase 1 — Standalone entities
// =============================================================================

async function syncSuppliers(): Promise<SyncResult> {
  const logId = await createSyncLog("suppliers", 1);
  const db = await requireMongoDb();

  const docs = await db.collection<MongoSupplier>("suppliers").find().toArray();
  const rows = docs.map(transformSupplier);
  const result = await upsertRows("suppliers", rows);

  await completeSyncLog(logId, result);
  return { entityType: "suppliers", phase: 1, ...result };
}

async function syncMalts(): Promise<SyncResult> {
  const logId = await createSyncLog("malts", 1);
  const db = await requireMongoDb();

  const supplierNameMap = await buildSupplierNameMap(db);
  const docs = await db.collection<MongoMalt>("malts").find().toArray();
  const rows = docs.map((d) => transformMalt(d, supplierNameMap));
  const result = await upsertRows("malts", rows);

  await completeSyncLog(logId, result);
  return { entityType: "malts", phase: 1, ...result };
}

async function syncHops(): Promise<SyncResult> {
  const logId = await createSyncLog("hops", 1);
  const db = await requireMongoDb();

  const docs = await db.collection<MongoHop>("hops").find().toArray();
  const rows = docs.map(transformHop);
  const result = await upsertRows("hops", rows);

  await completeSyncLog(logId, result);
  return { entityType: "hops", phase: 1, ...result };
}

async function syncYeasts(): Promise<SyncResult> {
  const logId = await createSyncLog("yeasts", 1);
  const db = await requireMongoDb();

  const supplierNameMap = await buildSupplierNameMap(db);
  const docs = await db.collection<MongoYeast>("yeasts").find().toArray();
  const rows = docs.map((d) => transformYeast(d, supplierNameMap));
  const result = await upsertRows("yeasts", rows);

  await completeSyncLog(logId, result);
  return { entityType: "yeasts", phase: 1, ...result };
}

async function syncStyles(): Promise<SyncResult> {
  const logId = await createSyncLog("beer_styles", 1);
  const db = await requireMongoDb();

  const docs = await db.collection<MongoStyle>("styles").find().toArray();
  const rows = docs.map(transformStyle);
  // Match by name to preserve existing BJCP-seeded UUIDs
  const result = await upsertRows("beer_styles", rows, "name");

  await completeSyncLog(logId, result);
  return { entityType: "beer_styles", phase: 1, ...result };
}

// =============================================================================
// Phase 2 — First-level dependencies
// =============================================================================

async function syncBrands(): Promise<SyncResult> {
  const logId = await createSyncLog("brands", 2);
  const db = await requireMongoDb();

  // Build hop lookup for brand.hops JSONB
  const hops = await db.collection<MongoHop>("hops").find().toArray();
  const hopLookup: HopLookup = new Map(
    hops.map((h) => [
      h._id.toString(),
      { uuid: objectIdToUuid(h._id.toString()), name: h.name },
    ])
  );

  const mongoStyleIdToPgId = await buildStyleLookup(db);

  const docs = await db.collection<MongoBeer>("beers").find().toArray();

  const rows = docs.map((d) => {
    const row = transformBeer(d, hopLookup);
    if (d.style) {
      row.style_id = mongoStyleIdToPgId.get(d.style.toString()) ?? null;
    }
    return row;
  });
  const result = await upsertRows("brands", rows, "name");

  await completeSyncLog(logId, result);
  return { entityType: "brands", phase: 2, ...result };
}

async function syncVessels(): Promise<SyncResult> {
  const logId = await createSyncLog("vessels", 2);
  const db = await requireMongoDb();

  const docs = await db.collection<MongoVessel>("vessels").find().toArray();
  const rows = docs.map(transformVessel);
  const result = await upsertRows("vessels", rows, "name");

  await completeSyncLog(logId, result);
  return { entityType: "vessels", phase: 2, ...result };
}

async function syncRecipes(): Promise<SyncResult> {
  const logId = await createSyncLog("recipes", 2);
  const db = await requireMongoDb();
  const admin = await createAdminClient();

  const mongoStyleIdToPgId = await buildStyleLookup(db);

  // Build brand name lookup
  const { data: pgBrands } = await dynamicFrom(admin, "brands").select("id, name");
  const brandNameToId = new Map(
    (pgBrands ?? []).map((b: { id: string; name: string }) => [b.name, b.id])
  );
  const mongoBeers = await db.collection<MongoBeer>("beers").find().toArray();
  const mongoBeerIdToName = new Map(mongoBeers.map((b) => [b._id.toString(), b.name]));

  const docs = await db.collection<MongoRecipe>("recipes").find().toArray();

  // Delete all existing recipes and re-insert (no UNIQUE(name) constraint on recipes table)
  await dynamicFrom(admin, "recipe_malts").delete().gte("created_at", "1970-01-01");
  await dynamicFrom(admin, "recipe_hops").delete().gte("created_at", "1970-01-01");
  await dynamicFrom(admin, "recipe_yeasts").delete().gte("created_at", "1970-01-01");
  await dynamicFrom(admin, "recipes").delete().gte("created_at", "1970-01-01");

  const recipeRows = docs.map((d) => {
    const row = transformRecipe(d);
    // Resolve style FK
    if (d.style) {
      (row as Record<string, unknown>).style_id = mongoStyleIdToPgId.get(d.style.toString()) ?? null;
    }
    // Resolve brand FK
    if (d.beer) {
      const beerName = mongoBeerIdToName.get(d.beer.toString());
      (row as Record<string, unknown>).brand_id = beerName ? (brandNameToId.get(beerName) as string ?? null) : null;
    }
    return row;
  });
  const recipeResult = await upsertRows("recipes", recipeRows);

  // Build recipe name → PG UUID lookup for junction tables
  const { data: pgRecipes } = await dynamicFrom(admin, "recipes").select("id, name");
  const recipeNameToId = new Map(
    (pgRecipes ?? []).map((r: { id: string; name: string }) => [r.name, r.id])
  );

  // Resolve malt/hop/yeast FKs via name lookup
  const { data: pgMalts } = await dynamicFrom(admin, "malts").select("id, name");
  const maltNameToId = new Map((pgMalts ?? []).map((m: { id: string; name: string }) => [m.name, m.id]));
  const mongoMalts = await db.collection<MongoMalt>("malts").find().toArray();
  const mongoMaltIdToName = new Map(mongoMalts.map((m) => [m._id.toString(), m.name]));

  const { data: pgHops } = await dynamicFrom(admin, "hops").select("id, name");
  const hopNameToId = new Map((pgHops ?? []).map((h: { id: string; name: string }) => [h.name, h.id]));
  const mongoHops = await db.collection<MongoHop>("hops").find().toArray();
  const mongoHopIdToName = new Map(mongoHops.map((h) => [h._id.toString(), h.name]));

  const { data: pgYeasts } = await dynamicFrom(admin, "yeasts").select("id, name");
  const yeastNameToId = new Map((pgYeasts ?? []).map((y: { id: string; name: string }) => [y.name, y.id]));
  const mongoYeasts = await db.collection<MongoYeast>("yeasts").find().toArray();
  const mongoYeastIdToName = new Map(mongoYeasts.map((y) => [y._id.toString(), y.name]));

  // Build direct Mongo ObjectId → PG UUID maps for ingredient FKs
  const mongoMaltIdToPgId = new Map<string, string>();
  for (const [mongoId, name] of mongoMaltIdToName) {
    const pgId = maltNameToId.get(name) as string | undefined;
    if (pgId) mongoMaltIdToPgId.set(mongoId, pgId);
  }
  const mongoHopIdToPgId = new Map<string, string>();
  for (const [mongoId, name] of mongoHopIdToName) {
    const pgId = hopNameToId.get(name) as string | undefined;
    if (pgId) mongoHopIdToPgId.set(mongoId, pgId);
  }
  const mongoYeastIdToPgId = new Map<string, string>();
  for (const [mongoId, name] of mongoYeastIdToName) {
    const pgId = yeastNameToId.get(name) as string | undefined;
    if (pgId) mongoYeastIdToPgId.set(mongoId, pgId);
  }

  // Build junction rows with resolved PG UUIDs
  const maltRows: Record<string, unknown>[] = [];
  const hopRows: Record<string, unknown>[] = [];
  const yeastRows: Record<string, unknown>[] = [];

  for (const doc of docs) {
    const pgRecipeId = recipeNameToId.get(doc.name) as string | undefined;
    if (!pgRecipeId) continue;

    let maltPos = 0;
    for (const m of doc.malts ?? []) {
      const pgMaltId = mongoMaltIdToPgId.get(m.malt.toString());
      if (!pgMaltId) continue;
      maltRows.push({
        recipe_id: pgRecipeId,
        malt_id: pgMaltId,
        weight_lbs: m.weight,
        position: maltPos++,
      });
    }

    let hopPos = 0;
    for (const h of doc.hops ?? []) {
      const pgHopId = mongoHopIdToPgId.get(h.hop.toString());
      if (!pgHopId) continue;
      hopRows.push({
        recipe_id: pgRecipeId,
        hop_id: pgHopId,
        weight_oz: Math.round(h.weight * 16 * 100) / 100,
        timing: HOP_TIMING_MAP[h.hopTiming ?? "boil"] ?? "boil",
        boil_time_min: h.boilTime ?? null,
        position: hopPos++,
      });
    }

    if (doc.yeast) {
      const pgYeastId = mongoYeastIdToPgId.get(doc.yeast.toString());
      if (pgYeastId) {
        yeastRows.push({
          recipe_id: pgRecipeId,
          yeast_id: pgYeastId,
          is_primary: true,
          position: 0,
        });
      }
    }
  }

  // Junction tables were already deleted above — plain insert, not upsert
  const maltResult = await upsertRows("recipe_malts", maltRows);
  const hopResult = await upsertRows("recipe_hops", hopRows);
  const yeastResult = await upsertRows("recipe_yeasts", yeastRows);

  const combined = mergeResults(recipeResult, maltResult, hopResult, yeastResult);
  await completeSyncLog(logId, combined);
  return { entityType: "recipes", phase: 2, ...combined };
}

// =============================================================================
// Phase 3 — Production chain
// =============================================================================

async function syncBatches(): Promise<SyncResult> {
  const logId = await createSyncLog("batches", 3);
  const db = await requireMongoDb();
  const admin = await createAdminClient();

  // Build recipe lookups: MongoDB recipe ObjectId → PG recipe UUID + volume.
  // Recipes use auto-generated UUIDs (not deterministic), so we resolve by name.
  const [mongoRecipes, pgRecipesResult] = await Promise.all([
    db.collection<MongoRecipe>("recipes").find().toArray(),
    dynamicFrom(admin, "recipes").select("id, name"),
  ]);
  const pgRecipeNameToId = new Map(
    (pgRecipesResult.data ?? []).map((r: { id: string; name: string }) => [r.name, r.id])
  );

  const mongoRecipeIdToPgId = new Map<string, string>();
  const mongoRecipeIdToVolume = new Map<string, number>();
  const unmatchedRecipes: string[] = [];
  for (const r of mongoRecipes) {
    const mongoId = r._id.toString();
    const pgId = pgRecipeNameToId.get(r.name) as string | undefined;
    if (pgId) mongoRecipeIdToPgId.set(mongoId, pgId);
    else unmatchedRecipes.push(r.name);
    const volume = r.batchSize ?? r.volume;
    if (volume != null) mongoRecipeIdToVolume.set(mongoId, volume);
  }
  if (unmatchedRecipes.length > 0) {
    logger.warn("Unmatched MongoDB recipes: %s", unmatchedRecipes.join(", "));
  }

  const docs = await db.collection<MongoBatch>("batches").find().toArray();
  const rows = docs.map((d) => {
    const row = transformBatch(d);
    if (d.recipe) {
      const mongoRecipeId = d.recipe.toString();
      const pgRecipeId = mongoRecipeIdToPgId.get(mongoRecipeId);
      if (pgRecipeId) (row as Record<string, unknown>).recipe_id = pgRecipeId;
      const volume = mongoRecipeIdToVolume.get(mongoRecipeId);
      if (volume != null) (row as Record<string, unknown>).volume_bbl = volume;
    }
    return row;
  });

  // Deduplicate batch_codes within this batch to avoid UNIQUE constraint
  // violations on INSERT (same-named MongoDB batches derive the same code).
  // The UUID `id` conflict target ensures idempotency across sync runs —
  // batch_code can safely be rewritten by the generate_batch_code trigger.
  const codeCounts = new Map<string, number>();
  for (const row of rows) {
    const base = row.batch_code;
    const count = codeCounts.get(base) ?? 0;
    if (count > 0) {
      row.batch_code = `${base}-${count + 1}`;
    }
    codeCounts.set(base, count + 1);
  }

  const result = await upsertRows("batches", rows, "id");

  await completeSyncLog(logId, result);
  return { entityType: "batches", phase: 3, ...result };
}

async function syncTransfers(): Promise<SyncResult> {
  const logId = await createSyncLog("vessel_transfers", 3);
  const db = await requireMongoDb();

  const { vesselNameToId, mongoVesselIdToName } = await buildVesselLookups(db);

  const docs = await db.collection<MongoTransfer>("transfers").find().sort({ date: 1 }).toArray();
  const rows = docs.map((doc) => {
    const row = transformTransfer(doc);

    if (doc.transferFrom) {
      const fromName = mongoVesselIdToName.get(doc.transferFrom.toString());
      row.from_vessel_id = fromName ? (vesselNameToId.get(fromName) as string ?? null) : null;
    }
    const toName = mongoVesselIdToName.get(doc.transferTo.toString());
    row.to_vessel_id = toName ? (vesselNameToId.get(toName) as string ?? row.to_vessel_id) : row.to_vessel_id;

    row.batch_id = objectIdToUuid(doc.batch.toString());

    return row;
  });
  const result = await upsertRows("vessel_transfers", rows);

  await completeSyncLog(logId, result);
  return { entityType: "vessel_transfers", phase: 3, ...result };
}

async function syncOrders(): Promise<SyncResult> {
  const logId = await createSyncLog("orders", 3);
  const db = await requireMongoDb();

  const docs = await db.collection<MongoOrder>("orders").find().sort({ date: 1 }).toArray();

  // Sync orders
  const orderRows = docs.map((d) => transformOrder(d));
  const orderResult = await upsertRows("orders", orderRows, "order_number");

  // Build order_number → PG UUID lookup for order_items FK resolution
  const admin2 = await createAdminClient();
  const { data: pgOrders } = await dynamicFrom(admin2, "orders").select("id, order_number");
  const orderNumberToId = new Map(
    (pgOrders ?? []).map((o: { id: string; order_number: string }) => [o.order_number, o.id])
  );

  // Build Mongo beer ObjectId → PG brand UUID lookup
  const mongoBeers = await db.collection<MongoBeer>("beers").find().toArray();
  const { data: pgBrands } = await dynamicFrom(admin2, "brands").select("id, name");
  const brandNameToId = new Map(
    (pgBrands ?? []).map((b: { id: string; name: string }) => [b.name, b.id])
  );
  const mongoBeerIdToName = new Map(
    mongoBeers.map((b) => [b._id.toString(), b.name])
  );

  // Sync order items using PG order UUIDs and brand UUIDs
  const itemRows = docs.flatMap((doc, orderIdx) => {
    const orderNumber = orderRows[orderIdx]?.order_number;
    const pgOrderId = orderNumber ? (orderNumberToId.get(orderNumber) as string | undefined) : null;
    if (!pgOrderId) return [];
    return (doc.products ?? []).map((product, itemIdx) => {
      const row = transformOrderItem(product, pgOrderId, doc._id.toString(), itemIdx);
      // Resolve brand_id via name lookup
      if (product.product?.value) {
        const beerName = mongoBeerIdToName.get(product.product.value.toString());
        row.brand_id = beerName ? (brandNameToId.get(beerName) as string ?? null) : null;
      }
      return row;
    });
  });

  let itemResult = { synced: 0, failed: 0, errors: [] as Array<{ mongoId: string; error: string }> };
  if (itemRows.length > 0) {
    // Delete existing order_items for synced orders, then insert fresh
    const syncedOrderIds = orderRows
      .map((r) => orderNumberToId.get(r.order_number) as string | undefined)
      .filter(Boolean) as string[];
    if (syncedOrderIds.length > 0) {
      await dynamicFrom(admin2, "order_items")
        .delete()
        .in("order_id", syncedOrderIds);
    }
    itemResult = await upsertRows("order_items", itemRows);
  }

  const combined = mergeResults(orderResult, itemResult);
  await completeSyncLog(logId, combined);
  return { entityType: "orders", phase: 3, ...combined };
}

async function syncBrewLogs(): Promise<SyncResult> {
  const logId = await createSyncLog("brew_logs", 3);
  const db = await requireMongoDb();

  const admin = await createAdminClient();

  const docs = await db.collection<MongoBrewLog>("brew-logs").find().sort({ brewDate: 1 }).toArray();

  // Transform brew logs
  const brewLogRows = docs.map((d) => transformBrewLog(d));
  const brewLogResult = await upsertRows("brew_logs", brewLogRows, "brew_number");

  // Build brew_number → PG brew_log UUID lookup for junction table
  const { data: pgBrewLogs } = await dynamicFrom(admin, "brew_logs").select("id, brew_number");
  const brewNumberToId = new Map(
    (pgBrewLogs ?? []).map((bl: { id: string; brew_number: string }) => [bl.brew_number, bl.id])
  );

  // Create brew_log_batches junction entries
  const junctionRows: Record<string, unknown>[] = [];
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    if (!doc.batch) continue;

    const brewNumber = brewLogRows[i].brew_number;
    const pgBrewLogId = brewNumberToId.get(brewNumber) as string | undefined;
    if (!pgBrewLogId) continue;

    const pgBatchId = objectIdToUuid(doc.batch.toString());

    // Use knockOut volume if available, otherwise estimate from batch
    const volume = (doc.knockOut as Record<string, unknown>)?.volumeKO as number ?? 0;

    junctionRows.push({
      brew_log_id: pgBrewLogId,
      batch_id: pgBatchId,
      volume_bbl: volume || DEFAULT_BREW_VOLUME_BBL,
    });
  }

  // Delete existing junction entries for these brew logs, then insert
  const syncedBrewLogIds = junctionRows.map((r) => r.brew_log_id as string);
  if (syncedBrewLogIds.length > 0) {
    await dynamicFrom(admin, "brew_log_batches")
      .delete()
      .in("brew_log_id", syncedBrewLogIds);
  }
  const junctionResult = await upsertRows("brew_log_batches", junctionRows);

  const combined = mergeResults(brewLogResult, junctionResult);
  await completeSyncLog(logId, combined);
  return { entityType: "brew_logs", phase: 3, ...combined };
}

// =============================================================================
// Phase 4 — Batch readings
// =============================================================================

async function syncBatchReadings(): Promise<SyncResult> {
  const logId = await createSyncLog("batch_logs", 4);
  const db = await requireMongoDb();
  const admin = await createAdminClient();

  const docs = await db.collection<MongoTest>("tests").find().sort({ time: 1 }).toArray();
  const rows: Record<string, unknown>[] = [];
  const errors: Array<{ mongoId: string; error: string }> = [];

  for (const doc of docs) {
    try {
      if (!doc.batch) {
        errors.push({ mongoId: doc._id.toString(), error: "no batch reference" });
        continue;
      }
      const pgBatchId = objectIdToUuid(doc.batch.toString());
      // transformTest returns multiple rows (one per measurement type)
      const logRows = transformTest(doc);
      for (const row of logRows) {
        row.batch_id = pgBatchId;
        rows.push(row);
      }
    } catch (err) {
      errors.push({ mongoId: doc._id.toString(), error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Delete existing synced measurement logs before inserting fresh.
  // Only delete logs that look like sync-created ones (measurement type with mongo-style timestamps).
  // We use a broad delete of all measurement logs for the synced batches.
  const syncedBatchIds = [...new Set(rows.map((r) => r.batch_id as string))];
  if (syncedBatchIds.length > 0) {
    await dynamicFrom(admin, "batch_logs")
      .delete()
      .in("batch_id", syncedBatchIds)
      .eq("log_type", "measurement");
  }

  const insertResult = await upsertRows("batch_logs", rows);
  const combined = {
    synced: insertResult.synced,
    failed: insertResult.failed + errors.length,
    errors: [...insertResult.errors, ...errors.slice(0, 10)],
  };

  await completeSyncLog(logId, combined);
  return { entityType: "batch_logs", phase: 4, ...combined };
}

// =============================================================================
// Phase 4 — Packaging sessions
// =============================================================================

async function syncPackagingSessions(): Promise<SyncResult> {
  const logId = await createSyncLog("packaging_sessions", 4);
  const db = await requireMongoDb();
  const admin = await createAdminClient();

  // 1. Read and transform sessions
  const docs = await db.collection<MongoPackagingSession>("packaging-sessions")
    .find().sort({ date: 1 }).toArray();
  const sessionRows = docs.map(transformPackagingSession);
  const sessionResult = await upsertRows("packaging_sessions", sessionRows);

  // 2. Build lookups for line item FK resolution
  // Batch → beer → brand chain (to derive brand_id, which is NOT NULL)
  const mongoBatches = await db.collection<MongoBatch>("batches").find().toArray();
  const mongoBatchIdToBeer = new Map(
    mongoBatches.filter((b) => b.beer).map((b) => [b._id.toString(), b.beer!.toString()])
  );
  const mongoBeers = await db.collection<MongoBeer>("beers").find().toArray();
  const mongoBeerIdToName = new Map(mongoBeers.map((b) => [b._id.toString(), b.name]));
  const { data: pgBrands } = await dynamicFrom(admin, "brands").select("id, name");
  const brandNameToId = new Map(
    (pgBrands ?? []).map((b: { id: string; name: string }) => [b.name, b.id])
  );

  // Format lookup: MongoDB formats → PG selling_formats
  // MongoDB "formats" collection has flat names (e.g. "16oz Cans - Case of 24")
  // PG has a two-level model: containers ("16oz Can") + selling_formats ("Case of 24")
  // Try multiple matching strategies to resolve the mapping.
  const mongoFormats = await db.collection<MongoFormat>("formats").find().toArray();
  const mongoFormatIdToName = new Map(
    mongoFormats.map((f) => [f._id.toString(), f.name ?? f._id.toString()])
  );

  // Query selling_formats with their container names for composite matching
  const { data: pgFormatsRaw } = await dynamicFrom(admin, "selling_formats")
    .select("id, name, containers(name)");

  type PgFormatRow = { id: string; name: string; containers: { name: string } | null };
  const pgFormatsWithContainers = (pgFormatsRaw ?? []) as PgFormatRow[];

  // Build lookup maps for cascading match strategies
  const formatByExactName = new Map<string, string>();       // "Case of 24" → uuid
  const formatByComposite = new Map<string, string>();       // "16oz can case of 24" → uuid (lowercase)
  const formatByContainerName = new Map<string, string>();   // "1/2 barrel" → uuid (for "Per Keg" entries)

  for (const sf of pgFormatsWithContainers) {
    const containerName = sf.containers?.name ?? "";
    formatByExactName.set(sf.name, sf.id);
    // Composite: "16oz Can Case of 24", "1/2 Barrel Per Keg", etc.
    if (containerName) {
      formatByComposite.set(`${containerName} ${sf.name}`.toLowerCase(), sf.id);
    }
    // For kegs, the container name alone identifies the format
    if (sf.name === "Per Keg" && containerName) {
      formatByContainerName.set(containerName.toLowerCase(), sf.id);
    }
  }

  /** Resolve a MongoDB format name to a PG selling_format UUID using cascading match strategies. */
  function resolveSellingFormat(mongoName: string): string | null {
    // Strategy 1: exact match on selling_format.name (e.g. "Case of 24")
    const exact = formatByExactName.get(mongoName);
    if (exact) return exact;

    const lower = mongoName.toLowerCase();

    // Strategy 2: exact match on composite "container format" (e.g. "16oz Can Case of 24")
    const composite = formatByComposite.get(lower);
    if (composite) return composite;

    // Strategy 3: match on container name alone (e.g. "1/2 Barrel" for kegs)
    const container = formatByContainerName.get(lower);
    if (container) return container;

    // Strategy 4: containment — find the longest composite key that overlaps
    let bestMatch: string | null = null;
    let bestLen = 0;
    for (const [key, id] of formatByComposite) {
      if ((lower.includes(key) || key.includes(lower)) && key.length > bestLen) {
        bestMatch = id;
        bestLen = key.length;
      }
    }
    if (bestMatch) return bestMatch;

    return null;
  }

  // Pre-resolve all MongoDB format ObjectIds → PG selling_format UUIDs
  const mongoFormatIdToPgId = new Map<string, string>();
  const unmatchedFormats: string[] = [];
  for (const [mongoId, name] of mongoFormatIdToName) {
    const pgId = resolveSellingFormat(name);
    if (pgId) {
      mongoFormatIdToPgId.set(mongoId, pgId);
    } else {
      unmatchedFormats.push(name);
    }
  }
  if (unmatchedFormats.length > 0) {
    logger.warn("Unmatched MongoDB formats: %s", unmatchedFormats.join(", "));
  }

  // 3. Build line item rows from each session's products array
  const lineItems: Record<string, unknown>[] = [];
  const lineErrors: Array<{ mongoId: string; error: string }> = [];

  for (const doc of docs) {
    const pgSessionId = objectIdToUuid(doc._id.toString());
    const isCompleted = !!doc.completed;

    for (let i = 0; i < (doc.products ?? []).length; i++) {
      const product = doc.products![i]!;

      const pgBatchId = product.batch ? objectIdToUuid(product.batch.toString()) : null;

      // Resolve brand_id via batch → beer → brand chain (NOT NULL)
      let pgBrandId: string | null = null;
      if (product.batch) {
        const beerId = mongoBatchIdToBeer.get(product.batch.toString());
        if (beerId) {
          const beerName = mongoBeerIdToName.get(beerId);
          if (beerName) {
            pgBrandId = brandNameToId.get(beerName) as string ?? null;
          }
        }
      }

      if (!pgBrandId) {
        lineErrors.push({
          mongoId: doc._id.toString(),
          error: `product[${i}]: could not resolve brand_id (NOT NULL constraint)`,
        });
        continue;
      }

      // Resolve selling_format_id (nullable)
      const pgFormatId = product.packagingFormat
        ? (mongoFormatIdToPgId.get(product.packagingFormat.toString()) ?? null)
        : null;

      // Generate stable ID from session ObjectId + product index
      const itemId = product.id
        ? objectIdToUuid(product.id)
        : objectIdToUuid(`${doc._id.toString()}-product-${i}`);

      lineItems.push({
        id: itemId,
        session_id: pgSessionId,
        brand_id: pgBrandId,
        selling_format_id: pgFormatId,
        batch_id: pgBatchId,
        planned_quantity: product.quantity ?? null,
        actual_quantity: isCompleted ? (product.quantity ?? null) : null,
      });
    }
  }

  // 4. Delete existing line items for synced sessions, then insert fresh
  const syncedSessionIds = sessionRows.map((r) => r.id);
  if (syncedSessionIds.length > 0) {
    await dynamicFrom(admin, "session_line_items")
      .delete()
      .in("session_id", syncedSessionIds);
  }
  const lineResult = await upsertRows("session_line_items", lineItems);

  const combined = mergeResults(sessionResult, lineResult);
  combined.failed += lineErrors.length;
  combined.errors.push(...lineErrors.slice(0, 10));

  await completeSyncLog(logId, combined);
  return { entityType: "packaging_sessions", phase: 4, ...combined };
}

// =============================================================================
// Phase orchestration
// =============================================================================

const PHASE_ENTITIES: Record<SyncPhase, Array<() => Promise<SyncResult>>> = {
  1: [syncSuppliers, syncMalts, syncHops, syncYeasts, syncStyles],
  2: [syncBrands, syncVessels, syncRecipes],
  3: [syncBatches, syncTransfers, syncBrewLogs, syncOrders],
  4: [syncBatchReadings, syncPackagingSessions],
};

/** Reverse lookup: function → entity name (used in error reporting). */
const ENTITY_FN_NAMES = new Map<() => Promise<SyncResult>, string>([
  [syncSuppliers, "suppliers"], [syncMalts, "malts"], [syncHops, "hops"],
  [syncYeasts, "yeasts"], [syncStyles, "beer_styles"], [syncBrands, "brands"],
  [syncVessels, "vessels"], [syncRecipes, "recipes"], [syncBatches, "batches"], [syncTransfers, "vessel_transfers"],
  [syncBrewLogs, "brew_logs"], [syncOrders, "orders"], [syncBatchReadings, "batch_logs"],
  [syncPackagingSessions, "packaging_sessions"],
]);

/** Run all entities for a given phase. Continues on error so one entity failure doesn't block others. */
export async function syncPhase(phase: SyncPhase): Promise<SyncResult[]> {
  const fns = PHASE_ENTITIES[phase];
  if (!fns) throw new Error(`Invalid phase: ${phase}`);

  const results: SyncResult[] = [];
  for (const fn of fns) {
    try {
      results.push(await fn());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Sync error in phase %d: %s", phase, message);
      results.push({
        entityType: (ENTITY_FN_NAMES.get(fn) ?? "unknown") as SyncEntityType,
        phase,
        synced: 0,
        failed: 0,
        errors: [{ mongoId: "phase-error", error: message }],
      });
    }
  }
  return results;
}

/** Run a single entity sync by name. */
export async function syncEntity(entityType: SyncEntityType): Promise<SyncResult> {
  const entityFnMap: Record<string, () => Promise<SyncResult>> = {
    suppliers: syncSuppliers,
    malts: syncMalts,
    hops: syncHops,
    yeasts: syncYeasts,
    beer_styles: syncStyles,
    brands: syncBrands,
    vessels: syncVessels,
    recipes: syncRecipes,
    batches: syncBatches,
    vessel_transfers: syncTransfers,
    orders: syncOrders,
    brew_logs: syncBrewLogs,
    batch_logs: syncBatchReadings,
    packaging_sessions: syncPackagingSessions,
  };

  const fn = entityFnMap[entityType];
  if (!fn) throw new Error(`Unknown entity type: ${entityType}`);
  return fn();
}

/** Run all phases in order (1 → 2 → 3 → 4). Caller owns connection lifecycle. */
export async function syncAll(): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const phase of [1, 2, 3, 4] as SyncPhase[]) {
    const phaseResults = await syncPhase(phase);
    results.push(...phaseResults);
  }
  return results;
}
