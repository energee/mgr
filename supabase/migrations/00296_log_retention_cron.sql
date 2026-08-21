-- Migration: 00296_log_retention_cron.sql
-- Schema audit 2026-08-21 (docs/plans/2026-08-21-schema-audit.md, H5):
-- no log table was ever pruned. cleanup_old_notifications() has existed since
-- 00020 but was scheduled nowhere; the sync/notification log family and
-- entity_revisions grew unbounded.
--
-- One retention function covers the log family:
--   p_log_days (default 90):       square_sync_log, qbo_sync_log,
--                                  mongodb_sync_log, slack_notification_log,
--                                  email_notification_log
--   p_revision_days (default 365): entity_revisions (full before/after JSONB
--                                  per write — the longer window keeps a year
--                                  of audit trail)
-- plus a schedule for the existing cleanup_old_notifications(90).
--
-- Patterns: pg_cron guards from 00272/00281 (extension may be absent in CI
-- replays / local Postgres); service-role lock from 00247.

-- =============================================================================
-- 0. Capture email_notification_log into the chain (live↔chain drift, audit H6
--    class — same capture remedy as 00199/00285)
-- =============================================================================
-- The table exists on live (00190's SECURITY DEFINER email writers INSERT and
-- UPDATE it) but no migration ever created it, so a from-scratch replay
-- shipped a broken email pipeline — and this migration's retention DELETE
-- would have needed a permanent runtime existence check. Captured here so the
-- DELETE below can be static like the other five tables.
--
-- Shape is from src/types/supabase.ts (generated from live). Policy bodies
-- are byte-exact against live: supabase/live-catalog.snapshot.txt stores
-- md5(qual || '~' || with_check) per policy, and the hashes below compute
-- directly:
--   "Authenticated users can read email log" ec053f581ef5aa2dba3dff1f99a6b444
--       = md5('true~')      -> FOR SELECT TO authenticated USING (true)
--   "System can insert email log"            a452132919de0eeb842df6c4e1d34ac4
--       = md5('~true')      -> FOR INSERT WITH CHECK (true)
--   "System can update email log"            8a32db1846a8702d3d2030fce42c09d4
--       = md5('true~true')  -> FOR UPDATE USING (true) WITH CHECK (true)
--   current_user_enabled                     ee25f986535267ddf4e1e2b6b68f44f7
--       = the 00255 restrictive-gate loop form
-- Policies are created only when absent, so live's policy md5s are untouched
-- and the drift watchdog stays quiet. The permissive `true` bodies are kept
-- byte-exact deliberately: the only writers are SECURITY DEFINER functions
-- (which bypass RLS anyway) and rows carry no secrets — tightening live RLS
-- here would be a separate, deliberate change, not a capture.
CREATE TABLE IF NOT EXISTS public.email_notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  notification_type TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_notification_log IS
  'Delivery log for the notify_all_users -> send-email Edge Function pipeline (00190). One row per attempted email; status: pending/sent/failed/skipped.';

ALTER TABLE public.email_notification_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'email_notification_log'
      AND policyname = 'Authenticated users can read email log'
  ) THEN
    EXECUTE $pol$
      -- check-permissive-rls: skip byte-exact live capture (see header); delivery log holds no secrets
      CREATE POLICY "Authenticated users can read email log"
        ON public.email_notification_log
        FOR SELECT TO authenticated
        USING (true)
    $pol$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'email_notification_log'
      AND policyname = 'System can insert email log'
  ) THEN
    EXECUTE $pol$
      -- check-permissive-rls: skip byte-exact live capture (see header); writers are SECURITY DEFINER and bypass RLS regardless
      CREATE POLICY "System can insert email log"
        ON public.email_notification_log
        FOR INSERT
        WITH CHECK (true)
    $pol$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'email_notification_log'
      AND policyname = 'System can update email log'
  ) THEN
    EXECUTE $pol$
      -- check-permissive-rls: skip byte-exact live capture (see header); writers are SECURITY DEFINER and bypass RLS regardless
      CREATE POLICY "System can update email log"
        ON public.email_notification_log
        FOR UPDATE
        USING (true)
        WITH CHECK (true)
    $pol$;
  END IF;

  -- Disabled-account gate (00255 pattern): every RLS-enabled public table
  -- carries this restrictive policy.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'email_notification_log'
      AND policyname = 'current_user_enabled'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY current_user_enabled
        ON public.email_notification_log
        AS RESTRICTIVE
        FOR ALL
        TO authenticated
        USING ((SELECT current_user_is_enabled()))
        WITH CHECK ((SELECT current_user_is_enabled()))
    $pol$;
  END IF;
