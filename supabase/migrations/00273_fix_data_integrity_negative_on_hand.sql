-- =============================================================================
-- Migration: repair check_data_integrity()'s broken first invariant
-- =============================================================================
-- 00272 shipped check_data_integrity() with a check #1 that queries a column
-- which has not existed since 00010:
--
--   FROM allocations a GROUP BY a.inventory_item_id HAVING SUM(a.quantity) < 0
--
-- 00010 renamed the old signed ledger to `allocations_legacy` and rebuilt
-- `allocations` around source_type/source_id + destination_type/destination_id,
-- with CONSTRAINT chk_allocation_quantity_positive CHECK (quantity >= 0). So
-- 00272's own header comment ("positive for additions, negative for usage; the
-- sum is the on-hand") describes allocations_legacy, not the table it reads —
-- and on the current table SUM(quantity) can never be negative anyway.
--
-- PL/pgSQL plans a statement on first EXECUTION, not at CREATE FUNCTION time,
-- so 00272 applied cleanly and then the nightly 05:30 UTC job aborted every
-- run with `column a.inventory_item_id does not exist`. Because the whole
-- function body is one transaction, checks #2 and #3 never ran either: the
-- watchdog has recorded nothing since it was scheduled.
--
-- Replacement invariant — `over_allocated_lot`:
--   inventory_lots_with_quantities.remaining_quantity < 0, i.e. a lot with
--   more planned+completed allocation against it than was ever received. That
--   view (00014) is the on-hand seam the app itself uses
--   (consumption-service, inventory-count-service), and the condition is
--   exactly what 00212's trg_guard_allocation_availability exists to prevent —
--   so a finding here means the guard was bypassed, which is precisely the
--   silent corruption this job was built to surface.
--
-- Checks #2 and #3 are unchanged; they were already correct.
--
-- No data cleanup is needed: the broken check could never insert a row, so no
-- 'negative_on_hand' findings exist to migrate or delete.
-- =============================================================================

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
  'Nightly pg_cron invariant sweep: upserts violations into data_integrity_findings (over-allocated lots, negative bin/lot quantities) and stamps resolved_at on violations that cleared. Run manually with SELECT check_data_integrity();';

-- CREATE OR REPLACE preserves privileges, but restate them so the grant set
-- stays visible alongside the definition it belongs to.
REVOKE ALL ON FUNCTION public.check_data_integrity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_data_integrity() TO service_role;

-- Fail loudly at migration time if the body no longer plans — the exact class
-- of bug 00272 shipped. Rolls the whole migration back rather than leaving a
-- broken function scheduled to run nightly.
DO $$
BEGIN
  PERFORM check_data_integrity();
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'check_data_integrity() is not executable: %', SQLERRM;
END $$;

-- Keep the registry description in step with the renamed check.
UPDATE public._schema_registry
SET description = 'Violations recorded by the nightly check_data_integrity() pg_cron sweep (over-allocated lots, negative bin/lot quantities). Upserted per check+entity; resolved_at set when a violation clears.',
    query_examples = '["Which inventory lots are over-allocated?", "Are there unresolved data-integrity findings?"]'::jsonb
WHERE table_name = 'data_integrity_findings';
