/**
 * MongoDB Integration — Sync Trigger
 *
 * POST: Triggers sync by phase, entity, or all.
 * Body: { phase?: 1|2|3|4, entity?: string } — if neither, runs all phases.
 */

export const maxDuration = 60;

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { getMongoDb, closeMongoClient } from "@/lib/mongodb/client";
import { syncAll, syncPhase, syncEntity } from "@/lib/mongodb/sync";
import type { SyncEntityType, SyncPhase } from "@/lib/mongodb/types";

export const POST = withPermission("integrations:manage", async (req) => {
  try {
    // Verify MongoDB is connected
    const db = await getMongoDb();
    if (!db) {
      return errorResponse(
        "MONGODB_NOT_CONNECTED",
        "MongoDB is not connected. Configure the URI in Settings → Integrations.",
        undefined,
        400
      );
    }

    const body = await req.json().catch(() => ({}));
    const { phase, entity } = body as { phase?: number; entity?: string };

    const VALID_PHASES = [1, 2, 3, 4];
    const VALID_ENTITIES = [
      "suppliers", "malts", "hops", "yeasts", "beer_styles",
      "brands", "vessels", "batches", "vessel_transfers",
      "orders", "brew_logs", "batch_readings",
    ];

    if (phase && !VALID_PHASES.includes(phase)) {
      return errorResponse("INVALID_PHASE", `Invalid phase: ${phase}. Valid: 1-4`, undefined, 400);
    }
    if (entity && !VALID_ENTITIES.includes(entity)) {
      return errorResponse("INVALID_ENTITY", `Invalid entity: ${entity}`, undefined, 400);
    }

    let results;

    if (entity) {
      const result = await syncEntity(entity as SyncEntityType);
      results = [result];
    } else if (phase) {
      results = await syncPhase(phase as SyncPhase);
    } else {
      results = await syncAll();
    }

    const summary = {
      totalSynced: results.reduce((sum, r) => sum + r.synced, 0),
      totalFailed: results.reduce((sum, r) => sum + r.failed, 0),
      entities: results.map((r) => ({
        entityType: r.entityType,
        phase: r.phase,
        synced: r.synced,
        failed: r.failed,
        errors: r.errors,
      })),
    };

    return successResponse(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse("SYNC_FAILED", message, undefined, 500);
  } finally {
    await closeMongoClient();
  }
});