END $$;

-- RLS-exception markers (00198 pattern): the rls-coverage integration test
-- requires every permissive policy to carry a COMMENT ON POLICY starting with
-- 'RLS-EXCEPTION:'. Comments live outside pg_policies, so the drift watchdog
-- is unaffected. Safe unconditionally — the DO block above guarantees the
-- policies exist.
COMMENT ON POLICY "Authenticated users can read email log" ON public.email_notification_log IS
  'RLS-EXCEPTION: email delivery log readable by any authenticated staff user; rows carry no secrets (recipient/subject/status only).';
COMMENT ON POLICY "System can insert email log" ON public.email_notification_log IS
  'RLS-EXCEPTION: rows are written only by SECURITY DEFINER functions in the notify_all_users pipeline, which bypass RLS regardless; policy kept byte-exact with live capture.';
COMMENT ON POLICY "System can update email log" ON public.email_notification_log IS
  'RLS-EXCEPTION: status updates come only from SECURITY DEFINER functions in the notify_all_users pipeline, which bypass RLS regardless; policy kept byte-exact with live capture.';

-- Schema registry entry (AGENTS.md: required for every table). DO NOTHING so
-- a row already present on live is preserved untouched.
INSERT INTO public._schema_registry (table_name, description, domain, relationships)
VALUES (
  'email_notification_log',
  'Delivery log for the notify_all_users -> send-email pipeline; one row per attempted email with status and error detail.',
  'system',
  '[{"type":"belongsTo","target":"auth.users","fk":"user_id"}]'
)
ON CONFLICT (table_name) DO NOTHING;

