-- 00208_rewrite_get_inventory_overview.sql
-- Drift fix (backlog-adjacent, flagged by 00205 + the live-function-bug list):
-- get_inventory_overview() is broken on live and never returns.
--
-- The live body (last touched 00096) references three objects that no longer
-- match the schema after the selling-formats/containers refactor:
--   1. JOIN package_types pt ON pt.id = fg.package_type_id
--      — package_types was dropped and finished_goods.package_type_id replaced
--        by selling_format_id, so the finished-goods CTE errors at runtime.
--   2. inventory_items.catalog_type — the type column is `category`; the
--        raw-materials CTE errors too.
--   3. finished-goods on-hand was summed from bin_inventory, which is an empty
--        dead limb (0 rows; audit L6) — so even without (1) the FG list is blank.
--
-- Rewrite against the current schema, preserving the JSON output shape the UI
-- consumer renders (src/components/domain/inventory/inventory-alerts.tsx and the
-- getInventoryOverview chat tool):
--   finished_goods:      [{ brand, package_type, total_quantity, available_quantity }]
--   raw_materials:       [{ item_name, item_type, quantity_available, unit }]
--   batches_in_progress: [{ batch_code, recipe_name, status, planned_start }]
--
-- Changes vs the broken body:
--   * finished_goods sourced from finished_goods.quantity (real FG on hand),
--     joined to selling_formats for the package label (sf.name), net of
--     planned/completed finished_good allocations.
--   * raw_materials use inventory_items.category as item_type.
--   * batches ordered inside jsonb_agg (the old top-level ORDER BY on an
--     aggregate query was a no-op).
-- SECURITY INVOKER (default) preserved — RLS applies to the caller.

CREATE OR REPLACE FUNCTION public.get_inventory_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fg JSONB;
  v_rm JSONB;
  v_batches JSONB;
BEGIN
  -- Finished goods on hand by brand + selling format, net of planned/completed
  -- finished_good allocations.
  SELECT jsonb_agg(jsonb_build_object(
    'brand', fg_summary.brand_name,
    'package_type', fg_summary.package_name,
    'total_quantity', fg_summary.total_qty,
    'available_quantity', fg_summary.available_qty
  ))
  INTO v_fg
  FROM (
    SELECT
      br.name AS brand_name,
      sf.name AS package_name,
      SUM(fg.quantity) AS total_qty,
      SUM(fg.quantity) - COALESCE(SUM(alloc.allocated_qty), 0) AS available_qty
    FROM finished_goods fg
    JOIN brands br ON br.id = fg.brand_id
    JOIN selling_formats sf ON sf.id = fg.selling_format_id
    LEFT JOIN (
      SELECT source_id, SUM(quantity) AS allocated_qty
      FROM allocations
      WHERE source_type = 'finished_good' AND status IN ('planned', 'completed')
      GROUP BY source_id
    ) alloc ON alloc.source_id = fg.id
    GROUP BY br.id, br.name, sf.id, sf.name
  ) fg_summary;

  -- Raw materials with positive available quantity, net of planned/completed
  -- inventory_lot allocations.
  SELECT jsonb_agg(jsonb_build_object(
    'item_name', ri.name,
    'item_type', ri.type,
    'quantity_available', ri.available,
    'unit', ri.unit
  ))
  INTO v_rm
  FROM (
    SELECT
      ii.name,
      ii.category AS type,
      ii.unit,
      COALESCE(SUM(il.quantity), 0) - COALESCE(SUM(alloc.allocated_qty), 0) AS available
    FROM inventory_items ii
    LEFT JOIN inventory_lots il ON il.inventory_item_id = ii.id
    LEFT JOIN (
      SELECT source_id, SUM(quantity) AS allocated_qty
      FROM allocations
      WHERE source_type = 'inventory_lot' AND status IN ('planned', 'completed')
      GROUP BY source_id
    ) alloc ON alloc.source_id = il.id
    GROUP BY ii.id, ii.name, ii.category, ii.unit
  ) ri
  WHERE ri.available > 0;

  -- Batches not yet completed/cancelled, ordered by planned start.
  SELECT jsonb_agg(
    jsonb_build_object(
      'batch_code', b.batch_code,
      'recipe_name', r.name,
      'status', b.status,
      'planned_start', b.planned_start_date
    )
    ORDER BY b.planned_start_date
  )
  INTO v_batches
  FROM batches b
  JOIN recipes r ON r.id = b.recipe_id
  WHERE b.status NOT IN ('completed', 'cancelled');

  RETURN jsonb_build_object(
    'finished_goods', COALESCE(v_fg, '[]'::jsonb),
    'raw_materials', COALESCE(v_rm, '[]'::jsonb),
    'batches_in_progress', COALESCE(v_batches, '[]'::jsonb)
  );
END;
$function$;

COMMENT ON FUNCTION public.get_inventory_overview() IS
  'Dashboard inventory snapshot: finished goods (from finished_goods.quantity, by brand + selling_format, net of allocations), raw materials with positive availability (by inventory_items.category), and batches in progress. Rewritten in 00208 off the dropped package_types/catalog_type/bin_inventory references.';

NOTIFY pgrst, 'reload schema';
