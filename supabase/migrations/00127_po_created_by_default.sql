-- Set default for purchase_orders.created_by to auth.uid()
-- Previously, demand-generated POs had NULL created_by because the column had no default.
-- This aligns purchase_orders with newer tables (batch_blends, pick_lists, pitch_events).
ALTER TABLE purchase_orders ALTER COLUMN created_by SET DEFAULT auth.uid();
