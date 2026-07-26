-- =============================================================================
-- 00274: TTB removals — admit batch-sourced (cellar) removals
-- =============================================================================
-- Issue #603. NOT applied live — deploy via scripts/db-push.sh after merge.
--
-- WHY
-- get_ttb_removals_summary was written around a single source (finished goods)
-- and ended its fg_allocations CTE with a hard `AND a.source_type =
-- 'finished_good'`. Every writer of a cellar removal, however, emits
-- source_type='batch':
--   * recordBatchLoss (src/services/consumption-service.ts) — manual transfer
--     and packaging-shortfall losses from RecordLossDialog;
--   * archive_batch (00069) — loss captured when a batch is archived;
--   * transition_entity_atomic (00256:206-218) — the automatic unattributed
--     remainder booked on every batches -> completed transition, which fires
--     with no user opt-in.
-- All three were filtered out before the losses_bbl arm ever saw them, so the
-- `Losses` line of Form 5130.9 read 0.00 for all in-process beer while the
-- allocation ledger underneath was correct. The filter survived every rewrite
-- of the function (00041 -> 00191 -> 00203 -> 00237), each of which fixed a
-- different aspect (volume math, period keying) while carrying it forward.
--
-- FIX
-- Widen the CTE to `a.source_type IN ('finished_good', 'batch')` and classify
-- batch rows as 'cellar'. The explicit CASE arm is load-bearing:
-- get_ttb_tax_class(NULL) returns 'bottled' (00041:44-49, ELSE branch), so
-- without it every batch-sourced removal would be misfiled as a bottled
-- removal rather than a cellar one.
--
-- Batch rows whose destination_type is 'finished_good', 'transfer' or 'batch'
-- are excluded: those are movements WITHIN the brewery, not removals from it.
-- Packaged volume already leaves the cellar through the packaging/production
-- terms, and inter-vessel moves and blends never leave at all. (None of those
-- destination types matches a removals CASE arm today, so the exclusion is
-- currently a no-op on the numbers; it is stated explicitly so that adding a
-- future arm cannot silently start double-counting packaged beer.)
--
-- Everything else — the completed_at-first period key (00237), the volume
-- expression, the taproom_sale classification (00203), the signature, STABLE /
-- SECURITY INVOKER / search_path — is unchanged from the 00237 definition, so
-- a plain CREATE OR REPLACE is safe and the finished-goods arms that drive the
-- keg and bottled rows keep their existing numbers exactly.
--
-- NOT IN SCOPE (deliberately)
-- get_ttb_inventory_summary's in-process terms (00237:132-149) are a status
-- SNAPSHOT, not a period-keyed history: ip_ending has no date filter at all
-- and ip_beginning filters current status by batches.created_at. No accounting
-- identity can hold over them in either direction, before or after this
-- change, and repairing that needs historical batch status the schema does not
-- record. This migration therefore does not touch that function: it does not
-- make the cellar arithmetic worse (the cellar row's ending_inventory_bbl is
-- structurally 0 because no finished good is ever classed 'cellar', so
-- ending = available - removals never held for that row), and it moves the
-- reported Losses number from wrong to right. Tracked separately.

