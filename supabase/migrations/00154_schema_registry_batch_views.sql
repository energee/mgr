-- =============================================================================
-- Migration: 00154_schema_registry_batch_views
--
-- Registers batches_with_brew_info and batches_with_blend_info views
-- in _schema_registry for AI context and self-documenting schema.
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples)
VALUES
  ('batches_with_brew_info',
   'Batches with derived fields from linked brew_logs and current vessel. Includes brew_date, actual_og, volume_from_brews_bbl, brew_count, and current vessel info (id, name, type). Use this view when you need brew date, OG, and vessel info without manual joins.',
   'production',
   '["extends: batches", "joins: brew_logs via brew_log_batches", "joins: vessels via current_batch_id"]'::jsonb,
   '["id", "batch_number", "status", "brew_date", "actual_og", "current_vessel_name", "current_vessel_type"]'::jsonb,
   '["Show all batches with their current vessel", "Which batches are fermenting and in which vessels?", "Show batch OG and brew date"]'::jsonb),
  ('batches_with_blend_info',
   'Per-batch blend data: volume blended away, available volume, and weighted estimates (OG, FG, ABV, IBU, SRM) from source batches blended in.',
   'production',
   '["extends: batches", "joins: batch_blends", "joins: recipes_with_estimates"]'::jsonb,
   '["id", "volume_blended_away_bbl", "available_volume_bbl", "blend_source_count", "blended_og", "blended_abv"]'::jsonb,
   '["How much volume has been blended away from batch X?", "Show blend sources and weighted OG for a blend batch"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;