-- =============================================================================
-- 1. Retention function
-- =============================================================================
-- SECURITY DEFINER so the service role can invoke it manually without table
-- privileges; locked to service_role below (00247 pattern). The nightly
-- pg_cron job runs as the job owner (postgres) and is unaffected.
-- Bulk retention DELETE across six log tables whose RLS deliberately blocks
-- app-role deletes; EXECUTE is REVOKEd from PUBLIC/anon/authenticated and
-- granted only to service_role; returns only deleted counts.
-- security-definer: justified — service-role-locked retention sweep over RLS-protected log tables; returns counts only
CREATE OR REPLACE FUNCTION public.prune_log_tables(
  p_log_days INT DEFAULT 90,
  p_revision_days INT DEFAULT 365
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts JSONB := '{}'::jsonb;
  v_deleted BIGINT;
BEGIN
  DELETE FROM square_sync_log
  WHERE created_at < now() - make_interval(days => p_log_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('square_sync_log', v_deleted);

  DELETE FROM qbo_sync_log
  WHERE created_at < now() - make_interval(days => p_log_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('qbo_sync_log', v_deleted);

  -- mongodb_sync_log has no created_at (00165); started_at is its insert time.
  -- started_at is nullable (DEFAULT NOW(), no NOT NULL) — a NULL row is
  -- undateable junk, so the sweep removes it rather than keeping it forever.
  DELETE FROM mongodb_sync_log
  WHERE started_at < now() - make_interval(days => p_log_days)
     OR started_at IS NULL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('mongodb_sync_log', v_deleted);

  DELETE FROM slack_notification_log
  WHERE created_at < now() - make_interval(days => p_log_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('slack_notification_log', v_deleted);

  DELETE FROM email_notification_log
  WHERE created_at < now() - make_interval(days => p_log_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('email_notification_log', v_deleted);

  -- entity_revisions: changed_at is the revision timestamp (00019).
  DELETE FROM entity_revisions
  WHERE changed_at < now() - make_interval(days => p_revision_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('entity_revisions', v_deleted);

  RETURN v_counts;
END;
$$;

COMMENT ON FUNCTION public.prune_log_tables(INT, INT) IS
  'Nightly log retention (00296): deletes sync/notification log rows older than p_log_days (default 90) and entity_revisions older than p_revision_days (default 365). Returns per-table deleted counts. Scheduled via pg_cron (prune-log-tables); service-role locked. Retune by rescheduling the cron job with explicit arguments — no migration needed.';

-- 00247 pattern: nothing app-facing may call this; pg_cron runs it as the
-- function owner, service_role keeps a manual escape hatch.
REVOKE ALL ON FUNCTION public.prune_log_tables(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_log_tables(INT, INT) TO service_role;

-- Retention-scan indexes. Three of the pruned tables had no usable timestamp
-- index (square_sync_log's only time index leads with sync_type; 00060
-- dropped idx_entity_revisions_changed_at as then-unused; mongodb_sync_log
-- and the just-captured email_notification_log never had one). BRIN on an
-- append-only timestamp column costs a few KB and near-zero write overhead,
-- and turns the nightly range DELETE from a full seq scan of the largest
-- tables (entity_revisions holds full before/after JSONB per write) into a
-- block-range lookup. qbo_sync_log and slack_notification_log already have
-- usable btree created_at indexes.
CREATE INDEX IF NOT EXISTS idx_entity_revisions_changed_at_brin
  ON public.entity_revisions USING brin (changed_at);
CREATE INDEX IF NOT EXISTS idx_square_sync_log_created_at_brin
  ON public.square_sync_log USING brin (created_at);
CREATE INDEX IF NOT EXISTS idx_mongodb_sync_log_started_at_brin
  ON public.mongodb_sync_log USING brin (started_at);
CREATE INDEX IF NOT EXISTS idx_email_notification_log_created_at_brin
  ON public.email_notification_log USING brin (created_at);

-- =============================================================================
-- 2. Schedules
-- =============================================================================
-- pg_cron is available on Supabase but not enabled by default. Tolerate
-- plain-Postgres environments (CI replays) where the extension is absent —
-- same pattern as 00272.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron unavailable (non-Supabase environment); log-retention jobs not scheduled: %', SQLERRM;
END $$;

-- Idempotent unschedule-then-schedule (00272 pattern). Nightly DB jobs stay
-- clustered but not concurrent: 05:10 retention, 05:15 notifications cleanup,
-- ahead of 05:30 data-integrity, 05:45 findings notify, 06:00 low inventory.
DO $job$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-log-tables') THEN
      PERFORM cron.unschedule('prune-log-tables');
    END IF;
    PERFORM cron.schedule(
      'prune-log-tables',
      '10 5 * * *',
      $$SELECT public.prune_log_tables()$$
    );

    -- cleanup_old_notifications(p_days_old integer DEFAULT 30) — 00020,
    -- service-role locked in 00247. 90-day retention, matching the log family.
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-old-notifications') THEN
      PERFORM cron.unschedule('cleanup-old-notifications');
    END IF;
    PERFORM cron.schedule(
      'cleanup-old-notifications',
      '15 5 * * *',
      $$SELECT public.cleanup_old_notifications(90)$$
    );
  END IF;
END;
$job$;

-- =============================================================================
-- 3. Plan probe (docs/agents/scheduled-jobs.md rule)
-- =============================================================================
-- PL/pgSQL plans statements on first execution, so a body referencing a
-- missing column would create fine and then fail on every scheduled run.
-- Both function bodies are straight-line (no data-dependent branches), so a
-- bare call plans every statement — no probe-rollback scaffolding needed.
-- The probe calls with ~100-year windows: every DELETE is planned and
-- executed but matches ~0 rows, so the apply generates no WAL burst and
-- holds no long row locks inside the migration transaction. The real
-- backlog prune happens on the first 05:10 cron run, off-hours, served by
-- the BRIN indexes above.
DO $$
BEGIN
  PERFORM public.prune_log_tables(36500, 36500);
  PERFORM public.cleanup_old_notifications(36500);
END $$;
