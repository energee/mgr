-- Packaging Session Completion Trigger
-- Implements Phase 3.3: Link packaging session completion to FG creation
--
-- When a packaging session status changes to 'completed', this trigger:
-- 1. Validates all line items have actual_quantity > 0
-- 2. Generates lot numbers for each line item
-- 3. Creates finished_goods records
-- 4. Creates allocations (batch -> finished_good) for inventory tracking

-- =============================================================================
-- LOT NUMBER GENERATION
-- =============================================================================

-- Function to generate lot numbers in standard format: YYYYMMDD-NNN
-- Where NNN is a sequential number for that date
CREATE OR REPLACE FUNCTION generate_lot_number(p_date DATE)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_date_str TEXT;
  v_seq INTEGER;
  v_lot TEXT;
BEGIN
  -- Format date as YYYYMMDD
  v_date_str := to_char(p_date, 'YYYYMMDD');

  -- Get next sequence number for this date
  SELECT COALESCE(MAX(
    CASE
      WHEN lot_number ~ ('^' || v_date_str || '-[0-9]+$')
      THEN CAST(split_part(lot_number, '-', 2) AS INTEGER)
      ELSE 0
    END
  ), 0) + 1
  INTO v_seq
  FROM finished_goods
  WHERE lot_number LIKE v_date_str || '-%';

  -- Format as YYYYMMDD-NNN (3 digit sequence, zero-padded)
  v_lot := v_date_str || '-' || lpad(v_seq::TEXT, 3, '0');

  RETURN v_lot;
END;
$$;

COMMENT ON FUNCTION generate_lot_number IS 'Generates lot numbers in format YYYYMMDD-NNN';

-- =============================================================================
-- PACKAGING COMPLETION FUNCTION
-- =============================================================================

-- Function to create finished goods from completed packaging session
CREATE OR REPLACE FUNCTION create_finished_goods_from_packaging(p_session_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_line RECORD;
  v_batch_info JSONB;
  v_batch_id UUID;
  v_fg_id UUID;
  v_lot_number TEXT;
  v_count INTEGER := 0;
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

    -- Extract batch_id from source_batches JSONB (use first batch)
    v_batch_info := v_line.source_batches->0;
    IF v_batch_info IS NOT NULL AND v_batch_info->>'batch_id' IS NOT NULL THEN
      v_batch_id := (v_batch_info->>'batch_id')::UUID;
    ELSE
      v_batch_id := NULL;
    END IF;

    -- Generate lot number
    v_lot_number := generate_lot_number(v_session.session_date);

    -- Create finished_goods record
    INSERT INTO finished_goods (
      batch_id,
      brand_id,
      package_type_id,
      session_line_item_id,
      quantity,
      lot_number,
      production_date,
      created_by
    ) VALUES (
      v_batch_id,
      v_line.brand_id,
      v_line.package_type_id,
      v_line.id,
      v_line.actual_quantity,
      v_lot_number,
      v_session.session_date,
      v_session.created_by
    )
    RETURNING id INTO v_fg_id;

    -- Create allocation record (batch -> finished_good)
    IF v_batch_id IS NOT NULL THEN
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

COMMENT ON FUNCTION create_finished_goods_from_packaging IS 'Creates finished goods and allocations from a completed packaging session';

-- =============================================================================
-- TRIGGER FUNCTION
-- =============================================================================

-- Trigger function that fires on packaging session status change
CREATE OR REPLACE FUNCTION trigger_packaging_session_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Only fire when status changes to 'completed'
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    -- Create finished goods
    v_count := create_finished_goods_from_packaging(NEW.id);

    -- Log the action (optional: could add to audit table)
    RAISE NOTICE 'Created % finished goods records for packaging session %', v_count, NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trigger_packaging_session_completion IS 'Trigger function to create FG on packaging completion';

-- =============================================================================
-- CREATE TRIGGER
-- =============================================================================

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS on_packaging_session_completion ON packaging_sessions;

-- Create trigger for packaging session completion
CREATE TRIGGER on_packaging_session_completion
  AFTER UPDATE OF status ON packaging_sessions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_packaging_session_completion();

COMMENT ON TRIGGER on_packaging_session_completion ON packaging_sessions IS
  'Creates finished goods records when packaging session is completed';

-- =============================================================================
-- SCHEMA REGISTRY UPDATE
-- =============================================================================

-- Update schema registry with new functions
INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples)
VALUES
  ('generate_lot_number', 'Function to generate sequential lot numbers in YYYYMMDD-NNN format', 'packaging', NULL,
   '["date"]'::jsonb,
   '["SELECT generate_lot_number(CURRENT_DATE)", "Generate lot number for today"]'::jsonb),
  ('create_finished_goods_from_packaging', 'Function to create FG records from completed packaging session', 'packaging', NULL,
   '["session_id"]'::jsonb,
   '["SELECT create_finished_goods_from_packaging(uuid)", "Create FG from packaging session"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;
