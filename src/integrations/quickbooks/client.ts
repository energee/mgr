import { getTokens, getClientCredentials, saveTokens } from "./token-manager";

const QBO_BASE_URLS = {
  sandbox: "https://sandbox-quickbooks.api.intuit.com",
  production: "https://quickbooks.api.intuit.com",
} as const;

const OAUTH_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const OAUTH_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

export class QBOClientError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public qboError?: unknown
  ) {
    super(message);
    this.name = "QBOClientError";
  }
}

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  // Dedup concurrent refresh attempts — only one refresh runs at a time
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const tokens = await getTokens();
      const creds = await getClientCredentials();
      if (!tokens || !creds) throw new QBOClientError("QBO not connected");

      const response = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${creds.clientId}:${creds.clientSecret}`)}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
        }),
      });

      if (!response.ok) {
        throw new QBOClientError(`Token refresh failed: ${response.status}`, response.status);
      }

      const data = await response.json();
      const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

      const { saved } = await saveTokens(
        {
          accessToken: data.access_token,
          refreshToken: data.refresh_token || tokens.refreshToken,
          realmId: tokens.realmId,
          expiresAt,
        },
        // CAS against the refresh token this refresh consumed (#840): if a
        // concurrent refresh on another instance already rotated it, keep the
        // winner's pair instead of overwriting last-write-wins.
        { expectedRefreshToken: tokens.refreshToken }
      );

      if (!saved) {
        // Lost the persist race — use the winner's stored access token; this
        // instance's pair may be invalidated by Intuit's rotation.
        const current = await getTokens();
        if (current) return current.accessToken;
      }

      return data.access_token;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// Main request function with auto-refresh and retry
async function qboRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  retryCount = 0,
  // Tracked separately from retryCount (429 rate-limit retries): a 429 retry
  // bumps retryCount before the auth guard ever runs, so gating the one
  // allowed refresh on retryCount === 0 skips it for a 401 that arrives on
  // a 429 retry — even though no refresh has actually been attempted yet.
  authRetried = false
): Promise<T> {
  const tokens = await getTokens();
  if (!tokens) throw new QBOClientError("QBO not connected");

  let accessToken = tokens.accessToken;

  // Check if token is expired, refresh if needed
  if (tokens.expiresAt && new Date(tokens.expiresAt) <= new Date()) {
    accessToken = await refreshAccessToken();
  }

  const baseUrl = QBO_BASE_URLS[tokens.environment];
  const url = `${baseUrl}/v3/company/${tokens.realmId}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Handle 401 - try refresh once
  if (response.status === 401 && !authRetried) {
    await refreshAccessToken();
    return qboRequest<T>(method, path, body, retryCount, true);
  }

  // Handle rate limiting (429)
  if (response.status === 429 && retryCount < 3) {
    const retryAfter = parseInt(response.headers.get("Retry-After") || "5", 10);
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return qboRequest<T>(method, path, body, retryCount + 1, authRetried);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    let parsed: unknown;
    try { parsed = JSON.parse(errorBody); } catch { parsed = errorBody; }
    throw new QBOClientError(
      `QBO API error ${response.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`,
      response.status,
      parsed
    );
  }

  return response.json() as Promise<T>;
}

// Public API methods
export const qboClient = {
  get: <T>(path: string) => qboRequest<T>("GET", path),
  post: <T>(path: string, body: unknown) => qboRequest<T>("POST", path, body),

  query: <T>(entityType: string, where?: string) => {
    let queryStr = `SELECT * FROM ${entityType}`;
    if (where) queryStr += ` WHERE ${where}`;
    return qboRequest<T>("GET", `/query?query=${encodeURIComponent(queryStr)}`);
  },
};

// OAuth helper for exchanging authorization code
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const creds = await getClientCredentials();
  if (!creds) throw new QBOClientError("QBO client credentials not configured");

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${creds.clientId}:${creds.clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new QBOClientError(`Token exchange failed: ${err}`, response.status);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

// Revoke token for disconnect
export async function revokeToken(): Promise<void> {
  const tokens = await getTokens();
  const creds = await getClientCredentials();
  if (!tokens || !creds) return;

  await fetch(OAUTH_REVOKE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${creds.clientId}:${creds.clientSecret}`)}`,
    },
    body: new URLSearchParams({
      token: tokens.refreshToken,
    }),
  });
}
