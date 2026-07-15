-- Migration: 00199_capture_selling_formats_containers
--
-- Captures the two remaining out-of-band TABLES from the live database:
-- `containers` and `selling_formats` were created directly in prod (no
-- CREATE TABLE migration exists), yet 00160+ reference them — the last
-- structural blocker for replaying the chain from scratch (issue #10;
-- 00190/00191 captured the out-of-band views/functions but not these).
--
-- On the live database every statement here is a no-op or an exact
-- re-statement of what already exists. On a from-scratch replay migration
-- 00112 creates the pre-00160 shape in the reserved historical gap, 00160 adds
-- the pallet columns, and this migration layers on the captured RLS state.
-- The plain-Postgres test shim intentionally contains no application tables.
--
-- NOT captured here (already guaranteed elsewhere in the chain):
--   * pallet columns + trg_selling_formats_pallet_quantity — 00160
--   * views over these tables — 00190/00191

-- ---------------------------------------------------------------------------
-- 1. Tables (full current live shape; skipped wherever they already exist)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS containers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL UNIQUE,
  type           TEXT NOT NULL CHECK (type IN ('package', 'keg')),
  volume_oz      NUMERIC(6,2),
  volume_bbl     NUMERIC(10,4),
  deposit_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT containers_deposit_keg_only CHECK (type = 'keg' OR deposit_amount = 0),
  CONSTRAINT containers_keg_needs_bbl    CHECK (type <> 'keg' OR volume_bbl IS NOT NULL),
  CONSTRAINT containers_package_needs_oz CHECK (type <> 'package' OR volume_oz IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS selling_formats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id    UUID NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  unit_count      INTEGER NOT NULL DEFAULT 1 CHECK (unit_count > 0),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  units_per_layer INTEGER CHECK (units_per_layer > 0),
  default_layers  INTEGER CHECK (default_layers > 0),
  pallet_quantity INTEGER CHECK (pallet_quantity > 0),
  UNIQUE (container_id, name)
);

CREATE INDEX IF NOT EXISTS idx_selling_formats_container
  ON selling_formats (container_id);

-- ---------------------------------------------------------------------------
-- 2. updated_at triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_containers_updated_at ON containers;
CREATE TRIGGER set_containers_updated_at
  BEFORE UPDATE ON containers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_selling_formats_updated_at ON selling_formats;
CREATE TRIGGER set_selling_formats_updated_at
  BEFORE UPDATE ON selling_formats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS — catalog pattern (any-auth read, settings:manage write), matching
--    the live policies verbatim.
-- ---------------------------------------------------------------------------
ALTER TABLE containers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE selling_formats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS containers_select ON containers;
CREATE POLICY containers_select ON containers
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS containers_write ON containers;
CREATE POLICY containers_write ON containers
  FOR ALL
  USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

DROP POLICY IF EXISTS selling_formats_select ON selling_formats;
CREATE POLICY selling_formats_select ON selling_formats
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS selling_formats_write ON selling_formats;
CREATE POLICY selling_formats_write ON selling_formats
  FOR ALL
  USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

-- Permissive-SELECT markers for the 00198 guardrail
-- (src/__tests__/integration/rls-coverage.test.ts).
COMMENT ON POLICY containers_select ON containers IS
  'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';
COMMENT ON POLICY selling_formats_select ON selling_formats IS
  'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';

-- ---------------------------------------------------------------------------
-- 3a. email_settings — capture + CLOSE A LIVE GAP (found during PR #322)
--
-- Out-of-band table (no CREATE TABLE migration; stubbed for replays in the
-- integration bootstrap). Live carried two permissive policies —
-- "Authenticated users can read/update email settings" with USING (true) /
-- WITH CHECK (true) — meaning ANY authenticated user could rewrite
-- supabase_project_url/app_url and redirect notification email delivery.
-- Invisible to earlier audits because those scanned migration-defined tables.
-- Tightened here to the settings pattern: any-auth read, settings:manage
-- write. The notify path is unaffected (its reader is SECURITY DEFINER).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_settings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_enabled           BOOLEAN NOT NULL DEFAULT false,
  supabase_project_url TEXT,
  app_url              TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read email settings" ON email_settings;
DROP POLICY IF EXISTS "Authenticated users can update email settings" ON email_settings;
DROP POLICY IF EXISTS email_settings_select ON email_settings;
CREATE POLICY email_settings_select ON email_settings
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS email_settings_write ON email_settings;
CREATE POLICY email_settings_write ON email_settings
  FOR ALL
  USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

COMMENT ON POLICY email_settings_select ON email_settings IS
  'RLS-EXCEPTION: singleton app-settings row read by the settings UI; contains no secrets; write is gated by settings:manage on the companion _write policy.';

-- ---------------------------------------------------------------------------
-- 3b. Misc drift indexes deferred from earlier migrations (see PR #322)
-- ---------------------------------------------------------------------------
-- From 00129: the table only exists from 00158 on a from-scratch replay.
CREATE INDEX IF NOT EXISTS idx_yeast_pitch_events_created_by
  ON yeast_pitch_events (created_by);

-- ---------------------------------------------------------------------------
-- 4. QBO policies — capture the live out-of-band replacements
--
-- History: 00099 created permissive per-command policies; 00102 dropped them
-- but its role-based replacements referenced the pre-00097 `role` column and
-- never applied. The live pair below (00097 §5i integrations pattern) was
-- applied out-of-band. Idempotent re-statement of live.
-- ---------------------------------------------------------------------------
DO $$ DECLARE _tbl TEXT; BEGIN
  FOR _tbl IN SELECT unnest(ARRAY['qbo_account_mappings','qbo_sync_log','qbo_sync_mappings']) LOOP
    IF to_regclass('public.'||_tbl) IS NULL THEN
      RAISE NOTICE 'table % does not exist; skipping policy capture', _tbl;
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', _tbl||'_select', _tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (user_has_permission(''integrations:manage''))', _tbl||'_select', _tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', _tbl||'_write', _tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (user_has_permission(''integrations:manage'')) WITH CHECK (user_has_permission(''integrations:manage''))', _tbl||'_write', _tbl);
  END LOOP;
END $$;
