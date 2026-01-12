-- =============================================================================
-- Migration: Entity Revisions & Audit Trail
-- =============================================================================
-- Creates unified audit trail for high-value entities (batches, recipes, orders).
-- Tracks all INSERT, UPDATE, DELETE operations with full before/after data.
-- =============================================================================

-- =============================================================================
-- 1. Entity Revisions Table
-- =============================================================================

CREATE TABLE entity_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,  -- table name: 'batches', 'recipes', 'orders', etc.
  entity_id UUID NOT NULL,
  revision_number INTEGER NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  changed_by UUID,  -- can be null for system operations
  changed_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  old_data JSONB,  -- null for INSERT
  new_data JSONB,  -- null for DELETE
  change_reason TEXT,  -- optional user-provided reason
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE entity_revisions IS 'Unified audit trail for high-value entities. Stores full revision history with before/after data.';
COMMENT ON COLUMN entity_revisions.entity_type IS 'Table name of the tracked entity (e.g., batches, recipes, orders)';
COMMENT ON COLUMN entity_revisions.revision_number IS 'Sequential revision number per entity';
COMMENT ON COLUMN entity_revisions.operation IS 'Type of change: INSERT, UPDATE, or DELETE';
COMMENT ON COLUMN entity_revisions.old_data IS 'Complete row data before change (null for INSERT)';
COMMENT ON COLUMN entity_revisions.new_data IS 'Complete row data after change (null for DELETE)';

-- Indexes for common query patterns
CREATE INDEX idx_entity_revisions_entity ON entity_revisions(entity_type, entity_id);
CREATE INDEX idx_entity_revisions_changed_at ON entity_revisions(changed_at DESC);
CREATE INDEX idx_entity_revisions_changed_by ON entity_revisions(changed_by) WHERE changed_by IS NOT NULL;

-- =============================================================================
-- 2. Revision Trigger Function
-- =============================================================================

CREATE OR REPLACE FUNCTION log_entity_revision()
RETURNS TRIGGER AS $$
DECLARE
  v_revision_number INTEGER;
  v_entity_id UUID;
BEGIN
  -- Get the entity ID
  v_entity_id := COALESCE(NEW.id, OLD.id);

  -- Calculate next revision number for this entity
  SELECT COALESCE(MAX(revision_number), 0) + 1
  INTO v_revision_number
  FROM entity_revisions
  WHERE entity_type = TG_TABLE_NAME
    AND entity_id = v_entity_id;

  -- Insert revision record
  INSERT INTO entity_revisions (
    entity_type,
    entity_id,
    revision_number,
    operation,
    old_data,
    new_data,
    changed_by
  )
  VALUES (
    TG_TABLE_NAME,
    v_entity_id,
    v_revision_number,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END,
    (SELECT auth.uid())
  );

  -- Return appropriate record
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION log_entity_revision() IS 'Trigger function to log entity revisions for audit trail';

-- =============================================================================
-- 3. Attach Triggers to High-Value Entities
-- =============================================================================

-- Batches - production runs are critical for traceability
CREATE TRIGGER tr_batches_revision
  AFTER INSERT OR UPDATE OR DELETE ON batches
  FOR EACH ROW EXECUTE FUNCTION log_entity_revision();

-- Recipes - formulation changes need tracking
CREATE TRIGGER tr_recipes_revision
  AFTER INSERT OR UPDATE OR DELETE ON recipes
  FOR EACH ROW EXECUTE FUNCTION log_entity_revision();

-- Orders - sales order changes are business-critical
CREATE TRIGGER tr_orders_revision
  AFTER INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION log_entity_revision();

-- Purchase Orders - procurement audit trail
CREATE TRIGGER tr_purchase_orders_revision
  AFTER INSERT OR UPDATE OR DELETE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION log_entity_revision();

-- Finished Goods - inventory movement tracking
CREATE TRIGGER tr_finished_goods_revision
  AFTER INSERT OR UPDATE OR DELETE ON finished_goods
  FOR EACH ROW EXECUTE FUNCTION log_entity_revision();

-- =============================================================================
-- 4. RLS Policy
-- =============================================================================

ALTER TABLE entity_revisions ENABLE ROW LEVEL SECURITY;

-- Single-tenant: all authenticated users can view revisions
CREATE POLICY entity_revisions_select ON entity_revisions
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

-- Only system (via triggers) can insert revisions
CREATE POLICY entity_revisions_insert ON entity_revisions
  FOR INSERT WITH CHECK (true);

-- No one can update or delete revisions (immutable audit log)
-- (Default deny since no UPDATE/DELETE policies)

-- =============================================================================
-- 5. Helper Views
-- =============================================================================

-- Recent revisions with user info
CREATE VIEW recent_revisions
WITH (security_invoker = true)
AS
SELECT
  er.id,
  er.entity_type,
  er.entity_id,
  er.revision_number,
  er.operation,
  er.changed_at,
  er.changed_by,
  er.change_reason,
  -- Extract common display fields
  CASE
    WHEN er.entity_type = 'batches' THEN er.new_data->>'batch_number'
    WHEN er.entity_type = 'recipes' THEN er.new_data->>'name'
    WHEN er.entity_type = 'orders' THEN er.new_data->>'order_number'
    WHEN er.entity_type = 'purchase_orders' THEN er.new_data->>'po_number'
    ELSE er.entity_id::text
  END as entity_display_name,
  -- Status changes are common and useful
  er.old_data->>'status' as old_status,
  er.new_data->>'status' as new_status
FROM entity_revisions er
ORDER BY er.changed_at DESC;

COMMENT ON VIEW recent_revisions IS 'Recent entity revisions with extracted display fields';

-- =============================================================================
-- 6. Schema Registry Entry
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, state_machine, query_examples)
VALUES
('entity_revisions', 'Unified audit trail for high-value entities. Immutable log of all changes.', 'audit',
 '["tracks: batches", "tracks: recipes", "tracks: orders", "tracks: purchase_orders", "tracks: finished_goods"]',
 '["entity_type", "entity_id", "revision_number", "operation", "changed_at"]',
 NULL,
 '["Show revision history for batch X", "Who changed recipe Y?", "What orders changed today?", "Find all deletions"]')
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;