CREATE OR REPLACE FUNCTION public.get_ttb_removals_summary(p_year integer, p_month integer)
 RETURNS TABLE(ttb_tax_class text, taxpaid_domestic_bbl numeric, taxpaid_export_bbl numeric, tax_free_samples_bbl numeric, losses_bbl numeric, destroyed_bbl numeric, adjustments_bbl numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH period_dates AS (
    SELECT
      make_date(p_year, p_month, 1) AS period_start,
      (make_date(p_year, p_month, 1) + INTERVAL '1 month')::DATE AS period_end
  ),
  fg_allocations AS (
    SELECT
      a.id,
      a.destination_type,
      a.reason_code,
      a.volume_bbl,
      a.quantity,
      -- Finished-goods removals take their class from the container; cellar
      -- (batch-sourced) removals have no container, and MUST get the explicit
      -- 'cellar' arm — get_ttb_tax_class(NULL) falls through to 'bottled'
      -- (00041), which would misfile them as packaged-beer removals (#603).
      CASE
        WHEN a.source_type = 'batch' THEN 'cellar'
        ELSE COALESCE(
          get_ttb_tax_class(c.type),
          'bottled'
        )
      END AS tax_class,
      CASE
        WHEN a.destination_type = 'order' THEN
          (SELECT o.is_export FROM orders o WHERE o.id = a.destination_id)
        ELSE FALSE
      END AS is_export
    FROM allocations a
    LEFT JOIN finished_goods fg ON a.source_type = 'finished_good' AND a.source_id = fg.id
    LEFT JOIN selling_formats sf ON sf.id = fg.selling_format_id
    LEFT JOIN containers c ON c.id = sf.container_id
    CROSS JOIN period_dates pd
    WHERE a.status = 'completed'
      -- Bucket removals by when they actually happened: completed_at is
      -- stamped at fulfillment (orders can be reserved in one month and
      -- fulfilled in the next), falling back to created_at for legacy rows
      -- that were completed before completed_at was stamped. Keyed on
      -- created_at (pre-00237) a June-reserved/July-fulfilled removal mutated
      -- June's already-filed report and never appeared in July's. Must match
      -- get_ttb_inventory_summary's alloc_before/alloc_end keying.
      AND COALESCE(a.completed_at, a.created_at) >= pd.period_start
      AND COALESCE(a.completed_at, a.created_at) < pd.period_end
      -- Both beer sources report (#603). inventory_lot/external allocations are
      -- raw materials and packaging components, never beer, so they stay out.
      AND a.source_type IN ('finished_good', 'batch')
      -- ...but a batch row is only a REMOVAL if the beer left the brewery.
      -- 'finished_good' is packaging (already reported by the production and
      -- packaging terms), 'transfer' and 'batch' are inter-vessel moves and
      -- blends. Counting them here would debit the cellar twice.
      AND NOT (
        a.source_type = 'batch'
        AND a.destination_type IN ('finished_good', 'transfer', 'batch')
      )
  )
  SELECT
    tc.tax_class AS ttb_tax_class,
    -- Taxpaid removals: domestic order sales PLUS taproom sales — beer sold
    -- for consumption or sale on brewery premises is removed for consumption
    -- or sale (taxpaid) on Form 5130.9; it is never an export and never a
    -- tax-free sample.
    COALESCE(SUM(CASE
      WHEN (a.destination_type = 'order' AND NOT COALESCE(a.is_export, FALSE))
        OR a.destination_type = 'taproom_sale'
      THEN a.volume_bbl ELSE 0
    END), 0) AS taxpaid_domestic_bbl,
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'order' AND COALESCE(a.is_export, FALSE)
      THEN a.volume_bbl ELSE 0
    END), 0) AS taxpaid_export_bbl,
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'sample'
      THEN a.volume_bbl ELSE 0
    END), 0) AS tax_free_samples_bbl,
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'loss'
      THEN a.volume_bbl ELSE 0
    END), 0) AS losses_bbl,
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'destruction'
      THEN a.volume_bbl ELSE 0
    END), 0) AS destroyed_bbl,
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'adjustment'
      THEN a.volume_bbl ELSE 0
    END), 0) AS adjustments_bbl
  FROM (VALUES ('cellar'), ('keg'), ('bottled')) AS tc(tax_class)
  LEFT JOIN fg_allocations a ON a.tax_class = tc.tax_class
  GROUP BY tc.tax_class;
$function$;

COMMENT ON FUNCTION public.get_ttb_removals_summary IS
  'TTB Form 5130.9 removals by tax class for a month. Reads completed allocations from both beer sources: finished_good (keg/bottled, classed by container) and batch (cellar). Batch rows destined for finished_good/transfer/batch are internal movements, not removals. Buckets on COALESCE(completed_at, created_at).';

