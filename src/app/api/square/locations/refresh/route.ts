/**
 * Square Locations Refresh (Milestone C3)
 *
 * POST: Pull the seller's Square business locations (Square `locations.list`)
 * and upsert them into square_locations. These rows populate the bin entity's
 * Square-location picker (Milestone C6): a bin becomes a POS sync target by
 * pairing a bins.square_location_id with a bins.pos_sales_channel_id.
 *
 * Upsert-only: a location removed in Square is left in place. It may still be
 * referenced by a bin, and a stale row is harmless (the picker shows it; sync
 * still targets whatever Square id is configured). Deletion is out of scope.
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/server";
import { listSquareLocations } from "@/integrations/square/client";
import { requireSquareClient } from "@/integrations/square/route-helpers";

export const POST = withPermission("integrations:manage", async () => {
  const guard = await requireSquareClient();
  if (!guard.ok) return guard.response;
  const client = guard.client;

  let locations;
  try {
    locations = await listSquareLocations(client);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list Square locations";
    return errorResponse("SYNC_FAILED", message, undefined, 502);
  }

  if (locations.length === 0) {
    return successResponse({ count: 0, locations: [] });
  }

  const admin = await createAdminClient();
  const syncedAt = new Date().toISOString();
  const { error } = await admin
    .from("square_locations")
    .upsert(
      locations.map((l) => ({ ...l, synced_at: syncedAt })),
      { onConflict: "square_location_id" }
    );

  if (error) {
    return errorResponse(
      "SYNC_FAILED",
      `Failed to save Square locations: ${error.message}`,
      undefined,
      500
    );
  }

  return successResponse({ count: locations.length, locations });
});
