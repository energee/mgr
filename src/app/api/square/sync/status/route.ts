/**
 * Square Sync Status
 *
 * GET: Returns the current Square integration status including:
 * - Whether integration is enabled
 * - Last sync timestamps
 * - Count of catalog mappings
 * - Recent sync log entries
 * - Count of unreconciled draft sales (drives the settings-page badge for
 *   api/square/reconcile-draft-sales — audit BD-2)
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/server";
import { updateSquareSettings } from "@/integrations/square/client";
import { getPosBins } from "@/integrations/square/route-helpers";
import { dynamicFrom } from "@/services/types";

export const GET = withPermission("integrations:manage", async () => {
  const admin = await createAdminClient();

  // 1. Get Square settings (use safe view to avoid exposing tokens)
  const { data: settings } = await admin
    .from("square_settings_safe")
    .select("is_enabled, last_catalog_sync_at, last_inventory_sync_at")
    .eq("id", "00000000-0000-0000-0000-000000000002")
    .single();

  // 2. Count catalog mappings
  const { count: catalogItemCount } = await admin
    .from("square_catalog_map")
    .select("id", { count: "exact", head: true });

  // 3. Get recent sync log entries (last 10)
  const { data: recentSyncs } = await admin
    .from("square_sync_log")
    .select("id, sync_type, items_synced, items_failed, started_at, completed_at")
    .order("started_at", { ascending: false })
    .limit(10);

  // 3b. Staged keg pours not yet converted into TTB removals (BD-2). Drives
  //     the "Reconcile draft sales" badge. dynamicFrom: reconciled_at (00240)
  //     is not in the generated types yet.
  const { count: unreconciledDraftSales } = await dynamicFrom(admin, "square_draft_sales")
    .select("id", { count: "exact", head: true })
    .is("reconciled_at", null);

  // 4. POS-config surface: bins that are outbound Square sync targets (both
  //    square_location_id and pos_sales_channel_id set), with their Square
  //    location + sales-channel names resolved for display. Names are mapped
  //    separately (square_locations has no FK from bins) rather than embedded.
  const { data: posBinRows } = await getPosBins<{
    id: string;
    name: string;
    square_location_id: string | null;
    pos_sales_channel_id: string | null;
  }>(admin, { select: "id, name, square_location_id, pos_sales_channel_id", orderBy: "name" });

  const squareLocationIds = [
    ...new Set((posBinRows ?? []).map((b) => b.square_location_id).filter((v): v is string => !!v)),
  ];
  const channelIds = [
    ...new Set((posBinRows ?? []).map((b) => b.pos_sales_channel_id).filter((v): v is string => !!v)),
  ];

  const locationNames = new Map<string, string | null>();
  if (squareLocationIds.length > 0) {
    const { data: locRows } = await admin
      .from("square_locations")
      .select("square_location_id, name")
      .in("square_location_id", squareLocationIds);
    for (const l of locRows ?? []) locationNames.set(l.square_location_id, l.name);
  }

  const channelNames = new Map<string, string>();
  if (channelIds.length > 0) {
    const { data: chanRows } = await admin
      .from("sales_channels")
      .select("id, name")
      .in("id", channelIds);
    for (const c of chanRows ?? []) channelNames.set(c.id, c.name);
  }

  const posBins = (posBinRows ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    squareLocationId: b.square_location_id,
    squareLocationName: b.square_location_id ? locationNames.get(b.square_location_id) ?? null : null,
    channelName: b.pos_sales_channel_id ? channelNames.get(b.pos_sales_channel_id) ?? null : null,
  }));

  return successResponse({
    isEnabled: settings?.is_enabled ?? false,
    lastCatalogSync: settings?.last_catalog_sync_at ?? null,
    lastInventorySync: settings?.last_inventory_sync_at ?? null,
    catalogItemCount: catalogItemCount ?? 0,
    unreconciledDraftSales: unreconciledDraftSales ?? 0,
    recentSyncs: (recentSyncs ?? []).map((s) => ({
      id: s.id,
      syncType: s.sync_type,
      itemsSynced: s.items_synced,
      itemsFailed: s.items_failed,
      startedAt: s.started_at,
      completedAt: s.completed_at,
    })),
    posBins,
  });
});

export const POST = withPermission("integrations:manage", async (request) => {
  const body = await request.json();
  const isEnabled = body?.is_enabled;

  if (typeof isEnabled !== "boolean") {
    return errorResponse(
      "VALIDATION_ERROR",
      "is_enabled must be a boolean",
      undefined,
      400
    );
  }

  await updateSquareSettings({ is_enabled: isEnabled });

  return successResponse({ is_enabled: isEnabled });
});
