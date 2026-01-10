-- =============================================================================
-- Brands Table
-- Manufactured products (beers, ciders, wines, etc.)
-- =============================================================================

CREATE TABLE brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  style_id UUID,  -- FK to beer_styles (added when catalog tables created)
  description TEXT,
  abv DECIMAL(3,1) CHECK (abv >= 0 AND abv <= 30),
  variant TEXT,  -- Machine name/slug (lowercase, dashes)
  hops JSONB DEFAULT '[]',  -- Display hops for marketing [{ "hop_id": "uuid", "name": "Citra" }]
  untappd_url TEXT,
  untappd_rating DECIMAL(3,2) CHECK (untappd_rating >= 0 AND untappd_rating <= 5),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE brands IS 'Manufactured products (beers, ciders, wines). A brand is a finished product that may be produced from one or more recipes.';
COMMENT ON COLUMN brands.hops IS 'Display hops for marketing purposes, not recipe ingredients. JSON array: [{ "hop_id": "uuid", "name": "string" }]';
COMMENT ON COLUMN brands.variant IS 'Machine name/slug for URLs and integrations. Lowercase with dashes.';
COMMENT ON COLUMN brands.untappd_rating IS 'Auto-fetched from Untappd. Do not manually update.';

CREATE INDEX idx_brands_style ON brands(style_id) WHERE style_id IS NOT NULL;

-- =============================================================================
-- Add brand_id to recipes
-- =============================================================================

ALTER TABLE recipes ADD COLUMN brand_id UUID REFERENCES brands(id) ON DELETE SET NULL;
CREATE INDEX idx_recipes_brand ON recipes(brand_id) WHERE brand_id IS NOT NULL;

-- =============================================================================
-- RLS Policy
-- =============================================================================

ALTER TABLE brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_access ON brands
  FOR ALL USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- Updated At Trigger
-- =============================================================================

CREATE TRIGGER update_brands_updated_at BEFORE UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- Schema Registry Entry
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, state_machine, query_examples)
VALUES (
  'brands',
  'Manufactured products (beers, ciders, wines) for sale.',
  'production',
  '["belongs_to: beer_styles", "has_many: recipes", "has_many: finished_goods", "has_many: order_items"]',
  '["name", "style_id", "abv", "variant"]',
  NULL,
  '["List all brands", "Find brands by style", "Get brand with Untappd rating above 4"]'
);
