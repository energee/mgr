-- MGR Vessels Migration
--
-- Creates vessels, vessel_transfers, and vessel_cleanings tables.
-- Also creates locations table (referenced by vessels).
--
-- Vessel states follow brewery cleaning workflow:
-- dirty → caustic_cleaned → ready_for_use → in_use → dirty
-- Plus maintenance as escape hatch from any state.

-- =============================================================================
-- Locations Table
-- =============================================================================

CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address JSONB,  -- {street, city, state, zip}
  location_type TEXT NOT NULL DEFAULT 'brewery',  -- brewery, warehouse, taproom, offsite
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE locations IS 'Physical locations/facilities. Vessels, bins, and inventory are assigned to locations.';

-- Insert default location
INSERT INTO locations (id, name, location_type, is_primary) VALUES
  ('00000000-0000-0000-0000-000000000002', 'Main Brewery', 'brewery', true);

-- =============================================================================
-- Vessels Table
-- =============================================================================

CREATE TYPE vessel_type AS ENUM (
  'fermenter',
  'brite',
  'kettle',
  'mash_tun',
  'hlt',
  'unitank'
);

CREATE TYPE vessel_status AS ENUM (
  'dirty',
  'caustic_cleaned',
  'ready_for_use',
  'in_use',
  'maintenance'
);

CREATE TABLE vessels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  vessel_type vessel_type NOT NULL,
  capacity_bbl DECIMAL(8,2) NOT NULL,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  status vessel_status NOT NULL DEFAULT 'ready_for_use',
  current_batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE vessels IS 'Brewing vessels (fermenters, brites, kettles, etc.). Status tracks cleaning state through brewery workflow.';

CREATE INDEX idx_vessels_status ON vessels(status);
CREATE INDEX idx_vessels_type ON vessels(vessel_type);
CREATE INDEX idx_vessels_location ON vessels(location_id);
CREATE INDEX idx_vessels_current_batch ON vessels(current_batch_id) WHERE current_batch_id IS NOT NULL;

-- =============================================================================
-- Vessel Transfers Table
-- =============================================================================

CREATE TABLE vessel_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  from_vessel_id UUID REFERENCES vessels(id) ON DELETE SET NULL,  -- NULL if from kettle
  to_vessel_id UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  volume_bbl DECIMAL(8,2) NOT NULL,
  transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  transferred_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE vessel_transfers IS 'Track batch movements between vessels. from_vessel_id is NULL for knockout from kettle.';

CREATE INDEX idx_vessel_transfers_batch ON vessel_transfers(batch_id);
CREATE INDEX idx_vessel_transfers_to ON vessel_transfers(to_vessel_id);
CREATE INDEX idx_vessel_transfers_from ON vessel_transfers(from_vessel_id) WHERE from_vessel_id IS NOT NULL;
CREATE INDEX idx_vessel_transfers_date ON vessel_transfers(transferred_at);

-- =============================================================================
-- Vessel Cleanings Table
-- =============================================================================

CREATE TYPE cleaning_type AS ENUM (
  'cip',
  'caustic',
  'acid',
  'sanitize',
  'manual',
  'rinse'
);

CREATE TABLE vessel_cleanings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  cleaning_type cleaning_type NOT NULL,
  from_status vessel_status NOT NULL,
  to_status vessel_status NOT NULL,
  cleaned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleaned_by UUID REFERENCES auth.users(id),
  duration_min INTEGER,
  chemicals_used JSONB,  -- [{chemical, concentration_percent, temp_f}]
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE vessel_cleanings IS 'Cleaning history for vessels. Each record represents a cleaning event with status transition.';

CREATE INDEX idx_vessel_cleanings_vessel ON vessel_cleanings(vessel_id);
CREATE INDEX idx_vessel_cleanings_date ON vessel_cleanings(cleaned_at);
CREATE INDEX idx_vessel_cleanings_type ON vessel_cleanings(cleaning_type);

-- =============================================================================
-- Row Level Security
-- =============================================================================

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vessels ENABLE ROW LEVEL SECURITY;
ALTER TABLE vessel_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vessel_cleanings ENABLE ROW LEVEL SECURITY;

