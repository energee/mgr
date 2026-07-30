-- =============================================================================
-- Migration: give the data-integrity watchdog a consumer (notifications)
-- =============================================================================
-- Issue #586. 00272 scheduled check_data_integrity() (daily 05:30 UTC) and
-- 00273 repaired its first invariant, but nothing ever READ the table it
-- writes: data_integrity_findings had zero references in src/, in any workflow
-- or script, and in every other migration. A loop whose output nobody consumes
-- is indistinguishable from a disabled loop — a real negative-inventory or
-- over-allocation violation could sit open indefinitely with nobody alerted.
--
-- This migration wires the findings into the existing notification path, the
-- same one 00174 wired for check_low_inventory():
--   * notify_data_integrity_findings()      — new; announces open findings
--                                             through notify_all_users()
--   * cron job 'notify-data-integrity-findings' — daily 05:45 UTC, 15 minutes
--                                             after the 05:30 sweep and before
--                                             the 06:00 low-inventory job
--
-- AUDIENCE is unchanged from every other broadcast in this system:
-- notify_all_users() (00022, rescoped in 00201) fans out to ACTIVE,
-- NON-CUSTOMER user_profiles and routes each recipient through
-- create_notification(), which honours their notification_preferences, plus
-- the existing email + Slack dispatch. No new recipient model is invented here.
--
-- WHY A SEPARATE FUNCTION + JOB instead of appending the notify step to
-- check_data_integrity(): the sweep and the announcement then fail
-- independently. The whole sweep body is one transaction, so a
-- notification-path error (pg_net, Slack, email) appended to it would roll
-- back the findings themselves — the data we most need to keep.
--
-- HOW RE-NOTIFICATION IS AVOIDED (a daily duplicate alert is how alerting gets
-- muted, which is the exact failure mode this issue is about):
--   * New column data_integrity_findings.notified_at records that an OPEN
--     finding has already been announced.
--   * The notifier selects only rows WHERE resolved_at IS NULL AND
--     notified_at IS NULL, and stamps notified_at in the same run. A finding
--     that stays open across 100 nightly sweeps is announced exactly ONCE.
--   * check_data_integrity()'s re-detection upsert leaves notified_at alone
--     while the finding is still open, and resets it to NULL only when the row
--     it collided with was already RESOLVED — a violation that cleared and came
--     back is a new event, so it does alert again.
--   * "The same finding" means the table's own identity key,
--     UNIQUE (check_name, entity_table, entity_id) — the same key the upsert
--     already dedupes on.
--
-- TRADEOFF, stated deliberately: once-per-occurrence means a finding nobody
-- acts on is announced once and then stays silent while it remains open. That
-- is the chosen side of the dial — the alternative (check_low_inventory()'s 24h
-- re-notify window) is a duplicate alert every night, which is how alerting
-- gets muted and how #586 happened in the first place. The findings table is
-- the durable record either way: it is staff-readable with `inventory:read`,
-- and `resolved_at IS NULL` is the query for "still broken". If chronic
-- findings turn out to need nagging, add a re-notify floor
-- (notified_at < NOW() - INTERVAL '7 days') rather than dropping to daily.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Notification bookkeeping column
-- -----------------------------------------------------------------------------
-- No new table, policy, or view: data_integrity_findings already has RLS
-- enabled with a SELECT policy for `inventory:read` staff plus the 00255
-- disabled-account gate (00272), and both cover the new column.
ALTER TABLE public.data_integrity_findings
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.data_integrity_findings.notified_at IS
  'When notify_data_integrity_findings() announced this OPEN finding. NULL = never announced, or the finding re-opened after being resolved (which clears it). Keeps the nightly job from re-alerting the same open violation every day.';

-- Partial index on exactly the notifier's predicate: the work queue is
-- normally empty, so this keeps the daily job off a sequential scan as the
-- resolved-findings history grows.
CREATE INDEX IF NOT EXISTS idx_data_integrity_findings_unnotified
  ON public.data_integrity_findings (detected_at)
  WHERE resolved_at IS NULL AND notified_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2. check_data_integrity() — preserve notified_at across re-detections
