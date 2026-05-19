/**
 * QuickBooks Sync - Single Entity
 *
 * POST: Syncs a single entity (customer, supplier, order, purchase_order) to QBO.
 * Body: { entityType: SyncEntityType, entityId: string }
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
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

  const body = (await request.json()) as {
    entityType: SyncEntityType;
    entityId: string;
  };
  const { entityType, entityId } = body;

  if (!entityType || !entityId) {
    return errorResponse(
      "VALIDATION_ERROR",
      "entityType and entityId are required",
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

  try {
    const result = await syncFn(entityId);
    return successResponse(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return errorResponse("INTERNAL_ERROR", message, undefined, 500);
  }
});
