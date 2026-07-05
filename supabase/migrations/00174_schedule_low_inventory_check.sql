-- =============================================================================
-- Migration: Schedule check_low_inventory() via pg_cron
-- =============================================================================
-- check_low_inventory() (created in 00022_notification_triggers.sql) scans
-- inventory_items below their reorder_point and notifies all users, with a
-- 24h dedupe per item. Its COMMENT says "Call periodically via cron" but it
-- was never scheduled — low-stock notifications only ever fired if something
-- called the function manually. This migration schedules it daily at 06:00 UTC.
-- =============================================================================

-- pg_cron is available on Supabase but not enabled by default (same pattern
-- as pg_net in 00090_slack_integration.sql). Tolerate plain-Postgres
-- environments where the extension is not installed at all (CI / local
-- replays — see PR #322): everything is skipped with a NOTICE there.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron unavailable (non-Supabase environment); low-inventory job not scheduled: %', SQLERRM;
END $$;

-- Idempotent guard: unschedule a previous job of the same name so re-running
-- this migration (or a later reschedule) never creates duplicate jobs.
-- Daily at 06:00 UTC — before the start of the brew day, and the function's
-- own 24h notification dedupe means a daily cadence cannot spam users.
DO $job$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-low-inventory') THEN
      PERFORM cron.unschedule('check-low-inventory');
    END IF;
    PERFORM cron.schedule(
      'check-low-inventory',
      '0 6 * * *',
      $$SELECT public.check_low_inventory()$$
    );
  END IF;
END;
$job$;
