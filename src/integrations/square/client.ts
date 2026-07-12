import { SquareClient } from "square";
import { createAdminClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

type SquareSettings = {
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

  // Read tokens from system_settings (where the UI stores them).
  // Read errors are logged before falling through to null/defaults (audit
  // SF-10): the null return renders as "Square not connected", so without the
  // log a transient DB error is indistinguishable from a missing token.
  const { data: tokenRows, error: tokenError } = await admin
    .from("system_settings")
    .select("key, value")
    .in("key", ["square_api_key", "square-webhook_api_key"]);
  if (tokenError) {
    logger.error(
      { err: tokenError.message },
      "Failed to read Square tokens from system_settings — treating as not connected"
    );
  }

  const tokenMap = new Map(
    (tokenRows ?? []).map((r) => [r.key, r.value as string | null])
  );

  const accessToken = tokenMap.get("square_api_key");
  if (!accessToken) return null;

  // Read operational state from square_settings
  const { data: settings, error: settingsError } = await admin
    .from("square_settings")
    .select("is_enabled, last_catalog_sync_at, last_inventory_sync_at")
    .eq("id", SINGLETON_ID)
    .single();
  if (settingsError) {
    logger.error(
      { err: settingsError.message },
      "Failed to read square_settings — defaulting to disabled"
    );
  }

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

/** A Square business location normalized for the square_locations table. */
export type SquareLocationRow = {
  square_location_id: string;
  name: string | null;
  status: string | null;
};

/**
 * List the seller's Square business locations (Square `locations.list`),
 * normalized to square_locations rows. Locations without an `id` are skipped —
 * `id` is the table's primary key. Includes inactive locations (Square returns
 * them; `status` is preserved so the UI can distinguish).
 */
export async function listSquareLocations(
  client: SquareClient
): Promise<SquareLocationRow[]> {
  const { locations } = await client.locations.list();
  return (locations ?? [])
    .filter((loc): loc is typeof loc & { id: string } => !!loc.id)
    .map((loc) => ({
      square_location_id: loc.id,
      name: loc.name ?? null,
      status: loc.status ?? null,
    }));
}

/** Columns writable on the Square settings singleton row. */
type SquareSettingsUpdate = Partial<{
  is_enabled: boolean;
  last_catalog_sync_at: string;
  last_inventory_sync_at: string;
}>;

/** Shared write for the settings singleton; returns the error message or null. */
async function writeSquareSettings(
  updates: SquareSettingsUpdate
): Promise<string | null> {
  const admin = await createAdminClient();
  const { error } = await admin
    .from("square_settings")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", SINGLETON_ID);
  return error ? error.message : null;
}

/**
 * Update specific columns on the Square settings singleton row.
 * Uses admin client to bypass RLS.
 *
 * A failed write is logged, not thrown: callers use this for last-sync-at
 * bookkeeping AFTER the sync work already succeeded, so failing the request
 * over a timestamp would be worse than a stale timestamp — but it must not be
 * silent either (observability). User-initiated writes that must not no-op
 * (e.g. the enable/disable toggle) use {@link updateSquareSettingsOrThrow}.
 */
export async function updateSquareSettings(
  updates: SquareSettingsUpdate
): Promise<void> {
  const err = await writeSquareSettings(updates);
  if (err) {
    logger.error({ err }, "Failed to update square_settings");
  }
}

/**
 * Throwing twin of {@link updateSquareSettings} for user-initiated writes
 * where a swallowed failure would be reported as success (audit IN-12: the
 * enable/disable toggle POST could no-op while returning 200). The thrown
 * error propagates to the route's withAuth handler, which converts it into a
 * 5xx error response the client toggle surfaces as a toast.
 */
export async function updateSquareSettingsOrThrow(
  updates: SquareSettingsUpdate
): Promise<void> {
  const err = await writeSquareSettings(updates);
  if (err) {
    throw new Error(`Failed to update square_settings: ${err}`);
  }
}
