-- Migration: 00039_fix_batch_order_status_enums.sql
-- Purpose: Fix batch_status and order_status enums to match entity configurations
--
-- The initial enum registry (00037) had incorrect states:
--   - batch_status: had "brewing" and "ready" which don't exist in batch.tsx
--     (hot-side brew day operations are tracked in brew_logs, not batch status)
--   - order_status: had "ready", "delivered", "invoiced", "paid" instead of
--     "scheduled", "packed", "fulfilled" flow from order.tsx

-- =============================================================================
-- Fix batch_status (matches batch.tsx)
-- =============================================================================
-- Note: Hot-side brew day operations are tracked in brew_logs, not batch status

DELETE FROM enum_values WHERE enum_type = 'batch_status';

INSERT INTO enum_values (enum_type, value, label, description, color, sort_order, is_default, metadata) VALUES
  ('batch_status', 'planned', 'Planned', 'Batch is scheduled but not started', 'default', 10, TRUE, '{"next_states": ["fermenting", "cancelled"]}'::jsonb),
  ('batch_status', 'fermenting', 'Fermenting', 'In primary or secondary fermentation', 'info', 20, FALSE, '{"next_states": ["conditioning", "cancelled"]}'::jsonb),
  ('batch_status', 'conditioning', 'Conditioning', 'Conditioning/lagering phase', 'info', 30, FALSE, '{"next_states": ["packaging", "cancelled"]}'::jsonb),
  ('batch_status', 'packaging', 'Packaging', 'Being packaged', 'warning', 40, FALSE, '{"next_states": ["completed", "cancelled"]}'::jsonb),
  ('batch_status', 'completed', 'Completed', 'Batch is complete', 'success', 50, FALSE, '{"next_states": []}'::jsonb),
  ('batch_status', 'cancelled', 'Cancelled', 'Batch was cancelled', 'error', 60, FALSE, '{"next_states": []}'::jsonb);

-- =============================================================================
-- Fix order_status (matches order.tsx)
-- =============================================================================

DELETE FROM enum_values WHERE enum_type = 'order_status';

INSERT INTO enum_values (enum_type, value, label, description, color, sort_order, is_default, metadata) VALUES
  ('order_status', 'draft', 'Draft', 'Order being prepared', 'default', 10, TRUE, '{"next_states": ["confirmed", "cancelled"]}'::jsonb),
  ('order_status', 'confirmed', 'Confirmed', 'Order confirmed with customer', 'info', 20, FALSE, '{"next_states": ["scheduled", "cancelled"]}'::jsonb),
  ('order_status', 'scheduled', 'Scheduled', 'Delivery date scheduled', 'info', 30, FALSE, '{"next_states": ["picking", "cancelled"]}'::jsonb),
  ('order_status', 'picking', 'Picking', 'Order being picked/prepared', 'warning', 40, FALSE, '{"next_states": ["packed", "cancelled"]}'::jsonb),
  ('order_status', 'packed', 'Packed', 'Order packed and ready', 'warning', 50, FALSE, '{"next_states": ["fulfilled", "cancelled"]}'::jsonb),
  ('order_status', 'fulfilled', 'Fulfilled', 'Order delivered to customer', 'success', 60, FALSE, '{"next_states": []}'::jsonb),
  ('order_status', 'cancelled', 'Cancelled', 'Order was cancelled', 'error', 70, FALSE, '{"next_states": []}'::jsonb);
