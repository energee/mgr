/**
 * Square Combined Sync
 *
 * POST: Runs catalog sync followed by inventory sync in sequence by invoking
 * the sibling route handlers directly as functions with the caller's request.
 *
 * No HTTP self-fetch (audit SEC-1): an earlier version fetched
 * `${new URL(request.url).origin}/api/square/sync/{catalog,inventory}` with the
 * caller's cookie forwarded. `request.url` derives from the incoming Host
 * header, so on a deployment that doesn't strictly validate Host a spoofed
 * header could send the loopback call — admin session cookie included — to an
 * attacker-chosen origin. Direct invocation removes the derived origin (and
 * the loopback HTTP hop) entirely; each sibling handler still runs its own
 * withPermission gate against the same request, so auth semantics are
 * unchanged.
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { POST as catalogSync } from "./catalog/route";
import { POST as inventorySync } from "./inventory/route";

type SyncResponse = {
  data?: unknown;
  error?: { message?: string; details?: unknown };
}

export const POST = withPermission("integrations:manage", async (request) => {
  // 1. Run catalog sync first
  let catalogData: SyncResponse;
  try {
    const catalogRes = await catalogSync(request);
    catalogData = await catalogRes.json();

    if (!catalogRes.ok) {
      return errorResponse(
        "CATALOG_SYNC_FAILED",
        catalogData.error?.message ?? "Catalog sync failed",
        catalogData.error?.details,
        catalogRes.status
      );
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Catalog sync request failed";
    return errorResponse("CATALOG_SYNC_FAILED", message, undefined, 500);
  }

  // 2. Run inventory sync
  let inventoryData: SyncResponse;
  try {
    const inventoryRes = await inventorySync(request);
    inventoryData = await inventoryRes.json();

    if (!inventoryRes.ok) {
      // Return partial success -- catalog succeeded but inventory failed
      return successResponse({
        catalog: catalogData.data,
        inventory: {
          success: false,
          error: inventoryData.error?.message ?? "Inventory sync failed",
        },
      });
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Inventory sync request failed";
    return successResponse({
      catalog: catalogData.data,
      inventory: { success: false, error: message },
    });
  }

  return successResponse({
    catalog: catalogData.data,
    inventory: inventoryData.data,
  });
});
