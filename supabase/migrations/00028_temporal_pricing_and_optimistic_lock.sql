-- Temporal Pricing Function Update and Optimistic Locking Enhancements
-- Phase 5.2: Update pricing queries to respect date ranges (DEC-MP-003)
-- Phase 5.4: Optimistic Locking (bin_inventory)

-- =============================================================================
-- 1. OPTIMISTIC LOCKING FOR BIN_INVENTORY
-- =============================================================================

ALTER TABLE bin_inventory
  ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;

COMMENT ON COLUMN bin_inventory.version IS 'Optimistic locking version for concurrent modification detection';

-- Trigger to auto-increment version on update
CREATE OR REPLACE FUNCTION increment_bin_inventory_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.version := COALESCE(OLD.version, 0) + 1;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_bin_inventory_update_version ON bin_inventory;
CREATE TRIGGER on_bin_inventory_update_version
  BEFORE UPDATE ON bin_inventory
  FOR EACH ROW
  EXECUTE FUNCTION increment_bin_inventory_version();

-- =============================================================================
-- 2. INDEX FOR EFFICIENT TEMPORAL PRICING QUERIES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_tier_prices_effective_dates
  ON tier_prices(price_tier_id, format_id, effective_from, effective_to);

-- =============================================================================
-- 3. UPDATE PRICE RESOLUTION FUNCTION FOR TEMPORAL PRICING
-- =============================================================================

-- Drop existing function to recreate with new signature
DROP FUNCTION IF EXISTS get_price_for_customer(UUID, UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION get_price_for_customer(
  p_customer_id UUID,
  p_format_id UUID,
  p_brand_id UUID DEFAULT NULL,
  p_style_id UUID DEFAULT NULL,
  p_effective_date DATE DEFAULT CURRENT_DATE
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
  -- Get customer's price tier (direct or via default for sales channel)
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
  -- 1. Brand-specific price (if brand provided)
  -- 2. Style-specific price (if style provided)
  -- 3. Format-only price (fallback)
  -- All respecting temporal validity (effective_from/effective_to)

  RETURN QUERY
  SELECT
    tp.price,
    pt.name AS tier_name,
    tp.brand_id IS NOT NULL AS is_brand_specific,
    tp.style_id IS NOT NULL AS is_style_specific
  FROM tier_prices tp
  JOIN price_tiers pt ON tp.price_tier_id = pt.id
  WHERE tp.price_tier_id = v_price_tier_id
    AND tp.format_id = p_format_id
    AND tp.effective_from <= p_effective_date
    AND (tp.effective_to IS NULL OR tp.effective_to >= p_effective_date)
    AND (
      -- Brand match (most specific)
      (p_brand_id IS NOT NULL AND tp.brand_id = p_brand_id)
      OR
      -- Style match (second most specific)
      (p_style_id IS NOT NULL AND tp.style_id = p_style_id AND tp.brand_id IS NULL)
      OR
      -- Format-only (least specific fallback)
      (tp.brand_id IS NULL AND tp.style_id IS NULL)
    )
  ORDER BY
    -- Prefer brand-specific over style-specific over generic
    CASE WHEN tp.brand_id = p_brand_id THEN 1
         WHEN tp.style_id = p_style_id THEN 2
         ELSE 3 END,
    -- For same specificity, prefer most recently effective
    tp.effective_from DESC
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION get_price_for_customer IS 'Resolves price for customer/format with temporal validity support. Pass p_effective_date for historical price lookup.';

-- =============================================================================
-- 4. PRICE HISTORY VIEW
-- =============================================================================

CREATE OR REPLACE VIEW tier_prices_with_status
WITH (security_invoker = true)
AS
SELECT
  tp.*,
  pt.name AS tier_name,
  sc.name AS channel_name,
  pf.name AS format_name,
  b.name AS brand_name,
  bs.name AS style_name,
  CASE
    WHEN tp.effective_to IS NOT NULL AND tp.effective_to < CURRENT_DATE THEN 'expired'
    WHEN tp.effective_from > CURRENT_DATE THEN 'future'
    ELSE 'active'
  END AS validity_status
FROM tier_prices tp
JOIN price_tiers pt ON tp.price_tier_id = pt.id
JOIN sales_channels sc ON pt.sales_channel_id = sc.id
JOIN package_types pf ON tp.format_id = pf.id
LEFT JOIN brands b ON tp.brand_id = b.id
LEFT JOIN beer_styles bs ON tp.style_id = bs.id;

COMMENT ON VIEW tier_prices_with_status IS 'Tier prices with temporal status (active/expired/future) and joined display names';

-- =============================================================================
-- 5. SCHEMA REGISTRY UPDATES
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples)
VALUES
  ('tier_prices_with_status', 'View of tier prices with temporal validity status and joined names', 'sales',
   '{"price_tiers": "price_tier_id", "package_types": "format_id", "brands": "brand_id", "beer_styles": "style_id"}'::jsonb,
   '["id", "tier_name", "format_name", "price", "validity_status", "effective_from", "effective_to"]'::jsonb,
   '["SELECT * FROM tier_prices_with_status WHERE validity_status = ''active''", "Get all active prices"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;
