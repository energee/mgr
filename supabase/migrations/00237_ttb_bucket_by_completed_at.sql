-- =============================================================================
-- 00237: TTB period attribution — bucket completed allocations by completed_at
-- =============================================================================
-- Audit 2026-07-10 finding BD-1 (backlog P1 #5). NOT applied live — deploy via
-- scripts/db-push.sh after merge. (00236 is reserved by unmerged PR #370; this
-- branch deliberately skips to 00237.)
--
-- WHY
-- The 00203 definitions of get_ttb_removals_summary and
-- get_ttb_inventory_summary bucket completed allocations into a reporting
-- month by a.created_at. But since the orders→fulfilled side effect went live
-- (src/services/transition-side-effects.ts), a reservation PLANNED in June is
-- flipped to completed — and stamped completed_at — at JULY fulfillment time.
-- Keyed on created_at, that removal lands in June's (possibly already-filed)
-- Form 5130.9 and never appears in July's: the filed month silently mutates
-- after the fact, and the fulfillment month under-reports. The begin/end
-- inventory allocation terms use the same wrong key, so the report's own
-- identity validators (begin + produced − removed = end) could never catch it
-- — both sides were consistently wrong together.
--
-- FIX
-- Key every completed-allocation term on COALESCE(a.completed_at, a.created_at):
--   * get_ttb_removals_summary — the fg_allocations period filter (feeds every
--     removals CASE arm: taxpaid domestic/export, samples, losses, destroyed,
--     adjustments);
--   * get_ttb_inventory_summary — BOTH alloc_before (beginning inventory) and
--     alloc_end (ending inventory).
-- Removals and inventory switch keys together in this one migration, so the
-- inventory identity keeps holding in every month: a removal now leaves
-- inventory in exactly the month it is reported as removed. The created_at
-- fallback covers legacy completed rows (and quick depletions) that never got
-- a completed_at stamp — for those the old and new keys coincide.
--
-- get_ttb_production_summary (also last defined in 00203) has NO allocation
-- terms — it keys on finished_goods.production_date and batches — so it is
-- intentionally not redefined here. get_ttb_report (00041) composes these
-- summaries, so it picks up the fix without redefinition.
--
-- Both functions keep the exact signatures/return types of their 00203
-- definitions, so plain CREATE OR REPLACE is safe (no DROP needed). Bodies are
-- otherwise byte-identical to 00203 except the keying (and dropping the unused
-- a.created_at column from the removals CTE).

CREATE OR REPLACE FUNCTION public.get_ttb_inventory_summary(p_year integer, p_month integer)
 RETURNS TABLE(ttb_tax_class text, beginning_inventory_bbl numeric, ending_inventory_bbl numeric, in_process_beginning_bbl numeric, in_process_ending_bbl numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH period_dates AS (
    SELECT
      make_date(p_year, p_month, 1) AS period_start,
      (make_date(p_year, p_month, 1) + INTERVAL '1 month')::TIMESTAMPTZ AS period_end_ts
  ),
  fg_produced_before AS (
    SELECT
      fg.id,
      get_ttb_tax_class(c.type) AS tax_class,
      -- Per-unit volume: COALESCE(volume_bbl, volume_oz / 3968) x unit_count
      -- (matches computeUnitFillVolumeBbl; kegs carry volume_bbl only).
      (fg.quantity * COALESCE(c.volume_bbl, c.volume_oz / 3968.0) * sf.unit_count)::DECIMAL(10,4) AS produced_bbl
    FROM finished_goods fg
    JOIN selling_formats sf ON sf.id = fg.selling_format_id
    JOIN containers c ON c.id = sf.container_id
    CROSS JOIN period_dates pd
    WHERE fg.production_date < pd.period_start
  ),
  alloc_before AS (
    SELECT
      a.source_id AS fg_id,
      get_ttb_tax_class(c.type) AS tax_class,
      COALESCE(a.volume_bbl, 0) AS removed_bbl
    FROM allocations a
    JOIN finished_goods fg ON a.source_type = 'finished_good' AND a.source_id = fg.id
    JOIN selling_formats sf ON sf.id = fg.selling_format_id
    JOIN containers c ON c.id = sf.container_id
    CROSS JOIN period_dates pd
    WHERE a.status = 'completed'
      -- Bucket by when the removal actually happened (completed_at, stamped at
      -- fulfillment), not when the reservation row was created; created_at is
      -- the fallback for legacy rows completed before completed_at was stamped.
      -- Must match get_ttb_removals_summary's keying (00237) or the
      -- begin + produced - removed = end identity breaks.
      AND COALESCE(a.completed_at, a.created_at) < pd.period_start
  ),
  fg_beginning AS (
    SELECT
      tax_class,
      GREATEST(0, SUM(produced_bbl) - COALESCE(
        (SELECT SUM(removed_bbl) FROM alloc_before ab WHERE ab.tax_class = fpb.tax_class),
        0
      )) AS volume_bbl
    FROM fg_produced_before fpb
    GROUP BY tax_class
  ),
  fg_produced_end AS (
    SELECT
      fg.id,
      get_ttb_tax_class(c.type) AS tax_class,
      -- Per-unit volume: COALESCE(volume_bbl, volume_oz / 3968) x unit_count
      -- (matches computeUnitFillVolumeBbl; kegs carry volume_bbl only).
      (fg.quantity * COALESCE(c.volume_bbl, c.volume_oz / 3968.0) * sf.unit_count)::DECIMAL(10,4) AS produced_bbl
    FROM finished_goods fg
    JOIN selling_formats sf ON sf.id = fg.selling_format_id
    JOIN containers c ON c.id = sf.container_id
    CROSS JOIN period_dates pd
    WHERE fg.production_date < pd.period_end_ts::DATE
  ),
  alloc_end AS (
    SELECT
      a.source_id AS fg_id,
      get_ttb_tax_class(c.type) AS tax_class,
      COALESCE(a.volume_bbl, 0) AS removed_bbl
    FROM allocations a
    JOIN finished_goods fg ON a.source_type = 'finished_good' AND a.source_id = fg.id
    JOIN selling_formats sf ON sf.id = fg.selling_format_id
    JOIN containers c ON c.id = sf.container_id
    CROSS JOIN period_dates pd
    WHERE a.status = 'completed'
      -- Same completed_at-first keying as alloc_before (see comment there).
      AND COALESCE(a.completed_at, a.created_at) < pd.period_end_ts
  ),
  fg_ending AS (
    SELECT
      tax_class,
      GREATEST(0, SUM(produced_bbl) - COALESCE(
        (SELECT SUM(removed_bbl) FROM alloc_end ae WHERE ae.tax_class = fpe.tax_class),
        0
      )) AS volume_bbl
    FROM fg_produced_end fpe
    GROUP BY tax_class
  ),
  ip_beginning AS (
    SELECT
      'cellar' AS tax_class,
      SUM(b.volume_bbl) AS volume_bbl
    FROM batches b
    CROSS JOIN period_dates pd
    WHERE b.status IN ('fermenting', 'conditioning', 'packaging')
      AND b.created_at < pd.period_start
    GROUP BY 1
  ),
  ip_ending AS (
    SELECT
      'cellar' AS tax_class,
      SUM(b.volume_bbl) AS volume_bbl
    FROM batches b
    WHERE b.status IN ('fermenting', 'conditioning', 'packaging')
    GROUP BY 1
  )
  SELECT
    tc.tax_class AS ttb_tax_class,
    COALESCE(fgb.volume_bbl, 0) AS beginning_inventory_bbl,
    COALESCE(fge.volume_bbl, 0) AS ending_inventory_bbl,
    COALESCE(ipb.volume_bbl, 0) AS in_process_beginning_bbl,
    COALESCE(ipe.volume_bbl, 0) AS in_process_ending_bbl
  FROM (VALUES ('cellar'), ('keg'), ('bottled')) AS tc(tax_class)
  LEFT JOIN fg_beginning fgb ON fgb.tax_class = tc.tax_class
  LEFT JOIN fg_ending fge ON fge.tax_class = tc.tax_class
  LEFT JOIN ip_beginning ipb ON ipb.tax_class = tc.tax_class
  LEFT JOIN ip_ending ipe ON ipe.tax_class = tc.tax_class;
$function$;

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
      COALESCE(
        get_ttb_tax_class(c.type),
        'bottled'
      ) AS tax_class,
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
      AND a.source_type = 'finished_good'
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

-- =============================================================================
-- Verification (self-rolling-back; commits NO rows) — matches 00229/00232 idiom
-- =============================================================================
-- Proves, then rolls back, on a cross-month scenario in Jan/Feb 2001 (month A =
-- January, month B = February; far enough in the past that a clean baseline is
-- expected — guarded below):
--   Seed: 10 half-bbl kegs of finished goods produced Jan 10 (5.0 bbl);
--     allocation #1: fg -> order, completed, 1.0 bbl, created Jan 20 but
--       completed_at Feb 5 (the BD-1 cross-month case);
--     allocation #2: fg -> taproom_sale, completed, 0.5 bbl, created Jan 25,
--       completed_at NULL (exercises the created_at fallback).
--   Assert:
--   (1) January removals show ONLY the 0.5 bbl taproom sale (NULL completed_at
--       falls back to created_at). Under the old created_at keying this would
--       be 1.5 — the order removal leaking into the reservation month.
--   (2) February removals show the 1.0 bbl order removal — the fulfillment
--       month reports it. Under the old keying this would be 0.
--   (3) January inventory: beginning 0, ending 4.5 (5.0 produced − 0.5
--       removed in January).
--   (4) February inventory: beginning 4.5 (continuity with January's ending),
--       ending 3.5 (− 1.0 removed in February).
--   (5) The accounting identity begin + packaged − removed = end holds in
--       BOTH months (Jan: 0 + 5.0 − 0.5 = 4.5; Feb: 4.5 + 0 − 1.0 = 3.5).
--
-- All test rows are created inside one subtransaction (BEGIN/EXCEPTION =
-- savepoint). A passing run RAISEs the sentinel 'A_VERIFY_OK' to unwind the
-- subtransaction so nothing commits. A genuine failure RAISEs 'A_ASSERT_FAIL…'
-- and is re-raised to ABORT the migration. Any other error (missing
-- prerequisites on a from-scratch replay, a non-clean Jan/Feb 2001 baseline,
-- etc.) is downgraded to a WARNING so the DDL above still applies.
DO $$
DECLARE
  v_brand   UUID;
  v_c_keg   UUID;
  v_sf_keg  UUID;
  v_fg      UUID;
  v_cust    UUID;
  v_order   UUID;
  v_num     NUMERIC;
  v_beg_a   NUMERIC;
  v_end_a   NUMERIC;
  v_beg_b   NUMERIC;
  v_end_b   NUMERIC;
  v_rem_a   NUMERIC;
  v_rem_b   NUMERIC;
  v_pkg_a   NUMERIC;
  v_pkg_b   NUMERIC;
  v_sfx     TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  BEGIN
    -- --- baseline guard: Jan/Feb 2001 keg class must be empty ----------------
    -- (assertions below are absolute; any pre-existing 2001 data means this
    -- environment can't run the check — downgrade to a WARNING skip)
    SELECT COALESCE(SUM(ABS(taxpaid_domestic_bbl) + ABS(taxpaid_export_bbl)
             + ABS(tax_free_samples_bbl) + ABS(losses_bbl)
             + ABS(destroyed_bbl) + ABS(adjustments_bbl)), 0)
      INTO v_num
      FROM (SELECT * FROM get_ttb_removals_summary(2001, 1)
            UNION ALL SELECT * FROM get_ttb_removals_summary(2001, 2)) r
      WHERE r.ttb_tax_class = 'keg';
    IF v_num <> 0 THEN
      RAISE EXCEPTION 'baseline not clean: keg removals already present in Jan/Feb 2001';
    END IF;

    SELECT COALESCE(SUM(ABS(beginning_inventory_bbl) + ABS(ending_inventory_bbl)), 0)
      INTO v_num
      FROM (SELECT * FROM get_ttb_inventory_summary(2001, 1)
            UNION ALL SELECT * FROM get_ttb_inventory_summary(2001, 2)) i
      WHERE i.ttb_tax_class = 'keg';
    IF v_num <> 0 THEN
      RAISE EXCEPTION 'baseline not clean: keg inventory already present in Jan/Feb 2001';
    END IF;

    -- --- prerequisites (all rolled back) --------------------------------------
    INSERT INTO brands (name)
      VALUES ('A_verify_brand_' || v_sfx)
      RETURNING id INTO v_brand;

    -- Half-bbl keg: volume_bbl only (00199 CHECK), tax class 'keg'.
    INSERT INTO containers (name, type, volume_bbl, deposit_amount)
      VALUES ('A_verify_keg_' || v_sfx, 'keg', 0.5, 0)
      RETURNING id INTO v_c_keg;

    -- Keg selling format: the 00219 placement trigger skips kegs, so no
    -- bin_inventory pollution.
    INSERT INTO selling_formats (container_id, name, unit_count)
      VALUES (v_c_keg, 'A_verify_sf_keg_' || v_sfx, 1)
      RETURNING id INTO v_sf_keg;

    -- 10 kegs produced Jan 10, 2001 -> 5.0 bbl packaged in month A.
    INSERT INTO finished_goods (brand_id, selling_format_id, quantity, lot_number, production_date)
      VALUES (v_brand, v_sf_keg, 10, 'A-fg-' || v_sfx, DATE '2001-01-10')
      RETURNING id INTO v_fg;

    INSERT INTO customers (name, customer_type)
      VALUES ('A_verify_cust_' || v_sfx, 'wholesale')
      RETURNING id INTO v_cust;

    INSERT INTO orders (order_number, customer_id)
      VALUES ('A-VERIFY-' || left(v_sfx, 12), v_cust)
      RETURNING id INTO v_order;

    -- The BD-1 cross-month case: reserved (created) in January, fulfilled
    -- (completed_at) in February. 2 kegs = 1.0 bbl.
    INSERT INTO allocations
      (source_type, source_id, destination_type, destination_id,
       quantity, volume_bbl, status, created_at, completed_at)
      VALUES ('finished_good', v_fg, 'order', v_order,
              2, 1.0, 'completed',
              TIMESTAMPTZ '2001-01-20 12:00:00+00', TIMESTAMPTZ '2001-02-05 12:00:00+00');

    -- The fallback case: completed with NO completed_at stamp (legacy/quick
    -- depletion shape) -> buckets by created_at, i.e. January. 1 keg = 0.5 bbl.
    INSERT INTO allocations
      (source_type, source_id, destination_type, destination_id,
       quantity, volume_bbl, status, created_at, completed_at)
      VALUES ('finished_good', v_fg, 'taproom_sale', NULL,
              1, 0.5, 'completed',
              TIMESTAMPTZ '2001-01-25 12:00:00+00', NULL);

    -- --- (1) January removals: only the taproom sale --------------------------
    SELECT taxpaid_domestic_bbl INTO v_rem_a
      FROM get_ttb_removals_summary(2001, 1) WHERE ttb_tax_class = 'keg';
    IF ABS(COALESCE(v_rem_a, 0) - 0.5) > 0.0005 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (1): January taxpaid_domestic %, expected 0.5 — the Feb-completed order removal must NOT bucket into its created_at month', COALESCE(v_rem_a, 0);
    END IF;

    -- --- (2) February removals: the order removal, in the fulfillment month ---
    SELECT taxpaid_domestic_bbl INTO v_rem_b
      FROM get_ttb_removals_summary(2001, 2) WHERE ttb_tax_class = 'keg';
    IF ABS(COALESCE(v_rem_b, 0) - 1.0) > 0.0005 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (2): February taxpaid_domestic %, expected 1.0 — removals must bucket by completed_at', COALESCE(v_rem_b, 0);
    END IF;

    -- --- (3) January inventory: begin 0, end 4.5 ------------------------------
    SELECT beginning_inventory_bbl, ending_inventory_bbl INTO v_beg_a, v_end_a
      FROM get_ttb_inventory_summary(2001, 1) WHERE ttb_tax_class = 'keg';
    IF ABS(COALESCE(v_beg_a, 0) - 0) > 0.0005 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (3): January beginning inventory %, expected 0', COALESCE(v_beg_a, 0);
    END IF;
    IF ABS(COALESCE(v_end_a, 0) - 4.5) > 0.0005 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (3): January ending inventory %, expected 4.5 (5.0 produced - 0.5 removed in Jan; the Feb-completed 1.0 must still be on hand)', COALESCE(v_end_a, 0);
    END IF;

    -- --- (4) February inventory: begin 4.5 (continuity), end 3.5 --------------
    SELECT beginning_inventory_bbl, ending_inventory_bbl INTO v_beg_b, v_end_b
      FROM get_ttb_inventory_summary(2001, 2) WHERE ttb_tax_class = 'keg';
    IF ABS(COALESCE(v_beg_b, 0) - 4.5) > 0.0005 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (4): February beginning inventory %, expected 4.5 (must equal January''s ending)', COALESCE(v_beg_b, 0);
    END IF;
    IF ABS(COALESCE(v_end_b, 0) - 3.5) > 0.0005 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (4): February ending inventory %, expected 3.5 (4.5 - 1.0 removed in Feb)', COALESCE(v_end_b, 0);
    END IF;

    -- --- (5) identity: begin + packaged - removed = end, both months ----------
    -- (production summary returns no keg row for a month with no production)
    SELECT beer_packaged_bbl INTO v_pkg_a
      FROM get_ttb_production_summary(2001, 1) WHERE ttb_tax_class = 'keg';
    SELECT beer_packaged_bbl INTO v_pkg_b
      FROM get_ttb_production_summary(2001, 2) WHERE ttb_tax_class = 'keg';
    IF ABS((COALESCE(v_beg_a, 0) + COALESCE(v_pkg_a, 0) - COALESCE(v_rem_a, 0)) - COALESCE(v_end_a, 0)) > 0.0005 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (5): January identity broken: % + % - % <> %', COALESCE(v_beg_a, 0), COALESCE(v_pkg_a, 0), COALESCE(v_rem_a, 0), COALESCE(v_end_a, 0);
    END IF;
    IF ABS((COALESCE(v_beg_b, 0) + COALESCE(v_pkg_b, 0) - COALESCE(v_rem_b, 0)) - COALESCE(v_end_b, 0)) > 0.0005 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (5): February identity broken: % + % - % <> %', COALESCE(v_beg_b, 0), COALESCE(v_pkg_b, 0), COALESCE(v_rem_b, 0), COALESCE(v_end_b, 0);
    END IF;

    -- All assertions passed: unwind the subtransaction (commit nothing).
    RAISE EXCEPTION 'A_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'A_VERIFY_OK' THEN
        RAISE NOTICE 'A TTB completed_at-bucketing verification passed (cross-month removal reports in fulfillment month, created_at fallback works, inventory identity holds in both months); test rows rolled back';
      ELSIF SQLERRM LIKE 'A_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine period-attribution bug: abort migration
      ELSE
        RAISE WARNING 'A TTB completed_at-bucketing verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

-- Refresh PostgREST schema cache so the replaced functions are picked up.
NOTIFY pgrst, 'reload schema';
