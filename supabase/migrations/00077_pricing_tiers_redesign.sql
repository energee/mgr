-- =============================================================================
-- Migration: Pricing Tiers Redesign
-- =============================================================================
-- Replaces the channel-scoped pricing model (price_tiers + tier_prices) with
-- a tier-based pricing matrix. Tiers are independent; prices are defined per
-- (tier x package format x sales channel) combination.
--
-- New tables:
--   pricing_tiers        - Tier definitions (e.g. Tier 1-6, or named)
--   pricing_tier_prices  - One row per tier x format x channel
--   pricing_history      - Trigger-managed audit trail
--
-- Also:
--   package_types.show_in_pricing - controls which formats appear in matrix
--   recipes.pricing_tier_id       - links recipe to a pricing tier
-- =============================================================================

-- =============================================================================
-- 1. Pricing Tiers
-- =============================================================================

CREATE TABLE pricing_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  default_upc TEXT,
  cogs_min NUMERIC,
  cogs_max NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE pricing_tiers IS 'Tier definitions for the pricing matrix. Small, rarely-changing set.';
COMMENT ON COLUMN pricing_tiers.name IS 'Display name, e.g. "Tier 1", "IPA", "Stout"';
COMMENT ON COLUMN pricing_tiers.sort_order IS 'Display ordering in the matrix';
COMMENT ON COLUMN pricing_tiers.default_upc IS 'Default UPC for this tier (overridden by brand UPC if set)';
COMMENT ON COLUMN pricing_tiers.cogs_min IS 'Lower bound for auto-assignment from recipe COGS';
COMMENT ON COLUMN pricing_tiers.cogs_max IS 'Upper bound for auto-assignment from recipe COGS';

CREATE INDEX idx_pricing_tiers_sort ON pricing_tiers(sort_order);

-- =============================================================================
-- 2. Pricing Tier Prices (the matrix cells)
-- =============================================================================

CREATE TABLE pricing_tier_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_tier_id UUID NOT NULL REFERENCES pricing_tiers(id) ON DELETE CASCADE,
  package_format_id UUID NOT NULL REFERENCES package_types(id) ON DELETE CASCADE,
  sales_channel_id UUID NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  price NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(pricing_tier_id, package_format_id, sales_channel_id)
);

COMMENT ON TABLE pricing_tier_prices IS 'One row per tier x format x channel combination. The pricing matrix cells.';

CREATE INDEX idx_pricing_tier_prices_tier ON pricing_tier_prices(pricing_tier_id);
CREATE INDEX idx_pricing_tier_prices_format ON pricing_tier_prices(package_format_id);
CREATE INDEX idx_pricing_tier_prices_channel ON pricing_tier_prices(sales_channel_id);

-- =============================================================================
-- 3. Pricing History (audit trail)
-- =============================================================================

CREATE TABLE pricing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_tier_price_id UUID REFERENCES pricing_tier_prices(id) ON DELETE SET NULL,
  pricing_tier_id UUID NOT NULL,
  package_format_id UUID NOT NULL,
  sales_channel_id UUID NOT NULL,
  old_price NUMERIC(10,2),
  new_price NUMERIC(10,2),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by UUID
);

COMMENT ON TABLE pricing_history IS 'Trigger-managed audit trail for price changes. No application code writes here.';
COMMENT ON COLUMN pricing_history.pricing_tier_price_id IS 'FK to the price row (SET NULL on delete so history survives)';
COMMENT ON COLUMN pricing_history.old_price IS 'Previous price value';
COMMENT ON COLUMN pricing_history.new_price IS 'New price value (NULL on deletion)';
COMMENT ON COLUMN pricing_history.changed_by IS 'Captured via auth.uid()';

CREATE INDEX idx_pricing_history_price ON pricing_history(pricing_tier_price_id);
CREATE INDEX idx_pricing_history_tier ON pricing_history(pricing_tier_id);
CREATE INDEX idx_pricing_history_changed ON pricing_history(changed_at);

