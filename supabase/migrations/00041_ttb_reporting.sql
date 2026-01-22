-- Migration: 00041_ttb_reporting.sql
-- Purpose: Create TTB Form 5130.9 reporting views and functions
-- Phase: 7.1 TTB Compliance
--
-- TTB Form 5130.9 (Brewer's Report of Operations) requires tracking:
-- - Beginning/ending inventory by tax class
-- - Production (brewed and packaged)
-- - Removals (taxable, tax-free, export)
-- - Losses and adjustments
--
-- Tax Classes (mapped from container_type):
-- - cellar: In-process beer (fermenting, conditioning) - Form Column A
-- - keg: Kegged beer - Form Column C
-- - bottled: Canned/Bottled beer in cases - Form Column F

-- =============================================================================
-- 1. TTB TAX CLASS MAPPING FUNCTION
-- =============================================================================
-- Maps package_types.container_type to TTB reporting categories

CREATE OR REPLACE FUNCTION get_ttb_tax_class(container_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN container_type = 'keg' THEN 'keg'
    WHEN container_type IN ('can', 'bottle') THEN 'bottled'
    WHEN container_type = 'growler' THEN 'keg'  -- Growlers count as draft/keg
    ELSE 'bottled'  -- Default to bottled for unknown types
  END;
$$;

COMMENT ON FUNCTION get_ttb_tax_class IS 'Maps package container_type to TTB Form 5130.9 tax class (cellar, keg, bottled)';

-- =============================================================================
-- 2. FINISHED GOODS WITH TTB CLASS VIEW
-- =============================================================================
-- Extends finished_goods with TTB tax class from package_type

CREATE OR REPLACE VIEW finished_goods_with_ttb_class
WITH (security_invoker = true)
AS
SELECT
  fg.*,
  pt.name AS package_type_name,
  pt.container_type,
  pt.volume_oz,
  pt.units_per_case,
  get_ttb_tax_class(pt.container_type) AS ttb_tax_class,
  -- Calculate volume in BBL (1 BBL = 31 gallons = 3968 oz)
  (fg.quantity * pt.volume_oz / 3968.0)::DECIMAL(10,4) AS volume_bbl,
  b.name AS brand_name
FROM finished_goods fg
JOIN package_types pt ON fg.package_type_id = pt.id
JOIN brands b ON fg.brand_id = b.id;

COMMENT ON VIEW finished_goods_with_ttb_class IS 'Finished goods with TTB tax class and volume calculations for compliance reporting';

-- =============================================================================
-- 3. IN-PROCESS BEER (CELLAR OPERATIONS) VIEW
-- =============================================================================
-- Beer currently in fermentation/conditioning vessels

CREATE OR REPLACE VIEW ttb_in_process_beer
WITH (security_invoker = true)
AS
SELECT
  b.id AS batch_id,
  b.batch_number,
  b.name AS batch_name,
  b.status,
  b.volume_bbl,
  b.updated_at,
  'cellar' AS ttb_tax_class,
  -- For period queries, use the status change date
  CASE
    WHEN b.status = 'fermenting' THEN COALESCE(
      (SELECT MAX(created_at) FROM entity_revisions
       WHERE entity_type = 'batch' AND entity_id = b.id
       AND (new_data->>'status') = 'fermenting'),
      b.created_at
    )
    WHEN b.status = 'conditioning' THEN COALESCE(
      (SELECT MAX(created_at) FROM entity_revisions
       WHERE entity_type = 'batch' AND entity_id = b.id
       AND (new_data->>'status') = 'conditioning'),
      b.created_at
    )
    ELSE b.updated_at
  END AS entered_status_at
FROM batches b
WHERE b.status IN ('fermenting', 'conditioning', 'packaging');

COMMENT ON VIEW ttb_in_process_beer IS 'Beer in cellar operations (fermenting, conditioning, packaging) for TTB Part I tracking';

-- =============================================================================
-- 4. TTB MONTHLY PRODUCTION SUMMARY FUNCTION
-- =============================================================================
-- Calculates production volumes by tax class for a given period

CREATE OR REPLACE FUNCTION get_ttb_production_summary(
  p_year INTEGER,
  p_month INTEGER
)
RETURNS TABLE (
  ttb_tax_class TEXT,
  beer_produced_bbl DECIMAL(10,4),
  beer_packaged_bbl DECIMAL(10,4),
  finished_goods_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH period_dates AS (
    SELECT
      make_date(p_year, p_month, 1) AS period_start,
      (make_date(p_year, p_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::DATE AS period_end
  ),
  -- Finished goods created in the period
  fg_in_period AS (
    SELECT
      fg.id,
      fg.quantity,
      fg.production_date,
      pt.container_type,
      pt.volume_oz,
      get_ttb_tax_class(pt.container_type) AS tax_class,
      (fg.quantity * pt.volume_oz / 3968.0)::DECIMAL(10,4) AS volume_bbl
    FROM finished_goods fg
    JOIN package_types pt ON fg.package_type_id = pt.id
    CROSS JOIN period_dates pd
    WHERE fg.production_date >= pd.period_start
      AND fg.production_date <= pd.period_end
  ),
  -- Batches that completed in the period (for production tracking)
  batches_completed AS (
    SELECT
      b.id,
      b.volume_bbl,
      'cellar' AS tax_class  -- Production goes to cellar first
    FROM batches b
    CROSS JOIN period_dates pd
    WHERE b.status = 'completed'
      AND DATE(b.updated_at) >= pd.period_start
      AND DATE(b.updated_at) <= pd.period_end
  )
  SELECT
    COALESCE(fg.tax_class, bc.tax_class, 'bottled') AS ttb_tax_class,
    COALESCE(SUM(bc.volume_bbl), 0) AS beer_produced_bbl,
    COALESCE(SUM(fg.volume_bbl), 0) AS beer_packaged_bbl,
    COUNT(DISTINCT fg.id) AS finished_goods_count
  FROM fg_in_period fg
  FULL OUTER JOIN batches_completed bc ON FALSE  -- Join for aggregation
  GROUP BY COALESCE(fg.tax_class, bc.tax_class, 'bottled');
$$;

COMMENT ON FUNCTION get_ttb_production_summary IS 'Returns TTB production summary by tax class for a given month';

-- =============================================================================
-- 5. TTB INVENTORY SUMMARY FUNCTION
-- =============================================================================
-- Calculates beginning and ending inventory by tax class

CREATE OR REPLACE FUNCTION get_ttb_inventory_summary(
  p_year INTEGER,
  p_month INTEGER
)
RETURNS TABLE (
  ttb_tax_class TEXT,
  beginning_inventory_bbl DECIMAL(10,4),
  ending_inventory_bbl DECIMAL(10,4),
  in_process_beginning_bbl DECIMAL(10,4),
  in_process_ending_bbl DECIMAL(10,4)
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH period_dates AS (
    SELECT
      make_date(p_year, p_month, 1) AS period_start,
      (make_date(p_year, p_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::DATE AS period_end
  ),
  -- Finished goods inventory at start of period
  fg_beginning AS (
    SELECT
      get_ttb_tax_class(pt.container_type) AS tax_class,
      SUM((fg.quantity * pt.volume_oz / 3968.0)::DECIMAL(10,4)) AS volume_bbl
    FROM finished_goods fg
    JOIN package_types pt ON fg.package_type_id = pt.id
    CROSS JOIN period_dates pd
    WHERE fg.production_date < pd.period_start
    GROUP BY get_ttb_tax_class(pt.container_type)
  ),
  -- Finished goods inventory at end of period
  fg_ending AS (
    SELECT
      get_ttb_tax_class(pt.container_type) AS tax_class,
      SUM((fg.quantity * pt.volume_oz / 3968.0)::DECIMAL(10,4)) AS volume_bbl
    FROM finished_goods fg
    JOIN package_types pt ON fg.package_type_id = pt.id
    CROSS JOIN period_dates pd
    WHERE fg.production_date <= pd.period_end
    GROUP BY get_ttb_tax_class(pt.container_type)
  ),
  -- In-process batches at start of period
  ip_beginning AS (
    SELECT
      'cellar' AS tax_class,
      SUM(b.volume_bbl) AS volume_bbl
    FROM batches b
    CROSS JOIN period_dates pd
    WHERE b.status IN ('fermenting', 'conditioning', 'packaging')
      AND DATE(b.created_at) < pd.period_start
    GROUP BY 1
  ),
  -- In-process batches at end of period
  ip_ending AS (
    SELECT
      'cellar' AS tax_class,
      SUM(b.volume_bbl) AS volume_bbl
    FROM batches b
    CROSS JOIN period_dates pd
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
$$;

COMMENT ON FUNCTION get_ttb_inventory_summary IS 'Returns TTB inventory (beginning/ending) by tax class for a given month';

-- =============================================================================
-- 6. TTB REMOVALS SUMMARY FUNCTION
-- =============================================================================
-- Calculates removals (sales, samples, losses) by tax class

CREATE OR REPLACE FUNCTION get_ttb_removals_summary(
  p_year INTEGER,
  p_month INTEGER
)
RETURNS TABLE (
  ttb_tax_class TEXT,
  taxpaid_domestic_bbl DECIMAL(10,4),
  taxpaid_export_bbl DECIMAL(10,4),
  tax_free_samples_bbl DECIMAL(10,4),
  losses_bbl DECIMAL(10,4),
  destroyed_bbl DECIMAL(10,4),
  adjustments_bbl DECIMAL(10,4)
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH period_dates AS (
    SELECT
      make_date(p_year, p_month, 1) AS period_start,
      (make_date(p_year, p_month, 1) + INTERVAL '1 month')::DATE AS period_end
  ),
  -- Allocations from finished goods during the period
  fg_allocations AS (
    SELECT
      a.id,
      a.destination_type,
      a.reason_code,
      a.volume_bbl,
      a.quantity,
      a.created_at,
      COALESCE(
        get_ttb_tax_class(pt.container_type),
        'bottled'
      ) AS tax_class,
      -- Check if order is export
      CASE
        WHEN a.destination_type = 'order' THEN
          (SELECT o.is_export FROM orders o WHERE o.id = a.destination_id)
        ELSE FALSE
      END AS is_export
    FROM allocations a
    LEFT JOIN finished_goods fg ON a.source_type = 'finished_good' AND a.source_id = fg.id
    LEFT JOIN package_types pt ON fg.package_type_id = pt.id
    CROSS JOIN period_dates pd
    WHERE a.status = 'completed'
      AND a.created_at >= pd.period_start
      AND a.created_at < pd.period_end
      AND a.source_type = 'finished_good'
  )
  SELECT
    tc.tax_class AS ttb_tax_class,
    -- Taxpaid domestic (orders that are not export)
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'order' AND NOT COALESCE(a.is_export, FALSE)
      THEN a.volume_bbl
      ELSE 0
    END), 0) AS taxpaid_domestic_bbl,
    -- Taxpaid export
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'order' AND COALESCE(a.is_export, FALSE)
      THEN a.volume_bbl
      ELSE 0
    END), 0) AS taxpaid_export_bbl,
    -- Tax-free samples
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'sample'
      THEN a.volume_bbl
      ELSE 0
    END), 0) AS tax_free_samples_bbl,
    -- Losses
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'loss'
      THEN a.volume_bbl
      ELSE 0
    END), 0) AS losses_bbl,
    -- Destroyed
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'destruction'
      THEN a.volume_bbl
      ELSE 0
    END), 0) AS destroyed_bbl,
    -- Adjustments
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'adjustment'
      THEN a.volume_bbl
      ELSE 0
    END), 0) AS adjustments_bbl
  FROM (VALUES ('cellar'), ('keg'), ('bottled')) AS tc(tax_class)
  LEFT JOIN fg_allocations a ON a.tax_class = tc.tax_class
  GROUP BY tc.tax_class;
