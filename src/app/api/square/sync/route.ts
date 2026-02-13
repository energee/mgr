/**
 * Square Combined Sync
 *
 * POST: Runs catalog sync followed by inventory sync in sequence.
 * This is a convenience endpoint that calls the individual sync endpoints.
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";

interface SyncResponse {
  data?: unknown;
  error?: { message?: string; details?: unknown };
}

export const POST = withPermission("integrations:manage", async (request) => {
  const origin = new URL(request.url).origin;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  // Forward auth cookies
  const cookie = request.headers.get("cookie");
  if (cookie) {
    headers["cookie"] = cookie;
  }

  // 1. Run catalog sync first
  let catalogData: SyncResponse;
  try {
    const catalogRes = await fetch(`${origin}/api/square/sync/catalog`, {
      method: "POST",
      headers,
    });
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
    const inventoryRes = await fetch(`${origin}/api/square/sync/inventory`, {
      method: "POST",
      headers,
    });
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
