/**
 * QuickBooks Sync - Batch
 *
 * POST: Bulk sync multiple entities of the same type.
 * Body: { entityType: SyncEntityType, entityIds: string[] }
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import {
  syncCustomer,
  syncSupplier,
  syncInvoice,
  syncBill,
  getTokens,
} from "@/lib/quickbooks";
import type { SyncEntityType } from "@/lib/quickbooks";

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

  const { entityType, entityIds } = (await request.json()) as {
    entityType: SyncEntityType;
    entityIds: string[];
  };

  if (entityIds?.length > 50) {
    return errorResponse(
      "VALIDATION_ERROR",
      "entityIds[] cannot exceed 50 items",
      undefined,
      400
    );
  }

  if (!entityType || !entityIds?.length) {
    return errorResponse(
      "VALIDATION_ERROR",
      "entityType and entityIds[] are required",
      undefined,
      400
    );
  }

  const syncFn = SYNC_FUNCTIONS[entityType];
  if (!syncFn) {
    return errorResponse(
      "VALIDATION_ERROR",
      `Unknown entity type: ${entityType}`,
      undefined,
      400
    );
  }

  const results: {
    entityId: string;
    success: boolean;
    qboId?: string;
    error?: string;
  }[] = [];

  for (let i = 0; i < entityIds.length; i++) {
    const entityId = entityIds[i];
    try {
      const result = await syncFn(entityId);
      results.push({ entityId, success: true, qboId: result.qboId });
    } catch (err) {
      results.push({
        entityId,
        success: false,
        error: err instanceof Error ? err.message : "Sync failed",
      });
    }

    // Rate limit: 600ms delay between operations to stay under QBO's 100 req/min limit
    if (i < entityIds.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const errorCount = results.filter((r) => !r.success).length;

  return successResponse({
    results,
    summary: {
      total: entityIds.length,
      success: successCount,
      errors: errorCount,
    },
  });
});
