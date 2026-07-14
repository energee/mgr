/** Applies one stored, server-authored Beer Orders preview through the atomic database RPC. */

import { withPermission } from "@/lib/api/auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/supabase/query-helpers";
import { dynamicFrom, dynamicRpc } from "@/services/types";
import { beerOrderApplySchema } from "@/integrations/beer-orders/validation";
import type { BeerOrderImportSummary } from "@/integrations/beer-orders/types";

export const POST = withPermission("integrations:manage", async (request) => {
  const parsed = beerOrderApplySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse("INVALID_RUN", "A valid preview run ID is required", parsed.error.flatten(), 400);
  }

  const admin = await createAdminClient();
  try {
    const summary = await unwrap<BeerOrderImportSummary>(
      dynamicRpc(admin, "apply_beer_order_import", { p_run_id: parsed.data.runId }),
    );
    return successResponse({ runId: parsed.data.runId, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The reconciliation could not be applied";
    const { error: auditError } = await dynamicFrom(admin, "beer_order_import_runs")
      .update({ status: "failed", error: message })
      .eq("id", parsed.data.runId)
      .eq("status", "previewed");
    return errorResponse(
      "APPLY_FAILED",
      message,
      auditError ? { auditError: auditError.message } : undefined,
      409,
    );
  }
});
