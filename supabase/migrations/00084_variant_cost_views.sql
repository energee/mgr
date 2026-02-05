-- Cost Projection Views for Recipe Variants and Batch Additions
-- Enables plan vs actual cost comparison at recipe variant and batch level.

-- =============================================================================
-- recipe_variants_with_costs: estimated costs per variant
-- =============================================================================

CREATE VIEW recipe_variants_with_costs
WITH (security_invoker = true)
AS
WITH variant_hop_costs AS (
  SELECT
    rvh.recipe_variant_id,
    SUM((rvh.weight_oz / 16.0) * COALESCE(h.cost_per_lb, 0)) as hop_cost
  FROM recipe_variant_hops rvh
  JOIN hops h ON h.id = rvh.hop_id
  GROUP BY rvh.recipe_variant_id
),
variant_adjunct_costs AS (
  SELECT
    rva.recipe_variant_id,
    SUM(rva.amount * COALESCE(a.cost_per_lb, 0)) as adjunct_cost
  FROM recipe_variant_adjuncts rva
  JOIN adjuncts a ON a.id = rva.adjunct_id
  GROUP BY rva.recipe_variant_id
),
variant_fruit_costs AS (
  SELECT
    rvf.recipe_variant_id,
    SUM(rvf.amount * COALESCE(f.cost_per_lb, 0)) as fruit_cost
  FROM recipe_variant_fruits rvf
  JOIN fruits f ON f.id = rvf.fruit_id
  GROUP BY rvf.recipe_variant_id
),
hot_side AS (
  SELECT
    rc.id as recipe_id,
    rc.volume_bbl,
    rc.batch_size_bbl,
    rc.total_cogs as hot_side_cost,
    CASE
      WHEN COALESCE(rc.batch_size_bbl, rc.volume_bbl, 0) > 0
      THEN rc.total_cogs / COALESCE(rc.batch_size_bbl, rc.volume_bbl)
      ELSE 0
    END as hot_side_cost_per_bbl
  FROM recipes_with_cogs rc
)
SELECT
  rv.id,
  rv.recipe_id,
  rv.name,
  rv.description,
  rv.position,
  rv.planned_volume_bbl,
  rv.created_at,
  rv.updated_at,
  ROUND(COALESCE(hs.hot_side_cost_per_bbl, 0)::numeric, 2) as hot_side_cost_per_bbl,
  ROUND((COALESCE(vhc.hop_cost, 0) + COALESCE(vac.adjunct_cost, 0) + COALESCE(vfc.fruit_cost, 0))::numeric, 2) as variant_addition_cost,
  ROUND((
    COALESCE(hs.hot_side_cost_per_bbl, 0) * COALESCE(rv.planned_volume_bbl, 0)
    + COALESCE(vhc.hop_cost, 0) + COALESCE(vac.adjunct_cost, 0) + COALESCE(vfc.fruit_cost, 0)
  )::numeric, 2) as est_total_cost,
  CASE
    WHEN COALESCE(rv.planned_volume_bbl, 0) > 0
    THEN ROUND((
      COALESCE(hs.hot_side_cost_per_bbl, 0)
      + (COALESCE(vhc.hop_cost, 0) + COALESCE(vac.adjunct_cost, 0) + COALESCE(vfc.fruit_cost, 0))
        / rv.planned_volume_bbl
    )::numeric, 2)
    ELSE NULL
  END as est_cost_per_bbl
FROM recipe_variants rv
LEFT JOIN hot_side hs ON hs.recipe_id = rv.recipe_id
LEFT JOIN variant_hop_costs vhc ON vhc.recipe_variant_id = rv.id
LEFT JOIN variant_adjunct_costs vac ON vac.recipe_variant_id = rv.id
LEFT JOIN variant_fruit_costs vfc ON vfc.recipe_variant_id = rv.id;

COMMENT ON VIEW recipe_variants_with_costs IS 'Recipe variants with hot-side and cold-side cost projections';

-- =============================================================================
-- batch_additions_with_costs: actual addition costs per batch
-- =============================================================================

CREATE VIEW batch_additions_with_costs
WITH (security_invoker = true)
AS
SELECT
  ba.id,
  ba.batch_id,
  ba.addition_type,
  ba.catalog_id,
  ba.catalog_table,
  ba.name,
  ba.amount,
  ba.unit,
  ba.timing,
  ba.days,
  ba.date_added,
  ba.notes,
  ba.created_at,
  -- Cost lookup: join to catalog table based on addition_type
  -- Uses CASE to handle different catalog cost columns
  ROUND((ba.amount * COALESCE(
    CASE ba.catalog_table
      WHEN 'hops' THEN (SELECT cost_per_lb / 16.0 FROM hops WHERE id = ba.catalog_id)
      WHEN 'adjuncts' THEN (SELECT cost_per_lb FROM adjuncts WHERE id = ba.catalog_id)
      WHEN 'fruits' THEN (SELECT cost_per_lb FROM fruits WHERE id = ba.catalog_id)
      WHEN 'spices' THEN (SELECT cost_per_unit FROM spices WHERE id = ba.catalog_id)
      ELSE 0
    END, 0
  ))::numeric, 2) as estimated_cost
FROM batch_additions ba;

COMMENT ON VIEW batch_additions_with_costs IS 'Batch additions with estimated costs from catalog prices';

-- =============================================================================
-- Schema Registry
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, key_fields) VALUES
  ('recipe_variants_with_costs', 'Recipe variants with hot-side and cold-side cost projections', 'production',
   '["hot_side_cost_per_bbl", "variant_addition_cost", "est_total_cost", "est_cost_per_bbl"]'::jsonb),
  ('batch_additions_with_costs', 'Batch additions with estimated costs from catalog prices', 'production',
   '["estimated_cost"]'::jsonb);
