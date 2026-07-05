-- =============================================================================
-- 00094: Codebase Audit Fixes
-- Tighten RLS policies, add CHECK constraints, change cascades, register tables
-- =============================================================================

-- ---------------------------------------------------------------------------
-- H1: Tighten overly permissive RLS policies
-- ---------------------------------------------------------------------------

-- Notifications: restrict INSERT so users can only create notifications for themselves
DROP POLICY IF EXISTS notifications_insert ON notifications;
CREATE POLICY notifications_insert ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Entity revisions: restrict INSERT to the user who made the change
DROP POLICY IF EXISTS entity_revisions_insert ON entity_revisions;
CREATE POLICY entity_revisions_insert ON entity_revisions
  FOR INSERT TO authenticated
  WITH CHECK (changed_by = (SELECT auth.uid()));

-- QBO policies: HISTORICAL PARTIAL NO-OP (rewritten in PR #322).
-- The original blocks here recreated every qbo_* policy filtering on
-- user_profiles.role — a column 00097 had already renamed to roles[] — so
-- every CREATE POLICY failed on every environment, while the DROPs
-- succeeded (removing 00099's permissive originals). The DROPs are kept to
-- reproduce that state; the live replacement pair per table
-- (user_has_permission('integrations:manage') _select/_write, applied
-- out-of-band) is captured in 00199_capture_selling_formats_containers.sql.
DROP POLICY IF EXISTS qbo_sync_mappings_select ON qbo_sync_mappings;
DROP POLICY IF EXISTS qbo_sync_mappings_insert ON qbo_sync_mappings;
DROP POLICY IF EXISTS qbo_sync_mappings_update ON qbo_sync_mappings;
DROP POLICY IF EXISTS qbo_sync_mappings_delete ON qbo_sync_mappings;
DROP POLICY IF EXISTS qbo_sync_log_select ON qbo_sync_log;
DROP POLICY IF EXISTS qbo_sync_log_insert ON qbo_sync_log;
DROP POLICY IF EXISTS qbo_sync_log_update ON qbo_sync_log;
DROP POLICY IF EXISTS qbo_sync_log_delete ON qbo_sync_log;
DROP POLICY IF EXISTS qbo_account_mappings_select ON qbo_account_mappings;
DROP POLICY IF EXISTS qbo_account_mappings_insert ON qbo_account_mappings;
DROP POLICY IF EXISTS qbo_account_mappings_update ON qbo_account_mappings;
DROP POLICY IF EXISTS qbo_account_mappings_delete ON qbo_account_mappings;

-- ---------------------------------------------------------------------------
-- H3: Change ON DELETE CASCADE to RESTRICT on high-risk FKs
-- ---------------------------------------------------------------------------

-- Purchase orders: prevent accidental supplier deletion from cascading
ALTER TABLE purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_supplier_id_fkey,
  ADD CONSTRAINT purchase_orders_supplier_id_fkey
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT;

-- Inventory lots: prevent accidental item deletion from cascading
ALTER TABLE inventory_lots
  DROP CONSTRAINT IF EXISTS inventory_lots_inventory_item_id_fkey,
  ADD CONSTRAINT inventory_lots_inventory_item_id_fkey
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- H4: Add CHECK constraint on allocations quantity
-- ---------------------------------------------------------------------------

ALTER TABLE allocations
  ADD CONSTRAINT allocations_quantity_positive CHECK (quantity > 0);

-- ---------------------------------------------------------------------------
-- H6: Register missing integration tables in _schema_registry
-- ---------------------------------------------------------------------------

INSERT INTO _schema_registry (table_name, description, domain, relationships)
VALUES
  ('slack_notification_log', 'Log of Slack notification delivery attempts and outcomes', 'integrations',
   '[{"table": "notifications", "type": "many-to-one", "description": "Source notification that triggered the Slack message"}]'::jsonb),
  ('square_catalog_map', 'Mapping between MGR catalog items and Square catalog objects', 'integrations',
   '[{"table": "packaging_formats", "type": "many-to-one", "description": "Local packaging format mapped to Square"}]'::jsonb)
ON CONFLICT (table_name) DO UPDATE
  SET description = EXCLUDED.description,
      domain = EXCLUDED.domain,
      relationships = EXCLUDED.relationships;
