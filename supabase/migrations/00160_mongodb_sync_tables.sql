-- Migration: MongoDB sync infrastructure + batch_readings table
--
-- Creates tables for tracking MongoDB-to-PostgreSQL sync operations
-- and the batch_readings table (documented in production.md but never created).

-- =============================================================================
-- 1. MONGODB SYNC LOG
-- =============================================================================

CREATE TABLE mongodb_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  phase INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  records_synced INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  error_details JSONB,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

COMMENT ON TABLE mongodb_sync_log IS
  'Tracks MongoDB-to-PostgreSQL sync operations per entity type and phase.';

ALTER TABLE mongodb_sync_log ENABLE ROW LEVEL SECURITY;

-- Read-only for authenticated users; writes via admin/service role only
CREATE POLICY mongodb_sync_log_select ON mongodb_sync_log
  FOR SELECT TO authenticated
  USING (true);

-- =============================================================================
-- 2. MONGODB SYNC MAPPINGS
-- =============================================================================

CREATE TABLE mongodb_sync_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  mongo_id TEXT NOT NULL,
  pg_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(entity_type, mongo_id)
);

COMMENT ON TABLE mongodb_sync_mappings IS
  'Audit trail mapping MongoDB ObjectIDs to PostgreSQL UUIDs for sync operations.';

ALTER TABLE mongodb_sync_mappings ENABLE ROW LEVEL SECURITY;

-- Read-only for authenticated users; writes via admin/service role only
CREATE POLICY mongodb_sync_mappings_select ON mongodb_sync_mappings
  FOR SELECT TO authenticated
  USING (true);

-- =============================================================================
-- 3. BATCH READINGS (documented in production.md, never created)
-- =============================================================================

CREATE TABLE batch_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by UUID REFERENCES auth.users(id),
  measurements JSONB NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE batch_readings IS
  'Fermentation and QA readings for batches. Measurements stored as JSONB array of {type, value, unit} objects.';
COMMENT ON COLUMN batch_readings.measurements IS
  'Array of measurement objects: [{"type": "temperature", "value": 66, "unit": "F"}, {"type": "gravity", "value": 1.015, "unit": "SG"}, {"type": "ph", "value": 4.2}]';

CREATE INDEX idx_batch_readings_batch_date ON batch_readings(batch_id, recorded_at DESC);

ALTER TABLE batch_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY batch_readings_select ON batch_readings
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY batch_readings_insert ON batch_readings
  FOR INSERT TO authenticated
  WITH CHECK (recorded_by IS NULL OR auth.uid() = recorded_by);

CREATE POLICY batch_readings_update ON batch_readings
  FOR UPDATE TO authenticated
  USING (recorded_by IS NULL OR auth.uid() = recorded_by);

-- =============================================================================
-- 4. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, ai_context)
VALUES
  ('mongodb_sync_log',
   'Tracks MongoDB-to-PostgreSQL sync operations per entity type and phase',
   'system', NULL,
   '["entity_type", "phase", "status"]'::jsonb,
   '["SELECT * FROM mongodb_sync_log ORDER BY started_at DESC LIMIT 10"]'::jsonb),
  ('mongodb_sync_mappings',
   'Audit trail mapping MongoDB ObjectIDs to PostgreSQL UUIDs',
   'system', NULL,
   '["entity_type", "mongo_id", "pg_id"]'::jsonb,
   '["SELECT entity_type, count(*) FROM mongodb_sync_mappings GROUP BY entity_type"]'::jsonb),
  ('batch_readings',
   'Fermentation and QA readings for batches with JSONB measurements',
   'production',
   '{"batch_id": "batches.id"}'::jsonb,
   '["batch_id", "recorded_at", "measurements"]'::jsonb,
   '["SELECT * FROM batch_readings WHERE batch_id = ?", "Get latest readings for a batch"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  ai_context = EXCLUDED.ai_context;
