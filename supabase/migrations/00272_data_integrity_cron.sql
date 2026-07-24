-- =============================================================================
-- Migration: Nightly data-integrity check via pg_cron
-- =============================================================================
-- Free, DB-side invariant watchdog. check_data_integrity() runs a few cheap,
-- high-confidence checks and records violations in data_integrity_findings so
-- silent corruption (negative stock, impossible quantities) surfaces within a
-- day instead of at the next physical count. Scheduling follows the
-- idempotent unschedule-then-schedule pattern from
-- 00174_schedule_low_inventory_check.sql.
--
-- Implemented invariants (all verified against the current schema):
--   1. negative_on_hand      — SUM(allocations.quantity) per inventory item
--                              is negative (00001: quantity is positive for
--                              additions, negative for usage; the sum is the
--                              on-hand and can never legitimately go below 0).
--   2. negative_bin_quantity — bin_inventory.quantity < 0 (00010: INTEGER
--                              with no CHECK constraint, unlike keg_inventory
--                              which has CHECK (quantity >= 0)).
--   3. negative_lot_quantity — inventory_lots.quantity < 0 (00010: DECIMAL
--                              with no CHECK constraint).
--
-- Candidate invariants for follow-up (NOT implemented — verify schema/intent
-- first): orphaned allocations whose reference_id no longer resolves
-- (reference_type is a soft link, needs per-type join), packaging sessions
-- consuming more than batch volume, finished_goods vs bin_inventory totals.
-- =============================================================================

-- Findings table. Rows are only ever written by the cron-run function (the
-- pg_cron job runs as the job owner, which bypasses RLS); staff read them.
CREATE TABLE public.data_integrity_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_name TEXT NOT NULL,
  entity_table TEXT NOT NULL,
  entity_id UUID,
  detail TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  -- One open finding per (check, row): re-detections update detected_at
  -- instead of inserting duplicates.
  CONSTRAINT data_integrity_findings_open_unique
    UNIQUE (check_name, entity_table, entity_id)
);

COMMENT ON TABLE public.data_integrity_findings IS
  'Violations found by the nightly check_data_integrity() pg_cron job. Rows are upserted per (check, entity); resolved_at is stamped when a later run no longer sees the violation.';

ALTER TABLE public.data_integrity_findings ENABLE ROW LEVEL SECURITY;

-- Staff with inventory read access can see findings; nobody writes directly
-- (the cron job owner bypasses RLS; authenticated write privileges revoked).
CREATE POLICY data_integrity_findings_select
  ON public.data_integrity_findings
  FOR SELECT
  USING (user_has_permission('inventory:read'));

REVOKE INSERT, UPDATE, DELETE ON TABLE public.data_integrity_findings
  FROM PUBLIC, anon, authenticated;

-- SECURITY INVOKER: pg_cron executes the job as its owner (postgres), which
-- already has full table access — no privilege escalation needed or wanted.
CREATE OR REPLACE FUNCTION public.check_data_integrity()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- 1. Negative on-hand: allocation ledger sums below zero per item.
  INSERT INTO data_integrity_findings (check_name, entity_table, entity_id, detail)
  SELECT
    'negative_on_hand',
    'inventory_items',
    a.inventory_item_id,
    'On-hand (SUM of allocations.quantity) is ' || SUM(a.quantity)::text
  FROM allocations a
  GROUP BY a.inventory_item_id
  HAVING SUM(a.quantity) < 0
  ON CONFLICT (check_name, entity_table, entity_id)
  DO UPDATE SET
    detail = EXCLUDED.detail,
    detected_at = NOW(),
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
  'Nightly pg_cron invariant sweep: upserts violations into data_integrity_findings and stamps resolved_at on violations that cleared. Run manually with SELECT check_data_integrity();';

-- Only the cron job owner / service role should run the sweep.
REVOKE ALL ON FUNCTION public.check_data_integrity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_data_integrity() TO service_role;

-- pg_cron is available on Supabase but not enabled by default. Tolerate
-- plain-Postgres environments (CI replays) where the extension is absent —
-- same pattern as 00174.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron unavailable (non-Supabase environment); data-integrity job not scheduled: %', SQLERRM;
END $$;

-- Idempotent guard: unschedule any previous job of the same name so replays
-- never create duplicates. Daily at 05:30 UTC (before the 06:00 low-inventory
-- job, keeping the nightly DB jobs clustered but not concurrent).
DO $job$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-data-integrity') THEN
      PERFORM cron.unschedule('check-data-integrity');
    END IF;
    PERFORM cron.schedule(
      'check-data-integrity',
      '30 5 * * *',
      $$SELECT public.check_data_integrity()$$
    );
  END IF;
END;
$job$;

-- Schema registry entry (AGENTS.md: required for every new table).
INSERT INTO public._schema_registry (
  table_name,
  description,
  domain,
  relationships,
  key_fields,
  state_machine,
  query_examples
)
VALUES (
  'data_integrity_findings',
  'Violations recorded by the nightly check_data_integrity() pg_cron sweep (negative on-hand, negative bin/lot quantities). Upserted per check+entity; resolved_at set when a violation clears.',
  'system',
  '["references (soft): inventory_items, bin_inventory, inventory_lots via entity_table + entity_id"]'::jsonb,
  '["check_name", "entity_table", "entity_id", "detected_at", "resolved_at"]'::jsonb,
  NULL,
  '["Which inventory items currently have negative on-hand?", "Are there unresolved data-integrity findings?"]'::jsonb
)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  state_machine = EXCLUDED.state_machine,
  query_examples = EXCLUDED.query_examples;
