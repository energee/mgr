-- Vessel Transfer Trigger
--
-- Automatically updates vessel status and current_batch_id when transfers occur:
-- - Destination vessel: status → 'in_use', current_batch_id → batch_id
-- - Source vessel (if any): status → 'dirty', current_batch_id → null
--
-- This ensures vessel state stays in sync with transfers without manual updates.

-- =============================================================================
-- Trigger Function
-- =============================================================================

CREATE OR REPLACE FUNCTION handle_vessel_transfer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Update destination vessel: mark as in_use with the batch
  UPDATE vessels
  SET
    status = 'in_use',
    current_batch_id = NEW.batch_id,
    updated_at = NOW()
  WHERE id = NEW.to_vessel_id;

  -- Update source vessel (if specified): mark as dirty and clear batch
  -- NULL from_vessel_id indicates knockout from kettle
  IF NEW.from_vessel_id IS NOT NULL THEN
    UPDATE vessels
    SET
      status = 'dirty',
      current_batch_id = NULL,
      updated_at = NOW()
    WHERE id = NEW.from_vessel_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION handle_vessel_transfer() IS 'Updates vessel status and current_batch_id when a transfer is recorded.';

-- =============================================================================
-- Trigger
-- =============================================================================

CREATE TRIGGER vessel_transfer_status_update
  AFTER INSERT ON vessel_transfers
  FOR EACH ROW
  EXECUTE FUNCTION handle_vessel_transfer();

COMMENT ON TRIGGER vessel_transfer_status_update ON vessel_transfers IS 'Auto-update vessel status on transfer insert.';

-- =============================================================================
-- Schema Registry Update
-- =============================================================================

UPDATE _schema_registry
SET ai_context = jsonb_build_object(
  'trigger', 'handle_vessel_transfer() automatically updates vessel status on transfer insert',
  'behavior', 'Destination vessel → in_use, Source vessel (if any) → dirty'
)
WHERE table_name = 'vessel_transfers';
