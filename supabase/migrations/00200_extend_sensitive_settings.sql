-- =============================================================================
-- 00200 — Extend is_sensitive_setting() to cover integration API keys
-- =============================================================================
-- Surfaced by the PR #336 review: system_settings_select is permissive
-- (auth.uid() IS NOT NULL, 00097) and the RESTRICTIVE companion policy
-- system_settings_hide_sensitive (00099) only filtered the three qbo_* token
-- keys. That left square_api_key, square-webhook_api_key, slack_api_key,
-- quickbooks_api_key, mongodb_api_key, and the global anthropic_api_key
-- readable in plaintext by ANY authenticated client.
--
-- Safe to hide: every legitimate reader is server-side via createAdminClient()
-- (service role bypasses RLS) — the integration clients, /api/chat's global-key
-- fallback, and the settings:manage-gated GET /api/settings/api-key, which
-- returns only { hasKey, keyHint }. No client-side code selects these rows
-- (the settings/system page reads all rows but never references *_api_key
-- keys, and it already tolerates the hidden qbo_* rows).
--
-- The LIKE pattern future-proofs the policy: every integration credential
-- follows the `${id}_api_key` naming convention enforced by
-- /api/settings/api-key, so new integrations are hidden automatically.

CREATE OR REPLACE FUNCTION is_sensitive_setting(setting_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT setting_key IN ('qbo_access_token', 'qbo_refresh_token', 'qbo_client_secret')
      OR setting_key LIKE '%\_api\_key'
$$;

NOTIFY pgrst, 'reload schema';
