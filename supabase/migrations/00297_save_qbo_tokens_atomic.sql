-- 00297_save_qbo_tokens_atomic.sql
--
-- Atomic persist for the QBO token set (#855, hardening PR #850's app-side
-- optimistic lock).
--
-- The app-side CAS in token-manager.ts had two accepted residuals:
--   * correctness was coupled to supabase-js's JSONB string encoding — the
--     PostgREST filter compared `value` against a JSON-encoded literal, so an
--     encoding change would make every CAS silently miss;
--   * the CAS + 3-row upsert were two PostgREST requests, leaving a torn
--     window where a CAS-miss reader could pick up the loser's stale access
--     token (self-healing via the client's 401-retry, but real).
--
-- This function replaces both requests with one transaction, serialized by an
-- advisory xact lock (the 00257/00293 pattern — a lock taken in a separate
-- PostgREST request would not help, since every request is its own
-- transaction). The refresh-token comparison happens DB-side with
-- `to_jsonb(text)`, so no client encoding assumption remains.
--
-- p_expected_refresh_token:
--   * non-NULL (refresh path): persist only if the stored qbo_refresh_token
--     still equals the token this refresh consumed. A mismatch — or a missing
--     row (tokens cleared mid-refresh) — writes nothing and returns FALSE:
--     a concurrent refresh already rotated the pair, and last-write-wins here
--     would strand the QBO connection with a dead pair (#840).
--   * NULL (OAuth connect/reconnect path): write unconditionally.

CREATE OR REPLACE FUNCTION save_qbo_tokens_atomic(
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_realm_id TEXT,
  p_expires_at TEXT,
  p_expected_refresh_token TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_access_token IS NULL OR p_refresh_token IS NULL
     OR p_realm_id IS NULL OR p_expires_at IS NULL THEN
    RAISE EXCEPTION 'all token fields are required' USING ERRCODE = '22023';
  END IF;

  -- Serialize concurrent QBO token persists (single global token set, so a
  -- single lock key). Held to end of transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended('qbo_tokens', 0));

  IF p_expected_refresh_token IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE key = 'qbo_refresh_token'
      AND value = to_jsonb(p_expected_refresh_token)
  ) THEN
    RETURN FALSE;
  END IF;

  INSERT INTO system_settings (key, value) VALUES
    ('qbo_access_token',     to_jsonb(p_access_token)),
    ('qbo_refresh_token',    to_jsonb(p_refresh_token)),
    ('qbo_realm_id',         to_jsonb(p_realm_id)),
    ('qbo_token_expires_at', to_jsonb(p_expires_at))
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW();

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION save_qbo_tokens_atomic(TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Atomically persists the four qbo_* system_settings rows in one transaction, serialized by an advisory xact lock. With p_expected_refresh_token set (refresh path) it is a DB-side compare-and-swap against the stored refresh token: a mismatch writes nothing and returns FALSE (#840/#855). SECURITY INVOKER and service_role-only.';

REVOKE ALL ON FUNCTION save_qbo_tokens_atomic(TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION save_qbo_tokens_atomic(TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;
