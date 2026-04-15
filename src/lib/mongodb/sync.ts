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
  transformBatch,
  transformTransfer,
  transformBrewLog,
  transformOrder,
  transformOrderItem,
  transformTest,
  deriveBatchCode,
  type HopLookup,
} from "./transformers";
import type {
  MongoBatch,
  MongoBeer,
  MongoBrewLog,
  MongoHop,
  MongoMalt,
  MongoOrder,
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

/** Typical brew volume when knockout volume wasn't recorded in Mongo. */
const DEFAULT_BREW_VOLUME_BBL = 22;

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

async function buildBatchLookups(db: Db) {
  const admin = await createAdminClient();
  const mongoBatches = await db.collection<MongoBatch>("batches").find().toArray();
  const { data: pgBatches } = await dynamicFrom(admin, "batches").select("id, batch_code");

  const batchCodeToId = new Map(
    (pgBatches ?? []).map((b: { id: string; batch_code: string }) => [b.batch_code, b.id])
  );
  const mongoBatchIdToCode = new Map(
    mongoBatches.map((b) => [b._id.toString(), deriveBatchCode(b.name, b._id.toString())])
  );

  return { batchCodeToId, mongoBatchIdToCode };
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

  // Build style name→UUID lookup so brands reference existing BJCP styles
  const admin = await createAdminClient();
  const { data: existingStyles } = await dynamicFrom(admin, "beer_styles")
    .select("id, name");
  const styleNameMap = new Map(
    (existingStyles ?? []).map((s: { id: string; name: string }) => [s.name, s.id])
  );

  const docs = await db.collection<MongoBeer>("beers").find().toArray();

  // Resolve style ObjectId → style name → existing PG UUID
  const mongoStyles = await db.collection<MongoStyle>("styles").find().toArray();
  const mongoStyleNameMap = new Map(
    mongoStyles.map((s) => [s._id.toString(), s.name])
  );

  const rows = docs.map((d) => {
    const row = transformBeer(d, hopLookup);
    // Override style_id: match by name to existing BJCP style instead of deterministic UUID
    if (d.style) {
      const styleName = mongoStyleNameMap.get(d.style.toString());
      row.style_id = styleName ? (styleNameMap.get(styleName) as string ?? null) : null;
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

// =============================================================================
// Phase 3 — Production chain
// =============================================================================

async function syncBatches(): Promise<SyncResult> {
  const logId = await createSyncLog("batches", 3);
  const db = await requireMongoDb();

  const docs = await db.collection<MongoBatch>("batches").find().toArray();
  const rows = docs.map(transformBatch);

  // Deduplicate batch_codes — append suffix for collisions
  const codeCounts = new Map<string, number>();
  for (const row of rows) {
    const base = row.batch_code;
    const count = codeCounts.get(base) ?? 0;
    if (count > 0) {
      row.batch_code = `${base}-${count + 1}`;
    }
    codeCounts.set(base, count + 1);
  }

  const result = await upsertRows("batches", rows, "batch_code");

  await completeSyncLog(logId, result);
  return { entityType: "batches", phase: 3, ...result };
}

async function syncTransfers(): Promise<SyncResult> {
  const logId = await createSyncLog("vessel_transfers", 3);
  const db = await requireMongoDb();

  const { vesselNameToId, mongoVesselIdToName } = await buildVesselLookups(db);
  const { batchCodeToId, mongoBatchIdToCode } = await buildBatchLookups(db);

  const docs = await db.collection<MongoTransfer>("transfers").find().sort({ date: 1 }).toArray();
  const rows = docs.map((doc) => {
    const row = transformTransfer(doc);

    if (doc.transferFrom) {
      const fromName = mongoVesselIdToName.get(doc.transferFrom.toString());
      row.from_vessel_id = fromName ? (vesselNameToId.get(fromName) as string ?? null) : null;
    }
    const toName = mongoVesselIdToName.get(doc.transferTo.toString());
    row.to_vessel_id = toName ? (vesselNameToId.get(toName) as string ?? row.to_vessel_id) : row.to_vessel_id;

    const code = mongoBatchIdToCode.get(doc.batch.toString());
    if (code) {
      row.batch_id = (batchCodeToId.get(code) as string) ?? row.batch_id;
    }

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

  const combined = {
    synced: orderResult.synced + itemResult.synced,
    failed: orderResult.failed + itemResult.failed,
    errors: [...orderResult.errors, ...itemResult.errors],
  };

  await completeSyncLog(logId, combined);
  return { entityType: "orders", phase: 3, ...combined };
}

async function syncBrewLogs(): Promise<SyncResult> {
  const logId = await createSyncLog("brew_logs", 3);
  const db = await requireMongoDb();

  const admin = await createAdminClient();
  const { batchCodeToId, mongoBatchIdToCode } = await buildBatchLookups(db);

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

    const batchCode = mongoBatchIdToCode.get(doc.batch.toString());
    const pgBatchId = batchCode ? (batchCodeToId.get(batchCode) as string | undefined) : null;
    if (!pgBatchId) continue;

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

  const combined = {
    synced: brewLogResult.synced + junctionResult.synced,
    failed: brewLogResult.failed + junctionResult.failed,
    errors: [...brewLogResult.errors, ...junctionResult.errors],
  };

  await completeSyncLog(logId, combined);
  return { entityType: "brew_logs", phase: 3, ...combined };
}

// =============================================================================
// Phase 4 — Batch readings
// =============================================================================

async function syncBatchReadings(): Promise<SyncResult> {
  const logId = await createSyncLog("batch_logs", 4);
  const db = await requireMongoDb();

  const { batchCodeToId, mongoBatchIdToCode } = await buildBatchLookups(db);
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
      const batchCode = mongoBatchIdToCode.get(doc.batch.toString());
      const pgBatchId = batchCode ? batchCodeToId.get(batchCode) as string | undefined : null;
      if (!pgBatchId) {
        errors.push({ mongoId: doc._id.toString(), error: "batch not found in PG" });
        continue;
      }
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
// Phase orchestration
// =============================================================================

const PHASE_ENTITIES: Record<SyncPhase, Array<() => Promise<SyncResult>>> = {
  1: [syncSuppliers, syncMalts, syncHops, syncYeasts, syncStyles],
  2: [syncBrands, syncVessels],
  3: [syncBatches, syncTransfers, syncBrewLogs, syncOrders],
  4: [syncBatchReadings],
};

/** Reverse lookup: function → entity name (used in error reporting). */
const ENTITY_FN_NAMES = new Map<() => Promise<SyncResult>, string>([
  [syncSuppliers, "suppliers"], [syncMalts, "malts"], [syncHops, "hops"],
  [syncYeasts, "yeasts"], [syncStyles, "beer_styles"], [syncBrands, "brands"],
  [syncVessels, "vessels"], [syncBatches, "batches"], [syncTransfers, "vessel_transfers"],
  [syncBrewLogs, "brew_logs"], [syncOrders, "orders"], [syncBatchReadings, "batch_logs"],
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
    batches: syncBatches,
    vessel_transfers: syncTransfers,
    orders: syncOrders,
    brew_logs: syncBrewLogs,
    batch_logs: syncBatchReadings,
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
