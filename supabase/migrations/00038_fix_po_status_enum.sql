-- Migration: 00038_fix_po_status_enum.sql
-- Purpose: Fix po_status enum values to match purchase-order.tsx state machine
--
-- The initial enum registry (00037) had incorrect states:
--   - "shipped" and "received" don't exist in the codebase
--   - Missing "fulfilled" and "closed" states
--   - Incorrect next_states transitions

-- Delete the incorrect po_status values
DELETE FROM enum_values WHERE enum_type = 'po_status';

-- Insert the correct values matching purchase-order.tsx
INSERT INTO enum_values (enum_type, value, label, description, color, sort_order, is_default, metadata) VALUES
  ('po_status', 'draft', 'Draft', 'PO being prepared', 'default', 10, TRUE, '{"next_states": ["submitted", "cancelled"]}'::jsonb),
  ('po_status', 'submitted', 'Submitted', 'Sent to supplier', 'info', 20, FALSE, '{"next_states": ["confirmed", "cancelled"]}'::jsonb),
  ('po_status', 'confirmed', 'Confirmed', 'Supplier confirmed', 'info', 30, FALSE, '{"next_states": ["partial", "fulfilled", "cancelled"]}'::jsonb),
  ('po_status', 'partial', 'Partial', 'Partially received', 'warning', 40, FALSE, '{"next_states": ["fulfilled", "cancelled"]}'::jsonb),
  ('po_status', 'fulfilled', 'Fulfilled', 'Fully received', 'success', 50, FALSE, '{"next_states": ["closed"]}'::jsonb),
  ('po_status', 'cancelled', 'Cancelled', 'PO was cancelled', 'error', 60, FALSE, '{"next_states": []}'::jsonb),
  ('po_status', 'closed', 'Closed', 'PO completed and closed', 'default', 70, FALSE, '{"next_states": []}'::jsonb);
