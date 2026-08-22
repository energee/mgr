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
  -- No NULL guard: value is JSONB NOT NULL, so a NULL argument fails on the
  -- column constraint; the only caller passes four typed strings.
  --
  -- Serialize concurrent QBO token persists (single global token set, so a
  -- single lock key). Held to end of transaction. An advisory lock rather
  -- than FOR UPDATE on the CAS row: both paths (refresh and connect) take it
  -- first, so there is no connect-vs-refresh row-lock ordering to deadlock.
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

-- Disconnect goes through the same lock. Without it, a delete can commit
-- between the RPC's CAS check and its INSERT, and the insert then proceeds as
-- a fresh 4-row write — resurrecting a token pair Intuit has already revoked
-- ("connected" status with dead tokens). Serialized on the advisory lock, a
-- clear lands either before the save (whose CAS then misses the deleted
-- refresh-token row and writes nothing) or after it (delete wins) — both
-- consistent.
--
-- Deliberately scoped to the four TOKEN rows: qbo_client_id /
-- qbo_client_secret / qbo_environment are operator configuration with no app
-- write path (save_qbo_client_credentials below is the only writer), so a
-- disconnect must not turn credential setup into a one-way door.
CREATE OR REPLACE FUNCTION clear_qbo_tokens_atomic()
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('qbo_tokens', 0));
  DELETE FROM system_settings
    WHERE key IN ('qbo_access_token', 'qbo_refresh_token',
                  'qbo_realm_id', 'qbo_token_expires_at');
END;
$$;

COMMENT ON FUNCTION clear_qbo_tokens_atomic() IS
  'Deletes the four qbo_* token rows under the same advisory xact lock as save_qbo_tokens_atomic, so a disconnect cannot interleave with an in-flight token persist and resurrect revoked tokens (#855). Leaves qbo_client_id / qbo_client_secret / qbo_environment configuration in place. SECURITY INVOKER and service_role-only.';

REVOKE ALL ON FUNCTION clear_qbo_tokens_atomic() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION clear_qbo_tokens_atomic() TO service_role;

-- Retire the superseded 00100 token RPCs: no app callers (audited in 00205),
-- and save_qbo_tokens does the same four-row write with no lock and no CAS —
-- leaving it in place invites the next `save_qbo_tokens` grep hit to silently
-- reintroduce the #840 race. save_qbo_client_credentials is deliberately
-- KEPT: it is the only writer for qbo_client_id/qbo_client_secret (the app
-- only reads them), so dropping it would leave no supported way to seed
-- credentials.
DROP FUNCTION IF EXISTS save_qbo_tokens(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS clear_qbo_tokens();
