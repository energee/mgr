-- Migration: Start Batch Fermentation (Atomic)
-- Description: Create function to start batch fermentation as an atomic transaction

-- =============================================================================
-- Function: start_batch_fermentation
-- =============================================================================
-- Atomically starts batch fermentation by:
-- 1. Creating a vessel_transfer record (knockout from kettle)
-- 2. Updating the batch status to 'fermenting'
--
-- This ensures both operations succeed or fail together.

CREATE OR REPLACE FUNCTION start_batch_fermentation(
  p_batch_id UUID,
  p_vessel_id UUID,
  p_volume_bbl NUMERIC,
  p_vessel_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Insert vessel transfer (knockout from kettle)
  INSERT INTO vessel_transfers (
    batch_id,
    from_vessel_id,
    to_vessel_id,
    volume_bbl,
    transferred_at,
    notes
  ) VALUES (
    p_batch_id,
    NULL, -- Knockout from kettle
    p_vessel_id,
    p_volume_bbl,
    NOW(),
    'Knockout - start of fermentation'
  );

  -- Update batch status and fermenter
  UPDATE batches
  SET
    status = 'fermenting',
    fermenter = p_vessel_name,
    volume_bbl = p_volume_bbl
  WHERE id = p_batch_id;

  -- Verify batch was updated
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch % not found', p_batch_id;
  END IF;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION start_batch_fermentation(UUID, UUID, NUMERIC, TEXT) TO authenticated;

-- Update schema registry
UPDATE _schema_registry
SET ai_context = jsonb_set(
  COALESCE(ai_context, '{}'::jsonb),
  '{functions}',
  COALESCE(ai_context->'functions', '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'name', 'start_batch_fermentation',
      'purpose', 'Atomically start batch fermentation by creating vessel transfer and updating batch status',
      'parameters', jsonb_build_object(
        'p_batch_id', 'Batch UUID',
        'p_vessel_id', 'Destination vessel UUID',
        'p_volume_bbl', 'Volume in barrels',
        'p_vessel_name', 'Vessel name for batch.fermenter field'
      ),
      'returns', 'void',
      'example', 'SELECT start_batch_fermentation(''batch-uuid'', ''vessel-uuid'', 7.0, ''FV-01'')'
    )
  )
)
WHERE table_name = 'batches';
