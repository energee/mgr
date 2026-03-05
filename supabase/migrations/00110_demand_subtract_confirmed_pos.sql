-- =============================================================================
-- Migration: 00110_demand_subtract_confirmed_pos
--
-- Enhances demand planning in two ways:
-- 1. Adds yeast to recipe_ingredients_normalized view
-- 2. Modifies calculate_ingredient_shortfalls to subtract outstanding quantities
--    from confirmed POs (status IN ('confirmed', 'partial', 'fulfilled')),
--    preventing duplicate PO generation.
-- =============================================================================

-- =============================================================================
-- ADD YEAST TO RECIPE INGREDIENTS NORMALIZED VIEW
-- Yeast uses a simplified "packs" unit based on 1 pack per recipe addition.
-- =============================================================================

DROP VIEW IF EXISTS recipe_ingredients_normalized CASCADE;
CREATE VIEW recipe_ingredients_normalized
WITH (security_invoker = true)
AS
-- Malts (weight in lbs)
SELECT
  rm.recipe_id,
  'malt' as catalog_type,
  rm.malt_id as catalog_id,
  m.name as catalog_name,
  rm.weight_lbs as quantity,
  'lb' as unit
FROM recipe_malts rm
JOIN malts m ON m.id = rm.malt_id

UNION ALL

-- Hops (convert oz to lb for consistency)
SELECT
  rh.recipe_id,
  'hop' as catalog_type,
  rh.hop_id as catalog_id,
  h.name as catalog_name,
  rh.weight_oz / 16.0 as quantity,
  'lb' as unit
FROM recipe_hops rh
JOIN hops h ON h.id = rh.hop_id

UNION ALL

-- Adjuncts (weight in lbs)
SELECT
  ra.recipe_id,
  'adjunct' as catalog_type,
  ra.adjunct_id as catalog_id,
  a.name as catalog_name,
  ra.weight_lbs as quantity,
  'lb' as unit
FROM recipe_adjuncts ra
JOIN adjuncts a ON a.id = ra.adjunct_id

UNION ALL

-- Sugars (weight in lbs)
SELECT
  rs.recipe_id,
  'sugar' as catalog_type,
  rs.sugar_id as catalog_id,
  s.name as catalog_name,
  rs.weight_lbs as quantity,
  'lb' as unit
FROM recipe_sugars rs
JOIN sugars s ON s.id = rs.sugar_id

UNION ALL

-- Spices (convert to oz for standard unit)
SELECT
  rsp.recipe_id,
  'spice' as catalog_type,
  rsp.spice_id as catalog_id,
  sp.name as catalog_name,
  CASE rsp.unit
    WHEN 'oz' THEN rsp.amount
    WHEN 'g' THEN rsp.amount / 28.35
    WHEN 'tsp' THEN rsp.amount * 0.17  -- ~0.17 oz per tsp
    WHEN 'tbsp' THEN rsp.amount * 0.5  -- ~0.5 oz per tbsp
    ELSE rsp.amount
  END as quantity,
  'oz' as unit
FROM recipe_spices rsp
JOIN spices sp ON sp.id = rsp.spice_id

UNION ALL

-- Fruits (convert to lb)
SELECT
  rf.recipe_id,
  'fruit' as catalog_type,
  rf.fruit_id as catalog_id,
  f.name as catalog_name,
  CASE rf.unit
    WHEN 'lb' THEN rf.amount
    WHEN 'oz' THEN rf.amount / 16.0
    WHEN 'kg' THEN rf.amount * 2.205
    ELSE rf.amount
  END as quantity,
  'lb' as unit
FROM recipe_fruits rf
JOIN fruits f ON f.id = rf.fruit_id

UNION ALL

-- Yeasts (1 pack per recipe addition, scaled by batch volume ratio)
SELECT
  ry.recipe_id,
  'yeast' as catalog_type,
  ry.yeast_id as catalog_id,
  y.name as catalog_name,
  1.0 as quantity,  -- 1 pack per recipe addition; scales with batch volume ratio
  'pk' as unit
FROM recipe_yeasts ry
JOIN yeasts y ON y.id = ry.yeast_id;

COMMENT ON VIEW recipe_ingredients_normalized IS 'Normalized view of all recipe ingredients across all types (malts, hops, adjuncts, sugars, spices, fruits, yeasts) with consistent units. Yeast uses packs (pk) with 1 pack per recipe addition.';

-- =============================================================================
-- UPDATED CALCULATE INGREDIENT SHORTFALLS FUNCTION
-- Now subtracts outstanding quantities from confirmed POs to avoid duplicates.
-- Returns new on_order_qty column for UI display.
-- =============================================================================

