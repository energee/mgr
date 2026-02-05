-- Drop sort_order and cogs_min from pricing_tiers.
-- Tiers are sorted by cogs_max; lower bound is implicitly the previous tier's upper bound.

DROP INDEX IF EXISTS idx_pricing_tiers_sort;

ALTER TABLE pricing_tiers DROP COLUMN IF EXISTS sort_order;
ALTER TABLE pricing_tiers DROP COLUMN IF EXISTS cogs_min;

-- Update schema registry
UPDATE _schema_registry
SET key_fields = '["name", "cogs_max"]'::jsonb,
    updated_at = NOW()
WHERE table_name = 'pricing_tiers';
