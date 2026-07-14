/** Returns recent Beer Orders spreadsheet preview/apply audit history. */

import { withPermission } from "@/lib/api/auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/supabase/query-helpers";
import { dynamicFrom } from "@/services/types";
import type { BeerOrderImportRun } from "@/integrations/beer-orders/types";

export const GET = withPermission("integrations:manage", async () => {
  try {
    const admin = await createAdminClient();
    const runs = await unwrap<BeerOrderImportRun[]>(
      dynamicFrom(admin, "beer_order_import_runs")
        .select("id,filename,file_sha256,status,summary,error,created_at,applied_at")
        .order("created_at", { ascending: false })
        .limit(20),
    );
    return successResponse(runs);
  } catch (error) {
    return errorResponse(
      "RUN_HISTORY_FAILED",
      error instanceof Error ? error.message : "Unable to load import history",
      undefined,
      500,
    );
  }
});
