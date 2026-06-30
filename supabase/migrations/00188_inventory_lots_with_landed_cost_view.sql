-- =============================================================================
-- Derive landed cost at read time; stop feeding stale numbers into COGS
-- =============================================================================
-- inventory_lots.landed_cost is a STORED column, populated only as an UPDATE
-- side-effect of calculate_landed_cost() (invoked lazily from a read-path
-- display helper) and never recomputed when PO inputs (unit price, shipping,
-- tax, line mix) change. cogs_by_period read that stored column, so COGS could
-- be stale or zero for lots whose landed cost was never (re)calculated.
--
-- This migration introduces a read-time view, inventory_lots_with_landed_cost,
-- that computes landed cost per unit live — a faithful transcription of the
-- calculate_landed_cost() allocation formula (mig 00146): unit price plus PO
-- shipping + tax allocated proportionally by line value, divided per unit.
-- cogs_by_period is repointed at the view so COGS is always fresh.
--
-- Scope note: this does NOT yet drop the calculate_landed_cost() UPDATE
-- side-effect or retire the stored column. inventory_lots_with_quantities (the
-- inventory-lot UI) still reads the stored landed_cost, so removing the UPDATE
-- requires repointing that view too — deferred to DB-verified follow-up work
-- (the third bullet of P0 #4 / Phase 5 column retirement).
-- =============================================================================

CREATE OR REPLACE VIEW inventory_lots_with_landed_cost
WITH (security_invoker = true)
AS
SELECT
  il.id,
  il.inventory_item_id,
  il.po_receive_id,
  il.lot_number,
  il.quantity,
  il.unit,
  il.unit_cost,
  -- Derived landed cost per unit (replaces the stored il.landed_cost).
  -- Mirrors calculate_landed_cost() (mig 00146):
  --   * no shipping/tax overhead        -> landed = unit_price
  --   * total line value > 0            -> unit_price + (overhead * line_value_share) / qty
  --   * no prices (split overhead even) -> unit_price + (overhead / line_count) / qty
  -- Lots with no PO line (manual lots) or zero quantity yield NULL, matching
  -- the stored column's behaviour (calculate_landed_cost skipped them).
  CASE
    WHEN COALESCE(po.shipping_cost, 0) + COALESCE(po.tax, 0) = 0
      THEN pli.unit_price
    WHEN t.total_value > 0
      THEN ROUND(
        COALESCE(pli.unit_price, 0)
        + ((COALESCE(po.shipping_cost, 0) + COALESCE(po.tax, 0))
           * (COALESCE(pli.unit_price, 0) * pli.quantity) / t.total_value)
          / NULLIF(pli.quantity, 0),
        4)
    ELSE ROUND(
        COALESCE(pli.unit_price, 0)
        + ((COALESCE(po.shipping_cost, 0) + COALESCE(po.tax, 0)) / NULLIF(t.line_count, 0))
          / NULLIF(pli.quantity, 0),
        4)
  END::numeric(10, 4) AS landed_cost,
  il.received_date,
  il.expiration_date,
  il.location,
  il.notes,
  il.created_at,
  il.updated_at
FROM inventory_lots il
LEFT JOIN po_receives pr ON pr.id = il.po_receive_id
LEFT JOIN po_line_items pli ON pli.id = pr.po_line_item_id
LEFT JOIN purchase_orders po ON po.id = pli.po_id
LEFT JOIN LATERAL (
  SELECT
    COALESCE(SUM(x.unit_price * x.quantity), 0) AS total_value,
    COUNT(*)                                    AS line_count
  FROM po_line_items x
  WHERE x.po_id = pli.po_id
) t ON true;

COMMENT ON VIEW inventory_lots_with_landed_cost IS
  'Inventory lots with landed cost per unit derived at read time from the PO chain (po_receives -> po_line_items -> purchase_orders shipping/tax allocated by line value). Read-time replacement for the stored, drift-prone inventory_lots.landed_cost. See calculate_landed_cost() for the original formula.';

-- =============================================================================
-- cogs_by_period: source landed cost from the derivation view (not the stored
-- column). Identical to mig 00155 except the batch_allocations join target.
-- =============================================================================
CREATE OR REPLACE FUNCTION cogs_by_period(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  batch_id UUID,
  batch_code TEXT,
  batch_name TEXT,
  recipe_name TEXT,
  brand_name TEXT,
  brand_id UUID,
  volume_bbl DECIMAL,
  status TEXT,
  created_at TIMESTAMPTZ,
  malt_cost DECIMAL,
  hop_cost DECIMAL,
  yeast_cost DECIMAL,
  adjunct_cost DECIMAL,
  other_cost DECIMAL,
  total_ingredient_cost DECIMAL,
  total_landed_cost DECIMAL,
  cost_per_bbl DECIMAL,
  has_allocation_data BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH batch_allocations AS (
    SELECT
      a.destination_id AS batch_id,
      ii.category,
      SUM(a.quantity * COALESCE(a.unit_cost, il.unit_cost, 0)) AS ingredient_cost,
      SUM(a.quantity * COALESCE(il.landed_cost, 0)) AS landed_cost
    FROM allocations a
    JOIN inventory_lots_with_landed_cost il ON il.id = a.source_id
    JOIN inventory_items ii ON ii.id = il.inventory_item_id
    WHERE a.destination_type = 'batch'
      AND a.source_type = 'inventory_lot'
      AND a.status IN ('completed', 'planned')
    GROUP BY a.destination_id, ii.category
  ),
  pivoted AS (
    SELECT
      ba.batch_id,
      COALESCE(SUM(CASE WHEN ba.category = 'grain' THEN ba.ingredient_cost END), 0) AS malt_cost,
      COALESCE(SUM(CASE WHEN ba.category = 'hop' THEN ba.ingredient_cost END), 0) AS hop_cost,
      COALESCE(SUM(CASE WHEN ba.category = 'yeast' THEN ba.ingredient_cost END), 0) AS yeast_cost,
      COALESCE(SUM(CASE WHEN ba.category = 'adjunct' THEN ba.ingredient_cost END), 0) AS adjunct_cost,
      COALESCE(SUM(CASE WHEN ba.category NOT IN ('grain', 'hop', 'yeast', 'adjunct') THEN ba.ingredient_cost END), 0) AS other_cost,
      COALESCE(SUM(ba.ingredient_cost), 0) AS total_ingredient_cost,
      COALESCE(SUM(ba.landed_cost), 0) AS total_landed_cost,
      TRUE AS has_allocation_data
    FROM batch_allocations ba
    GROUP BY ba.batch_id
  )
  SELECT
    b.id AS batch_id,
    b.batch_code,
    b.name AS batch_name,
    r.name AS recipe_name,
    br.name AS brand_name,
    r.brand_id,
    b.volume_bbl,
    b.status,
    b.created_at,
    ROUND(COALESCE(p.malt_cost, 0)::numeric, 2) AS malt_cost,
    ROUND(COALESCE(p.hop_cost, 0)::numeric, 2) AS hop_cost,
    ROUND(COALESCE(p.yeast_cost, 0)::numeric, 2) AS yeast_cost,
    ROUND(COALESCE(p.adjunct_cost, 0)::numeric, 2) AS adjunct_cost,
    ROUND(COALESCE(p.other_cost, 0)::numeric, 2) AS other_cost,
    ROUND(COALESCE(p.total_ingredient_cost, 0)::numeric, 2) AS total_ingredient_cost,
    ROUND(COALESCE(p.total_landed_cost, 0)::numeric, 2) AS total_landed_cost,
    CASE
      WHEN COALESCE(b.volume_bbl, 0) > 0
      THEN ROUND((COALESCE(p.total_ingredient_cost, 0) / b.volume_bbl)::numeric, 2)
      ELSE NULL
    END AS cost_per_bbl,
    COALESCE(p.has_allocation_data, FALSE) AS has_allocation_data
  FROM batches b
  LEFT JOIN recipes r ON r.id = b.recipe_id
  LEFT JOIN brands br ON br.id = r.brand_id
  LEFT JOIN pivoted p ON p.batch_id = b.id
  WHERE b.created_at >= p_start_date
    AND b.created_at < (p_end_date + INTERVAL '1 day')
    AND b.status NOT IN ('cancelled', 'archived')
  ORDER BY b.created_at DESC;
END;
$$;
