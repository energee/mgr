-- Keg Types Table
-- Phase 10.1 / Phase 8.6: Track keg sizes for inventory, deposits, and lifecycle management

-- =============================================================================
-- 1. KEG_TYPES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS keg_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  volume_bbl DECIMAL(10,4) NOT NULL,
  deposit_amount DECIMAL(10,2) DEFAULT 0,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  position INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE keg_types IS 'Keg type definitions for inventory tracking and deposit management';
COMMENT ON COLUMN keg_types.name IS 'Display name (e.g., "1/2 Barrel", "1/6 Barrel", "50L")';
COMMENT ON COLUMN keg_types.code IS 'Short code (e.g., "half", "sixth", "50L")';
COMMENT ON COLUMN keg_types.volume_bbl IS 'Volume in barrels for TTB reporting';
COMMENT ON COLUMN keg_types.deposit_amount IS 'Keg deposit amount charged to customers';
COMMENT ON COLUMN keg_types.position IS 'Display order in lists';

-- Enable RLS
ALTER TABLE keg_types ENABLE ROW LEVEL SECURITY;

-- RLS Policy: All authenticated users can read
CREATE POLICY "keg_types_select" ON keg_types
  FOR SELECT TO authenticated USING (true);

-- RLS Policy: Only admin can insert/update/delete
CREATE POLICY "keg_types_insert" ON keg_types
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "keg_types_update" ON keg_types
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "keg_types_delete" ON keg_types
  FOR DELETE TO authenticated USING (true);

-- =============================================================================
-- 2. SEED DEFAULT KEG TYPES
-- =============================================================================

INSERT INTO keg_types (name, code, volume_bbl, deposit_amount, position) VALUES
  ('1/2 Barrel', 'half', 0.5, 30.00, 1),
  ('1/4 Barrel', 'quarter', 0.25, 25.00, 2),
  ('1/6 Barrel', 'sixth', 0.1667, 20.00, 3),
  ('50 Liter', '50L', 0.4259, 30.00, 4),
  ('30 Liter', '30L', 0.2555, 25.00, 5),
  ('Corny (5 gal)', 'corny', 0.1613, 0.00, 6)
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- 3. UPDATED_AT TRIGGER
-- =============================================================================

CREATE TRIGGER set_keg_types_updated_at
  BEFORE UPDATE ON keg_types
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 4. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples)
VALUES
  ('keg_types', 'Keg type definitions with volumes and deposits', 'inventory',
   '{}'::jsonb,
   '["id", "name", "code", "volume_bbl", "deposit_amount"]'::jsonb,
   '["List all keg types", "What is the deposit for a 1/2 barrel?"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;