-- =============================================================================
-- 4. Audit Triggers
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
      pricing_tier_price_id, pricing_tier_id, package_format_id,
      sales_channel_id, old_price, new_price, changed_by
    ) VALUES (
      NEW.id, NEW.pricing_tier_id, NEW.package_format_id,
      NEW.sales_channel_id, OLD.price, NEW.price, auth.uid()
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO pricing_history (
      pricing_tier_price_id, pricing_tier_id, package_format_id,
      sales_channel_id, old_price, new_price, changed_by
    ) VALUES (
      OLD.id, OLD.pricing_tier_id, OLD.package_format_id,
      OLD.sales_channel_id, OLD.price, NULL, auth.uid()
    );
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pricing_tier_prices_update
  BEFORE UPDATE ON pricing_tier_prices
  FOR EACH ROW
  EXECUTE FUNCTION log_pricing_change();

CREATE TRIGGER trg_pricing_tier_prices_delete
  BEFORE DELETE ON pricing_tier_prices
  FOR EACH ROW
  EXECUTE FUNCTION log_pricing_change();

-- =============================================================================
-- 5. Add show_in_pricing to package_types
-- =============================================================================

ALTER TABLE package_types
  ADD COLUMN IF NOT EXISTS show_in_pricing BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN package_types.show_in_pricing IS 'Controls which formats appear as columns in the pricing matrix';

-- =============================================================================
-- 6. Add pricing_tier_id to recipes
-- =============================================================================

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS pricing_tier_id UUID REFERENCES pricing_tiers(id) ON DELETE SET NULL;

COMMENT ON COLUMN recipes.pricing_tier_id IS 'Assigned pricing tier. Auto-suggested from COGS thresholds or set manually.';

CREATE INDEX idx_recipes_pricing_tier ON recipes(pricing_tier_id) WHERE pricing_tier_id IS NOT NULL;

-- =============================================================================
-- 7. Data Migration
-- =============================================================================
-- Migrate from old price_tiers/tier_prices to new structure.
-- Old model: tiers belong to a channel, prices are per tier+format+brand/style
-- New model: tiers are independent, prices are per tier+format+channel
--
-- Strategy:
--   - Create one pricing_tier per old price_tier (include channel name for uniqueness)
--   - Migrate tier_prices as pricing_tier_prices (use old tier's channel)
--   - Only migrate generic format prices (no brand/style specificity in new model)

INSERT INTO pricing_tiers (id, name, sort_order, created_at, updated_at)
SELECT
  pt.id,
  CASE
    WHEN (SELECT COUNT(*) FROM price_tiers pt2 WHERE pt2.name = pt.name) > 1
    THEN pt.name || ' (' || sc.name || ')'
    ELSE pt.name
  END,
  ROW_NUMBER() OVER (ORDER BY sc.position, pt.name)::integer,
  pt.created_at,
  pt.updated_at
FROM price_tiers pt
JOIN sales_channels sc ON sc.id = pt.sales_channel_id
WHERE pt.is_active = true
ON CONFLICT (name) DO NOTHING;

-- Migrate generic format prices (where brand_id and style_id are both null)
INSERT INTO pricing_tier_prices (pricing_tier_id, package_format_id, sales_channel_id, price, created_at, updated_at)
SELECT
  tp.price_tier_id,
  tp.format_id,
  pt.sales_channel_id,
  tp.price,
  tp.created_at,
  tp.updated_at
FROM tier_prices tp
JOIN price_tiers pt ON pt.id = tp.price_tier_id
WHERE tp.brand_id IS NULL
  AND tp.style_id IS NULL
  AND (tp.effective_to IS NULL OR tp.effective_to >= CURRENT_DATE)
  AND pt.is_active = true
ON CONFLICT (pricing_tier_id, package_format_id, sales_channel_id) DO NOTHING;

-- =============================================================================
-- 8. Update customers table
-- =============================================================================
-- Re-point customers.price_tier_id to reference new pricing_tiers table.
-- The old FK references price_tiers; we need to drop it and add one to pricing_tiers.
-- Since we preserved IDs during migration, existing references remain valid.

ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_price_tier_id_fkey;

ALTER TABLE customers
  ADD CONSTRAINT customers_pricing_tier_id_fkey
  FOREIGN KEY (price_tier_id) REFERENCES pricing_tiers(id) ON DELETE SET NULL;

-- =============================================================================
-- 9. Drop old views, tables, and function
-- =============================================================================

-- Drop views that depend on old tables first
DROP VIEW IF EXISTS tier_prices_with_status;
DROP VIEW IF EXISTS customers_with_order_summary;

-- Drop old function and tables
DROP FUNCTION IF EXISTS get_price_for_customer(UUID, UUID, UUID, UUID, DATE);
DROP TABLE IF EXISTS tier_prices CASCADE;
DROP TABLE IF EXISTS price_tiers CASCADE;

-- =============================================================================
-- 9b. Recreate customers_with_order_summary view with new pricing_tiers
-- =============================================================================

CREATE VIEW customers_with_order_summary
WITH (security_invoker = true)
AS
SELECT
  c.*,
  sc.name AS sales_channel_name,
  pt.name AS price_tier_name,
  COALESCE(order_stats.total_orders, 0) AS total_orders,
  COALESCE(order_stats.total_revenue, 0) AS total_revenue,
  order_stats.last_order_date,
  COALESCE(order_stats.pending_orders, 0) AS pending_orders,
  COALESCE(order_stats.pending_revenue, 0) AS pending_revenue,
  COALESCE(kb.total_kegs_out, 0)::INTEGER AS total_kegs_out,
  COALESCE(kb.total_deposit_value, 0)::DECIMAL(10,2) AS total_deposit_value
FROM customers c
LEFT JOIN sales_channels sc ON c.sales_channel_id = sc.id
LEFT JOIN pricing_tiers pt ON c.price_tier_id = pt.id
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::INTEGER AS total_orders,
    SUM(CASE WHEN o.status IN ('fulfilled', 'out_the_door') THEN
      COALESCE((SELECT SUM(oi.quantity * oi.unit_price) FROM order_items oi WHERE oi.order_id = o.id), 0)
    ELSE 0 END) AS total_revenue,
    MAX(o.order_date) AS last_order_date,
    COUNT(*) FILTER (WHERE o.status NOT IN ('fulfilled', 'out_the_door', 'cancelled'))::INTEGER AS pending_orders,
    SUM(CASE WHEN o.status NOT IN ('fulfilled', 'out_the_door', 'cancelled') THEN
      COALESCE((SELECT SUM(oi.quantity * oi.unit_price) FROM order_items oi WHERE oi.order_id = o.id), 0)
    ELSE 0 END) AS pending_revenue
  FROM orders o
  WHERE o.customer_id = c.id
) order_stats ON true
LEFT JOIN customer_keg_balance_summary kb ON c.id = kb.customer_id;

COMMENT ON VIEW customers_with_order_summary IS 'Customers with order statistics, pricing info, and keg balances. Order revenue calculated from order_items for completed orders only.';

-- =============================================================================
-- 10. Row Level Security
-- =============================================================================

ALTER TABLE pricing_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_tier_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY pricing_tiers_access ON pricing_tiers
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY pricing_tier_prices_access ON pricing_tier_prices
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY pricing_history_access ON pricing_history
  FOR ALL USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- 11. Schema Registry
-- =============================================================================

-- Remove old entries
DELETE FROM _schema_registry WHERE table_name IN ('price_tiers', 'tier_prices', 'tier_prices_with_status');

-- HISTORICAL NO-OP: this INSERT referenced columns _schema_registry never had
-- (is_primary_entity, ui_hints), so it failed on every environment and the
-- rows do not exist in the live database. Commented out (rather than fixed)
-- so a from-scratch replay reproduces the live state. See PR #322.
-- INSERT INTO _schema_registry (table_name, description, domain, is_primary_entity, key_fields, relationships, ui_hints)
-- VALUES
--   ('pricing_tiers', ...), ('pricing_tier_prices', ...), ('pricing_history', ...)
-- ON CONFLICT (table_name) DO UPDATE SET ...;

-- Update package_types entry to note show_in_pricing column
UPDATE _schema_registry
SET key_fields = key_fields || '["show_in_pricing"]'::jsonb,
    updated_at = NOW()
WHERE table_name = 'package_types';