$$;

COMMENT ON FUNCTION get_ttb_removals_summary IS 'Returns TTB removals summary by tax class for a given month';

-- =============================================================================
-- 7. COMPREHENSIVE TTB REPORT FUNCTION
-- =============================================================================
-- Returns full TTB Form 5130.9 data for a given period

CREATE OR REPLACE FUNCTION get_ttb_report(
  p_year INTEGER,
  p_month INTEGER
)
RETURNS TABLE (
  report_year INTEGER,
  report_month INTEGER,
  report_period TEXT,
  ttb_tax_class TEXT,
  -- Part I - Operations
  beginning_inventory_bbl DECIMAL(10,4),
  beer_produced_bbl DECIMAL(10,4),
  beer_received_bbl DECIMAL(10,4),
  -- Total Available
  total_available_bbl DECIMAL(10,4),
  -- Removals
  taxpaid_domestic_bbl DECIMAL(10,4),
  taxpaid_export_bbl DECIMAL(10,4),
  tax_free_samples_bbl DECIMAL(10,4),
  losses_bbl DECIMAL(10,4),
  destroyed_bbl DECIMAL(10,4),
  adjustments_bbl DECIMAL(10,4),
  -- Total Removals
  total_removals_bbl DECIMAL(10,4),
  -- Ending
  ending_inventory_bbl DECIMAL(10,4),
  -- In Process (Cellar)
  in_process_beginning_bbl DECIMAL(10,4),
  in_process_ending_bbl DECIMAL(10,4)
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH inventory AS (
    SELECT * FROM get_ttb_inventory_summary(p_year, p_month)
  ),
  production AS (
    SELECT * FROM get_ttb_production_summary(p_year, p_month)
  ),
  removals AS (
    SELECT * FROM get_ttb_removals_summary(p_year, p_month)
  )
  SELECT
    p_year AS report_year,
    p_month AS report_month,
    TO_CHAR(make_date(p_year, p_month, 1), 'Month YYYY') AS report_period,
    COALESCE(i.ttb_tax_class, p.ttb_tax_class, r.ttb_tax_class) AS ttb_tax_class,
    -- Beginning inventory
    COALESCE(i.beginning_inventory_bbl, 0) AS beginning_inventory_bbl,
    -- Production
    COALESCE(p.beer_packaged_bbl, 0) AS beer_produced_bbl,
    0::DECIMAL(10,4) AS beer_received_bbl,  -- Future: track transfers in
    -- Total available
    (COALESCE(i.beginning_inventory_bbl, 0) + COALESCE(p.beer_packaged_bbl, 0))::DECIMAL(10,4) AS total_available_bbl,
    -- Removals
    COALESCE(r.taxpaid_domestic_bbl, 0) AS taxpaid_domestic_bbl,
    COALESCE(r.taxpaid_export_bbl, 0) AS taxpaid_export_bbl,
    COALESCE(r.tax_free_samples_bbl, 0) AS tax_free_samples_bbl,
    COALESCE(r.losses_bbl, 0) AS losses_bbl,
    COALESCE(r.destroyed_bbl, 0) AS destroyed_bbl,
    COALESCE(r.adjustments_bbl, 0) AS adjustments_bbl,
    -- Total removals
    (COALESCE(r.taxpaid_domestic_bbl, 0) +
     COALESCE(r.taxpaid_export_bbl, 0) +
     COALESCE(r.tax_free_samples_bbl, 0) +
     COALESCE(r.losses_bbl, 0) +
     COALESCE(r.destroyed_bbl, 0) +
     COALESCE(r.adjustments_bbl, 0))::DECIMAL(10,4) AS total_removals_bbl,
    -- Ending inventory
    COALESCE(i.ending_inventory_bbl, 0) AS ending_inventory_bbl,
    -- In process
    COALESCE(i.in_process_beginning_bbl, 0) AS in_process_beginning_bbl,
    COALESCE(i.in_process_ending_bbl, 0) AS in_process_ending_bbl
  FROM inventory i
  FULL OUTER JOIN production p ON i.ttb_tax_class = p.ttb_tax_class
  FULL OUTER JOIN removals r ON COALESCE(i.ttb_tax_class, p.ttb_tax_class) = r.ttb_tax_class
  ORDER BY
    CASE COALESCE(i.ttb_tax_class, p.ttb_tax_class, r.ttb_tax_class)
      WHEN 'cellar' THEN 1
      WHEN 'keg' THEN 2
      WHEN 'bottled' THEN 3
    END;
$$;

COMMENT ON FUNCTION get_ttb_report IS 'Returns comprehensive TTB Form 5130.9 data by tax class for a given month';

-- =============================================================================
-- 8. TTB REPORT TOTALS VIEW
-- =============================================================================
-- Provides a simple summary view for the report page

CREATE OR REPLACE VIEW ttb_current_month_summary
WITH (security_invoker = true)
AS
SELECT
  EXTRACT(YEAR FROM NOW())::INTEGER AS report_year,
  EXTRACT(MONTH FROM NOW())::INTEGER AS report_month,
  TO_CHAR(NOW(), 'Month YYYY') AS report_period,
  -- In-process totals
  COALESCE(SUM(b.volume_bbl) FILTER (WHERE b.status IN ('fermenting', 'conditioning', 'packaging')), 0) AS in_process_bbl,
  COUNT(*) FILTER (WHERE b.status IN ('fermenting', 'conditioning', 'packaging')) AS in_process_batch_count,
  -- Completed this month
  COALESCE(SUM(b.volume_bbl) FILTER (
    WHERE b.status = 'completed'
    AND DATE_TRUNC('month', b.updated_at) = DATE_TRUNC('month', NOW())
  ), 0) AS completed_this_month_bbl,
  COUNT(*) FILTER (
    WHERE b.status = 'completed'
    AND DATE_TRUNC('month', b.updated_at) = DATE_TRUNC('month', NOW())
  ) AS completed_this_month_count
FROM batches b;

COMMENT ON VIEW ttb_current_month_summary IS 'Quick summary of TTB-relevant data for current month';

-- =============================================================================
-- 9. ADD IS_EXPORT COLUMN TO ORDERS IF NOT EXISTS
-- =============================================================================
-- Check and add is_export column for export order tracking

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'is_export'
  ) THEN
    ALTER TABLE orders ADD COLUMN is_export BOOLEAN DEFAULT FALSE;
    COMMENT ON COLUMN orders.is_export IS 'Whether this order is for export (tax-free TTB removal)';
  END IF;
