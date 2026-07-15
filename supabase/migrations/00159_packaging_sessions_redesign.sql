-- =============================================================================
-- Migration: Packaging Sessions Redesign
-- =============================================================================
-- Changes:
--   1. Add completed_at to packaging_sessions
--   2. Add batch_id FK to session_line_items (replacing source_batches JSONB)
--   3. Migrate existing source_batches data to batch_id
--   4. Add UNIQUE constraint on (session_id, batch_id, selling_format_id)
--   5. Add BEFORE UPDATE trigger for completed_at + validation guards
--   6. Recreate packaging_sessions_with_summary view with new columns
--   7. Create brand_packaging_summary view
--   8. Update create_finished_goods_from_packaging() to use batch_id
--   9. Fix notification trigger URL
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. DRIFT SHIM (added retroactively — see PR #322)
-- -----------------------------------------------------------------------------
-- selling_format_id was added to these pre-existing tables directly in the
-- live DB (no migration captured the ALTERs). Migration 00112 now establishes
-- the lost selling_formats/containers foundation before this first reference;
-- 00199 later converges it to the captured live shape. FK actions mirror live.
ALTER TABLE order_items        ADD COLUMN IF NOT EXISTS selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
ALTER TABLE finished_goods     ADD COLUMN IF NOT EXISTS selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
ALTER TABLE keg_transactions   ADD COLUMN IF NOT EXISTS selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
ALTER TABLE session_line_items ADD COLUMN IF NOT EXISTS selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
ALTER TABLE keg_owner_deposits ADD COLUMN IF NOT EXISTS selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
ALTER TABLE packages           ADD COLUMN IF NOT EXISTS selling_format_id UUID REFERENCES selling_formats(id) ON DELETE RESTRICT;
ALTER TABLE square_catalog_map ADD COLUMN IF NOT EXISTS selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
ALTER TABLE square_draft_sales ADD COLUMN IF NOT EXISTS selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 1. Add completed_at to packaging_sessions
-- -----------------------------------------------------------------------------
ALTER TABLE packaging_sessions
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

COMMENT ON COLUMN packaging_sessions.completed_at
  IS 'Timestamp when the session was marked completed. Set by BEFORE UPDATE trigger.';

-- -----------------------------------------------------------------------------
-- 2. Add batch_id FK to session_line_items
-- -----------------------------------------------------------------------------
ALTER TABLE session_line_items
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES batches(id);

COMMENT ON COLUMN session_line_items.batch_id
  IS 'Source batch for this line item. Replaces the source_batches JSONB column.';

-- -----------------------------------------------------------------------------
-- 3. Migrate source_batches data to batch_id
-- -----------------------------------------------------------------------------

-- 3a. Split multi-batch rows into separate line items
DO $$
DECLARE
  v_line RECORD;
  v_entry JSONB;
  v_idx INTEGER;
BEGIN
  FOR v_line IN
    SELECT id, session_id, brand_id, selling_format_id, keg_owner_id,
           planned_quantity, actual_quantity, source_batches
    FROM session_line_items
    WHERE source_batches IS NOT NULL
      AND jsonb_array_length(source_batches) > 1
  LOOP
    v_idx := 0;
    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_line.source_batches)
    LOOP
      IF v_idx = 0 THEN
        UPDATE session_line_items
        SET batch_id = (v_entry->>'batch_id')::UUID
        WHERE id = v_line.id;
      ELSE
        INSERT INTO session_line_items (
          session_id, brand_id, selling_format_id, keg_owner_id,
          batch_id, planned_quantity, actual_quantity
        ) VALUES (
          v_line.session_id, v_line.brand_id, v_line.selling_format_id,
          v_line.keg_owner_id,
          (v_entry->>'batch_id')::UUID,
          NULL, NULL
        );
      END IF;
      v_idx := v_idx + 1;
    END LOOP;
  END LOOP;
END;
$$;

-- 3b. Migrate single-batch rows
UPDATE session_line_items
SET batch_id = (source_batches->0->>'batch_id')::UUID
WHERE source_batches IS NOT NULL
  AND jsonb_array_length(source_batches) = 1
  AND batch_id IS NULL;

-- 3c. Drop the source_batches column
ALTER TABLE session_line_items DROP COLUMN IF EXISTS source_batches;

-- -----------------------------------------------------------------------------
-- 4. Add UNIQUE constraint
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_session_line_items_batch_format
  ON session_line_items (session_id, batch_id, selling_format_id)
  WHERE batch_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5. BEFORE UPDATE trigger on packaging_sessions
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION packaging_session_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_line_count INTEGER;
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    NEW.completed_at := NOW();

    IF OLD.status != 'in_progress' THEN
      RAISE EXCEPTION 'Cannot complete a session directly from "%" status. Must be "in_progress".', OLD.status;
    END IF;

    SELECT COUNT(*) INTO v_line_count
    FROM session_line_items
    WHERE session_id = NEW.id;

    IF v_line_count = 0 THEN
      RAISE EXCEPTION 'Cannot complete a session with zero line items.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS packaging_session_before_update ON packaging_sessions;
CREATE TRIGGER packaging_session_before_update
  BEFORE UPDATE ON packaging_sessions
  FOR EACH ROW
  EXECUTE FUNCTION packaging_session_before_update();

COMMENT ON FUNCTION packaging_session_before_update
  IS 'Sets completed_at timestamp and validates state transitions for packaging sessions.';

