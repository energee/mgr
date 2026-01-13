-- Migration: 00021_pricing_tiers.sql
-- Purpose: Add sales channels, price tiers, and tier pricing for order pricing resolution
-- See: docs/data-model/sales.md for full specification

-- =============================================================================
-- Sales Channels
-- =============================================================================

CREATE TABLE sales_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE sales_channels IS 'Sales channel definitions (distributor, retailer, taproom, etc.)';

-- Default channels
INSERT INTO sales_channels (name, slug, description) VALUES
  ('Distributor', 'distributor', 'Wholesale distribution partners'),
  ('Retailer', 'retailer', 'Retail accounts (bars, restaurants)'),
  ('Taproom', 'taproom', 'On-site taproom sales'),
  ('Direct', 'direct', 'Direct to consumer sales'),
  ('Export', 'export', 'Export/international sales');

-- =============================================================================
-- Price Tiers
-- =============================================================================

CREATE TABLE price_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE price_tiers IS 'Price tier definitions (Wholesale, Retail, Premium, etc.)';

-- Default tiers
INSERT INTO price_tiers (name, description, sort_order) VALUES
  ('Wholesale', 'Wholesale pricing for distributors', 1),
  ('Retail', 'Standard retail pricing', 2),
  ('Premium', 'Premium/taproom pricing', 3);

-- =============================================================================
-- Price Tier Channel Mapping (Many-to-Many)
-- =============================================================================

CREATE TABLE price_tier_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id UUID NOT NULL REFERENCES price_tiers(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tier_id, channel_id)
);

COMMENT ON TABLE price_tier_channels IS 'Map price tiers to sales channels';

-- Default mappings
INSERT INTO price_tier_channels (tier_id, channel_id)
SELECT pt.id, sc.id
FROM price_tiers pt, sales_channels sc
WHERE (pt.name = 'Wholesale' AND sc.slug = 'distributor')
   OR (pt.name = 'Retail' AND sc.slug IN ('retailer', 'direct'))
   OR (pt.name = 'Premium' AND sc.slug = 'taproom');

-- =============================================================================
-- Tier Prices
-- =============================================================================

CREATE TABLE tier_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id UUID NOT NULL REFERENCES price_tiers(id) ON DELETE CASCADE,
  style_id UUID REFERENCES beer_styles(id) ON DELETE SET NULL,
  brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
  package_type_id UUID NOT NULL REFERENCES package_types(id) ON DELETE CASCADE,
  price DECIMAL(10,2) NOT NULL,
  valid_from DATE DEFAULT CURRENT_DATE,
  valid_to DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Either brand_id or style_id must be set (brand takes precedence)
  CONSTRAINT chk_tier_price_target CHECK (brand_id IS NOT NULL OR style_id IS NOT NULL)
);

COMMENT ON TABLE tier_prices IS 'Prices by tier, product, and package type with temporal validity';

-- =============================================================================
-- Add sales_channel_id to customers
-- =============================================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS sales_channel_id UUID REFERENCES sales_channels(id);

COMMENT ON COLUMN customers.sales_channel_id IS 'Customer sales channel for price tier resolution';

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE INDEX idx_sales_channels_active ON sales_channels(is_active, slug);
CREATE INDEX idx_price_tiers_active ON price_tiers(is_active, sort_order);
CREATE INDEX idx_price_tier_channels_tier ON price_tier_channels(tier_id);
CREATE INDEX idx_price_tier_channels_channel ON price_tier_channels(channel_id);
CREATE INDEX idx_tier_prices_tier ON tier_prices(tier_id, valid_from, valid_to);
CREATE INDEX idx_tier_prices_brand_package ON tier_prices(brand_id, package_type_id, valid_from, valid_to);
CREATE INDEX idx_tier_prices_style_package ON tier_prices(style_id, package_type_id, valid_from, valid_to) WHERE style_id IS NOT NULL;
CREATE INDEX idx_customers_channel ON customers(sales_channel_id);

-- =============================================================================
-- RLS Policies
-- =============================================================================

