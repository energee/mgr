/**
 * MongoDB Integration — Sync Trigger
 *
 * POST: Triggers catalog and production sync by phase, entity, or all.
 * Body: { phase?: 1|2|3|4, entity?: string } — if neither, runs all phases.
 * Orders are spreadsheet-owned and are deliberately excluded from MongoDB
 * reconciliation. Global clean is rejected; normal sync owns cleanup scope.
 */

export const maxDuration = 60;

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { getMongoDb, closeMongoClient } from "@/integrations/mongodb/client";
import { syncAll, syncPhase, syncEntity } from "@/integrations/mongodb/sync";
import type { SyncEntityType, SyncPhase } from "@/integrations/mongodb/types";

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

    const body: unknown = await req.json().catch(() => ({}));
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("INVALID_SYNC_REQUEST", "Request body must be a JSON object.", undefined, 400);
    }

    const { phase, entity, clean } = body as Record<string, unknown>;
    if (
      (phase !== undefined && typeof phase !== "number")
      || (entity !== undefined && typeof entity !== "string")
      || (clean !== undefined && typeof clean !== "boolean")
    ) {
      return errorResponse(
        "INVALID_SYNC_REQUEST",
        "phase must be a number, entity must be a string, and clean must be a boolean.",
        undefined,
        400,
      );
    }

    const VALID_PHASES = [1, 2, 3, 4];
    const VALID_ENTITIES = [
      "suppliers", "malts", "hops", "yeasts", "beer_styles",
      "brands", "vessels", "recipes", "batches", "vessel_transfers",
      "brew_logs", "batch_logs", "packaging_sessions",
    ];

    if (phase !== undefined && !VALID_PHASES.includes(phase)) {
      return errorResponse("INVALID_PHASE", `Invalid phase: ${phase}. Valid: 1-4`, undefined, 400);
    }
    if (entity && !VALID_ENTITIES.includes(entity)) {
      return errorResponse("INVALID_ENTITY", `Invalid entity: ${entity}`, undefined, 400);
    }

    if (clean === true) {
      return errorResponse(
        "UNSAFE_CLEAN_DISABLED",
        "Global clean is disabled. Normal sync atomically reconciles only MongoDB-owned rows.",
        undefined,
        400,
      );
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

    const hasFailure = summary.totalFailed > 0
      || summary.entities.some((result) => result.errors.length > 0);
    if (hasFailure) {
      return errorResponse(
        "SYNC_PARTIAL_FAILURE",
        "MongoDB sync did not complete successfully.",
        summary,
        502,
      );
    }

    return successResponse(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse("SYNC_FAILED", message, undefined, 500);
  } finally {
    await closeMongoClient();
  }
});
