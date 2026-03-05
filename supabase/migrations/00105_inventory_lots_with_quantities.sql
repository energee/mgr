-- Add schema registry entry for inventory_lots_with_quantities view
-- The view itself was created in 00010 and recreated with security_invoker in 00014.
-- This migration adds the missing _schema_registry documentation.

INSERT INTO _schema_registry (table_name, description, domain, key_fields)
VALUES (
  'inventory_lots_with_quantities',
  'Inventory lots view with calculated remaining and allocated quantities derived from the allocations table. Follows the same pattern as yeast_pitches_with_remaining.',
  'inventory',
  jsonb_build_array('id', 'inventory_item_id', 'quantity', 'remaining_quantity', 'allocated_quantity', 'expiration_date')
)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  key_fields = EXCLUDED.key_fields;