ALTER TABLE sales_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_tier_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE tier_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_channels_access ON sales_channels FOR ALL USING (true);
CREATE POLICY price_tiers_access ON price_tiers FOR ALL USING (true);
CREATE POLICY price_tier_channels_access ON price_tier_channels FOR ALL USING (true);
CREATE POLICY tier_prices_access ON tier_prices FOR ALL USING (true);

-- =============================================================================
-- Schema Registry
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples) VALUES
('sales_channels', 'Sales channel definitions', 'sales',
 '["has_many: price_tier_channels", "has_many: customers"]',
 '["name", "slug"]',
 '["List active sales channels", "Get channel by slug"]'),

('price_tiers', 'Price tier definitions', 'sales',
 '["has_many: price_tier_channels", "has_many: tier_prices"]',
 '["name"]',
 '["List active price tiers", "Get tier by name"]'),

('tier_prices', 'Prices by tier, product, and package type', 'sales',
 '["belongs_to: price_tiers", "belongs_to: brands", "belongs_to: beer_styles", "belongs_to: package_types"]',
 '["tier_id", "brand_id", "style_id", "package_type_id", "price"]',
 '["Get price for brand and package in tier", "Find style fallback price"]')

ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;

-- =============================================================================
-- Price Resolution Function
-- =============================================================================

CREATE OR REPLACE FUNCTION resolve_order_item_price(
  p_customer_id UUID,
  p_brand_id UUID,
  p_package_type_id UUID,
  p_order_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  price DECIMAL(10,2),
  source TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_channel_id UUID;
  v_tier_id UUID;
  v_brand_price DECIMAL(10,2);
  v_style_id UUID;
  v_style_price DECIMAL(10,2);
BEGIN
  -- Step 1: Get customer's channel
  SELECT sales_channel_id INTO v_channel_id
  FROM customers
  WHERE id = p_customer_id;

  IF v_channel_id IS NULL THEN
    RETURN QUERY SELECT 0::DECIMAL(10,2), 'manual'::TEXT;
    RETURN;
  END IF;

  -- Step 2: Get tier for channel
  SELECT ptc.tier_id INTO v_tier_id
  FROM price_tier_channels ptc
  WHERE ptc.channel_id = v_channel_id
  LIMIT 1;

  IF v_tier_id IS NULL THEN
    RETURN QUERY SELECT 0::DECIMAL(10,2), 'manual'::TEXT;
    RETURN;
  END IF;

  -- Step 3: Try brand-specific price
  SELECT tp.price INTO v_brand_price
  FROM tier_prices tp
  WHERE tp.tier_id = v_tier_id
    AND tp.brand_id = p_brand_id
    AND tp.package_type_id = p_package_type_id
    AND tp.valid_from <= p_order_date
    AND (tp.valid_to IS NULL OR tp.valid_to >= p_order_date)
  ORDER BY tp.valid_from DESC
  LIMIT 1;

  IF v_brand_price IS NOT NULL THEN
    RETURN QUERY SELECT v_brand_price, 'tier'::TEXT;
    RETURN;
  END IF;

  -- Step 4: Get brand's style for fallback
  SELECT style_id INTO v_style_id
  FROM brands
  WHERE id = p_brand_id;

  IF v_style_id IS NOT NULL THEN
    -- Try style-level fallback
    SELECT tp.price INTO v_style_price
    FROM tier_prices tp
    WHERE tp.tier_id = v_tier_id
      AND tp.style_id = v_style_id
      AND tp.brand_id IS NULL
      AND tp.package_type_id = p_package_type_id
      AND tp.valid_from <= p_order_date
      AND (tp.valid_to IS NULL OR tp.valid_to >= p_order_date)
    ORDER BY tp.valid_from DESC
    LIMIT 1;

    IF v_style_price IS NOT NULL THEN
      RETURN QUERY SELECT v_style_price, 'style_tier'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Step 5: No match - manual entry required
  RETURN QUERY SELECT 0::DECIMAL(10,2), 'manual'::TEXT;
END;
$$;

COMMENT ON FUNCTION resolve_order_item_price IS 'Resolve price for an order item based on customer channel and price tier';
