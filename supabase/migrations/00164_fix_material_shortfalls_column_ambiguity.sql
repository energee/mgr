-- =============================================================================
-- Migration: 00164_fix_material_shortfalls_column_ambiguity
--
-- Fixes runtime error in calculate_material_shortfalls():
--   42702: column reference "inventory_item_id" is ambiguous
--   It could refer to either a PL/pgSQL variable or a table column.
--
-- The function declares `inventory_item_id` as an OUT column in its
-- RETURNS TABLE clause, and inner CTEs reference unqualified
-- `inventory_item_id` columns. Postgres cannot disambiguate the OUT
-- parameter from CTE columns and aborts.
--
-- Primary fix: add `#variable_conflict use_column` to the PL/pgSQL body so
-- unqualified identifiers resolve to columns. The OUT parameters remain
-- accessible only via assignment, which we don't use (RETURN QUERY).
--
-- Secondary clarity change: replace `LEFT JOIN ... USING (inventory_item_id)`
-- with explicit `ON x.col = y.col`. Not strictly required for the bug fix,
-- but makes the join sides explicit and easier to reason about given the
-- OUT-parameter shadowing context.
--
-- Function signature is unchanged; this is a safe in-place CREATE OR REPLACE.
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
-- Resolve unqualified identifiers as columns, not OUT parameters.
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH
  catalog_items AS (
    SELECT id, name, 'malt'    AS ct FROM malts
    UNION ALL SELECT id, name, 'hop'     FROM hops
    UNION ALL SELECT id, name, 'yeast'   FROM yeasts
    UNION ALL SELECT id, name, 'adjunct' FROM adjuncts
    UNION ALL SELECT id, name, 'sugar'   FROM sugars
    UNION ALL SELECT id, name, 'spice'   FROM spices
    UNION ALL SELECT id, name, 'fruit'   FROM fruits
  ),

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
           WHEN 'hop'     THEN 'hop'
           WHEN 'yeast'   THEN 'yeast'
           WHEN 'adjunct' THEN 'adjunct'
           ELSE d.catalog_type
         END
  ),

  packaging_demand AS (
    SELECT
      pd.inventory_item_id,
      pd.inventory_item_name,
      pd.category,
      'packaging'::TEXT                       AS demand_source,
      pd.earliest_needed_by                   AS needed_by_date,
      pd.total_required,
      pd.unit,
      pd.source_count
    FROM calculate_packaging_material_demand(p_horizon_weeks) pd
  ),

  shipping_demand AS (
    SELECT
      sd.inventory_item_id,
      sd.inventory_item_name,
      sd.category,
      'shipping'::TEXT                        AS demand_source,
      sd.earliest_needed_by                   AS needed_by_date,
      sd.total_required,
      sd.unit,
      sd.source_count
    FROM calculate_shipping_material_demand(p_horizon_weeks) sd
  ),

  all_demand AS (
    SELECT * FROM brewing_demand
    UNION ALL
    SELECT * FROM packaging_demand
    UNION ALL
    SELECT * FROM shipping_demand
  ),

  inventory_available AS (
    SELECT
      ilq.inventory_item_id,
      COALESCE(SUM(ilq.remaining_quantity), 0)::DECIMAL(12,4) AS on_hand
    FROM inventory_lots_with_quantities ilq
    GROUP BY ilq.inventory_item_id
  ),

  po_received_summary AS (
    SELECT pr.po_line_item_id, SUM(pr.quantity) AS received_qty
    FROM po_receives pr
    GROUP BY pr.po_line_item_id
  ),

  open_po_quantities AS (
    SELECT
      ii.id AS inventory_item_id,
      GREATEST(pli.quantity - COALESCE(prs.received_qty, 0), 0) AS outstanding_qty
    FROM po_line_items pli
    JOIN purchase_orders po ON po.id = pli.po_id
    LEFT JOIN po_received_summary prs ON prs.po_line_item_id = pli.id
    JOIN catalog_items cat ON cat.id = pli.catalog_id AND cat.ct = pli.catalog_type
    JOIN inventory_items ii
      ON ii.name ILIKE cat.name
     AND ii.category = CASE pli.catalog_type
           WHEN 'malt'    THEN 'grain'
           WHEN 'hop'     THEN 'hop'
           WHEN 'yeast'   THEN 'yeast'
           WHEN 'adjunct' THEN 'adjunct'
           ELSE pli.catalog_type
         END
    WHERE po.status IN ('submitted', 'confirmed', 'partial')
      AND pli.catalog_type != 'inventory_item'

    UNION ALL

    SELECT
      pli.catalog_id AS inventory_item_id,
      GREATEST(pli.quantity - COALESCE(prs.received_qty, 0), 0) AS outstanding_qty
    FROM po_line_items pli
    JOIN purchase_orders po ON po.id = pli.po_id
    LEFT JOIN po_received_summary prs ON prs.po_line_item_id = pli.id
    WHERE po.status IN ('submitted', 'confirmed', 'partial')
      AND pli.catalog_type = 'inventory_item'
  ),

  po_agg AS (
    SELECT
      opq.inventory_item_id,
      COALESCE(SUM(opq.outstanding_qty), 0)::DECIMAL(12,4) AS incoming_po
    FROM open_po_quantities opq
    GROUP BY opq.inventory_item_id
  ),

  supplier_candidates AS (
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
           WHEN 'hop'     THEN 'hop'
           WHEN 'yeast'   THEN 'yeast'
           WHEN 'adjunct' THEN 'adjunct'
           ELSE sc.catalog_type
         END
    WHERE sc.catalog_type != 'inventory_item'

    UNION ALL

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
  LEFT JOIN inventory_available ia ON ia.inventory_item_id = ad.inventory_item_id
  LEFT JOIN po_agg            pa   ON pa.inventory_item_id = ad.inventory_item_id
  LEFT JOIN best_suppliers    bs   ON bs.inv_item_id        = ad.inventory_item_id
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
