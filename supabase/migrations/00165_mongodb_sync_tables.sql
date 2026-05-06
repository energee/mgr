-- Migration: MongoDB sync infrastructure
--
-- Creates tables for tracking MongoDB-to-PostgreSQL sync operations.
-- Test/reading data syncs into the existing batch_logs table (log_type="measurement").

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
-- check-permissive-rls: skip read-only sync log; SELECT-only policy gated by `TO authenticated`; writes happen via service role
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
-- check-permissive-rls: skip read-only sync mappings; SELECT-only policy gated by `TO authenticated`; writes happen via service role
CREATE POLICY mongodb_sync_mappings_select ON mongodb_sync_mappings
  FOR SELECT TO authenticated
  USING (true);

-- =============================================================================
-- 3. SCHEMA REGISTRY
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
   '["SELECT entity_type, count(*) FROM mongodb_sync_mappings GROUP BY entity_type"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  ai_context = EXCLUDED.ai_context;
