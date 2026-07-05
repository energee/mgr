-- =============================================================================
-- Migration: Sales Channels and Pricing
-- =============================================================================
-- Implements Phase 4.6: Sales channels, price tiers, and tier prices for
-- customer-specific pricing based on sales channel.
--
-- Schema:
--   sales_channels - Channel types (distributor, retailer, taproom, export)
--   price_tiers    - Pricing tiers linked to sales channels
--   tier_prices    - Specific prices per format/brand/style within a tier
--   customers.sales_channel_id - Link customer to channel for pricing
-- =============================================================================

-- =============================================================================
-- 1. Sales Channels Table
-- =============================================================================

CREATE TABLE sales_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,  -- Short code: dist, retail, taproom, export
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  position INTEGER DEFAULT 0,  -- For ordering
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE sales_channels IS 'Sales channel categories for pricing tiers. Each customer belongs to one channel.';
COMMENT ON COLUMN sales_channels.code IS 'Short code for the channel (dist, retail, taproom, export, etc.)';

-- Seed default sales channels
INSERT INTO sales_channels (name, code, description, position) VALUES
  ('Distributor', 'dist', 'Wholesale distributors', 1),
  ('Retailer', 'retail', 'Direct retail accounts (bars, restaurants, stores)', 2),
  ('Taproom', 'taproom', 'On-premise taproom sales', 3),
  ('Export', 'export', 'International export sales', 4);

-- =============================================================================
-- 2. Price Tiers Table
-- =============================================================================

CREATE TABLE price_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sales_channel_id UUID NOT NULL REFERENCES sales_channels(id) ON DELETE RESTRICT,
  description TEXT,
  is_default BOOLEAN DEFAULT false,  -- Default tier for the channel
  discount_percent DECIMAL(5,2) DEFAULT 0,  -- Optional global discount
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, sales_channel_id)
);

COMMENT ON TABLE price_tiers IS 'Pricing tiers within each sales channel. Allows different pricing levels per channel.';
COMMENT ON COLUMN price_tiers.is_default IS 'If true, this is the default tier for new customers in this channel.';
COMMENT ON COLUMN price_tiers.discount_percent IS 'Optional global discount applied to all prices in this tier.';

CREATE INDEX idx_price_tiers_channel ON price_tiers(sales_channel_id);
CREATE INDEX idx_price_tiers_default ON price_tiers(sales_channel_id, is_default) WHERE is_default = true;

-- =============================================================================
-- 3. Tier Prices Table
-- =============================================================================

