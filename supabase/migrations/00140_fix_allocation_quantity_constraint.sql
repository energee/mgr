-- Fix: allocation quantity constraint conflict
-- Migration 00102 added allocations_quantity_positive CHECK (quantity > 0)
-- which conflicts with the original chk_allocation_quantity_positive CHECK (quantity >= 0).
-- The original >= 0 is correct: zero-quantity adjustments are valid for
-- approved-but-not-yet-executed inventory write-downs.

ALTER TABLE allocations DROP CONSTRAINT IF EXISTS allocations_quantity_positive;