DROP FUNCTION IF EXISTS calculate_ingredient_shortfalls(INTEGER);
CREATE OR REPLACE FUNCTION calculate_ingredient_shortfalls(
  p_horizon_weeks INTEGER DEFAULT 8
)
RETURNS TABLE (
  catalog_type TEXT,
  catalog_id UUID,
  catalog_name TEXT,
  total_required DECIMAL(12,4),
  available_qty DECIMAL(12,4),
  on_order_qty DECIMAL(12,4),
  shortfall_qty DECIMAL(12,4),
  unit TEXT,
  required_by_date DATE,
  order_by_date DATE,
  lead_time_days INTEGER,
  preferred_supplier_id UUID,
  preferred_supplier_name TEXT,
  min_order_qty DECIMAL(10,2),
  unit_price DECIMAL(10,4),
  is_urgent BOOLEAN,
  batch_count INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH demand AS (
    SELECT * FROM calculate_ingredient_demand(p_horizon_weeks, true, true)
  ),
  -- Get available inventory by matching catalog items to inventory_items by name
  inventory_available AS (
    SELECT
      CASE ii.category
        WHEN 'grain' THEN 'malt'
        WHEN 'hops' THEN 'hop'
        WHEN 'yeast' THEN 'yeast'
        WHEN 'adjunct' THEN 'adjunct'
        ELSE ii.category
      END as inferred_catalog_type,
      ii.name as item_name,
      COALESCE(SUM(ilq.remaining_quantity), 0) as available_qty
    FROM inventory_items ii
    LEFT JOIN inventory_lots_with_quantities ilq ON ilq.inventory_item_id = ii.id
    WHERE ii.is_active = true
    GROUP BY ii.category, ii.name
  ),
  -- Calculate outstanding quantities from confirmed POs (not draft or submitted)
  -- Outstanding = ordered - received for each line item
  confirmed_po_quantities AS (
    SELECT
      pli.catalog_type,
      pli.catalog_id,
      COALESCE(
        SUM(pli.quantity - COALESCE(recv.received_qty, 0)),
        0
      ) as on_order_qty
    FROM po_line_items pli
    JOIN purchase_orders po ON po.id = pli.po_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(pr.quantity), 0) as received_qty
      FROM po_receives pr
      WHERE pr.po_line_item_id = pli.id
    ) recv ON true
    WHERE po.status IN ('confirmed', 'partial', 'fulfilled')
    GROUP BY pli.catalog_type, pli.catalog_id
  ),
  -- Get preferred supplier info from supplier_catalog
  preferred_suppliers AS (
    SELECT DISTINCT ON (sc.catalog_type, sc.catalog_id)
      sc.catalog_type,
      sc.catalog_id,
      sc.supplier_id,
      s.name as supplier_name,
      sc.lead_time_days,
      sc.min_order_qty,
      sc.price as unit_price
    FROM supplier_catalog sc
    JOIN suppliers s ON s.id = sc.supplier_id
    WHERE sc.is_preferred = true
       OR sc.id IN (
         SELECT sc2.id
         FROM supplier_catalog sc2
         WHERE sc2.catalog_type = sc.catalog_type
           AND sc2.catalog_id = sc.catalog_id
         ORDER BY sc2.price ASC NULLS LAST
         LIMIT 1
       )
    ORDER BY sc.catalog_type, sc.catalog_id, sc.is_preferred DESC, sc.price ASC
  )
  SELECT
    d.catalog_type,
    d.catalog_id,
    d.catalog_name,
    d.total_required,
    COALESCE(ia.available_qty, 0)::DECIMAL(12,4) as available_qty,
    COALESCE(cpq.on_order_qty, 0)::DECIMAL(12,4) as on_order_qty,
    GREATEST(
      d.total_required - COALESCE(ia.available_qty, 0) - COALESCE(cpq.on_order_qty, 0),
      0
    )::DECIMAL(12,4) as shortfall_qty,
    d.unit,
    d.earliest_required_by as required_by_date,
    (d.earliest_required_by - COALESCE(ps.lead_time_days, 7) - 3)::DATE as order_by_date,
    COALESCE(ps.lead_time_days, 7)::INTEGER as lead_time_days,
    ps.supplier_id as preferred_supplier_id,
    ps.supplier_name as preferred_supplier_name,
    ps.min_order_qty,
    ps.unit_price,
    ((d.earliest_required_by - COALESCE(ps.lead_time_days, 7) - 3) <= (CURRENT_DATE + 3))::BOOLEAN as is_urgent,
    d.batch_count
  FROM demand d
  LEFT JOIN inventory_available ia
    ON ia.item_name ILIKE d.catalog_name
    AND ia.inferred_catalog_type = d.catalog_type
  LEFT JOIN confirmed_po_quantities cpq
    ON cpq.catalog_type = d.catalog_type
    AND cpq.catalog_id = d.catalog_id
  LEFT JOIN preferred_suppliers ps
    ON ps.catalog_type = d.catalog_type
    AND ps.catalog_id = d.catalog_id
  WHERE d.total_required > (COALESCE(ia.available_qty, 0) + COALESCE(cpq.on_order_qty, 0))
  ORDER BY is_urgent DESC, order_by_date ASC, d.catalog_type, d.total_required DESC;
END;
$$;

COMMENT ON FUNCTION calculate_ingredient_shortfalls IS 'Calculates ingredient shortfalls by comparing demand against inventory and outstanding confirmed PO quantities, with supplier info. Only shows items where demand exceeds inventory + on-order.';
