-- =============================================================================
-- Migration: 00163_calculate_material_shortfalls
--
-- Adds three functions that together produce a unified material shortfalls
-- report covering brewing ingredients, packaging materials, and shipping
-- materials across the planning horizon.
--
--   calculate_packaging_material_demand(p_horizon_weeks)
--     Aggregates packaging material demand from planned packaging sessions
--     via the selling_format_materials BOM.
--
--   calculate_shipping_material_demand(p_horizon_weeks)
--     Aggregates shipping material demand from open orders that have
--     order_materials rows (populated by the order materials auto-calc).
--
--   calculate_material_shortfalls(p_horizon_weeks)
--     Main entry point. Combines brewing ingredient demand
--     (calculate_ingredient_demand), packaging material demand, and shipping
--     material demand; then compares the union against on-hand inventory and
--     open PO quantities to produce per-item shortfall rows with lead-time,
--     drop-dead-date, and preferred supplier details.
--
-- The old calculate_ingredient_shortfalls function is kept for backwards
-- compatibility. New callers should use calculate_material_shortfalls.
-- =============================================================================

-- =============================================================================
-- 1. Performance indexes
-- =============================================================================

-- Speeds up the planned-sessions filter in calculate_packaging_material_demand.
CREATE INDEX IF NOT EXISTS idx_packaging_sessions_status_date
  ON packaging_sessions (status, session_date)
  WHERE status = 'planned';

-- Speeds up the BOM lookup join in calculate_packaging_material_demand.
CREATE INDEX IF NOT EXISTS idx_session_line_items_format
  ON session_line_items (selling_format_id)
  WHERE selling_format_id IS NOT NULL;

