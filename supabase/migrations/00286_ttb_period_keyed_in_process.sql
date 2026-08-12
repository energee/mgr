-- =============================================================================
-- 00286: TTB in-process terms — period-keyed history, not a status snapshot
-- =============================================================================
-- Issue #618 (unblocks #698). NOT applied live from this branch — deploy via
-- scripts/db-push.sh after merge.
--
-- WHY
-- The 00237 definition of get_ttb_inventory_summary computed the Form 5130.9
-- beer-in-process terms as a LIVE STATUS SNAPSHOT:
--   * ip_ending summed batches.volume_bbl for every batch whose status is
--     fermenting/conditioning/packaging RIGHT NOW, with no date filter at all,
--     so re-running a closed month returned a different number every time a
--     batch changed status — filed months were not reproducible;
--   * ip_beginning filtered that same present-tense set by created_at, so a
--     batch that was demonstrably in the cellar on the 1st but completed
--     mid-month was dropped from the month's beginning balance, and a month's
--     ending never had to equal the next month's beginning.
--
-- FIX (issue #618, option 1)
-- Reconstruct each batch's RECORDED status at the two period boundaries from
-- entity_revisions, the audit trail migration 00019 has kept on batches (full
-- before/after row images on every INSERT/UPDATE/DELETE) since long before any
-- TTB reporting existed. For a boundary timestamp T, a batch's state is its
-- latest revision with changed_at < T; it counts toward beer in process when
-- that revision's status is fermenting/conditioning/packaging, at the
-- volume_bbl that revision recorded (the volume as of T, not as of today).
-- A DELETE revision carries new_data NULL, so a deleted batch stops counting
-- with no special-casing. Both boundaries use the same reconstruction, so
-- in_process_ending(M) == in_process_beginning(M+1) by construction, and a
-- closed month returns the same figures no matter what has happened since.
--
-- Boundary comparisons are strict (< period_start / < period_end_ts), matching
-- the alloc_before/alloc_end keying convention from 00237.
--
-- LIMITS
--   * A batch with no audit history before T is not counted at T. Every batch
--     inserted after 00019 has an INSERT revision, so this only affects rows
--     that predate the audit trail — and those cannot still be in process.
--   * This fixes the in-process terms only. The cellar row's packaged
--     ending_inventory_bbl is still structurally 0 (get_ttb_tax_class never
--     classes a finished good as 'cellar'), and beer leaves the cellar by
--     being packaged — a movement the removals lines deliberately do not
--     report (00274) — so the row stays on IDENTITY_EXEMPT_TAX_CLASSES in
--     src/domain/ttb-utils.ts. Making the cellar row identity-checkable would
--     need a racked-to-packaging line on the report (see #698 discussion).
--
-- RLS: the function stays SECURITY INVOKER. entity_revisions' SELECT policy
-- (00282) maps entity_type 'batches' to user_has_permission('batches:read'),
-- the same permission batches_select (00097) requires for the table this used
-- to read — no caller gains or loses visibility.
--
-- Everything outside the ip_* CTEs is byte-identical to 00237 (whose fg/alloc
-- terms structural tests in src/lib/__tests__/ttb-sql.test.ts pin against the
-- latest definition). Signature and return type are unchanged, so plain
-- CREATE OR REPLACE is safe. get_ttb_report (00041) composes this summary and
-- picks up the fix without redefinition.

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
  -- Batch state AS OF period start: the latest audit-trail record strictly
  -- before the boundary. new_data is the full row image the trigger captured,
  -- so status and volume_bbl are the values that were true at that moment;
  -- a DELETE revision's new_data is NULL and drops the batch naturally.
  ip_state_at_start AS (
    SELECT DISTINCT ON (r.entity_id)
      r.entity_id,
      r.new_data->>'status' AS status,
      (r.new_data->>'volume_bbl')::numeric AS volume_bbl
    FROM entity_revisions r
    CROSS JOIN period_dates pd
    WHERE r.entity_type = 'batches'
      AND r.changed_at < pd.period_start
    ORDER BY r.entity_id, r.changed_at DESC, r.revision_number DESC
  ),
  ip_beginning AS (
    SELECT
      'cellar' AS tax_class,
      SUM(volume_bbl) AS volume_bbl
    FROM ip_state_at_start
    WHERE status IN ('fermenting', 'conditioning', 'packaging')
    GROUP BY 1
  ),
  -- Batch state AS OF period end — the same reconstruction at the other
  -- boundary, which is what makes this month's ending equal next month's
  -- beginning and keeps closed months reproducible (issue #618).
  ip_state_at_end AS (
    SELECT DISTINCT ON (r.entity_id)
      r.entity_id,
      r.new_data->>'status' AS status,
      (r.new_data->>'volume_bbl')::numeric AS volume_bbl
    FROM entity_revisions r
    CROSS JOIN period_dates pd
    WHERE r.entity_type = 'batches'
      AND r.changed_at < pd.period_end_ts
    ORDER BY r.entity_id, r.changed_at DESC, r.revision_number DESC
  ),
  ip_ending AS (
    SELECT
      'cellar' AS tax_class,
      SUM(volume_bbl) AS volume_bbl
    FROM ip_state_at_end
    WHERE status IN ('fermenting', 'conditioning', 'packaging')
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

COMMENT ON FUNCTION get_ttb_inventory_summary IS
  'Returns TTB inventory (beginning/ending) by tax class for a given month. In-process terms are period-keyed: batch status is reconstructed at each period boundary from entity_revisions, so closed months are reproducible and a month''s ending in-process equals the next month''s beginning (issue #618).';
