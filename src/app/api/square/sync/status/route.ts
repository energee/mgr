/**
 * Square Sync Status
 *
 * GET: Returns the current Square integration status including:
 * - Whether integration is enabled
 * - Last sync timestamps
 * - Count of catalog mappings
 * - Recent sync log entries
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/server";
import { updateSquareSettings } from "@/integrations/square/client";

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

  return successResponse({
    isEnabled: settings?.is_enabled ?? false,
    lastCatalogSync: settings?.last_catalog_sync_at ?? null,
    lastInventorySync: settings?.last_inventory_sync_at ?? null,
    catalogItemCount: catalogItemCount ?? 0,
    recentSyncs: (recentSyncs ?? []).map((s) => ({
      id: s.id,
      syncType: s.sync_type,
      itemsSynced: s.items_synced,
      itemsFailed: s.items_failed,
      startedAt: s.started_at,
      completedAt: s.completed_at,
    })),
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
