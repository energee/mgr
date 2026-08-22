import { createAdminClient } from "@/lib/supabase/server";
import { dynamicRpc } from "@/services/types";

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
 * One `save_qbo_tokens_atomic` RPC (00299): all four rows commit in a single
 * transaction, serialized by an advisory xact lock. `expectedRefreshToken`
 * (the refresh path) makes it a DB-side compare-and-swap (#840): the
 * in-process single-flight guard in client.ts only dedups refreshes within
 * one serverless instance, so two instances can both refresh against Intuit
 * and race to persist. If the stored refresh token no longer matches the one
 * this refresh consumed, a concurrent refresh already persisted a newer pair
 * and this write is discarded (`saved: false`) instead of clobbering it
 * last-write-wins. Omitting `expectedRefreshToken` (the OAuth connect path)
 * writes unconditionally.
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
  const { data, error } = await dynamicRpc(admin, "save_qbo_tokens_atomic", {
    p_access_token: tokens.accessToken,
    p_refresh_token: tokens.refreshToken,
    p_realm_id: tokens.realmId,
    p_expires_at: tokens.expiresAt,
    p_expected_refresh_token: opts?.expectedRefreshToken ?? null,
  });
  if (error) throw new Error(`Failed to save QBO tokens: ${error.message}`);
  return { saved: data === true };
}

/**
 * Deletes the four token rows via clear_qbo_tokens_atomic (00299), which
 * takes the same advisory lock as the save RPC — an unserialized delete could
 * commit between the save's CAS check and its insert, resurrecting a token
 * pair Intuit has already revoked. Client credentials and environment
 * (operator configuration, no app write path) survive a disconnect.
 */
export async function clearTokens(): Promise<void> {
  const admin = await createAdminClient();
  const { error } = await dynamicRpc(admin, "clear_qbo_tokens_atomic");
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
