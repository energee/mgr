-- =============================================================================
-- Migration: Create containers, selling_formats, and channel_formats tables
-- =============================================================================
-- Replaces the package_types/keg_types dual-table model with a unified
-- container + selling format hierarchy. Containers are physical vessels
-- (cans, bottles, kegs). Selling formats define how they're grouped for
-- sale (single, 4-pack, case of 24, per keg).

-- -----------------------------------------------------------------------------
-- 1. containers table
-- -----------------------------------------------------------------------------
CREATE TABLE containers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('package', 'keg')),
  volume_oz DECIMAL(6,2),
  volume_bbl DECIMAL(10,4),
  deposit_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT containers_package_needs_oz CHECK (type != 'package' OR volume_oz IS NOT NULL),
  CONSTRAINT containers_keg_needs_bbl CHECK (type != 'keg' OR volume_bbl IS NOT NULL)
);

ALTER TABLE containers ENABLE ROW LEVEL SECURITY;

CREATE POLICY containers_select ON containers
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY containers_write ON containers
  FOR ALL
  USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

CREATE TRIGGER set_containers_updated_at
  BEFORE UPDATE ON containers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------------------------------------
-- 2. selling_formats table
-- -----------------------------------------------------------------------------
CREATE TABLE selling_formats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id UUID NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit_count INTEGER NOT NULL DEFAULT 1 CHECK (unit_count > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(container_id, name)
);

ALTER TABLE selling_formats ENABLE ROW LEVEL SECURITY;

CREATE POLICY selling_formats_select ON selling_formats
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY selling_formats_write ON selling_formats
  FOR ALL
  USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

CREATE TRIGGER set_selling_formats_updated_at
  BEFORE UPDATE ON selling_formats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_selling_formats_container ON selling_formats(container_id);

-- -----------------------------------------------------------------------------
-- 3. channel_formats junction table
-- -----------------------------------------------------------------------------
CREATE TABLE channel_formats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  selling_format_id UUID NOT NULL REFERENCES selling_formats(id) ON DELETE CASCADE,
  sales_channel_id UUID NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  UNIQUE(selling_format_id, sales_channel_id)
);

ALTER TABLE channel_formats ENABLE ROW LEVEL SECURITY;

CREATE POLICY channel_formats_select ON channel_formats
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY channel_formats_write ON channel_formats
  FOR ALL
  USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

CREATE INDEX idx_channel_formats_channel ON channel_formats(sales_channel_id);
CREATE INDEX idx_channel_formats_format ON channel_formats(selling_format_id);

-- -----------------------------------------------------------------------------
-- 4. Schema registry entries
-- -----------------------------------------------------------------------------
INSERT INTO _schema_registry (table_name, description, domain, relationships)
VALUES
  ('containers', 'Physical vessels — cans, bottles, kegs. Parent of selling_formats.', 'inventory',
   '[{"type": "hasMany", "target": "selling_formats", "foreignKey": "container_id"}]'),
  ('selling_formats', 'How a container is grouped for sale — single, 4-pack, case, per keg.', 'inventory',
   '[{"type": "belongsTo", "target": "containers", "foreignKey": "container_id"}, {"type": "hasMany", "target": "channel_formats", "foreignKey": "selling_format_id"}]'),
  ('channel_formats', 'Junction table: which selling formats appear in which sales channel.', 'sales',
   '[{"type": "belongsTo", "target": "selling_formats", "foreignKey": "selling_format_id"}, {"type": "belongsTo", "target": "sales_channels", "foreignKey": "sales_channel_id"}]')
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships;
