-- Rename batch_number → batch_code and auto-generate from planned_start_date + recipe slug
--
-- Format: M-D-YY-<recipe-slug> (e.g., "3-16-26-akko", "3-16-26-akko-2")
-- Falls back to created_at if no planned_start_date, and "no-recipe" if no recipe_id.
-- Duplicate detection appends -2, -3, etc. within the same brewery.

-- =============================================================================
-- Step 1: Drop dependent views (must be done before column rename)
-- =============================================================================

DROP VIEW IF EXISTS vessel_transfers_with_details CASCADE;
DROP VIEW IF EXISTS brew_logs_with_batches CASCADE;
DROP VIEW IF EXISTS batches_in_production_by_brand CASCADE;
DROP VIEW IF EXISTS ttb_in_process_beer CASCADE;
DROP VIEW IF EXISTS keg_inventory_with_details CASCADE;
DROP VIEW IF EXISTS keg_transactions_with_details CASCADE;
DROP VIEW IF EXISTS batches_with_brew_info CASCADE;

-- =============================================================================
-- Step 2: Rename column and update constraint
-- =============================================================================

ALTER TABLE batches RENAME COLUMN batch_number TO batch_code;
ALTER TABLE batches ALTER COLUMN batch_code SET DEFAULT '';

-- Drop old unique constraint and create new one
ALTER TABLE batches DROP CONSTRAINT IF EXISTS batches_batch_number_key;
ALTER TABLE batches ADD CONSTRAINT batches_batch_code_key UNIQUE (batch_code);

