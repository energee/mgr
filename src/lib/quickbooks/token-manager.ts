import { createAdminClient } from "@/lib/supabase/server";

interface QBOTokens {
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

  const settings = Object.fromEntries(data.map((r) => [r.key, r.value]));

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

  const settings = Object.fromEntries(data.map((r) => [r.key, r.value]));
  const clientId = settings[SETTINGS_KEYS.clientId];
  const clientSecret = settings[SETTINGS_KEYS.clientSecret];

  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export async function saveTokens(tokens: {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  expiresAt: string;
}): Promise<void> {
  const admin = await createAdminClient();

  const updates = [
    { key: SETTINGS_KEYS.accessToken, value: tokens.accessToken },
    { key: SETTINGS_KEYS.refreshToken, value: tokens.refreshToken },
    { key: SETTINGS_KEYS.realmId, value: tokens.realmId },
    { key: SETTINGS_KEYS.expiresAt, value: tokens.expiresAt },
  ];

  for (const { key, value } of updates) {
    const { error } = await admin
      .from("system_settings")
      .update({ value })
      .eq("key", key);
    if (error) throw new Error(`Failed to save ${key}: ${error.message}`);
  }
}

export async function clearTokens(): Promise<void> {
  const admin = await createAdminClient();
  const keysToNull = [
    SETTINGS_KEYS.accessToken,
    SETTINGS_KEYS.refreshToken,
    SETTINGS_KEYS.realmId,
    SETTINGS_KEYS.expiresAt,
  ];

  for (const key of keysToNull) {
    await admin.from("system_settings").update({ value: null }).eq("key", key);
  }
}

export async function isTokenExpired(): Promise<boolean> {
  const tokens = await getTokens();
  if (!tokens || !tokens.expiresAt) return true;
  return new Date(tokens.expiresAt) <= new Date();
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

/** Save QBO OAuth client credentials */
export async function saveClientCredentials(clientId: string, clientSecret: string): Promise<void> {
  const admin = await createAdminClient();

  for (const { key, value } of [
    { key: SETTINGS_KEYS.clientId, value: clientId },
    { key: SETTINGS_KEYS.clientSecret, value: clientSecret },
  ]) {
    const { error } = await admin
      .from("system_settings")
      .update({ value })
      .eq("key", key);
    if (error) throw new Error(`Failed to save ${key}: ${error.message}`);
  }
}

/** Refresh the QBO access token using the refresh token */
export async function refreshAccessToken(): Promise<{ accessToken: string; refreshToken: string }> {
  const tokens = await getTokens();
  const creds = await getClientCredentials();

  if (!tokens || !creds) {
    throw new Error("Missing QBO credentials for token refresh");
  }

  const basicAuth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");

  const response = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${errorText}`);
  }

  const data: { access_token: string; refresh_token: string; expires_in: number } =
    await response.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await saveTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    realmId: tokens.realmId,
    expiresAt,
  });

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  };
}
