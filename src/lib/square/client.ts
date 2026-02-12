import { SquareClient } from "square";
import { createAdminClient } from "@/lib/supabase/server";

interface SquareSettings {
  accessToken: string;
  webhookSignatureKey: string | null;
  isEnabled: boolean;
  lastCatalogSyncAt: string | null;
  lastInventorySyncAt: string | null;
}

const SINGLETON_ID = "00000000-0000-0000-0000-000000000002";

/**
 * Read Square integration settings.
 *
 * Tokens are stored in system_settings (via the IntegrationKeySection UI):
 *   - "square_api_key" → accessToken
 *   - "square-webhook_api_key" → webhookSignatureKey
 *
 * Operational state (is_enabled, last sync timestamps) lives in square_settings.
 */
export async function getSquareSettings(): Promise<SquareSettings | null> {
  const admin = await createAdminClient();

  // Read tokens from system_settings (where the UI stores them)
  const { data: tokenRows } = await admin
    .from("system_settings")
    .select("key, value")
    .in("key", ["square_api_key", "square-webhook_api_key"]);

  const tokenMap = new Map(
    (tokenRows ?? []).map((r) => [r.key, r.value as string | null])
  );

  const accessToken = tokenMap.get("square_api_key");
  if (!accessToken) return null;

  // Read operational state from square_settings
  const { data: settings } = await admin
    .from("square_settings")
    .select("is_enabled, last_catalog_sync_at, last_inventory_sync_at")
    .eq("id", SINGLETON_ID)
    .single();

  return {
    accessToken,
    webhookSignatureKey: tokenMap.get("square-webhook_api_key") ?? null,
    isEnabled: settings?.is_enabled ?? false,
    lastCatalogSyncAt: settings?.last_catalog_sync_at ?? null,
    lastInventorySyncAt: settings?.last_inventory_sync_at ?? null,
  };
}

/**
 * Create a configured Square SDK client from stored settings.
 * Returns null if Square is not connected or not enabled.
 */
export async function getSquareClient(): Promise<SquareClient | null> {
  const settings = await getSquareSettings();
  if (!settings?.isEnabled) return null;

  return new SquareClient({
    token: settings.accessToken,
    environment:
      process.env.SQUARE_ENVIRONMENT === "sandbox" ? "sandbox" : "production",
  });
}

/**
 * Update specific columns on the Square settings singleton row.
 * Uses admin client to bypass RLS.
 */
export async function updateSquareSettings(
  updates: Partial<{
    is_enabled: boolean;
    last_catalog_sync_at: string;
    last_inventory_sync_at: string;
  }>
): Promise<void> {
  const admin = await createAdminClient();
  await admin
    .from("square_settings")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", SINGLETON_ID);
}
