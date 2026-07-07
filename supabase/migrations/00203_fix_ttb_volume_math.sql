-- =============================================================================
-- Fix TTB summary volume math + count taproom sales as taxpaid removals
-- =============================================================================
-- Audit 2026-07-06 finding H2. The finished-goods volume math in
-- get_ttb_inventory_summary and get_ttb_production_summary (last defined in
-- 00191, capturing the live drifted objects) computed
--     fg.quantity * c.volume_oz / 3968.0
-- which is wrong in two ways:
--   1. It omits selling_formats.unit_count — a finished-goods quantity is a
--      count of SELLING UNITS (cases/packs), so 100 cases of 24 x 12oz cans
--      reported 0.30 bbl instead of 7.26 bbl (24x under).
--   2. Keg containers carry volume_bbl and leave volume_oz NULL (00199
--      CHECKs), so the whole keg tax class reported 0.00.
--
-- Per-FG-unit volume is now
--     COALESCE(c.volume_bbl, c.volume_oz / 3968.0) * sf.unit_count
-- which matches the client-side computeUnitFillVolumeBbl contract
-- (src/domain/consumption-planning.ts): prefer the container's barrel volume,
-- fall back to per-unit fluid ounces / 3968 (31 gal x 128 oz per barrel),
-- times units per selling format. containers.volume_oz is per-unit as of
-- 00202 — never a rolled-up case total.
--
-- get_ttb_removals_summary additionally gains a `taproom_sale` CASE arm:
-- beer sold over the taproom counter is removed for consumption or sale on
-- brewery premises — a TAXPAID removal on Form 5130.9 (grouped with domestic
-- sales; taproom sales are never exports and are NOT tax-free samples).
-- Previously taproom_sale allocations were silently excluded from the report.
--
-- All three functions keep the exact signatures/return types of their 00191
-- definitions, so plain CREATE OR REPLACE is safe (no DROP needed).

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
      AND a.created_at < pd.period_start
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
      AND a.created_at < pd.period_end_ts
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

CREATE OR REPLACE FUNCTION public.get_ttb_production_summary(p_year integer, p_month integer)
 RETURNS TABLE(ttb_tax_class text, beer_produced_bbl numeric, beer_packaged_bbl numeric, finished_goods_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH period_dates AS (
    SELECT
      make_date(p_year, p_month, 1) AS period_start,
      (make_date(p_year, p_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::DATE AS period_end
  ),
  fg_summary AS (
    SELECT
      get_ttb_tax_class(c.type) AS tax_class,
      -- Per-unit volume: COALESCE(volume_bbl, volume_oz / 3968) x unit_count
      -- (matches computeUnitFillVolumeBbl; kegs carry volume_bbl only).
      SUM((fg.quantity * COALESCE(c.volume_bbl, c.volume_oz / 3968.0) * sf.unit_count)::DECIMAL(10,4)) AS packaged_bbl,
      COUNT(*) AS fg_count
    FROM finished_goods fg
    JOIN selling_formats sf ON sf.id = fg.selling_format_id
    JOIN containers c ON c.id = sf.container_id
    CROSS JOIN period_dates pd
    WHERE fg.production_date >= pd.period_start
      AND fg.production_date <= pd.period_end
    GROUP BY get_ttb_tax_class(c.type)
  ),
  batch_summary AS (
    SELECT
      'cellar' AS tax_class,
      SUM(b.volume_bbl) AS produced_bbl
    FROM batches b
    CROSS JOIN period_dates pd
    WHERE b.status = 'completed'
      AND DATE(b.updated_at) >= pd.period_start
      AND DATE(b.updated_at) <= pd.period_end
    GROUP BY 1
  ),
  all_classes AS (
    SELECT tax_class FROM fg_summary
    UNION
    SELECT tax_class FROM batch_summary
  )
  SELECT
    ac.tax_class AS ttb_tax_class,
    COALESCE(bs.produced_bbl, 0) AS beer_produced_bbl,
    COALESCE(fs.packaged_bbl, 0) AS beer_packaged_bbl,
    COALESCE(fs.fg_count, 0) AS finished_goods_count
  FROM all_classes ac
  LEFT JOIN batch_summary bs ON bs.tax_class = ac.tax_class
  LEFT JOIN fg_summary fs ON fs.tax_class = ac.tax_class;
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
      a.created_at,
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
      AND a.created_at >= pd.period_start
      AND a.created_at < pd.period_end
      AND a.source_type = 'finished_good'
  )
  SELECT
    tc.tax_class AS ttb_tax_class,
    -- Taxpaid removals: domestic order sales PLUS taproom sales — beer sold
    -- for consumption on brewery premises is removed for consumption or sale
    -- (taxpaid) on Form 5130.9; it is never an export and never a tax-free
    -- sample.
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
