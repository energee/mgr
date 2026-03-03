-- =============================================================================
-- Migration: Drop old package_types/keg_types columns and tables
-- =============================================================================
-- All referencing tables now use selling_format_id. Old columns can be dropped.
-- Also fixes remaining stale views/functions that still referenced old tables.

-- -----------------------------------------------------------------------------
-- Part 1: Fix remaining stale views and functions
-- -----------------------------------------------------------------------------

-- 1. Rebuild order_items_with_details view
DROP VIEW IF EXISTS order_items_with_details CASCADE;

CREATE VIEW order_items_with_details
WITH (security_invoker = true)
AS
SELECT
  oi.id,
  oi.order_id,
  oi.package_id,
  oi.batch_id,
  oi.selling_format_id,
  oi.quantity,
  oi.unit_price,
  oi.notes,
  oi.created_at,
  oi.brand_id,
  b.name AS brand_name,
  b.abv AS brand_abv,
  sf.name AS selling_format_name,
  c.type AS container_type,
  c.volume_oz,
  sf.unit_count,
  c.name AS container_name,
  oi.quantity::numeric * COALESCE(oi.unit_price, 0::numeric) AS line_total
FROM order_items oi
  LEFT JOIN brands b ON b.id = oi.brand_id
  LEFT JOIN selling_formats sf ON sf.id = oi.selling_format_id
  LEFT JOIN containers c ON c.id = sf.container_id;

-- 2. Rebuild pricing_formats view (was UNION of package_types + keg_types)
DROP VIEW IF EXISTS pricing_formats CASCADE;

CREATE VIEW pricing_formats
WITH (security_invoker = true)
AS
SELECT
  sf.id,
  sf.name,
  c.type AS container_type,
  CASE c.type
    WHEN 'keg' THEN 'keg_type'
    ELSE 'package_type'
  END AS format_source,
  CASE c.type
    WHEN 'keg' THEN 2
    ELSE 1
  END AS sort_group
FROM selling_formats sf
JOIN containers c ON c.id = sf.container_id
WHERE sf.is_active = true
  AND c.is_active = true;