-- -----------------------------------------------------------------------------
-- Body is 00273's, unchanged except for the notified_at clause added to each
-- ON CONFLICT DO UPDATE (see the re-notification note in the header).
-- SECURITY INVOKER: pg_cron executes the job as its owner (postgres), which
-- already has full table access — no privilege escalation needed or wanted.
CREATE OR REPLACE FUNCTION public.check_data_integrity()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- 1. Over-allocated lot: more allocated against the lot than received.
  INSERT INTO data_integrity_findings (check_name, entity_table, entity_id, detail)
  SELECT
    'over_allocated_lot',
    'inventory_lots',
    v.id,
    'remaining_quantity is ' || v.remaining_quantity::text
      || ' (received ' || v.quantity::text
      || ', allocated ' || v.allocated_quantity::text || ')'
  FROM inventory_lots_with_quantities v
  WHERE v.remaining_quantity < 0
  ON CONFLICT (check_name, entity_table, entity_id)
  DO UPDATE SET
    detail = EXCLUDED.detail,
    detected_at = NOW(),
    -- Still open -> keep the existing stamp (no duplicate alert). Previously
    -- resolved -> clear it, so the recurrence is announced as a new event.
    notified_at = CASE
      WHEN data_integrity_findings.resolved_at IS NOT NULL THEN NULL
      ELSE data_integrity_findings.notified_at
    END,
    resolved_at = NULL;

  -- 2. Negative finished-goods bin quantity.
  INSERT INTO data_integrity_findings (check_name, entity_table, entity_id, detail)
  SELECT
    'negative_bin_quantity',
    'bin_inventory',
    b.id,
    'bin_inventory.quantity is ' || b.quantity::text
  FROM bin_inventory b
  WHERE b.quantity < 0
  ON CONFLICT (check_name, entity_table, entity_id)
  DO UPDATE SET
    detail = EXCLUDED.detail,
    detected_at = NOW(),
    notified_at = CASE
      WHEN data_integrity_findings.resolved_at IS NOT NULL THEN NULL
      ELSE data_integrity_findings.notified_at
    END,
    resolved_at = NULL;

  -- 3. Negative lot quantity.
  INSERT INTO data_integrity_findings (check_name, entity_table, entity_id, detail)
  SELECT
    'negative_lot_quantity',
    'inventory_lots',
    l.id,
    'inventory_lots.quantity is ' || l.quantity::text
  FROM inventory_lots l
  WHERE l.quantity < 0
  ON CONFLICT (check_name, entity_table, entity_id)
  DO UPDATE SET
    detail = EXCLUDED.detail,
    detected_at = NOW(),
    notified_at = CASE
      WHEN data_integrity_findings.resolved_at IS NOT NULL THEN NULL
      ELSE data_integrity_findings.notified_at
    END,
    resolved_at = NULL;

  -- Stamp resolved_at on findings the checks above no longer re-detected
  -- this run (their detected_at was not refreshed in the last minute).
  UPDATE data_integrity_findings
  SET resolved_at = NOW()
  WHERE resolved_at IS NULL
    AND detected_at < NOW() - INTERVAL '1 minute';
END;
$$;

COMMENT ON FUNCTION public.check_data_integrity() IS
  'Nightly pg_cron invariant sweep: upserts violations into data_integrity_findings (over-allocated lots, negative bin/lot quantities) and stamps resolved_at on violations that cleared. Preserves notified_at while a finding stays open and clears it when a resolved finding re-opens, so notify_data_integrity_findings() alerts once per occurrence. Run manually with SELECT check_data_integrity();';

-- CREATE OR REPLACE preserves privileges, but restate them so the grant set
-- stays visible alongside the definition it belongs to.
REVOKE ALL ON FUNCTION public.check_data_integrity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_data_integrity() TO service_role;