END $$;

-- =============================================================================
-- 10. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples, ai_context)
VALUES
  ('finished_goods_with_ttb_class',
   'Finished goods with TTB tax class (cellar, keg, bottled) and volume in BBL for compliance reporting.',
   'production',
   '{"package_types": "package_type_id", "brands": "brand_id", "batches": "batch_id"}'::jsonb,
   '["id", "ttb_tax_class", "volume_bbl", "production_date", "brand_name"]'::jsonb,
   '["Show finished goods by TTB class", "Calculate total BBL in kegs", "List packaged beer for current month"]'::jsonb,
   '"View for TTB Form 5130.9 compliance. Maps container_type to tax classes: keg (Column C), bottled (Column F). Volume calculated as quantity × volume_oz / 3968."'::jsonb),

  ('ttb_in_process_beer',
   'Beer currently in fermentation/conditioning (cellar operations) for TTB tracking.',
   'production',
   '{"batches": "batch_id"}'::jsonb,
   '["batch_id", "batch_number", "status", "volume_bbl", "ttb_tax_class"]'::jsonb,
   '["Show beer in process", "What is in fermentation?", "TTB cellar inventory"]'::jsonb,
   '"Tracks beer in cellar operations (fermenting, conditioning, packaging status). Used for TTB Form 5130.9 Part I beginning/ending in-process inventory."'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples,
  ai_context = EXCLUDED.ai_context;
