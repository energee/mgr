-- Migration: 00296_log_retention_cron.sql
-- Schema audit 2026-08-21 (docs/plans/2026-08-21-schema-audit.md, H5):
-- no log table was ever pruned. cleanup_old_notifications() has existed since
-- 00020 but was scheduled nowhere; the sync/notification log family and
-- entity_revisions grew unbounded.
--
-- One retention function covers the log family:
--   90 days:  square_sync_log, qbo_sync_log, mongodb_sync_log,
--             slack_notification_log, email_notification_log
--   365 days: entity_revisions (full before/after JSONB per write — the
--             longer window keeps a year of audit trail)
-- plus a schedule for the existing cleanup_old_notifications(90).
--
-- Patterns: pg_cron guards from 00272/00281 (extension may be absent in CI
-- replays / local Postgres); service-role lock from 00247.

-- =============================================================================
-- 1. Retention function
-- =============================================================================
-- SECURITY DEFINER so the service role can invoke it manually without table
-- privileges; locked to service_role below (00247 pattern). The nightly
-- pg_cron job runs as the job owner (postgres) and is unaffected.
-- Bulk retention DELETE across six log tables whose RLS deliberately blocks
-- app-role deletes; EXECUTE is REVOKEd from PUBLIC/anon/authenticated and
-- granted only to service_role; no arguments, returns only deleted counts.
-- security-definer: justified — service-role-locked retention sweep over RLS-protected log tables; returns counts only
CREATE OR REPLACE FUNCTION public.prune_log_tables()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts JSONB := '{}'::jsonb;
  v_deleted BIGINT;
BEGIN
  DELETE FROM square_sync_log WHERE created_at < now() - INTERVAL '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('square_sync_log', v_deleted);

  DELETE FROM qbo_sync_log WHERE created_at < now() - INTERVAL '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('qbo_sync_log', v_deleted);

  -- mongodb_sync_log has no created_at (00165); started_at is its insert time.
  DELETE FROM mongodb_sync_log WHERE started_at < now() - INTERVAL '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('mongodb_sync_log', v_deleted);

  DELETE FROM slack_notification_log WHERE created_at < now() - INTERVAL '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('slack_notification_log', v_deleted);

  -- email_notification_log exists on live but has no CREATE TABLE in the
  -- migration chain (known live↔chain drift; 00190 captured only its
  -- writers). Dynamic SQL + existence guard keeps this function runnable on
  -- fresh local replays where the table is absent.
  IF to_regclass('public.email_notification_log') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.email_notification_log WHERE created_at < now() - INTERVAL ''90 days''';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('email_notification_log', v_deleted);
  END IF;

  -- entity_revisions: changed_at is the revision timestamp (00019).
  DELETE FROM entity_revisions WHERE changed_at < now() - INTERVAL '365 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('entity_revisions', v_deleted);

  RETURN v_counts;
END;
$$;

COMMENT ON FUNCTION public.prune_log_tables() IS
  'Nightly log retention (00296): deletes sync/notification log rows older than 90 days and entity_revisions older than 365 days. Returns per-table deleted counts. Scheduled via pg_cron (prune-log-tables); service-role locked.';

-- 00247 pattern: nothing app-facing may call this; pg_cron runs it as the
-- function owner, service_role keeps a manual escape hatch.
REVOKE ALL ON FUNCTION public.prune_log_tables() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_log_tables() TO service_role;

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
-- Execute both scheduled functions inside a subtransaction that is rolled
-- back by a deliberate RAISE — proves the plans without persisting deletes
-- at migration time. (prune_log_tables has one data-independent branch per
-- table; the email_notification_log branch only plans where that live-only
-- table exists, which is exactly where the job will run it.)
DO $$
BEGIN
  BEGIN
    PERFORM public.prune_log_tables();
    PERFORM public.cleanup_old_notifications(90);
    RAISE EXCEPTION 'PLAN_PROBE_ROLLBACK';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'PLAN_PROBE_ROLLBACK' THEN
        RAISE;
      END IF;
  END;
END $$;
