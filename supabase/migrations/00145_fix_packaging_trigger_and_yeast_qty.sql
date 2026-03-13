-- =============================================================================
-- Migration: Fix packaging triggers and add yeast quantity
-- =============================================================================
-- Fixes:
--   1. M9: Packaging completion trigger references stale column package_type_id
--          (now selling_format_id) and notification trigger references columns
--          that no longer exist on packaging_sessions (batch_id, total_packaged).
--   2. M8: Packaging trigger only uses first batch from source_batches array;
--          now iterates all source batches to create per-batch FG records.
--   3. H8: recipe_yeasts has no quantity column; yeast projections hardcoded 1.
--          Adds a quantity column with default 1.
-- =============================================================================

-- =============================================================================
-- 1. Add quantity column to recipe_yeasts (H8)
-- =============================================================================

ALTER TABLE recipe_yeasts
  ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN recipe_yeasts.quantity IS 'Number of yeast packages required per batch. Defaults to 1.';

-- =============================================================================
-- 2. Update recipe_ingredients_normalized view to use actual quantity (H8)
-- =============================================================================
-- The view hardcodes 1.0 for yeast quantity. Update to use the new column.

DROP VIEW IF EXISTS recipe_ingredients_normalized CASCADE;

CREATE VIEW recipe_ingredients_normalized
WITH (security_invoker = true)
AS
-- Malts
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

-- Hops
SELECT
  rh.recipe_id,
  'hop' as catalog_type,
  rh.hop_id as catalog_id,
  h.name as catalog_name,
  rh.weight_oz as quantity,
  'oz' as unit
FROM recipe_hops rh
JOIN hops h ON h.id = rh.hop_id

UNION ALL

-- Adjuncts
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

-- Sugars
SELECT
  rs.recipe_id,
  'sugar' as catalog_type,
  rs.sugar_id as catalog_id,
  s.name as catalog_name,
  CASE rs.unit
    WHEN 'oz' THEN rs.amount / 16.0
    WHEN 'g' THEN rs.amount / 453.592
    WHEN 'kg' THEN rs.amount * 2.205
    ELSE rs.amount
  END as quantity,
  'lb' as unit
FROM recipe_sugars rs
JOIN sugars s ON s.id = rs.sugar_id

UNION ALL

-- Spices
SELECT
  rsp.recipe_id,
  'spice' as catalog_type,
  rsp.spice_id as catalog_id,
  sp.name as catalog_name,
  CASE rsp.unit
    WHEN 'g' THEN rsp.amount / 28.3495
    WHEN 'lb' THEN rsp.amount * 16.0
    ELSE rsp.amount
  END as quantity,
  'oz' as unit
FROM recipe_spices rsp
JOIN spices sp ON sp.id = rsp.spice_id

UNION ALL

-- Fruits
SELECT
  rf.recipe_id,
  'fruit' as catalog_type,
  rf.fruit_id as catalog_id,
  f.name as catalog_name,
  CASE rf.unit
    WHEN 'oz' THEN rf.amount / 16.0
    WHEN 'g' THEN rf.amount / 453.592
    WHEN 'kg' THEN rf.amount * 2.205
    ELSE rf.amount
  END as quantity,
  'lb' as unit
FROM recipe_fruits rf
JOIN fruits f ON f.id = rf.fruit_id

UNION ALL

-- Yeasts (use actual quantity column instead of hardcoded 1)
SELECT
  ry.recipe_id,
  'yeast' as catalog_type,
  ry.yeast_id as catalog_id,
  y.name as catalog_name,
  ry.quantity::decimal as quantity,
  'pk' as unit
FROM recipe_yeasts ry
JOIN yeasts y ON y.id = ry.yeast_id;

COMMENT ON VIEW recipe_ingredients_normalized IS 'Normalized view of all recipe ingredients across all types (malts, hops, adjuncts, sugars, spices, fruits, yeasts) with consistent units. Yeast uses packs (pk) from the recipe_yeasts.quantity column.';

-- Recreate calculate_ingredient_shortfalls if it depends on the view
-- (The function references recipe_ingredients_normalized via FROM)
-- It should still work since the view columns are unchanged.

-- =============================================================================
-- 3. Fix packaging completion function (M8 + M9)
-- =============================================================================
-- - M9: Replace package_type_id with selling_format_id
-- - M8: Iterate over all source batches, not just the first one