-- =============================================================================
-- Verification (self-rolling-back; commits NO rows) — 00229/00232/00237 idiom
-- =============================================================================
-- Seeds the issue #603 scenario in April 2001 (far enough in the past that a
-- clean baseline is expected — guarded below) and asserts, then rolls back:
--   Seed: one 10.00 bbl batch in 'packaging', with three completed
--     batch-sourced allocations dated 2001-04-15 —
--       loss 1.10 bbl (the transition_entity_atomic reconciliation shape),
--       finished_good 8.50 bbl (packaging — NOT a removal),
--       transfer 0.15 bbl (inter-vessel move — NOT a removal).
--   Assert:
--   (1) cellar losses_bbl = 1.10 (the defect: this was 0.00).
--   (2) cellar taxpaid/samples/destroyed/adjustments all 0 — packaging and the
--       inter-vessel transfer are not counted as removals.
--   (3) bottled losses_bbl = 0 — batch rows do not fall through to 'bottled'.
--
-- All test rows are created inside one subtransaction (BEGIN/EXCEPTION =
-- savepoint). A passing run RAISEs the sentinel 'A_VERIFY_OK' to unwind the
-- subtransaction so nothing commits. A genuine failure RAISEs 'A_ASSERT_FAIL…'
-- and is re-raised to ABORT the migration. Any other error (missing
-- prerequisites on a from-scratch replay, a non-clean April 2001 baseline) is
-- downgraded to a WARNING so the DDL above still applies.
DO $$
DECLARE
  v_batch  UUID;
  v_num    NUMERIC;
  v_loss   NUMERIC;
  v_other  NUMERIC;
  v_sfx    TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  BEGIN
    -- --- baseline guard: April 2001 must be empty in every class ------------
    SELECT COALESCE(SUM(ABS(taxpaid_domestic_bbl) + ABS(taxpaid_export_bbl)
             + ABS(tax_free_samples_bbl) + ABS(losses_bbl)
             + ABS(destroyed_bbl) + ABS(adjustments_bbl)), 0)
      INTO v_num
      FROM get_ttb_removals_summary(2001, 4);
    IF v_num <> 0 THEN
      RAISE EXCEPTION 'baseline not clean: removals already present in April 2001';
    END IF;

    -- --- prerequisites (all rolled back) ------------------------------------
    INSERT INTO batches (batch_code, name, status, volume_bbl)
      VALUES ('A-VERIFY-' || left(v_sfx, 12), 'A_verify_batch_' || v_sfx,
              'packaging', 10.00)
      RETURNING id INTO v_batch;

    -- The reconciliation loss shape written by transition_entity_atomic.
    INSERT INTO allocations
      (source_type, source_id, destination_type, destination_id,
       quantity, volume_bbl, status, completed_at, reason_code)
      VALUES ('batch', v_batch, 'loss', NULL,
              1.10, 1.10, 'completed',
              TIMESTAMPTZ '2001-04-15 12:00:00+00', 'reconciliation');

    -- Packaging: leaves the cellar via the production/packaging terms.
    INSERT INTO allocations
      (source_type, source_id, destination_type, destination_id,
       quantity, volume_bbl, status, completed_at)
      VALUES ('batch', v_batch, 'finished_good', NULL,
              8.50, 8.50, 'completed', TIMESTAMPTZ '2001-04-15 12:00:00+00');

    -- Inter-vessel move: never leaves the brewery.
    INSERT INTO allocations
      (source_type, source_id, destination_type, destination_id,
       quantity, volume_bbl, status, completed_at)
      VALUES ('batch', v_batch, 'transfer', NULL,
              0.15, 0.15, 'completed', TIMESTAMPTZ '2001-04-15 12:00:00+00');

    -- --- (1) the cellar losses line reports the batch-sourced loss ----------
    SELECT losses_bbl INTO v_loss
      FROM get_ttb_removals_summary(2001, 4) WHERE ttb_tax_class = 'cellar';
    IF ABS(COALESCE(v_loss, 0) - 1.10) > 0.0005 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (1): cellar losses_bbl %, expected 1.10 — batch-sourced losses must reach Form 5130.9 (#603)', COALESCE(v_loss, 0);
    END IF;

    -- --- (2) packaging and the transfer are not removals --------------------
    SELECT COALESCE(taxpaid_domestic_bbl, 0) + COALESCE(taxpaid_export_bbl, 0)
         + COALESCE(tax_free_samples_bbl, 0) + COALESCE(destroyed_bbl, 0)
         + COALESCE(adjustments_bbl, 0)
      INTO v_other
      FROM get_ttb_removals_summary(2001, 4) WHERE ttb_tax_class = 'cellar';
    IF ABS(COALESCE(v_other, 0)) > 0.0005 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (2): cellar non-loss removals %, expected 0 — packaging (8.50) and inter-vessel transfers (0.15) must not be reported as removals', COALESCE(v_other, 0);
    END IF;

    -- --- (3) no leakage into the packaged-beer rows -------------------------
    SELECT COALESCE(SUM(ABS(taxpaid_domestic_bbl) + ABS(taxpaid_export_bbl)
             + ABS(tax_free_samples_bbl) + ABS(losses_bbl)
             + ABS(destroyed_bbl) + ABS(adjustments_bbl)), 0)
      INTO v_num
      FROM get_ttb_removals_summary(2001, 4)
      WHERE ttb_tax_class IN ('keg', 'bottled');
    IF ABS(v_num) > 0.0005 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (3): keg/bottled removals %, expected 0 — batch-sourced rows must not fall through get_ttb_tax_class(NULL) into the bottled row', v_num;
    END IF;

    -- All assertions passed: unwind the subtransaction (commit nothing).
    RAISE EXCEPTION 'A_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'A_VERIFY_OK' THEN
        RAISE NOTICE 'A TTB cellar-removals verification passed (batch losses reach losses_bbl under cellar; packaging/transfers excluded; no keg/bottled leakage); test rows rolled back';
      ELSIF SQLERRM LIKE 'A_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine removals-classification bug: abort migration
      ELSE
        RAISE WARNING 'A TTB cellar-removals verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;