CREATE POLICY location_access ON locations
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY vessel_access ON vessels
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY vessel_transfer_access ON vessel_transfers
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY vessel_cleaning_access ON vessel_cleanings
  FOR ALL USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- Updated At Triggers
-- =============================================================================

CREATE TRIGGER update_locations_updated_at BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_vessels_updated_at BEFORE UPDATE ON vessels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- Schema Registry
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, state_machine, query_examples) VALUES
('locations', 'Physical locations/facilities where vessels, inventory, and operations occur.', 'system',
 '["has_many: vessels", "has_many: bins"]',
 '["name", "location_type", "is_primary"]', NULL,
 '["Get primary location", "List active locations", "Find warehouses"]'),

('vessels', 'Brewing vessels with cleaning state tracking.', 'production',
 '["belongs_to: locations", "belongs_to: batches (current)", "has_many: vessel_transfers", "has_many: vessel_cleanings"]',
 '["name", "vessel_type", "capacity_bbl", "status"]',
 '{"stateField": "status", "states": ["dirty", "caustic_cleaned", "ready_for_use", "in_use", "maintenance"], "transitions": {"dirty": ["caustic_cleaned", "ready_for_use", "maintenance"], "caustic_cleaned": ["ready_for_use", "maintenance"], "ready_for_use": ["in_use", "maintenance"], "in_use": ["dirty", "maintenance"], "maintenance": ["dirty"]}}',
 '["List available fermenters", "Find vessels ready for use", "Get vessel with current batch", "Show cleaning history for FV1"]'),

('vessel_transfers', 'Batch movements between vessels.', 'production',
 '["belongs_to: batches", "belongs_to: vessels (from)", "belongs_to: vessels (to)"]',
 '["batch_id", "volume_bbl", "transferred_at"]', NULL,
 '["Get transfer history for a batch", "List transfers to a vessel", "Find all knockout transfers (from_vessel_id IS NULL)"]'),

('vessel_cleanings', 'Vessel cleaning history with status transitions.', 'production',
 '["belongs_to: vessels", "belongs_to: auth.users (cleaned_by)"]',
 '["vessel_id", "cleaning_type", "cleaned_at", "from_status", "to_status"]', NULL,
 '["Get cleaning history for a vessel", "Find all caustic cleans today", "List vessels cleaned by user"]');

-- =============================================================================
-- Helpful Views
-- =============================================================================

-- Vessels with batch info
CREATE OR REPLACE VIEW vessels_with_batch AS
SELECT
  v.*,
  b.batch_number,
  b.name AS batch_name,
  b.status AS batch_status,
  r.name AS recipe_name
FROM vessels v
LEFT JOIN batches b ON v.current_batch_id = b.id
LEFT JOIN recipes r ON b.recipe_id = r.id;

COMMENT ON VIEW vessels_with_batch IS 'Vessels with current batch details. Use for vessel board/overview.';

-- Available vessels by type
CREATE OR REPLACE VIEW available_vessels AS
SELECT
  v.*,
  l.name AS location_name
FROM vessels v
LEFT JOIN locations l ON v.location_id = l.id
WHERE v.status = 'ready_for_use'
  AND v.is_active = true
  AND v.current_batch_id IS NULL;

COMMENT ON VIEW available_vessels IS 'Vessels that are clean, empty, and ready for use.';

-- Recent cleaning activity
CREATE OR REPLACE VIEW recent_vessel_cleanings AS
SELECT
  vc.*,
  v.name AS vessel_name,
  v.vessel_type,
  u.email AS cleaned_by_email
FROM vessel_cleanings vc
JOIN vessels v ON vc.vessel_id = v.id
LEFT JOIN auth.users u ON vc.cleaned_by = u.id
WHERE vc.cleaned_at > NOW() - INTERVAL '7 days'
ORDER BY vc.cleaned_at DESC;

COMMENT ON VIEW recent_vessel_cleanings IS 'Cleaning events from the last 7 days for dashboard/activity feed.';
