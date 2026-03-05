-- Atomic QBO token save functions
-- Wraps multi-row system_settings updates in transactions to prevent partial commits.

-- Save OAuth tokens atomically
CREATE OR REPLACE FUNCTION save_qbo_tokens(
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_realm_id TEXT,
  p_expires_at TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE system_settings SET value = to_jsonb(p_access_token), updated_at = now() WHERE key = 'qbo_access_token';
  UPDATE system_settings SET value = to_jsonb(p_refresh_token), updated_at = now() WHERE key = 'qbo_refresh_token';
  UPDATE system_settings SET value = to_jsonb(p_realm_id), updated_at = now() WHERE key = 'qbo_realm_id';
  UPDATE system_settings SET value = to_jsonb(p_expires_at), updated_at = now() WHERE key = 'qbo_token_expires_at';
END;
$$;

-- Clear OAuth tokens atomically
CREATE OR REPLACE FUNCTION clear_qbo_tokens()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE system_settings SET value = NULL, updated_at = now() WHERE key IN (
    'qbo_access_token', 'qbo_refresh_token', 'qbo_realm_id', 'qbo_token_expires_at'
  );
END;
$$;

-- Save client credentials atomically
CREATE OR REPLACE FUNCTION save_qbo_client_credentials(
  p_client_id TEXT,
  p_client_secret TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE system_settings SET value = to_jsonb(p_client_id), updated_at = now() WHERE key = 'qbo_client_id';
  UPDATE system_settings SET value = to_jsonb(p_client_secret), updated_at = now() WHERE key = 'qbo_client_secret';
END;
$$;
