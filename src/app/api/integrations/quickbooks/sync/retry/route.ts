/**
 * QuickBooks Sync - Retry Failed
 *
 * POST: Retries a failed sync from the sync log.
 * Body: { syncLogId: string }
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/server";
import {
  syncCustomer,
  syncSupplier,
  syncInvoice,
  syncBill,
  getTokens,
} from "@/integrations/quickbooks";
import type { SyncEntityType } from "@/integrations/quickbooks";

const SYNC_FUNCTIONS: Record<
  SyncEntityType,
  (id: string) => Promise<{ qboId: string; action: string }>
> = {
  customer: syncCustomer,
  supplier: syncSupplier,
  order: syncInvoice,
  purchase_order: syncBill,
};

export const POST = withPermission("integrations:manage", async (request) => {
  const tokens = await getTokens();
  if (!tokens) {
    return errorResponse(
      "VALIDATION_ERROR",
      "QuickBooks not connected",
      undefined,
      400
    );
  }

  const { syncLogId } = (await request.json()) as { syncLogId: string };
  if (!syncLogId) {
    return errorResponse(
      "VALIDATION_ERROR",
      "syncLogId is required",
      undefined,
      400
    );
  }

  const admin = await createAdminClient();
  const { data: logEntry, error } = await admin
    .from("qbo_sync_log")
    .select("entity_type, entity_id")
    .eq("id", syncLogId)
    .single();

  if (error || !logEntry) {
    return errorResponse(
      "NOT_FOUND",
      "Sync log entry not found",
      undefined,
      404
    );
  }

  const syncFn = SYNC_FUNCTIONS[logEntry.entity_type as SyncEntityType];
  if (!syncFn) {
    return errorResponse(
      "INTERNAL_ERROR",
      `Unknown entity type: ${logEntry.entity_type}`,
      undefined,
      500
    );
  }

  try {
    const result = await syncFn(logEntry.entity_id);
    return successResponse(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Retry failed";
    return errorResponse("INTERNAL_ERROR", message, undefined, 500);
  }
});