-- -----------------------------------------------------------------------------
-- 6. Recreate packaging_sessions_with_summary view
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS packaging_sessions_with_summary;

CREATE VIEW packaging_sessions_with_summary
WITH (security_invoker = true)
AS
SELECT
  ps.*,
  COALESCE(agg.line_count, 0) AS line_count,
  agg.brands,
  COALESCE(agg.total_planned, 0) AS total_planned,
  COALESCE(agg.total_actual, 0) AS total_actual,
  (COALESCE(agg.total_actual, 0) - COALESCE(agg.total_planned, 0)) AS total_variance
FROM packaging_sessions ps
LEFT JOIN (
  SELECT
    sli.session_id,
    COUNT(*) AS line_count,
    STRING_AGG(DISTINCT b.name, ', ' ORDER BY b.name) AS brands,
    SUM(sli.planned_quantity) AS total_planned,
    SUM(sli.actual_quantity) AS total_actual
  FROM session_line_items sli
  JOIN brands b ON b.id = sli.brand_id
  GROUP BY sli.session_id
) agg ON agg.session_id = ps.id;

COMMENT ON VIEW packaging_sessions_with_summary
  IS 'Packaging sessions with aggregated line item counts, brand names, quantity totals, and variance.';

-- -----------------------------------------------------------------------------
-- 7. Create brand_packaging_summary view
-- -----------------------------------------------------------------------------
CREATE VIEW brand_packaging_summary
WITH (security_invoker = true)
AS
SELECT
  b.id AS brand_id,
  b.name AS brand_name,
  sf.id AS selling_format_id,
  sf.name AS format_name,
  DATE_TRUNC('month', fg.production_date) AS period,
  SUM(fg.quantity) AS total_quantity,
  COUNT(DISTINCT fg.id) AS fg_count
FROM finished_goods fg
JOIN brands b ON b.id = fg.brand_id
LEFT JOIN selling_formats sf ON sf.id = fg.selling_format_id
GROUP BY b.id, b.name, sf.id, sf.name, DATE_TRUNC('month', fg.production_date);

COMMENT ON VIEW brand_packaging_summary
  IS 'Aggregated finished goods production by brand, selling format, and month.';

-- -----------------------------------------------------------------------------
-- 8. Update create_finished_goods_from_packaging() — use batch_id FK
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_finished_goods_from_packaging(p_session_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_line RECORD;
  v_fg_id UUID;
  v_lot_number TEXT;
  v_count INTEGER := 0;
BEGIN
  SELECT * INTO v_session
  FROM packaging_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Packaging session % not found', p_session_id;
  END IF;

  IF v_session.status != 'completed' THEN
    RAISE EXCEPTION 'Packaging session % is not completed (status: %)',
      p_session_id, v_session.status;
  END IF;

  FOR v_line IN
    SELECT * FROM session_line_items
    WHERE session_id = p_session_id
  LOOP
    IF v_line.actual_quantity IS NULL OR v_line.actual_quantity <= 0 THEN
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM finished_goods WHERE session_line_item_id = v_line.id) THEN
      CONTINUE;
    END IF;

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
      v_line.batch_id,
      v_line.brand_id,
      v_line.selling_format_id,
      v_line.id,
      v_line.actual_quantity,
      v_lot_number,
      v_session.session_date,
      v_session.created_by
    )
    RETURNING id INTO v_fg_id;

    IF v_line.batch_id IS NOT NULL THEN
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
        v_line.batch_id,
        'finished_good',
        v_fg_id,
        v_line.actual_quantity,
        'completed',
        v_lot_number,
        'Auto-created from packaging session ' || p_session_id::TEXT,
        NOW(),
        v_session.created_by
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION create_finished_goods_from_packaging
  IS 'Creates finished goods and allocations from a completed packaging session. Uses batch_id FK directly. Skips line items with null/zero actual quantity.';

-- -----------------------------------------------------------------------------
-- 9. Fix notification trigger URL
-- -----------------------------------------------------------------------------
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
  IF OLD.status = NEW.status OR NEW.status != 'completed' THEN
    RETURN NEW;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(actual_quantity), 0),
    string_agg(DISTINCT b.name, ', ')
  INTO v_line_count, v_total_units, v_brands
  FROM session_line_items sli
  LEFT JOIN brands b ON b.id = sli.brand_id
  WHERE sli.session_id = NEW.id;

  v_action_url := '/production/packaging/' || NEW.id;

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

-- -----------------------------------------------------------------------------
-- 10. Schema registry updates
-- -----------------------------------------------------------------------------
UPDATE _schema_registry
SET
  key_fields = '["session_date", "status", "completed_at", "brands", "total_planned", "total_actual"]'::jsonb,
  description = 'Packaging sessions track kegging, canning, and bottling runs. Each session contains line items with batch sources, selling formats, and planned/actual quantities.',
  updated_at = NOW()
WHERE table_name = 'packaging_sessions';

UPDATE _schema_registry
SET
  key_fields = '["session_id", "brand_id", "batch_id", "selling_format_id", "planned_quantity", "actual_quantity"]'::jsonb,
  description = 'Line items within a packaging session. Each line item represents a product (brand + format) being packaged from a single batch.',
  updated_at = NOW()
WHERE table_name = 'session_line_items';

-- -----------------------------------------------------------------------------
-- Done
-- -----------------------------------------------------------------------------
SELECT 'Packaging sessions redesign migration complete!' AS message;
