-- Migration Repair Script
--
-- Run this ONCE on any existing Supabase deployment (local or production)
-- BEFORE applying new migrations after the migration renumbering in PR #213.
--
-- The renumbering resolved 7 duplicate migration numbers (e.g., three files
-- all numbered 00092_*) by assigning each a unique sequential number.
-- Supabase tracks applied migrations by version string in
-- supabase_migrations.schema_migrations, so the old names must be updated
-- to match the new filenames.
--
-- Usage:
--   psql $DATABASE_URL -f supabase/repair-migration-renumbering.sql
--   -- or via Supabase Dashboard SQL editor

BEGIN;

UPDATE supabase_migrations.schema_migrations SET version = '00083_recipe_variants' WHERE version = '00082_recipe_variants';
UPDATE supabase_migrations.schema_migrations SET version = '00084_batch_additions' WHERE version = '00083_batch_additions';
UPDATE supabase_migrations.schema_migrations SET version = '00085_variant_cost_views' WHERE version = '00084_variant_cost_views';
UPDATE supabase_migrations.schema_migrations SET version = '00086_refresh_views_for_variants' WHERE version = '00085_refresh_views_for_variants';
UPDATE supabase_migrations.schema_migrations SET version = '00087_cost_view_unit_conversion' WHERE version = '00086_cost_view_unit_conversion';
UPDATE supabase_migrations.schema_migrations SET version = '00088_user_profiles_delete_policy' WHERE version = '00087_user_profiles_delete_policy';
UPDATE supabase_migrations.schema_migrations SET version = '00089_customer_portal_schema' WHERE version = '00088_customer_portal_schema';
UPDATE supabase_migrations.schema_migrations SET version = '00090_slack_integration' WHERE version = '00088_slack_integration';
UPDATE supabase_migrations.schema_migrations SET version = '00091_square_integration' WHERE version = '00088_square_integration';
UPDATE supabase_migrations.schema_migrations SET version = '00092_change_request_tables' WHERE version = '00089_change_request_tables';
UPDATE supabase_migrations.schema_migrations SET version = '00093_fix_slack_rls_policies' WHERE version = '00089_fix_slack_rls_policies';
UPDATE supabase_migrations.schema_migrations SET version = '00094_apply_change_request_function' WHERE version = '00090_apply_change_request_function';
UPDATE supabase_migrations.schema_migrations SET version = '00095_customer_portal_many_to_many' WHERE version = '00091_customer_portal_many_to_many';
UPDATE supabase_migrations.schema_migrations SET version = '00096_dashboard_views_and_query_optimization' WHERE version = '00092_dashboard_views_and_query_optimization';
UPDATE supabase_migrations.schema_migrations SET version = '00097_permission_based_roles' WHERE version = '00092_permission_based_roles';
UPDATE supabase_migrations.schema_migrations SET version = '00098_pricing_keg_formats' WHERE version = '00092_pricing_keg_formats';
UPDATE supabase_migrations.schema_migrations SET version = '00099_quickbooks_integration' WHERE version = '00092_quickbooks_integration';
UPDATE supabase_migrations.schema_migrations SET version = '00100_qbo_token_save_rpc' WHERE version = '00093_qbo_token_save_rpc';
UPDATE supabase_migrations.schema_migrations SET version = '00101_view_correlated_subquery_fixes' WHERE version = '00093_view_correlated_subquery_fixes';
UPDATE supabase_migrations.schema_migrations SET version = '00102_audit_fixes' WHERE version = '00094_audit_fixes';
UPDATE supabase_migrations.schema_migrations SET version = '00103_add_pricing_tier_to_recipes_view' WHERE version = '00095_add_pricing_tier_to_recipes_view';
UPDATE supabase_migrations.schema_migrations SET version = '00104_batch_centric_brew_logs' WHERE version = '00095_batch_centric_brew_logs';
UPDATE supabase_migrations.schema_migrations SET version = '00105_yeast_workflow_unification' WHERE version = '00095_yeast_workflow_unification';
UPDATE supabase_migrations.schema_migrations SET version = '00106_brew_event_enums' WHERE version = '00096_brew_event_enums';
UPDATE supabase_migrations.schema_migrations SET version = '00107_water_addition_profiles' WHERE version = '00096_water_addition_profiles';
UPDATE supabase_migrations.schema_migrations SET version = '00108_recreate_price_lookup' WHERE version = '00097_recreate_price_lookup';
UPDATE supabase_migrations.schema_migrations SET version = '00109_water_chemistry_targets' WHERE version = '00097_water_chemistry_targets';
UPDATE supabase_migrations.schema_migrations SET version = '00110_pricing_channel_formats' WHERE version = '00098_pricing_channel_formats';
UPDATE supabase_migrations.schema_migrations SET version = '00111_simplify_water_chemistry' WHERE version = '00098_simplify_water_chemistry';
UPDATE supabase_migrations.schema_migrations SET version = '00112_add_glass_container_type' WHERE version = '00099_add_glass_container_type';
UPDATE supabase_migrations.schema_migrations SET version = '00113_containers_and_selling_formats' WHERE version = '00099_containers_and_selling_formats';
UPDATE supabase_migrations.schema_migrations SET version = '00114_dashboard_trend_functions' WHERE version = '00099_dashboard_trend_functions';
UPDATE supabase_migrations.schema_migrations SET version = '00115_missing_fk_indexes' WHERE version = '00099_missing_fk_indexes';
UPDATE supabase_migrations.schema_migrations SET version = '00116_pick_list_duplicate_guard' WHERE version = '00099_pick_list_duplicate_guard';
UPDATE supabase_migrations.schema_migrations SET version = '00117_fix_dashboard_trend_functions' WHERE version = '00100_fix_dashboard_trend_functions';
UPDATE supabase_migrations.schema_migrations SET version = '00118_fix_pricing_channel_formats_rls' WHERE version = '00100_fix_pricing_channel_formats_rls';
UPDATE supabase_migrations.schema_migrations SET version = '00119_migrate_to_containers' WHERE version = '00100_migrate_to_containers';
UPDATE supabase_migrations.schema_migrations SET version = '00120_po_created_by_default' WHERE version = '00100_po_created_by_default';
UPDATE supabase_migrations.schema_migrations SET version = '00121_avatars_storage_bucket' WHERE version = '00101_avatars_storage_bucket';
UPDATE supabase_migrations.schema_migrations SET version = '00122_rebuild_views_for_containers' WHERE version = '00101_rebuild_views_for_containers';
UPDATE supabase_migrations.schema_migrations SET version = '00123_drop_old_packaging_tables' WHERE version = '00102_drop_old_packaging_tables';
UPDATE supabase_migrations.schema_migrations SET version = '00124_email_notification_dispatch' WHERE version = '00102_email_notification_dispatch';
UPDATE supabase_migrations.schema_migrations SET version = '00125_fix_keg_inventory_deterministic_id' WHERE version = '00103_fix_keg_inventory_deterministic_id';
UPDATE supabase_migrations.schema_migrations SET version = '00126_performance_indexes' WHERE version = '00103_performance_indexes';
UPDATE supabase_migrations.schema_migrations SET version = '00127_fix_email_rls_policies' WHERE version = '00104_fix_email_rls_policies';
UPDATE supabase_migrations.schema_migrations SET version = '00128_packages_selling_format_not_null' WHERE version = '00104_packages_selling_format_not_null';

COMMIT;

-- Verify: should show 130 rows with sequential numbering
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