-- -----------------------------------------------------------------------------
-- 3. notify_data_integrity_findings() — the consumer
-- -----------------------------------------------------------------------------
-- SECURITY INVOKER for the same reason as check_data_integrity(): pg_cron runs
-- the job as its owner, which already has the access this needs. It must NOT
-- be SECURITY DEFINER — notify_all_users() (the privileged part) is already
-- DEFINER and locked to service_role by 00247.
CREATE OR REPLACE FUNCTION public.notify_data_integrity_findings()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  -- Cap on itemised alerts per run. A systemic corruption event can open
  -- hundreds of findings at once, and one notification per finding per staff
  -- user is its own flavour of alert-muting. Findings past the cap keep
  -- notified_at NULL, so the next run announces them — nothing is lost, and
  -- the run below says how many are still queued.
  v_max CONSTANT INTEGER := 20;
  v_finding RECORD;
  v_label TEXT;
  v_pending INTEGER;
  v_count INTEGER := 0;
BEGIN
  -- Open + never-announced only: this predicate IS the dedupe (header note).
  SELECT count(*) INTO v_pending
  FROM data_integrity_findings
  WHERE resolved_at IS NULL
    AND notified_at IS NULL;

  IF v_pending = 0 THEN
    RETURN 0;
  END IF;

  FOR v_finding IN
    SELECT id, check_name, entity_table, entity_id, detail, detected_at
    FROM data_integrity_findings
    WHERE resolved_at IS NULL
      AND notified_at IS NULL
    ORDER BY detected_at, id
    LIMIT v_max
    -- FOR UPDATE so a manual run overlapping the cron run cannot announce the
    -- same finding twice: the second caller blocks on the row, then re-checks
    -- the predicate (READ COMMITTED) and skips it once notified_at is set. It
    -- adds no privilege requirement — the UPDATE below already needs UPDATE.
    FOR UPDATE
  LOOP
    v_label := CASE v_finding.check_name
      WHEN 'over_allocated_lot' THEN 'Over-allocated inventory lot'
      WHEN 'negative_bin_quantity' THEN 'Negative finished-goods bin quantity'
      WHEN 'negative_lot_quantity' THEN 'Negative inventory lot quantity'
      ELSE v_finding.check_name
    END;

    PERFORM notify_all_users(
      'data_integrity',
      'Data Integrity Alert',
      v_label || ' — ' || v_finding.detail
        || ' (' || v_finding.entity_table || ' '
        || COALESCE(v_finding.entity_id::text, 'unknown row') || ')',
      'data_integrity_finding',
      v_finding.id,
      'high',
      -- No action_url: findings have no page of their own yet, and pointing at
      -- a route that does not exist is worse than no link. The message carries
      -- the offending value; the row is in data_integrity_findings.
      NULL,
      jsonb_build_object(
        'check_name', v_finding.check_name,
        'entity_table', v_finding.entity_table,
        'entity_id', v_finding.entity_id,
        'detail', v_finding.detail,
        'detected_at', v_finding.detected_at
      )
    );

    UPDATE data_integrity_findings
    SET notified_at = NOW()
    WHERE id = v_finding.id;

    v_count := v_count + 1;
  END LOOP;

  IF v_pending > v_max THEN
    PERFORM notify_all_users(
      'data_integrity',
      'Data Integrity Alert',
      (v_pending - v_max)::text || ' further new data-integrity findings were not '
        || 'listed individually in this run; the next runs announce them. Query '
        || 'data_integrity_findings for the full list.',
      NULL,
      NULL,
      'high',
      NULL,
      jsonb_build_object('announced', v_count, 'queued', v_pending - v_max)
    );
  END IF;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.notify_data_integrity_findings() IS
  'Announces OPEN, never-announced data_integrity_findings rows to active staff via notify_all_users() (type ''data_integrity'', priority high), stamping notified_at so an open finding is alerted once per occurrence, not once per nightly sweep. Caps itemised alerts at 20 per run and reports the queued remainder. Scheduled daily 05:45 UTC; run manually with SELECT notify_data_integrity_findings();';

-- Same lock-down as every other notification-dispatching routine (00247).
REVOKE ALL ON FUNCTION public.notify_data_integrity_findings()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_data_integrity_findings() TO service_role;

-- -----------------------------------------------------------------------------
-- 4. Schedule it (00174 / 00272 idiom)
-- -----------------------------------------------------------------------------
-- pg_cron is available on Supabase but not enabled by default. Tolerate
-- plain-Postgres environments (CI chain replays) where the extension is absent.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron unavailable (non-Supabase environment); data-integrity notifier not scheduled: %', SQLERRM;
END $$;