CREATE TABLE tier_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_tier_id UUID NOT NULL REFERENCES price_tiers(id) ON DELETE CASCADE,
  format_id UUID NOT NULL REFERENCES package_types(id) ON DELETE CASCADE,
  brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,  -- Optional: brand-specific price
  style_id UUID REFERENCES beer_styles(id) ON DELETE CASCADE,  -- Optional: style-specific price
  price DECIMAL(10,2) NOT NULL,  -- Price per unit (case, keg, etc.)
  effective_from DATE DEFAULT CURRENT_DATE,  -- For temporal pricing
  effective_to DATE,  -- NULL means currently active
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure unique price per tier/format/brand/style combination.
-- (Expression uniqueness must be an index — a UNIQUE table constraint cannot
-- contain COALESCE(); the original inline form was invalid SQL and this table
-- never materialized as written. Dropped entirely by 00077.)
CREATE UNIQUE INDEX uniq_tier_prices_combination ON tier_prices (
  price_tier_id,
  format_id,
  COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(style_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

COMMENT ON TABLE tier_prices IS 'Specific prices for format/brand/style combinations within a price tier.';
COMMENT ON COLUMN tier_prices.brand_id IS 'If set, this price applies only to this brand. Takes precedence over style_id.';
COMMENT ON COLUMN tier_prices.style_id IS 'If set, this price applies to all brands of this style (unless brand_id overrides).';
COMMENT ON COLUMN tier_prices.effective_from IS 'Date from which this price is effective.';
COMMENT ON COLUMN tier_prices.effective_to IS 'Date until which this price is effective. NULL means currently active.';

CREATE INDEX idx_tier_prices_tier ON tier_prices(price_tier_id);
CREATE INDEX idx_tier_prices_format ON tier_prices(format_id);
CREATE INDEX idx_tier_prices_brand ON tier_prices(brand_id) WHERE brand_id IS NOT NULL;
CREATE INDEX idx_tier_prices_style ON tier_prices(style_id) WHERE style_id IS NOT NULL;
CREATE INDEX idx_tier_prices_effective ON tier_prices(effective_from, effective_to);

-- =============================================================================
-- 4. Update Customers Table
-- =============================================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS sales_channel_id UUID REFERENCES sales_channels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS price_tier_id UUID REFERENCES price_tiers(id) ON DELETE SET NULL;

COMMENT ON COLUMN customers.sales_channel_id IS 'Sales channel this customer belongs to (determines default pricing).';
COMMENT ON COLUMN customers.price_tier_id IS 'Specific price tier override for this customer (optional).';

CREATE INDEX idx_customers_sales_channel ON customers(sales_channel_id) WHERE sales_channel_id IS NOT NULL;
CREATE INDEX idx_customers_price_tier ON customers(price_tier_id) WHERE price_tier_id IS NOT NULL;

-- =============================================================================
-- 5. Price Resolution Function
-- =============================================================================

CREATE OR REPLACE FUNCTION get_price_for_customer(
  p_customer_id UUID,
  p_format_id UUID,
  p_brand_id UUID DEFAULT NULL,
  p_style_id UUID DEFAULT NULL
)
RETURNS TABLE (
  price DECIMAL(10,2),
  tier_name TEXT,
  is_brand_specific BOOLEAN,
  is_style_specific BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_price_tier_id UUID;
  v_sales_channel_id UUID;
BEGIN
  -- Get customer's price tier (direct or via sales channel default)
  SELECT
    COALESCE(c.price_tier_id, pt_default.id),
    c.sales_channel_id
  INTO v_price_tier_id, v_sales_channel_id
  FROM customers c
  LEFT JOIN price_tiers pt_default ON pt_default.sales_channel_id = c.sales_channel_id AND pt_default.is_default = true
  WHERE c.id = p_customer_id;

  IF v_price_tier_id IS NULL THEN
    RETURN;  -- No pricing available
  END IF;

  -- Try to find price in order of specificity:
  -- 1. Brand-specific price
  -- 2. Style-specific price
  -- 3. Generic format price
  RETURN QUERY
  SELECT
    tp.price,
    ptier.name,
    tp.brand_id IS NOT NULL,
    tp.style_id IS NOT NULL
  FROM tier_prices tp
  JOIN price_tiers ptier ON ptier.id = tp.price_tier_id
  WHERE tp.price_tier_id = v_price_tier_id
    AND tp.format_id = p_format_id
    AND (tp.effective_to IS NULL OR tp.effective_to >= CURRENT_DATE)
    AND tp.effective_from <= CURRENT_DATE
    AND (
      -- Brand-specific match
      (tp.brand_id = p_brand_id AND tp.style_id IS NULL)
      -- Style-specific match (when no brand specified or brand doesn't have specific price)
      OR (tp.style_id = p_style_id AND tp.brand_id IS NULL)
      -- Generic format price
      OR (tp.brand_id IS NULL AND tp.style_id IS NULL)
    )
  ORDER BY
    -- Prefer brand-specific, then style-specific, then generic
    CASE WHEN tp.brand_id = p_brand_id THEN 1
         WHEN tp.style_id = p_style_id THEN 2
         ELSE 3 END,
    tp.effective_from DESC
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION get_price_for_customer IS 'Resolves price for a customer/format/brand/style combination based on their tier.';

-- =============================================================================
-- 6. Row Level Security
-- =============================================================================

ALTER TABLE sales_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tier_prices ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users (single-tenant)
CREATE POLICY sales_channels_access ON sales_channels FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY price_tiers_access ON price_tiers FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY tier_prices_access ON tier_prices FOR ALL USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- 7. Schema Registry
-- =============================================================================

-- HISTORICAL NO-OP: this INSERT referenced columns _schema_registry never had
-- (is_primary_entity, ui_hints), so it failed on every environment and the
-- rows do not exist in the live database. Commented out (rather than fixed)
-- so a from-scratch replay reproduces the live state. See PR #322.
-- INSERT INTO _schema_registry (table_name, description, domain, is_primary_entity, key_fields, relationships, ui_hints)
-- VALUES
--   ('sales_channels', ...), ('price_tiers', ...), ('tier_prices', ...)
-- ON CONFLICT (table_name) DO UPDATE SET ...;