-- Update index on batch status (no change needed, doesn't reference batch_number)

-- =============================================================================
-- Step 3: Slugify helper
-- =============================================================================

CREATE OR REPLACE FUNCTION slugify(input TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT
SET search_path = public
AS $$
  SELECT trim(both '-' from
    regexp_replace(
      regexp_replace(lower(input), '[^a-z0-9]+', '-', 'g'),
      '-{2,}', '-', 'g'
    )
  );
$$;

COMMENT ON FUNCTION slugify(TEXT) IS 'Converts text to URL-safe slug: lowercase, non-alphanumeric replaced with hyphens.';

-- =============================================================================
-- Step 4: Auto-generation trigger function
-- =============================================================================

CREATE OR REPLACE FUNCTION generate_batch_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  use_date DATE;
  date_part TEXT;
  recipe_slug TEXT;
  base_code TEXT;
  candidate TEXT;
  suffix INT;
  needs_generate BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- On INSERT: generate if not explicitly provided
    needs_generate := (NEW.batch_code IS NULL OR NEW.batch_code = '');
  ELSIF TG_OP = 'UPDATE' THEN
    -- On UPDATE: regenerate if recipe or planned_start_date changed
    needs_generate := (
      NEW.recipe_id IS DISTINCT FROM OLD.recipe_id
      OR NEW.planned_start_date IS DISTINCT FROM OLD.planned_start_date
    );
  END IF;

  IF NOT needs_generate THEN
    RETURN NEW;
  END IF;

  -- Date: prefer planned_start_date, fall back to today
  use_date := COALESCE(NEW.planned_start_date, CURRENT_DATE);

  -- Format as M-D-YY (no zero-padding)
  date_part := extract(month from use_date)::int || '-'
            || extract(day from use_date)::int || '-'
            || to_char(use_date, 'YY');

  -- Recipe slug from recipe name
  IF NEW.recipe_id IS NOT NULL THEN
    SELECT slugify(r.name) INTO recipe_slug
    FROM recipes r
    WHERE r.id = NEW.recipe_id;
  END IF;

  recipe_slug := COALESCE(NULLIF(recipe_slug, ''), 'no-recipe');

  -- Base code without suffix
  base_code := date_part || '-' || recipe_slug;

  -- Check for duplicates and find next available suffix
  -- Exclude the current row on UPDATE so it doesn't conflict with itself
  candidate := base_code;
  suffix := 1;

  WHILE EXISTS (
    SELECT 1 FROM batches
    WHERE batch_code = candidate
      AND id <> NEW.id
  ) LOOP
    suffix := suffix + 1;
    candidate := base_code || '-' || suffix;
  END LOOP;

  NEW.batch_code := candidate;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION generate_batch_code() IS 'Auto-generates batch_code as M-D-YY-<recipe-slug> with dedup suffix on INSERT (when not provided) and on UPDATE (when recipe_id or planned_start_date changes).';

-- Drop old trigger/function if they exist
DROP TRIGGER IF EXISTS trg_generate_batch_number ON batches;
DROP FUNCTION IF EXISTS generate_batch_number();

CREATE TRIGGER trg_generate_batch_code
  BEFORE INSERT OR UPDATE ON batches
  FOR EACH ROW
  EXECUTE FUNCTION generate_batch_code();

-- Drop legacy sequential number generator (replaced by slug-based trigger)
DROP FUNCTION IF EXISTS generate_next_batch_number();

-- =============================================================================
-- Step 5: Recreate all dependent views with batch_code
-- =============================================================================

CREATE VIEW batches_with_brew_info
WITH (security_invoker = true)
AS
SELECT
  b.*,
  (
    SELECT MIN(bl.brew_date)
    FROM brew_log_batches blb
    JOIN brew_logs bl ON bl.id = blb.brew_log_id
    WHERE blb.batch_id = b.id
  ) AS brew_date,
  (
    SELECT
      CASE
        WHEN SUM(blb.volume_bbl) > 0 THEN
          SUM(
            blb.volume_bbl * (
              SELECT (m->>'value')::DECIMAL(4,1)
              FROM jsonb_array_elements(bl.events) e,
                   jsonb_array_elements(e->'measurements') m
              WHERE e->>'phase' IN ('ko_end', 'boil_end')
                AND m->>'metric' = 'gravity_plato'
              LIMIT 1
            )
          ) / SUM(blb.volume_bbl)
        ELSE NULL
      END
    FROM brew_log_batches blb
    JOIN brew_logs bl ON bl.id = blb.brew_log_id
    WHERE blb.batch_id = b.id
  ) AS actual_og,
  (
    SELECT COALESCE(SUM(blb.volume_bbl), 0)
    FROM brew_log_batches blb
    WHERE blb.batch_id = b.id
  ) AS volume_from_brews_bbl,
  (
    SELECT COUNT(*)
    FROM brew_log_batches blb
    WHERE blb.batch_id = b.id
  ) AS brew_count,
  (
    SELECT v.id
    FROM vessels v
    WHERE v.current_batch_id = b.id
    LIMIT 1
  ) AS current_vessel_id,
  (
    SELECT v.name
    FROM vessels v
    WHERE v.current_batch_id = b.id
    LIMIT 1
  ) AS current_vessel_name
FROM batches b;

CREATE VIEW vessel_transfers_with_details
WITH (security_invoker = true)
AS
SELECT
  vt.*,
  fv.name AS from_vessel_name,
  tv.name AS to_vessel_name,
  b.batch_code
FROM vessel_transfers vt
LEFT JOIN vessels fv ON vt.from_vessel_id = fv.id
JOIN vessels tv ON vt.to_vessel_id = tv.id
LEFT JOIN batches b ON vt.batch_id = b.id;

CREATE OR REPLACE VIEW brew_logs_with_batches
WITH (security_invoker = true)
AS
SELECT
  bl.*,
  bs.recipe_id,
  bs.recipe_name,
  bs.batch_count,
  bs.batch_codes
FROM brew_logs bl
LEFT JOIN LATERAL (
  SELECT
    (array_agg(b.recipe_id))[1] AS recipe_id,
    (array_agg(r.name))[1] AS recipe_name,
    COUNT(*)::int AS batch_count,
    string_agg(b.batch_code, ', ' ORDER BY b.batch_code) AS batch_codes
  FROM brew_log_batches blb
  JOIN batches b ON b.id = blb.batch_id
  LEFT JOIN recipes r ON r.id = b.recipe_id
  WHERE blb.brew_log_id = bl.id
) bs ON true;

CREATE VIEW batches_in_production_by_brand
WITH (security_invoker = true)
AS
SELECT
  r.brand_id,
  b.id AS batch_id,
  b.batch_code,
  b.name AS batch_name,
  b.status,
  b.planned_start_date,
  b.volume_bbl,
  r.id AS recipe_id,
  r.name AS recipe_name,
  r.fermentation_days,
  r.conditioning_days,
  CASE
    WHEN b.planned_start_date IS NOT NULL
    THEN (b.planned_start_date + INTERVAL '1 day' * (
      COALESCE(r.fermentation_days, 14) + COALESCE(r.conditioning_days, 7)
    ))::date
    ELSE NULL
  END AS estimated_ready_date
FROM batches b
JOIN recipes r ON r.id = b.recipe_id
WHERE b.status IN ('planned', 'fermenting', 'conditioning')
  AND r.brand_id IS NOT NULL;

CREATE OR REPLACE VIEW ttb_in_process_beer
WITH (security_invoker = true)
AS
SELECT
  b.id AS batch_id,
  b.batch_code,
  b.name AS batch_name,
  b.status,
  b.volume_bbl,
  b.updated_at,
  'cellar' AS ttb_tax_class,
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

-- keg_inventory_with_details and keg_transactions_with_details:
-- Only recreate if keg_types table exists (may not exist on all environments)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'keg_types') THEN
    EXECUTE $view$
      CREATE VIEW keg_inventory_with_details
      WITH (security_invoker = true)
      AS
      SELECT
        ki.id,
        ki.keg_type_id,
        ki.keg_owner_id,
        ki.state,
        ki.location_id,
        ki.quantity,
        ki.batch_id,
        ki.finished_good_id,
        kt.name AS keg_type_name,
        kt.code AS keg_type_code,
        kt.volume_bbl,
        ko.name AS keg_owner_name,
        ko.code AS keg_owner_code,
        l.name AS location_name,
        b.batch_code,
        fg_brand.name AS finished_good_name
      FROM keg_inventory ki
      JOIN keg_types kt ON kt.id = ki.keg_type_id
      LEFT JOIN keg_owners ko ON ko.id = ki.keg_owner_id
      LEFT JOIN locations l ON l.id = ki.location_id
      LEFT JOIN batches b ON b.id = ki.batch_id
      LEFT JOIN finished_goods fg ON fg.id = ki.finished_good_id
      LEFT JOIN brands fg_brand ON fg.brand_id = fg_brand.id
    $view$;

    EXECUTE $view$
      CREATE VIEW keg_transactions_with_details
      WITH (security_invoker = true)
      AS
      SELECT
        kt.id,
        kt.transaction_type,
        kt.keg_type_id,
        kt.quantity,
        kt.from_state,
        kt.to_state,
        kt.from_location_id,
        kt.to_location_id,
        kt.order_id,
        kt.customer_id,
        kt.packaging_session_id,
        kt.batch_id,
        kt.finished_good_id,
        kt.keg_owner_id,
        kt.notes,
        kt.created_by_name,
        kt.created_at,
        ktype.name AS keg_type_name,
        ktype.code AS keg_type_code,
        ktype.volume_bbl,
        ko.name AS keg_owner_name,
        ko.code AS keg_owner_code,
        c.name AS customer_name,
        o.order_number,
        b.batch_code,
        fg.lot_number AS finished_good_lot,
        fg_brand.name AS finished_good_brand,
        fg_brand.name AS finished_good_name,
        fl.name AS from_location_name,
        tl.name AS to_location_name,
        tl.name AS location_name
      FROM keg_transactions kt
      LEFT JOIN keg_types ktype ON kt.keg_type_id = ktype.id
      LEFT JOIN keg_owners ko ON kt.keg_owner_id = ko.id
      LEFT JOIN customers c ON kt.customer_id = c.id
      LEFT JOIN orders o ON kt.order_id = o.id
      LEFT JOIN batches b ON kt.batch_id = b.id
      LEFT JOIN finished_goods fg ON kt.finished_good_id = fg.id
      LEFT JOIN brands fg_brand ON fg.brand_id = fg_brand.id
      LEFT JOIN locations fl ON kt.from_location_id = fl.id
      LEFT JOIN locations tl ON kt.to_location_id = tl.id
      ORDER BY kt.created_at DESC
    $view$;
  END IF;
END;
$$;

-- =============================================================================
-- Step 6: Recreate dependent functions with batch_code
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
    JOIN inventory_lots il ON il.id = a.source_id
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

CREATE OR REPLACE FUNCTION get_inventory_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_fg JSONB;
  v_rm JSONB;
  v_batches JSONB;
BEGIN
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
      pt.name AS package_name,
      SUM(bi.quantity) AS total_qty,
      SUM(bi.quantity) - COALESCE(SUM(at.allocated_qty), 0) AS available_qty
    FROM bin_inventory bi
    JOIN finished_goods fg ON fg.id = bi.finished_good_id
    JOIN brands br ON br.id = fg.brand_id
    JOIN package_types pt ON pt.id = fg.package_type_id
    LEFT JOIN (
      SELECT source_id, SUM(quantity) AS allocated_qty
      FROM allocations
      WHERE source_type = 'finished_good' AND status IN ('planned', 'completed')
      GROUP BY source_id
    ) at ON at.source_id = fg.id
    GROUP BY br.id, br.name, pt.id, pt.name
  ) fg_summary;

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
      ii.catalog_type AS type,
      ii.unit,
      COALESCE(SUM(il.quantity), 0) - COALESCE(SUM(at.allocated_qty), 0) AS available
    FROM inventory_items ii
    LEFT JOIN inventory_lots il ON il.inventory_item_id = ii.id
    LEFT JOIN (
      SELECT source_id, SUM(quantity) AS allocated_qty
      FROM allocations
      WHERE source_type = 'inventory_lot' AND status IN ('planned', 'completed')
      GROUP BY source_id
    ) at ON at.source_id = il.id
    GROUP BY ii.id, ii.name, ii.catalog_type, ii.unit
  ) ri
  WHERE ri.available > 0;

  SELECT jsonb_agg(jsonb_build_object(
    'batch_code', b.batch_code,
    'recipe_name', r.name,
    'status', b.status,
    'planned_start', b.planned_start_date
  ))
  INTO v_batches
  FROM batches b
  JOIN recipes r ON r.id = b.recipe_id
  WHERE b.status NOT IN ('completed', 'cancelled')
  ORDER BY b.planned_start_date;

  v_result := jsonb_build_object(
    'finished_goods', COALESCE(v_fg, '[]'::jsonb),
    'raw_materials', COALESCE(v_rm, '[]'::jsonb),
    'batches_in_progress', COALESCE(v_batches, '[]'::jsonb)
  );

  RETURN v_result;
