import { createAdminClient } from "@/lib/supabase/server";

type QBOTokens = {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  expiresAt: string;
  environment: "sandbox" | "production";
}

const SETTINGS_KEYS = {
  accessToken: "qbo_access_token",
  refreshToken: "qbo_refresh_token",
  realmId: "qbo_realm_id",
  expiresAt: "qbo_token_expires_at",
  environment: "qbo_environment",
  clientId: "qbo_client_id",
  clientSecret: "qbo_client_secret",
} as const;

export async function getTokens(): Promise<QBOTokens | null> {
  const admin = await createAdminClient();
  const { data, error } = await admin
    .from("system_settings")
    .select("key, value")
    .in("key", Object.values(SETTINGS_KEYS));

  if (error || !data) return null;

  const settings = Object.fromEntries(data.map((r) => [r.key, r.value as string | null]));

  const accessToken = settings[SETTINGS_KEYS.accessToken];
  const refreshToken = settings[SETTINGS_KEYS.refreshToken];
  const realmId = settings[SETTINGS_KEYS.realmId];

  if (!accessToken || !refreshToken || !realmId) return null;

  return {
    accessToken,
    refreshToken,
    realmId,
    expiresAt: settings[SETTINGS_KEYS.expiresAt] || "",
    environment: (settings[SETTINGS_KEYS.environment] as "sandbox" | "production") || "sandbox",
  };
}

export async function getClientCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
  const admin = await createAdminClient();
  const { data, error } = await admin
    .from("system_settings")
    .select("key, value")
    .in("key", [SETTINGS_KEYS.clientId, SETTINGS_KEYS.clientSecret]);

  if (error || !data) return null;

  const settings = Object.fromEntries(data.map((r) => [r.key, r.value as string | null]));
  const clientId = settings[SETTINGS_KEYS.clientId];
  const clientSecret = settings[SETTINGS_KEYS.clientSecret];

  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Persist a QBO token set.
 *
 * `expectedRefreshToken` (the refresh path) adds an optimistic lock (#840):
 * the in-process single-flight guard in client.ts only dedups refreshes within
 * one serverless instance, so two instances can both refresh against Intuit
 * and race to persist. The refresh-token row is written with a compare-and-
 * swap against the token this refresh consumed; if it no longer matches, a
 * concurrent refresh already persisted a newer pair and this write is
 * discarded (`saved: false`) instead of clobbering it last-write-wins.
 * Omitting `expectedRefreshToken` (the OAuth connect path) writes
 * unconditionally.
 */
export async function saveTokens(
  tokens: {
    accessToken: string;
    refreshToken: string;
    realmId: string;
    expiresAt: string;
  },
  opts?: { expectedRefreshToken?: string }
): Promise<{ saved: boolean }> {
  const admin = await createAdminClient();

  if (opts?.expectedRefreshToken !== undefined) {
    // tx-ok: the CAS below and the 3-row upsert after it are two PostgREST
    // requests, deliberately ordered so every crash window self-heals: the
    // refresh token (the one-shot credential) commits first, so a crash
    // before the upsert leaves an old-but-consistent access/expiry pair whose
    // next refresh reads the already-persisted new refresh token. A CAS miss
    // writes nothing.
    //
    // `value` is JSONB and supabase-js stores these tokens as JSON strings,
    // so the filter must compare against the JSON-encoded literal — a raw
    // token is not valid JSON and PostgREST would reject the cast (22P02).
    const { data, error } = await admin
      .from("system_settings")
      .update({ value: tokens.refreshToken })
      .eq("key", SETTINGS_KEYS.refreshToken)
      .eq("value", JSON.stringify(opts.expectedRefreshToken))
      .select("key");
    if (error) throw new Error(`Failed to save QBO tokens: ${error.message}`);
    if (!data || data.length === 0) return { saved: false };
  }

  const rows = [
    { key: SETTINGS_KEYS.accessToken, value: tokens.accessToken },
    { key: SETTINGS_KEYS.realmId, value: tokens.realmId },
    { key: SETTINGS_KEYS.expiresAt, value: tokens.expiresAt },
    // Refresh path: the CAS above already wrote the refresh-token row.
    ...(opts?.expectedRefreshToken === undefined
      ? [{ key: SETTINGS_KEYS.refreshToken, value: tokens.refreshToken }]
      : []),
  ];
  const { error } = await admin
    .from("system_settings")
    .upsert(rows, { onConflict: "key" });
  if (error) throw new Error(`Failed to save QBO tokens: ${error.message}`);
  return { saved: true };
}

export async function clearTokens(): Promise<void> {
  const admin = await createAdminClient();
  const { error } = await admin
    .from("system_settings")
    .delete()
    .in("key", Object.values(SETTINGS_KEYS));
  if (error) throw new Error(`Failed to clear QBO tokens: ${error.message}`);
}

export async function getAutoSyncEnabled(): Promise<boolean> {
  const admin = await createAdminClient();
  const { data } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", "qbo_auto_sync_enabled")
    .single();
  return data?.value === "true";
}
