-- =============================================================================
-- P0 #4 (tail): make calculate_landed_cost pure; repoint the lot UI view
-- =============================================================================
-- Two remaining bullets of P0 #4 (the view + cogs_by_period repoint landed in
-- mig 00175):
--
--   (a) calculate_landed_cost() used to UPDATE inventory_lots.landed_cost as a
--       side-effect, then read that column back for its landed_cost_per_unit
--       return value. That write is the source of the stored-column drift this
--       work removes. This rewrite computes landed_cost_per_unit INLINE (same
--       allocation formula) and drops every UPDATE — the function is now a pure
--       read, identical in output to the breakdown the UI already expects.
--
--   (b) inventory_lots_with_quantities (the Lots UI / valuation / projections
--       view) still exposed the stored il.landed_cost. It now sources landed
--       cost from inventory_lots_with_landed_cost (mig 00175), so the inventory
--       UI shows the same live-derived number COGS uses. After this, nothing
--       reads or writes the stored inventory_lots.landed_cost column; retiring
--       the column itself is deferred to Phase 5.
--
-- Drift note: the live DB still had the pre-00144/00146 shipping-only, 7-column
-- version of calculate_landed_cost (migs 00144 + 00146 were never deployed), so
-- this migration brings the function to the intended tax-aware 8-column shape.
-- The return signature changes (7 -> 8 cols), which CREATE OR REPLACE cannot do,
-- hence the DROP first.
-- =============================================================================

DROP FUNCTION IF EXISTS calculate_landed_cost(uuid);

CREATE OR REPLACE FUNCTION calculate_landed_cost(p_po_id uuid)
RETURNS TABLE (
  lot_id uuid,
  line_item_id uuid,
  catalog_type text,
  quantity numeric,
  unit_price numeric,
  allocated_shipping numeric,
  allocated_tax numeric,
  landed_cost_per_unit numeric
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH po AS (
    SELECT COALESCE(shipping_cost, 0) AS shipping_cost,
           COALESCE(tax, 0)           AS tax
    FROM purchase_orders
    WHERE id = p_po_id
  ),
  totals AS (
    SELECT COALESCE(SUM(unit_price * quantity), 0) AS total_value,
           COUNT(*)                                AS line_count
    FROM po_line_items
    WHERE po_id = p_po_id
  )
  SELECT
    il.id          AS lot_id,
    pli.id         AS line_item_id,
    pli.catalog_type,
    pli.quantity,
    pli.unit_price,
    -- allocated_shipping: ONLY shipping, allocated to the whole line by value
    -- (mig 00146). Zero when the PO has no shipping.
    CASE
      WHEN po.shipping_cost = 0 THEN 0::numeric
      WHEN totals.total_value > 0
        THEN ROUND(po.shipping_cost * (COALESCE(pli.unit_price, 0) * pli.quantity) / totals.total_value, 4)
      ELSE ROUND(po.shipping_cost / NULLIF(totals.line_count, 0), 4)
    END AS allocated_shipping,
    -- allocated_tax: ONLY tax, allocated the same way.
    CASE
      WHEN po.tax = 0 THEN 0::numeric
      WHEN totals.total_value > 0
        THEN ROUND(po.tax * (COALESCE(pli.unit_price, 0) * pli.quantity) / totals.total_value, 4)
      ELSE ROUND(po.tax / NULLIF(totals.line_count, 0), 4)
    END AS allocated_tax,
    -- landed_cost_per_unit: computed inline (replaces the old UPDATE-then-read).
    -- Matches inventory_lots_with_landed_cost (mig 00175) for received lots.
    -- Unreceived / zero-qty lots return 0, as the prior COALESCE(il.landed_cost,0)
    -- did for rows the UPDATE skipped.
    CASE
      WHEN po.shipping_cost + po.tax = 0
        THEN COALESCE(pli.unit_price, 0::numeric)
      WHEN il.id IS NULL OR COALESCE(pli.quantity, 0) <= 0
        THEN 0::numeric
      WHEN totals.total_value > 0
        THEN ROUND(
          COALESCE(pli.unit_price, 0)
          + (po.shipping_cost + po.tax)
            * (COALESCE(pli.unit_price, 0) * pli.quantity) / totals.total_value
            / pli.quantity,
          4)
      ELSE ROUND(
          COALESCE(pli.unit_price, 0)
          + (po.shipping_cost + po.tax) / NULLIF(totals.line_count, 0) / pli.quantity,
          4)
    END AS landed_cost_per_unit
  FROM po_line_items pli
  CROSS JOIN po
  CROSS JOIN totals
  LEFT JOIN po_receives pr ON pr.po_line_item_id = pli.id
  LEFT JOIN inventory_lots il ON il.po_receive_id = pr.id
  WHERE pli.po_id = p_po_id;
$$;

COMMENT ON FUNCTION calculate_landed_cost(uuid) IS
  'Pure read: returns the per-lot landed-cost breakdown for a PO (shipping + tax allocated proportionally by line value, both as separate columns, plus landed_cost_per_unit). Computes landed cost inline — no UPDATE side-effect. Mirrors inventory_lots_with_landed_cost (mig 00175).';

-- =============================================================================
-- inventory_lots_with_quantities: source landed_cost from the derivation view.
-- =============================================================================
-- inventory_lots_with_landed_cost (mig 00175) projects every inventory_lots
-- column in order, with landed_cost derived, so it is a drop-in replacement for
-- the base table here. Allocations are pre-aggregated in a subquery (instead of
-- the prior GROUP BY il.id) because GROUP BY's functional-dependency shortcut
-- only covers a real table's primary key, not a view's columns — grouping over
-- the view would force every il.* column into GROUP BY. The subquery keeps the
-- output shape (18 columns, same names/types) byte-identical to mig 00157.
-- =============================================================================

DROP VIEW IF EXISTS inventory_lots_with_quantities CASCADE;

CREATE VIEW inventory_lots_with_quantities
WITH (security_invoker = true)
AS
SELECT
  il.*,
  ii.name AS item_name,
  il.quantity AS received_quantity,
  COALESCE(alloc.allocated_quantity, 0::numeric) AS allocated_quantity,
  il.quantity - COALESCE(alloc.allocated_quantity, 0::numeric) AS remaining_quantity
FROM inventory_lots_with_landed_cost il
JOIN inventory_items ii ON ii.id = il.inventory_item_id
LEFT JOIN (
  SELECT a.source_id,
         SUM(CASE WHEN a.status IN ('planned', 'completed') THEN a.quantity ELSE 0::numeric END) AS allocated_quantity
  FROM allocations a
  WHERE a.source_type = 'inventory_lot'
  GROUP BY a.source_id
) alloc ON alloc.source_id = il.id;

COMMENT ON VIEW inventory_lots_with_quantities IS
  'Inventory lots with available quantities, item names, and read-time-derived landed cost (sourced from inventory_lots_with_landed_cost, not the stored inventory_lots.landed_cost column).';