CREATE OR REPLACE FUNCTION create_finished_goods_from_packaging(p_session_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_line RECORD;
  v_batch_entry JSONB;
  v_batch_id UUID;
  v_fg_id UUID;
  v_lot_number TEXT;
  v_count INTEGER := 0;
  v_batch_qty INTEGER;
  v_total_source_qty INTEGER;
BEGIN
  -- Get session info
  SELECT * INTO v_session
  FROM packaging_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Packaging session % not found', p_session_id;
  END IF;

  IF v_session.status != 'completed' THEN
    RAISE EXCEPTION 'Packaging session % is not completed (status: %)', p_session_id, v_session.status;
  END IF;

  -- Process each line item
  FOR v_line IN
    SELECT * FROM session_line_items
    WHERE session_id = p_session_id
  LOOP
    -- Validate actual_quantity
    IF v_line.actual_quantity IS NULL OR v_line.actual_quantity <= 0 THEN
      RAISE EXCEPTION 'Line item % has no actual quantity', v_line.id;
    END IF;

    -- Check if FG already exists for this line item (idempotency)
    IF EXISTS (SELECT 1 FROM finished_goods WHERE session_line_item_id = v_line.id) THEN
      CONTINUE; -- Skip, already processed
    END IF;

    -- Calculate total source quantity for proportional allocation
    v_total_source_qty := 0;
    IF v_line.source_batches IS NOT NULL AND jsonb_array_length(v_line.source_batches) > 0 THEN
      FOR v_batch_entry IN SELECT * FROM jsonb_array_elements(v_line.source_batches)
      LOOP
        v_batch_qty := COALESCE((v_batch_entry->>'actual_qty')::integer,
                                (v_batch_entry->>'planned_qty')::integer, 0);
        v_total_source_qty := v_total_source_qty + v_batch_qty;
      END LOOP;
    END IF;

    -- If source_batches is empty or null, create a single FG with no batch
    IF v_line.source_batches IS NULL OR jsonb_array_length(v_line.source_batches) = 0 THEN
      v_lot_number := generate_lot_number(v_session.session_date);

      INSERT INTO finished_goods (
        batch_id,
        brand_id,
        selling_format_id,
        session_line_item_id,
        quantity,
        lot_number,
        production_date,
        created_by
      ) VALUES (
        NULL,
        v_line.brand_id,
        v_line.selling_format_id,
        v_line.id,
        v_line.actual_quantity,
        v_lot_number,
        v_session.session_date,
        v_session.created_by
      );

      v_count := v_count + 1;
    ELSE
      -- Iterate over all source batches and create per-batch FG records
      FOR v_batch_entry IN SELECT * FROM jsonb_array_elements(v_line.source_batches)
      LOOP
        v_batch_id := (v_batch_entry->>'batch_id')::UUID;
        v_batch_qty := COALESCE((v_batch_entry->>'actual_qty')::integer,
                                (v_batch_entry->>'planned_qty')::integer, 0);

        -- Skip batches with zero quantity
        IF v_batch_qty <= 0 THEN
          CONTINUE;
        END IF;

        v_lot_number := generate_lot_number(v_session.session_date);

        -- Create finished_goods record for this batch (M9: use selling_format_id)
        INSERT INTO finished_goods (
          batch_id,
          brand_id,
          selling_format_id,
          session_line_item_id,
          quantity,
          lot_number,
          production_date,
          created_by
        ) VALUES (
          v_batch_id,
          v_line.brand_id,
          v_line.selling_format_id,
          v_line.id,
          v_batch_qty,
          v_lot_number,
          v_session.session_date,
          v_session.created_by
        )
        RETURNING id INTO v_fg_id;

        -- Create allocation record (batch -> finished_good)
        INSERT INTO allocations (
          source_type,
          source_id,
          destination_type,
          destination_id,
          quantity,
          status,
          lot_number,
          notes,
          completed_at,
          created_by
        ) VALUES (
          'batch',
          v_batch_id,
          'finished_good',
          v_fg_id,
          v_batch_qty,
          'completed',
          v_lot_number,
          'Auto-created from packaging session ' || p_session_id::TEXT,
          NOW(),
          v_session.created_by
        );

        v_count := v_count + 1;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION create_finished_goods_from_packaging IS 'Creates finished goods and allocations from a completed packaging session. Iterates all source batches per line item and uses selling_format_id (not stale package_type_id).';

-- =============================================================================
-- 4. Fix packaging notification trigger (M9)
-- =============================================================================
-- The notification trigger references NEW.batch_id and NEW.total_packaged
-- which no longer exist on packaging_sessions. Update to derive from line items.

CREATE OR REPLACE FUNCTION trigger_packaging_completion_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line_count INTEGER;
  v_total_units INTEGER;
  v_brands TEXT;
  v_action_url TEXT;
BEGIN
  -- Only trigger when status changes to 'completed'
  IF OLD.status = NEW.status OR NEW.status != 'completed' THEN
    RETURN NEW;
  END IF;

  -- Derive summary from session line items instead of stale columns
  SELECT
    COUNT(*),
    COALESCE(SUM(actual_quantity), 0),
    string_agg(DISTINCT b.name, ', ')
  INTO v_line_count, v_total_units, v_brands
  FROM session_line_items sli
  LEFT JOIN brands b ON b.id = sli.brand_id
  WHERE sli.session_id = NEW.id;

  v_action_url := '/production/packaging-sessions/' || NEW.id;

  -- Notify all users
  PERFORM notify_all_users(
    'batch_status',
    'Packaging Complete',
    'Packaging session completed: ' ||
      COALESCE(v_brands, 'Unknown') || ' — ' ||
      v_total_units || ' units across ' || v_line_count || ' line items.',
    'packaging_session',
    NEW.id,
    'normal',
    v_action_url,
    jsonb_build_object(
      'brands', v_brands,
      'total_units', v_total_units,
      'line_count', v_line_count
    )
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trigger_packaging_completion_notification IS 'Notification trigger for packaging session completion. Derives summary from session line items.';

-- =============================================================================
-- 5. Schema registry updates
-- =============================================================================

UPDATE _schema_registry
SET
  key_fields = '["recipe_id", "yeast_id", "pitch_rate", "is_primary", "quantity"]'::jsonb,
  description = 'Recipe yeast additions. Links recipes to yeast catalog with pitch rate, quantity, and fermentation temp.',
  updated_at = NOW()
WHERE table_name = 'recipe_yeasts';

-- =============================================================================
-- Done
-- =============================================================================

SELECT 'Fix packaging triggers and yeast quantity migration complete!' AS message;