-- =============================================================================
-- 2. calculate_packaging_material_demand
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_packaging_material_demand(
  p_horizon_weeks INTEGER DEFAULT 8
)
RETURNS TABLE (
  inventory_item_id   UUID,
  inventory_item_name TEXT,
  category            TEXT,
  total_required      DECIMAL(12,4),
  unit                TEXT,
  earliest_needed_by  DATE,
  source_count        INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sfm.inventory_item_id,
    ii.name                                         AS inventory_item_name,
    ii.category,
    SUM(sli.planned_quantity * sfm.quantity_per_unit)::DECIMAL(12,4) AS total_required,
    ii.unit,
    MIN(ps.session_date)::DATE                      AS earliest_needed_by,
    COUNT(DISTINCT ps.id)::INTEGER                  AS source_count
  FROM packaging_sessions ps
  JOIN session_line_items sli
    ON sli.session_id = ps.id
  JOIN selling_format_materials sfm
    ON sfm.selling_format_id = sli.selling_format_id
  JOIN inventory_items ii
    ON ii.id = sfm.inventory_item_id
  WHERE ps.status = 'planned'
    AND ps.session_date <= (CURRENT_DATE + (p_horizon_weeks * 7))
    AND sli.selling_format_id IS NOT NULL
    AND sli.planned_quantity > 0
  GROUP BY sfm.inventory_item_id, ii.name, ii.category, ii.unit;
END;
$$;

COMMENT ON FUNCTION calculate_packaging_material_demand(INTEGER) IS
  'Aggregates packaging material demand from planned packaging sessions within the '
  'given horizon. Multiplies session line item planned_quantity by the '
  'selling_format_materials.quantity_per_unit BOM factor. Returns one row per '
  'inventory item with total required, earliest session date, and session count.';

-- =============================================================================
-- 3. calculate_shipping_material_demand
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_shipping_material_demand(
  p_horizon_weeks INTEGER DEFAULT 8
)
RETURNS TABLE (
  inventory_item_id   UUID,
  inventory_item_name TEXT,
  category            TEXT,
  total_required      DECIMAL(12,4),
  unit                TEXT,
  earliest_needed_by  DATE,
  source_count        INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    om.inventory_item_id,
    ii.name                                         AS inventory_item_name,
    ii.category,
    SUM(COALESCE(om.actual_qty, om.estimated_qty))::DECIMAL(12,4) AS total_required,
    ii.unit,
    MIN(COALESCE(o.scheduled_date, o.requested_date))::DATE AS earliest_needed_by,
    COUNT(DISTINCT om.order_id)::INTEGER            AS source_count
  FROM order_materials om
  JOIN orders o
    ON o.id = om.order_id
  JOIN inventory_items ii
    ON ii.id = om.inventory_item_id
  WHERE o.status IN ('confirmed', 'scheduled', 'picking', 'packed')
    AND COALESCE(o.scheduled_date, o.requested_date) <=
          (CURRENT_DATE + (p_horizon_weeks * 7))
    AND COALESCE(om.actual_qty, om.estimated_qty) > 0
  GROUP BY om.inventory_item_id, ii.name, ii.category, ii.unit;
END;
$$;

COMMENT ON FUNCTION calculate_shipping_material_demand(INTEGER) IS
  'Aggregates shipping material demand from open orders (confirmed, scheduled, '
  'picking, packed) within the given horizon. Uses actual_qty when set, otherwise '
  'falls back to estimated_qty from order_materials. Returns one row per inventory '
  'item with total required, earliest order date, and order count.';

-- =============================================================================
-- 4. calculate_material_shortfalls
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_material_shortfalls(
  p_horizon_weeks INTEGER DEFAULT 8
)
RETURNS TABLE (
  inventory_item_id   UUID,
  inventory_item_name TEXT,
  category            TEXT,
  demand_source       TEXT,
  needed_by_date      DATE,
  quantity_needed     DECIMAL(12,4),
  on_hand             DECIMAL(12,4),
  incoming_po         DECIMAL(12,4),
  shortfall           DECIMAL(12,4),
  unit                TEXT,
  best_supplier_id    UUID,
  best_supplier_name  TEXT,
  lead_time_days      INTEGER,
  drop_dead_date      DATE,
  is_past_due         BOOLEAN,
  source_count        INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH
  -- ─────────────────────────────────────────────────────────────────────────
  -- Shared: catalog items union (used by PO and supplier CTEs)
  -- ─────────────────────────────────────────────────────────────────────────
  catalog_items AS (
    SELECT id, name, 'malt'    AS ct FROM malts
    UNION ALL SELECT id, name, 'hop'     FROM hops
    UNION ALL SELECT id, name, 'yeast'   FROM yeasts
    UNION ALL SELECT id, name, 'adjunct' FROM adjuncts
    UNION ALL SELECT id, name, 'sugar'   FROM sugars
    UNION ALL SELECT id, name, 'spice'   FROM spices
    UNION ALL SELECT id, name, 'fruit'   FROM fruits
  ),

  -- ─────────────────────────────────────────────────────────────────────────
  -- Demand CTEs
  -- ─────────────────────────────────────────────────────────────────────────

  -- Brewing ingredient demand — translate catalog refs to inventory_item rows.
  -- calculate_ingredient_demand returns (catalog_type, catalog_id, catalog_name)
  -- keyed to the catalog tables (malts, hops, etc.).
  -- inventory_items does not store catalog FKs, so we use best-effort name
  -- matching (ILIKE) with catalog_type→category normalization, consistent with
  -- the existing calculate_ingredient_shortfalls approach.
  brewing_demand AS (
    SELECT
      ii.id                                   AS inventory_item_id,
      ii.name                                 AS inventory_item_name,
      ii.category,
      'brewing'::TEXT                         AS demand_source,
      d.earliest_required_by                  AS needed_by_date,
      d.total_required,
      d.unit,
      d.batch_count                           AS source_count
    FROM calculate_ingredient_demand(p_horizon_weeks, true, true) d
    JOIN inventory_items ii
      ON ii.name ILIKE d.catalog_name
     AND ii.category = CASE d.catalog_type
           WHEN 'malt'    THEN 'grain'
           WHEN 'hop'     THEN 'hops'
           WHEN 'yeast'   THEN 'yeast'
           WHEN 'adjunct' THEN 'adjunct'
           ELSE d.catalog_type
         END
  ),

  -- Packaging material demand
  packaging_demand AS (
    SELECT
      pd.inventory_item_id,
      pd.inventory_item_name,
      pd.category,
      'packaging'::TEXT AS demand_source,
      pd.earliest_needed_by AS needed_by_date,
      pd.total_required,
      pd.unit,
      pd.source_count
    FROM calculate_packaging_material_demand(p_horizon_weeks) pd
  ),

  -- Shipping material demand
  shipping_demand AS (
    SELECT
      sd.inventory_item_id,
      sd.inventory_item_name,
      sd.category,
      'shipping'::TEXT AS demand_source,
      sd.earliest_needed_by AS needed_by_date,
      sd.total_required,
      sd.unit,
      sd.source_count
    FROM calculate_shipping_material_demand(p_horizon_weeks) sd
  ),

  -- Union all three demand streams
  all_demand AS (
    SELECT * FROM brewing_demand
    UNION ALL
    SELECT * FROM packaging_demand
    UNION ALL
    SELECT * FROM shipping_demand
  ),

  -- ─────────────────────────────────────────────────────────────────────────
  -- Supply CTEs
  -- ─────────────────────────────────────────────────────────────────────────

  -- On-hand inventory grouped by inventory_item_id
  inventory_available AS (
    SELECT
      ilq.inventory_item_id,
      COALESCE(SUM(ilq.remaining_quantity), 0)::DECIMAL(12,4) AS on_hand
    FROM inventory_lots_with_quantities ilq
    GROUP BY ilq.inventory_item_id
  ),

  -- Pre-aggregate received PO quantities to avoid per-row lateral work
  po_received_summary AS (
    SELECT pr.po_line_item_id, SUM(pr.quantity) AS received_qty
    FROM po_receives pr
    GROUP BY pr.po_line_item_id
  ),

  -- Outstanding quantities from open POs.  Two legs:
  --   1. Catalog-linked line items (malt, hop, etc.): match to inventory_items
  --      via name ILIKE + category normalization (same pattern as ingredient shortfalls).
  --   2. Inventory-item-linked line items (catalog_type = 'inventory_item'):
  --      catalog_id is the inventory_item_id directly.
  open_po_quantities AS (
    -- Leg 1: catalog-linked (malt, hop, yeast, adjunct, etc.)
    SELECT
      ii.id AS inventory_item_id,
      GREATEST(pli.quantity - COALESCE(prs.received_qty, 0), 0) AS outstanding_qty
    FROM po_line_items pli
    JOIN purchase_orders po ON po.id = pli.po_id
    LEFT JOIN po_received_summary prs ON prs.po_line_item_id = pli.id
    -- Resolve catalog item name from the appropriate catalog table
    JOIN catalog_items cat ON cat.id = pli.catalog_id AND cat.ct = pli.catalog_type
    JOIN inventory_items ii
      ON ii.name ILIKE cat.name
     AND ii.category = CASE pli.catalog_type
           WHEN 'malt'    THEN 'grain'
           WHEN 'hop'     THEN 'hops'
           WHEN 'yeast'   THEN 'yeast'
           WHEN 'adjunct' THEN 'adjunct'
           ELSE pli.catalog_type
         END
    WHERE po.status IN ('submitted', 'confirmed', 'partial')
      AND pli.catalog_type != 'inventory_item'

    UNION ALL

    -- Leg 2: direct inventory_item references (catalog_type = 'inventory_item')
    SELECT
      pli.catalog_id AS inventory_item_id,
      GREATEST(pli.quantity - COALESCE(prs.received_qty, 0), 0) AS outstanding_qty
    FROM po_line_items pli
    JOIN purchase_orders po ON po.id = pli.po_id
    LEFT JOIN po_received_summary prs ON prs.po_line_item_id = pli.id
    WHERE po.status IN ('submitted', 'confirmed', 'partial')
      AND pli.catalog_type = 'inventory_item'
  ),

  -- Aggregate open PO quantities per inventory item
  po_agg AS (
    SELECT
      inventory_item_id,
      COALESCE(SUM(outstanding_qty), 0)::DECIMAL(12,4) AS incoming_po
    FROM open_po_quantities
    GROUP BY inventory_item_id
  ),

  -- ─────────────────────────────────────────────────────────────────────────
  -- Best supplier per inventory item
  -- Two legs mirroring the PO logic:
  --   1. Catalog-linked supplier rows: name ILIKE + category normalisation
  --      maps catalog items to inventory_item rows.
  --   2. catalog_type = 'inventory_item' rows: catalog_id IS the inventory_item_id.
  -- ─────────────────────────────────────────────────────────────────────────
  supplier_candidates AS (
    -- Leg 1: catalog-linked suppliers (malt, hop, yeast, etc.)
    -- Match to inventory_items via name ILIKE + category normalization.
    SELECT
      ii.id                                                    AS inv_item_id,
      sc.supplier_id,
      s.name                                                   AS supplier_name,
      COALESCE(sc.lead_time_days, s.default_lead_time_days, 7) AS lead_time_days,
      sc.is_preferred,
      sc.price
    FROM supplier_catalog sc
    JOIN suppliers s ON s.id = sc.supplier_id
    JOIN catalog_items cat ON cat.id = sc.catalog_id AND cat.ct = sc.catalog_type
    JOIN inventory_items ii
      ON ii.name ILIKE cat.name
     AND ii.category = CASE sc.catalog_type
           WHEN 'malt'    THEN 'grain'
           WHEN 'hop'     THEN 'hops'
           WHEN 'yeast'   THEN 'yeast'
           WHEN 'adjunct' THEN 'adjunct'
           ELSE sc.catalog_type
         END
    WHERE sc.catalog_type != 'inventory_item'

    UNION ALL

    -- Leg 2: direct inventory_item suppliers
    SELECT
      sc.catalog_id                                            AS inv_item_id,
      sc.supplier_id,
      s.name                                                   AS supplier_name,
      COALESCE(sc.lead_time_days, s.default_lead_time_days, 7) AS lead_time_days,
      sc.is_preferred,
      sc.price
    FROM supplier_catalog sc
    JOIN suppliers s ON s.id = sc.supplier_id
    WHERE sc.catalog_type = 'inventory_item'
  ),

  best_suppliers AS (
    SELECT DISTINCT ON (inv_item_id)
      inv_item_id,
      supplier_id,
      supplier_name,
      lead_time_days
    FROM supplier_candidates
    ORDER BY inv_item_id, is_preferred DESC, lead_time_days ASC, price ASC NULLS LAST
  )

  -- ─────────────────────────────────────────────────────────────────────────
  -- Final result
  -- ─────────────────────────────────────────────────────────────────────────
  SELECT
    ad.inventory_item_id,
    ad.inventory_item_name,
    ad.category,
    ad.demand_source,
    ad.needed_by_date,
    ad.total_required                                         AS quantity_needed,
    COALESCE(ia.on_hand,    0)::DECIMAL(12,4)                AS on_hand,
    COALESCE(pa.incoming_po, 0)::DECIMAL(12,4)               AS incoming_po,
    GREATEST(
      ad.total_required
        - COALESCE(ia.on_hand,     0)
        - COALESCE(pa.incoming_po, 0),
      0
    )::DECIMAL(12,4)                                          AS shortfall,
    ad.unit,
    bs.supplier_id                                           AS best_supplier_id,
    bs.supplier_name                                         AS best_supplier_name,
    COALESCE(bs.lead_time_days, 7)::INTEGER                  AS lead_time_days,
    (ad.needed_by_date - COALESCE(bs.lead_time_days, 7))::DATE AS drop_dead_date,
    ((ad.needed_by_date - COALESCE(bs.lead_time_days, 7)) < CURRENT_DATE)::BOOLEAN AS is_past_due,
    ad.source_count
  FROM all_demand ad
  LEFT JOIN inventory_available ia USING (inventory_item_id)
  LEFT JOIN po_agg pa              USING (inventory_item_id)
  LEFT JOIN best_suppliers bs
    ON bs.inv_item_id = ad.inventory_item_id
  ORDER BY is_past_due DESC, drop_dead_date ASC;
END;
$$;

COMMENT ON FUNCTION calculate_material_shortfalls(INTEGER) IS
  'Unified material shortfalls report combining brewing ingredient demand '
  '(from calculate_ingredient_demand), packaging material demand '
  '(from calculate_packaging_material_demand), and shipping material demand '
  '(from calculate_shipping_material_demand). '
  'Compares total demand against on-hand inventory and open PO quantities to '
  'compute per-item shortfalls. Returns supplier lead-time, drop-dead order '
  'date, and past-due flag. Replaces the older calculate_ingredient_shortfalls '
  'function, which is retained for backwards compatibility.';
