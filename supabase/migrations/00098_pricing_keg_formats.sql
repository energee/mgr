-- Migration: Unify keg and package formats in pricing matrix
--
-- Current state: pricing_tier_prices has package_format_id + keg_type_id
-- with XOR check constraint (exactly one non-null).
-- Target: single format_id column referencing either table via packaging_formats view.

-- =============================================================================
-- 1. Add show_in_pricing to keg_types
-- =============================================================================

ALTER TABLE keg_types
  ADD COLUMN IF NOT EXISTS show_in_pricing BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN keg_types.show_in_pricing
  IS 'Controls which keg formats appear as columns in the pricing matrix';

-- =============================================================================
-- 2. Merge package_format_id + keg_type_id into format_id (pricing_tier_prices)
-- =============================================================================

-- DRIFT SHIM (added retroactively — see PR #322): keg_type_id was added to
-- pricing_tier_prices and pricing_history directly in the live DB after
-- 00077 (no migration captured the ALTER); this file assumes it exists and
-- drops it below. No-op on live; required for a from-scratch replay.
ALTER TABLE pricing_tier_prices
  ADD COLUMN IF NOT EXISTS keg_type_id UUID REFERENCES keg_types(id);
ALTER TABLE pricing_history
  ADD COLUMN IF NOT EXISTS keg_type_id UUID;

-- Add unified column
ALTER TABLE pricing_tier_prices
  ADD COLUMN format_id UUID;

-- Populate from whichever is non-null
UPDATE pricing_tier_prices
SET format_id = COALESCE(package_format_id, keg_type_id);

-- Make it NOT NULL
ALTER TABLE pricing_tier_prices
  ALTER COLUMN format_id SET NOT NULL;

-- Drop old constraints
ALTER TABLE pricing_tier_prices
  DROP CONSTRAINT IF EXISTS chk_pricing_format_xor;

ALTER TABLE pricing_tier_prices
  DROP CONSTRAINT IF EXISTS pricing_tier_prices_package_format_id_fkey;

ALTER TABLE pricing_tier_prices
  DROP CONSTRAINT IF EXISTS pricing_tier_prices_keg_type_id_fkey;

-- Drop old unique indexes
DROP INDEX IF EXISTS uq_pricing_tier_price_package;
DROP INDEX IF EXISTS uq_pricing_tier_price_keg;

-- Drop old column indexes
DROP INDEX IF EXISTS idx_pricing_tier_prices_format;
DROP INDEX IF EXISTS idx_pricing_tier_prices_keg_type;

-- Drop old columns
ALTER TABLE pricing_tier_prices
  DROP COLUMN package_format_id,
  DROP COLUMN keg_type_id;

-- New unique constraint and index
ALTER TABLE pricing_tier_prices
  ADD CONSTRAINT pricing_tier_prices_tier_format_channel_key
  UNIQUE(pricing_tier_id, format_id, sales_channel_id);

CREATE INDEX idx_pricing_tier_prices_format ON pricing_tier_prices(format_id);

-- =============================================================================
-- 3. Merge columns in pricing_history
-- =============================================================================

ALTER TABLE pricing_history
  ADD COLUMN format_id UUID;

UPDATE pricing_history
SET format_id = COALESCE(package_format_id, keg_type_id);

ALTER TABLE pricing_history
  DROP COLUMN IF EXISTS package_format_id,
  DROP COLUMN IF EXISTS keg_type_id;

-- =============================================================================
-- 4. Update audit trigger to use format_id
-- =============================================================================

CREATE OR REPLACE FUNCTION log_pricing_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.price IS DISTINCT FROM NEW.price THEN
    INSERT INTO pricing_history (
      pricing_tier_price_id, pricing_tier_id, format_id,
      sales_channel_id, old_price, new_price, changed_by
    ) VALUES (
      NEW.id, NEW.pricing_tier_id, NEW.format_id,
      NEW.sales_channel_id, OLD.price, NEW.price, auth.uid()
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO pricing_history (
      pricing_tier_price_id, pricing_tier_id, format_id,
      sales_channel_id, old_price, new_price, changed_by
    ) VALUES (
      OLD.id, OLD.pricing_tier_id, OLD.format_id,
      OLD.sales_channel_id, OLD.price, NULL, auth.uid()
    );
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 5. Rebuild packaging_formats view with pricing columns
-- =============================================================================

DROP VIEW IF EXISTS packaging_formats;

CREATE VIEW packaging_formats
WITH (security_invoker = true)
AS
SELECT
  id,
  name,
  'package_type'::text AS format_source,
  container_type,
  volume_oz,
  units_per_case,
  is_active,
  show_in_pricing
FROM package_types
WHERE container_type != 'keg'

UNION ALL

SELECT
  id,
  name,
  'keg_type'::text AS format_source,
  'keg'::text AS container_type,
  NULL::numeric AS volume_oz,
  NULL::integer AS units_per_case,
  is_active,
  show_in_pricing
FROM keg_types;

COMMENT ON VIEW packaging_formats IS
  'Union view of non-keg package_types and keg_types. Includes show_in_pricing for pricing matrix column control.';

-- =============================================================================
-- 6. Schema registry update
-- =============================================================================

UPDATE _schema_registry
SET description = 'Union view of package types and keg types with pricing visibility flag'
WHERE table_name = 'packaging_formats';
