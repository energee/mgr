-- Migration: 00151_fix_inventory_category_hops_to_hop.sql
-- Purpose: Fix inventory_items category value 'hops' -> 'hop' to match
-- the catalog_type enum_values. Seed data used 'hops' (plural) but the
-- enum registry uses 'hop' (singular). The validation trigger (00040)
-- was added after seeding, so existing rows bypassed validation.

BEGIN;

-- Temporarily disable the validation trigger to allow the update
ALTER TABLE inventory_items DISABLE TRIGGER validate_catalog_type;

UPDATE inventory_items
SET category = 'hop'
WHERE category = 'hops';

ALTER TABLE inventory_items ENABLE TRIGGER validate_catalog_type;

COMMIT;
