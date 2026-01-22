-- Fix vessel_status values in enum_values table to match the actual ENUM type
-- The ENUM type (from 00006_vessels.sql) has: dirty, caustic_cleaned, ready_for_use, in_use, maintenance
-- But enum_values table (from 00037) had different values

-- Delete incorrect vessel_status entries
DELETE FROM enum_values WHERE enum_type = 'vessel_status';

-- Insert correct vessel_status values matching the ENUM type and frontend state machine
INSERT INTO enum_values (enum_type, value, label, description, color, sort_order, is_default, metadata)
VALUES
  ('vessel_status', 'dirty', 'Dirty', 'Needs cleaning', 'warning', 10, FALSE, NULL),
  ('vessel_status', 'caustic_cleaned', 'Caustic Cleaned', 'Cleaned with caustic, needs sanitizing', 'info', 20, FALSE, NULL),
  ('vessel_status', 'ready_for_use', 'Ready', 'Clean and ready for use', 'success', 30, TRUE, NULL),
  ('vessel_status', 'in_use', 'In Use', 'Currently occupied by a batch', 'default', 40, FALSE, NULL),
  ('vessel_status', 'maintenance', 'Maintenance', 'Under maintenance', 'error', 50, FALSE, NULL);

COMMENT ON TABLE enum_values IS 'Registry of enum values with display metadata. Used for dynamic dropdowns and validation.';
