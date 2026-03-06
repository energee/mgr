-- Fix vendor lead time cascade in calculate_ingredient_shortfalls.
-- Previously used only supplier_catalog.lead_time_days with a fallback to 7.
-- Now cascades: supplier_catalog lead time -> supplier default lead time -> 7 day fallback.

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
  -- Pre-aggregate received quantities to avoid per-row LATERAL subqueries
  po_received_summary AS (
    SELECT pr.po_line_item_id, SUM(pr.quantity) as received_qty
    FROM po_receives pr
    GROUP BY pr.po_line_item_id
  ),
  confirmed_po_quantities AS (
    SELECT
      pli.catalog_type,
      pli.catalog_id,
      COALESCE(
        SUM(pli.quantity - COALESCE(prs.received_qty, 0)),
        0
      ) as on_order_qty
    FROM po_line_items pli
    JOIN purchase_orders po ON po.id = pli.po_id
    LEFT JOIN po_received_summary prs ON prs.po_line_item_id = pli.id
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
      COALESCE(sc.lead_time_days, s.default_lead_time_days, 7) as lead_time_days,
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

COMMENT ON FUNCTION calculate_ingredient_shortfalls(INTEGER) IS
  'Calculates ingredient shortfalls for upcoming batches within the given horizon. '
  'Lead time cascades: supplier_catalog.lead_time_days -> suppliers.default_lead_time_days -> 7 day fallback.';
