-- Migration: 00040_enum_validation_triggers.sql
-- Purpose: Add validation triggers to ensure enum values exist in enum_values table
--
-- These triggers act like soft foreign keys, validating that values used in
-- status/type columns exist in the enum_values registry before insert/update.

-- =============================================================================
-- 1. Generic validation function
-- =============================================================================

CREATE OR REPLACE FUNCTION validate_enum_value()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  enum_type_name TEXT;
  column_name TEXT;
  column_value TEXT;
  valid BOOLEAN;
BEGIN
  -- Get the enum type and column from trigger args
  enum_type_name := TG_ARGV[0];
  column_name := TG_ARGV[1];

  -- Get the value from the NEW record dynamically
  EXECUTE format('SELECT ($1).%I::TEXT', column_name) INTO column_value USING NEW;

  -- Skip validation if value is NULL (let NOT NULL constraints handle that)
  IF column_value IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if value exists in enum_values
  SELECT EXISTS (
    SELECT 1 FROM enum_values
    WHERE enum_type = enum_type_name
      AND value = column_value
      AND is_active = TRUE
  ) INTO valid;

  IF NOT valid THEN
    RAISE EXCEPTION 'Invalid % value: %. Valid values are: %',
      enum_type_name,
      column_value,
      (SELECT string_agg(value, ', ' ORDER BY sort_order)
       FROM enum_values
       WHERE enum_type = enum_type_name AND is_active = TRUE);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION validate_enum_value() IS
'Generic trigger function to validate enum values against the enum_values registry.
Usage: CREATE TRIGGER ... EXECUTE FUNCTION validate_enum_value(enum_type, column_name)';

-- =============================================================================
-- 2. Create validation triggers for each table/column
-- =============================================================================

-- batches.status -> batch_status
CREATE TRIGGER validate_batch_status
  BEFORE INSERT OR UPDATE OF status ON batches
  FOR EACH ROW
  EXECUTE FUNCTION validate_enum_value('batch_status', 'status');

-- orders.status -> order_status
CREATE TRIGGER validate_order_status
  BEFORE INSERT OR UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_enum_value('order_status', 'status');

-- purchase_orders.status -> po_status
CREATE TRIGGER validate_po_status
  BEFORE INSERT OR UPDATE OF status ON purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_enum_value('po_status', 'status');

-- vessels.status -> vessel_status
CREATE TRIGGER validate_vessel_status
  BEFORE INSERT OR UPDATE OF status ON vessels
  FOR EACH ROW
  EXECUTE FUNCTION validate_enum_value('vessel_status', 'status');

-- vessels.vessel_type -> vessel_type
CREATE TRIGGER validate_vessel_type
  BEFORE INSERT OR UPDATE OF vessel_type ON vessels
  FOR EACH ROW
  EXECUTE FUNCTION validate_enum_value('vessel_type', 'vessel_type');

-- yeast_pitches.status -> yeast_pitch_status
CREATE TRIGGER validate_yeast_pitch_status
  BEFORE INSERT OR UPDATE OF status ON yeast_pitches
  FOR EACH ROW
  EXECUTE FUNCTION validate_enum_value('yeast_pitch_status', 'status');

-- packaging_sessions.status -> packaging_session_status
CREATE TRIGGER validate_packaging_session_status
  BEFORE INSERT OR UPDATE OF status ON packaging_sessions
  FOR EACH ROW
  EXECUTE FUNCTION validate_enum_value('packaging_session_status', 'status');

-- keg_inventory.state -> keg_state
CREATE TRIGGER validate_keg_state
  BEFORE INSERT OR UPDATE OF state ON keg_inventory
  FOR EACH ROW
  EXECUTE FUNCTION validate_enum_value('keg_state', 'state');

-- keg_transactions.transaction_type -> keg_transaction_type
CREATE TRIGGER validate_keg_transaction_type
  BEFORE INSERT OR UPDATE OF transaction_type ON keg_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_enum_value('keg_transaction_type', 'transaction_type');

-- inventory_items.category -> catalog_type
CREATE TRIGGER validate_catalog_type
  BEFORE INSERT OR UPDATE OF category ON inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION validate_enum_value('catalog_type', 'category');

-- Note: notifications table uses read_at/dismissed_at timestamps instead of status enum
-- Note: notifications.priority uses CHECK constraint, not enum_values (low/normal/high/urgent)

-- user_profiles.role -> user_role
CREATE TRIGGER validate_user_role
  BEFORE INSERT OR UPDATE OF role ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION validate_enum_value('user_role', 'role');

-- user_profiles.status -> user_status
CREATE TRIGGER validate_user_status
  BEFORE INSERT OR UPDATE OF status ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION validate_enum_value('user_status', 'status');

-- locations.location_type -> location_type
CREATE TRIGGER validate_location_type
  BEFORE INSERT OR UPDATE OF location_type ON locations
  FOR EACH ROW
  EXECUTE FUNCTION validate_enum_value('location_type', 'location_type');