END;
$$;

-- =============================================================================
-- Step 7: Update _schema_registry
-- =============================================================================

UPDATE _schema_registry
SET key_fields = replace(key_fields::text, 'batch_number', 'batch_code')::jsonb
WHERE table_name = 'batches';

UPDATE _schema_registry
SET query_examples = replace(query_examples::text, 'batch_number', 'batch_code')::jsonb
WHERE table_name = 'batches';

-- =============================================================================
-- Step 8: Backfill existing batches with auto-generated batch_codes
-- =============================================================================
-- Process batches ordered by planned_start_date/created_at so earlier batches
-- get the unsuffixed name and later ones get -2, -3, etc.

DO $$
DECLARE
  rec RECORD;
  use_date DATE;
  date_part TEXT;
  recipe_slug TEXT;
  base_code TEXT;
  candidate TEXT;
  suffix INT;
BEGIN
  -- Disable the trigger so it doesn't interfere with the backfill
  ALTER TABLE batches DISABLE TRIGGER trg_generate_batch_code;

  FOR rec IN
    SELECT b.id, b.recipe_id, b.planned_start_date, b.created_at
    FROM batches b
    ORDER BY COALESCE(b.planned_start_date, b.created_at::date), b.created_at
  LOOP
    -- Date: prefer planned_start_date, fall back to created_at
    use_date := COALESCE(rec.planned_start_date, rec.created_at::date);

    -- Format as M-D-YY (no zero-padding)
    date_part := extract(month from use_date)::int || '-'
              || extract(day from use_date)::int || '-'
              || to_char(use_date, 'YY');

    -- Recipe slug from recipe name
    recipe_slug := NULL;
    IF rec.recipe_id IS NOT NULL THEN
      SELECT slugify(r.name) INTO recipe_slug
      FROM recipes r
      WHERE r.id = rec.recipe_id;
    END IF;

    recipe_slug := COALESCE(NULLIF(recipe_slug, ''), 'no-recipe');

    -- Base code without suffix
    base_code := date_part || '-' || recipe_slug;

    -- Check for duplicates among already-updated batches
    candidate := base_code;
    suffix := 1;

    WHILE EXISTS (
      SELECT 1 FROM batches
      WHERE batch_code = candidate
        AND id <> rec.id
    ) LOOP
      suffix := suffix + 1;
      candidate := base_code || '-' || suffix;
    END LOOP;

    UPDATE batches SET batch_code = candidate WHERE id = rec.id;
  END LOOP;

  -- Re-enable the trigger
  ALTER TABLE batches ENABLE TRIGGER trg_generate_batch_code;
END;
$$;
