-- 00214_capture_get_price_for_customer.sql
-- Audit #14 (pricing) / migration-reconciliation drift item #4.
--
-- get_price_for_customer was DROPped by 00077 and never re-created in any
-- migration, but live has an out-of-band recreation that the app depends on
-- (order-items-editor.tsx auto-suggest, reorder.ts). A from-scratch replay
-- therefore loses the function while live keeps it — classic silent drift.
-- 00205 flagged it "present live; owned by backlog #14b" and deferred here.
--
-- This migration brings the live definition INTO the chain verbatim so replay
-- reproduces it. The body is byte-identical to the current live prosrc, so
-- `db push` re-asserting it is a semantic no-op (same function, same result).
--
-- Behavior it captures (the intentional "customer-tier" half of the dual
-- pricing model — see docs/knowledge/entity-model.md): resolve the customer's
-- price_tier_id + sales_channel_id, then read the tier x format x channel cell
-- from pricing_tier_prices. Brand/style/effective-date params are accepted for
-- signature compatibility but ignored (the 00077 redesign dropped the temporal
-- and brand/style dimensions). Returns no row when either tier or channel is
-- unset — which is exactly why M9's "default tier per channel" copy is wrong
-- (there is no default; auto-pricing simply no-ops). M9 copy/gating is a
-- separate customer-entity change.

CREATE OR REPLACE FUNCTION public.get_price_for_customer(p_customer_id uuid, p_format_id uuid, p_brand_id uuid DEFAULT NULL::uuid, p_style_id uuid DEFAULT NULL::uuid, p_effective_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(price numeric, tier_name text, is_brand_specific boolean, is_style_specific boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  -- In the new schema, pricing is tier x format x channel (no brand/style dimension)
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
$function$;
