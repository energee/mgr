/**
 * Shared helpers for the Square sync/locations API routes.
 *
 * These extract byte-identical boilerplate that had drifted across the catalog,
 * inventory, status, and locations/refresh route handlers:
 *   - getPosBins        the "POS-configured bin" predicate (both
 *                       bins.square_location_id AND bins.pos_sales_channel_id set)
 *                       that was hand-written in three routes (R1).
 *   - requireSquareClient the getSquareClient() null-guard + the standard
 *                       INTEGRATION_DISABLED error response (R2).
 *   - logSyncFailure    the failed-sync catch block: insert an error row into
 *                       square_sync_log, then return a SYNC_FAILED 500 (R3).
 *
 * Keeping these in one module means the POS-target predicate and the disabled/
 * failure responses stay consistent when any of them changes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import type { SquareClient } from "square";
import type { Database } from "@/types/supabase";
import { errorResponse } from "@/lib/api/response";
import { getSquareClient } from "./client";
import type { SquareSyncType } from "./types";

/** The service-role admin client returned by createAdminClient(). */
export type AdminClient = SupabaseClient<Database>;

/**
 * Query the POS-configured bins — the single source of truth for "which bins are
 * outbound Square sync targets". A bin is a target IFF it has BOTH
 * bins.square_location_id and bins.pos_sales_channel_id set (00222 moved POS
 * config from the location to the bin).
 *
 * Callers differ only in the columns they need and the ordering column, so those
 * are parameterized. The two NOT-NULL filters are the shared invariant.
 *
 * @param admin  service-role client (bypasses RLS).
 * @param opts.select  PostgREST select string (columns the caller needs).
 * @param opts.orderBy column to order by (e.g. "id" for a stable total order that
 *                     makes downstream tie-breaks deterministic, or "name" for
 *                     display).
 * @returns the raw { data, error } — the caller decides how strict to be about
 *          the error (the sync routes throw; the status route tolerates null).
 */
export async function getPosBins<Row>(
  admin: AdminClient,
  opts: { select: string; orderBy: string }
): Promise<{ data: Row[] | null; error: { message: string } | null }> {
  const { data, error } = await admin
    .from("bins")
    .select(opts.select)
    .not("square_location_id", "is", null)
    .not("pos_sales_channel_id", "is", null)
    .order(opts.orderBy);
  return { data: data as Row[] | null, error };
}

/** Discriminated result of {@link requireSquareClient}. */
export type SquareClientGuard =
  | { ok: true; client: SquareClient }
  | { ok: false; response: NextResponse };

/**
 * Resolve the configured Square SDK client, or the standard INTEGRATION_DISABLED
 * 400 response when Square is not connected/enabled. Replaces the byte-identical
 * guard that lived in the catalog, inventory, and locations/refresh routes.
 *
 * Usage:
 *   const guard = await requireSquareClient();
 *   if (!guard.ok) return guard.response;
 *   const client = guard.client;
 */
export async function requireSquareClient(): Promise<SquareClientGuard> {
  const client = await getSquareClient();
  if (!client) {
    return {
      ok: false,
      response: errorResponse(
        "INTEGRATION_DISABLED",
        "Square integration is not connected or not enabled",
        undefined,
        400
      ),
    };
  }
  return { ok: true, client };
}

/**
 * Record a failed sync in square_sync_log and return the standard SYNC_FAILED 500.
 * Extracts the catch block shared by the catalog and inventory sync routes (they
 * differed only in sync_type).
 *
 * @returns the errorResponse the route should return.
 */
export async function logSyncFailure(
  admin: AdminClient,
  opts: {
    syncType: SquareSyncType;
    startedAt: string;
    userId: string;
    err: unknown;
  }
): Promise<NextResponse> {
  const message =
    opts.err instanceof Error ? opts.err.message : "Sync failed";

  await admin.from("square_sync_log").insert({
    sync_type: opts.syncType,
    items_synced: 0,
    items_failed: 0,
    details: { error: message, triggeredBy: opts.userId },
    started_at: opts.startedAt,
    completed_at: new Date().toISOString(),
  });

  return errorResponse("SYNC_FAILED", message, undefined, 500);
}
