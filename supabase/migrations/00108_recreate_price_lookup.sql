-- =============================================================================
-- Migration: Recreate get_price_for_customer for new pricing schema
-- =============================================================================
-- The old function (migrations 25/28) referenced price_tiers/tier_prices which
-- were replaced by pricing_tiers/pricing_tier_prices in migration 77.
-- This version uses the new schema and works for both package_type and keg_type
-- format IDs.

-- Drop any remaining old versions
DROP FUNCTION IF EXISTS get_price_for_customer(UUID, UUID, UUID, UUID);
DROP FUNCTION IF EXISTS get_price_for_customer(UUID, UUID, UUID, UUID, DATE);

CREATE FUNCTION get_price_for_customer(
  p_customer_id UUID,
  p_format_id UUID,
  p_brand_id UUID DEFAULT NULL,
  p_style_id UUID DEFAULT NULL,
  p_effective_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  price NUMERIC(10,2),
  tier_name TEXT,
  is_brand_specific BOOLEAN,
  is_style_specific BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_pricing_tier_id UUID;
  v_sales_channel_id UUID;
BEGIN
  -- Get customer's pricing tier and sales channel
  SELECT c.price_tier_id, c.sales_channel_id
  INTO v_pricing_tier_id, v_sales_channel_id
  FROM customers c
  WHERE c.id = p_customer_id;

  IF v_pricing_tier_id IS NULL OR v_sales_channel_id IS NULL THEN
    RETURN;  -- No pricing available without both tier and channel
  END IF;

  -- Look up price from pricing_tier_prices matrix
  -- In the new schema, pricing is tier × format × channel (no brand/style dimension)
  RETURN QUERY
  SELECT
    ptp.price,
    pt.name AS tier_name,
    false AS is_brand_specific,
    false AS is_style_specific
  FROM pricing_tier_prices ptp
  JOIN pricing_tiers pt ON pt.id = ptp.pricing_tier_id
  WHERE ptp.pricing_tier_id = v_pricing_tier_id
    AND ptp.format_id = p_format_id
    AND ptp.sales_channel_id = v_sales_channel_id
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION get_price_for_customer IS
  'Resolves the tier price for a customer/format combination using the new pricing_tiers/pricing_tier_prices schema. '
  'Works for both package_type and keg_type format IDs. '
  'p_brand_id, p_style_id, and p_effective_date are retained for API compatibility but unused in the new model.';
