-- =============================================================================
-- Add NOT NULL constraint to packages.selling_format_id
-- =============================================================================
-- Migration 00102 added selling_format_id to packages and backfilled it from
-- package_type_id, but forgot to add the NOT NULL constraint. Every package
-- must have a selling format, so this adds the missing constraint.

ALTER TABLE packages ALTER COLUMN selling_format_id SET NOT NULL;
