-- Migration: Sales order number generator
--
-- Adds generate_next_order_number(), the sales-side sibling of
-- generate_next_po_number() (00142). The manual order create form
-- (/sales/orders/new) prefills order_number with this suggestion so users no
-- longer invent numbers by hand. The suggestion stays editable, and
-- orders_order_number_key (UNIQUE, from 00002) backstops the rare case where
-- two concurrently opened forms receive the same suggestion.
--
-- Format: ORD-YYYY-NNN, matching the manual-entry convention shown by the
-- form placeholder. The 'ORD-YYYY-' LIKE prefix does NOT match
-- MongoDB-imported numbers (ORD-YYYYMMDD-NNNNNN, see
-- src/integrations/mongodb/transformers.ts), so the imported series never
-- contaminates this sequence.
--
-- NOTE: the Functions entry for this RPC was hand-added to
-- src/types/supabase.ts pending type regeneration.

-- =============================================================================
-- 1. DOMAIN-SPECIFIC WRAPPER: SALES ORDER NUMBER
-- =============================================================================

-- Delegates to the advisory-locked generate_next_number() (00142), which
-- serializes concurrent callers per table+column+prefix series.
CREATE OR REPLACE FUNCTION generate_next_order_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN generate_next_number(
    'orders',
    'order_number',
    'ORD-' || to_char(CURRENT_DATE, 'YYYY') || '-'
  );
END;
$$;

COMMENT ON FUNCTION generate_next_order_number IS
  'Generates the next sales order number in ORD-YYYY-NNN format, safe under concurrency.';

-- =============================================================================
-- 2. SCHEMA REGISTRY
-- =============================================================================

-- Keep the generator family's registry examples current (entry created in 00142).
UPDATE _schema_registry
SET ai_context = '["SELECT generate_next_batch_number()", "SELECT generate_next_po_number()", "SELECT generate_next_order_number()", "SELECT generate_lot_number(CURRENT_DATE)"]'::jsonb
WHERE table_name = 'generate_next_number';