-- 3. Rebuild record_keg_transaction function (p_keg_type_id -> p_selling_format_id)
DROP FUNCTION IF EXISTS record_keg_transaction(keg_transaction_type, uuid, integer, keg_state, keg_state, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION record_keg_transaction(
  p_transaction_type keg_transaction_type,
  p_selling_format_id uuid,
  p_quantity integer,
  p_from_state keg_state,
  p_to_state keg_state,
  p_from_location_id uuid DEFAULT NULL,
  p_to_location_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_packaging_session_id uuid DEFAULT NULL,
  p_batch_id uuid DEFAULT NULL,
  p_finished_good_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_created_by_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_transaction_id UUID;
BEGIN
  INSERT INTO keg_transactions (
    transaction_type, selling_format_id, quantity,
    from_state, to_state,
    from_location_id, to_location_id,
    order_id, customer_id, packaging_session_id,
    batch_id, finished_good_id,
    notes, created_by_name
  ) VALUES (
    p_transaction_type, p_selling_format_id, p_quantity,
    p_from_state, p_to_state,
    p_from_location_id, p_to_location_id,
    p_order_id, p_customer_id, p_packaging_session_id,
    p_batch_id, p_finished_good_id,
    p_notes, p_created_by_name
  )
  RETURNING id INTO v_transaction_id;

  RETURN v_transaction_id;
END;
$$;

-- 4. Rebuild get_ttb_production_summary (package_types -> selling_formats + containers)
DROP FUNCTION IF EXISTS get_ttb_production_summary(integer, integer);

CREATE FUNCTION get_ttb_production_summary(p_year integer, p_month integer)
RETURNS TABLE(
  ttb_tax_class text,
  beer_produced_bbl decimal,
  beer_packaged_bbl decimal,
  finished_goods_count bigint
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH period_dates AS (
    SELECT
      make_date(p_year, p_month, 1) AS period_start,
      (make_date(p_year, p_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::DATE AS period_end
  ),
  fg_summary AS (
    SELECT
      get_ttb_tax_class(c.type) AS tax_class,
      SUM((fg.quantity * c.volume_oz / 3968.0)::DECIMAL(10,4)) AS packaged_bbl,
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
$$;

-- 5. Rebuild get_ttb_inventory_summary
DROP FUNCTION IF EXISTS get_ttb_inventory_summary(integer, integer);

CREATE FUNCTION get_ttb_inventory_summary(p_year integer, p_month integer)
RETURNS TABLE(
  ttb_tax_class text,
  beginning_inventory_bbl decimal,
  ending_inventory_bbl decimal,
  in_process_beginning_bbl decimal,
  in_process_ending_bbl decimal
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH period_dates AS (
    SELECT
      make_date(p_year, p_month, 1) AS period_start,
      (make_date(p_year, p_month, 1) + INTERVAL '1 month')::TIMESTAMPTZ AS period_end_ts
  ),
  fg_produced_before AS (
    SELECT
      fg.id,
      get_ttb_tax_class(c.type) AS tax_class,
      (fg.quantity * c.volume_oz / 3968.0)::DECIMAL(10,4) AS produced_bbl
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
      (fg.quantity * c.volume_oz / 3968.0)::DECIMAL(10,4) AS produced_bbl
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
$$;

-- 6. Rebuild get_ttb_removals_summary
DROP FUNCTION IF EXISTS get_ttb_removals_summary(integer, integer);

CREATE FUNCTION get_ttb_removals_summary(p_year integer, p_month integer)
RETURNS TABLE(
  ttb_tax_class text,
  taxpaid_domestic_bbl decimal,
  taxpaid_export_bbl decimal,
  tax_free_samples_bbl decimal,
  losses_bbl decimal,
  destroyed_bbl decimal,
  adjustments_bbl decimal
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
    COALESCE(SUM(CASE
      WHEN a.destination_type = 'order' AND NOT COALESCE(a.is_export, FALSE)
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
$$;

-- 7. Rebuild generate_pick_list function
DROP FUNCTION IF EXISTS generate_pick_list(uuid);

CREATE FUNCTION generate_pick_list(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_pick_list_id UUID;
  v_order_item RECORD;
  v_fg RECORD;
  v_remaining NUMERIC;
  v_alloc_qty NUMERIC;
  v_sort INTEGER := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM pick_lists WHERE order_id = p_order_id AND status NOT IN ('cancelled')) THEN
    RAISE EXCEPTION 'Active pick list already exists for this order';
  END IF;

  INSERT INTO pick_lists (order_id, status)
  VALUES (p_order_id, 'draft')
  RETURNING id INTO v_pick_list_id;

  FOR v_order_item IN
    SELECT
      oi.id AS order_item_id,
      oi.quantity,
      oi.finished_good_id AS specific_fg_id,
      fg.brand_id,
      fg.selling_format_id
    FROM order_items oi
    LEFT JOIN finished_goods fg ON fg.id = oi.finished_good_id
    WHERE oi.order_id = p_order_id
    ORDER BY oi.created_at
  LOOP
    v_remaining := v_order_item.quantity;

    FOR v_fg IN
      SELECT
        fg_loc.finished_good_id,
        fg_loc.available_quantity,
        fg_loc.production_date,
        fg_loc.location_id
      FROM (
        SELECT DISTINCT ON (fga.id)
          fga.id AS finished_good_id,
          fga.available_quantity,
          fga.production_date,
          l.id AS location_id
        FROM finished_goods_with_availability fga
        LEFT JOIN bin_inventory bi ON bi.finished_good_id = fga.id
        LEFT JOIN bins b ON b.id = bi.bin_id
        LEFT JOIN locations l ON l.id = b.location_id
        WHERE fga.available_quantity > 0
          AND (
            fga.id = v_order_item.specific_fg_id
            OR (
              v_order_item.specific_fg_id IS NULL
              AND fga.brand_id = v_order_item.brand_id
              AND fga.selling_format_id = v_order_item.selling_format_id
            )
          )
        ORDER BY fga.id, bi.quantity DESC NULLS LAST
      ) fg_loc
      ORDER BY fg_loc.production_date ASC NULLS LAST
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_alloc_qty := LEAST(v_remaining, v_fg.available_quantity);
      v_sort := v_sort + 1;

      INSERT INTO pick_list_items (
        pick_list_id,
        order_item_id,
        finished_good_id,
        location_id,
        quantity_requested,
        sort_order
      ) VALUES (
        v_pick_list_id,
        v_order_item.order_item_id,
        v_fg.finished_good_id,
        v_fg.location_id,
        v_alloc_qty,
        v_sort
      );

      v_remaining := v_remaining - v_alloc_qty;
    END LOOP;
  END LOOP;

  RETURN v_pick_list_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- Part 2: Drop old columns and tables
-- -----------------------------------------------------------------------------

-- Handle packages table (add new FK, drop old)
ALTER TABLE packages ADD COLUMN selling_format_id UUID REFERENCES selling_formats(id) ON DELETE RESTRICT;
ALTER TABLE packages DROP COLUMN package_type_id;

-- Fix keg_owner_deposits unique constraint
ALTER TABLE keg_owner_deposits DROP CONSTRAINT keg_owner_deposits_keg_owner_id_keg_type_id_key;
ALTER TABLE keg_owner_deposits ADD CONSTRAINT keg_owner_deposits_keg_owner_id_selling_format_id_key UNIQUE (keg_owner_id, selling_format_id);

-- Drop old FK columns from referencing tables
ALTER TABLE order_items DROP COLUMN package_type_id, DROP COLUMN keg_type_id;
ALTER TABLE session_line_items DROP COLUMN package_type_id, DROP COLUMN keg_type_id;
ALTER TABLE finished_goods DROP COLUMN package_type_id, DROP COLUMN keg_type_id;
ALTER TABLE keg_transactions DROP COLUMN keg_type_id;
ALTER TABLE keg_owner_deposits DROP COLUMN keg_type_id;
ALTER TABLE square_catalog_map DROP COLUMN package_type_id, DROP COLUMN keg_type_id;
ALTER TABLE square_draft_sales DROP COLUMN keg_type_id;

-- Drop old tables (CASCADE drops their policies, triggers, indexes)
DROP TABLE IF EXISTS package_types CASCADE;
DROP TABLE IF EXISTS keg_types CASCADE;

-- Remove old schema registry entries
DELETE FROM _schema_registry WHERE table_name IN ('package_types', 'keg_types');

-- Remove old enum_values for package_container_type
DELETE FROM enum_values WHERE enum_type = 'package_container_type';
