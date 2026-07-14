-- =============================================================================
-- 00246 -- Backfill _schema_registry for four capture-migration tables
-- =============================================================================
-- containers, selling_formats, email_settings (00199) and square_locations (00222)
-- entered the chain through capture migrations, which reproduced the live
-- CREATE TABLE but skipped the _schema_registry row every hand-written migration
-- adds. That left holes in the self-documenting layer exactly on the core packaging
-- tables -- and _schema_registry is what an agent (and get_ai_schema_context) reads
-- to learn the schema, so a missing row makes the table invisible to them.
--
-- Registry rows only. No table, column, policy, or grant is touched.
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, state_machine, query_examples)
VALUES
  ('containers', 'Physical vessel a product ships in (can, bottle, keg). Volume is carried in volume_oz for packages and volume_bbl for kegs; deposit_amount is keg-only. Supersedes the retired package_types/keg_types tables.', 'catalog',
   '["has_many: selling_formats"]'::jsonb,
   '["name", "type", "volume_oz", "volume_bbl", "is_active"]'::jsonb,
   NULL,
   '["List active keg containers", "Show the volume of each package container"]'::jsonb),

  ('selling_formats', 'A sellable unit built from a container -- e.g. a 4-pack of 16oz cans (unit_count = 4). Carries pallet geometry (units_per_layer, default_layers, pallet_quantity) for shipping math. This is the real packaging model: build against it, not the retired package_types.', 'catalog',
   '["belongs_to: containers", "has_many: selling_format_materials", "referenced_by: order_items", "referenced_by: packaging_sessions"]'::jsonb,
   '["container_id", "name", "unit_count", "is_active"]'::jsonb,
   NULL,
   '["List selling formats for a container", "Show pallet quantity per selling format"]'::jsonb),

  ('email_settings', 'Single-row configuration for outbound notification email: master on/off switch plus the Supabase project URL and app URL used to build links. Read by dispatch_email_notification (SECURITY DEFINER); writes are gated on settings:manage.', 'auth',
   '[]'::jsonb,
   '["is_enabled", "supabase_project_url", "app_url"]'::jsonb,
   NULL,
   '["Is notification email enabled?", "Show the configured app URL"]'::jsonb),

  ('square_locations', 'Square POS locations pulled from the Square API. A bin links to one 1:1 via bins.square_location_id. Staff-readable; refreshed from Square, not hand-edited.', 'sales',
   '["referenced_by: bins (square_location_id)"]'::jsonb,
   '["square_location_id", "name", "status", "synced_at"]'::jsonb,
   NULL,
   '["List active Square locations", "Which bin maps to Square location X?"]'::jsonb)

ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  state_machine = EXCLUDED.state_machine,
  query_examples = EXCLUDED.query_examples;

NOTIFY pgrst, 'reload schema';