-- Idempotent guard: unschedule any previous job of the same name so replays
-- never create duplicates. Daily at 05:45 UTC — after the 05:30 sweep has
-- written the night's findings, before the 06:00 low-inventory job.
DO $job$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-data-integrity-findings') THEN
      PERFORM cron.unschedule('notify-data-integrity-findings');
    END IF;
    PERFORM cron.schedule(
      'notify-data-integrity-findings',
      '45 5 * * *',
      $$SELECT public.notify_data_integrity_findings()$$
    );
  END IF;
END;
$job$;

-- -----------------------------------------------------------------------------
-- 5. Self-checks (docs/agents/scheduled-jobs.md rule 1)
-- -----------------------------------------------------------------------------
-- PL/pgSQL plans a statement on first EXECUTION, so a scheduled function can
-- create cleanly and then fail on every run — exactly how 00272 shipped a dead
-- watchdog. Execute both bodies here so a bad plan rolls this migration back
-- instead of scheduling a broken job.
DO $$
BEGIN
  PERFORM check_data_integrity();
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'check_data_integrity() is not executable: %', SQLERRM;
END $$;

-- The notifier has TWO statements that only plan when the data reaches them:
-- the per-finding loop body (needs at least one row) and the over-cap summary
-- call (needs more rows than the cap). A one-row probe would leave the summary
-- unplanned until the first mass-corruption night — the same "creates fine,
-- fails on execution" trap 00272 shipped, sprung at the worst moment. So the
-- probe seeds cap+1 findings and asserts the run hit the cap, which means both
-- statements planned.
--
-- Everything below runs in a nested block, i.e. a subtransaction:
--   * It first stamps every REAL open finding as announced, so the probe run
--     cannot alert staff about live violations. The 05:45 job announces those
--     for real, on its own schedule.
--   * The deliberate RAISE at the end rolls the subtransaction back — the mask,
--     the probe rows, and every notification/email/Slack row the call produced.
--     Applying this migration therefore notifies nobody and leaves no trace.
DO $selfcheck$
DECLARE
  -- Must exceed the function's own v_max so the over-cap branch is reached.
  v_probes CONSTANT INTEGER := 21;
  v_announced INTEGER;
BEGIN
  BEGIN
    UPDATE public.data_integrity_findings
    SET notified_at = NOW()
    WHERE resolved_at IS NULL
      AND notified_at IS NULL;

    INSERT INTO public.data_integrity_findings (check_name, entity_table, entity_id, detail)
    SELECT '_selfcheck', 'data_integrity_findings', gen_random_uuid(),
           'migration 00281 plan self-check (rolled back)'
    FROM generate_series(1, v_probes);

    v_announced := notify_data_integrity_findings();

    IF v_announced <= 0 OR v_announced >= v_probes THEN
      RAISE EXCEPTION
        'announced % of % probe findings; the probe must hit the itemisation cap so both the per-finding and over-cap statements plan (raise v_probes if the cap changed)',
        v_announced, v_probes;
    END IF;

    RAISE EXCEPTION 'selfcheck_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'selfcheck_rollback' THEN
      RAISE EXCEPTION 'notify_data_integrity_findings() self-check failed: %', SQLERRM;
    END IF;
  END;
END;
$selfcheck$;

-- -----------------------------------------------------------------------------
-- 6. Keep the schema registry in step (AGENTS.md)
-- -----------------------------------------------------------------------------
UPDATE public._schema_registry
SET description = 'Violations recorded by the nightly check_data_integrity() pg_cron sweep (over-allocated lots, negative bin/lot quantities). Upserted per check+entity; resolved_at set when a violation clears; notified_at set when notify_data_integrity_findings() alerted staff about the open finding.',
    key_fields = '["check_name", "entity_table", "entity_id", "detected_at", "resolved_at", "notified_at"]'::jsonb,
    query_examples = '["Which inventory lots are over-allocated?", "Are there unresolved data-integrity findings?", "Which open findings have not been announced yet (notified_at IS NULL)?"]'::jsonb
WHERE table_name = 'data_integrity_findings';

-- Reload PostgREST's schema cache so the new column is visible through the API.
NOTIFY pgrst, 'reload schema';
