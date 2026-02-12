-- =============================================================================
-- Migration: Order change request tables with RLS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- order_change_requests — one per customer submission
-- -----------------------------------------------------------------------------
CREATE TABLE order_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  notes TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_change_requests_order ON order_change_requests(order_id);
CREATE INDEX idx_change_requests_status ON order_change_requests(status) WHERE status = 'pending';
CREATE INDEX idx_change_requests_requested_by ON order_change_requests(requested_by);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON order_change_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE order_change_requests ENABLE ROW LEVEL SECURITY;

-- Staff: full access (matches existing pattern for authenticated internal users)
CREATE POLICY change_requests_staff_select ON order_change_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = (SELECT auth.uid()))
  );

CREATE POLICY change_requests_staff_insert ON order_change_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = (SELECT auth.uid()))
    OR requested_by = (SELECT auth.uid())
  );

CREATE POLICY change_requests_staff_update ON order_change_requests
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = (SELECT auth.uid()))
  );

-- Customer: can view own requests
CREATE POLICY change_requests_customer_select ON order_change_requests
  FOR SELECT TO authenticated
  USING (
    requested_by = (SELECT auth.uid())
  );

-- Customer: can insert requests on own orders
CREATE POLICY change_requests_customer_insert ON order_change_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = (SELECT auth.uid())
    AND order_id IN (
      SELECT id FROM orders WHERE customer_id IN (
        SELECT id FROM customers WHERE user_id = (SELECT auth.uid())
      )
    )
  );

-- -----------------------------------------------------------------------------
-- order_change_request_items — line-item changes within a request
-- -----------------------------------------------------------------------------
CREATE TABLE order_change_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_request_id UUID NOT NULL REFERENCES order_change_requests(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('add', 'modify', 'remove')),
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  brand_id UUID REFERENCES brands(id),
  package_type_id UUID REFERENCES package_types(id),
  keg_type_id UUID REFERENCES keg_types(id),
  quantity INTEGER,
  original_quantity INTEGER
);

CREATE INDEX idx_change_request_items_request ON order_change_request_items(change_request_id);

-- RLS
ALTER TABLE order_change_request_items ENABLE ROW LEVEL SECURITY;

-- Staff: full access
CREATE POLICY change_request_items_staff_select ON order_change_request_items
  FOR SELECT TO authenticated
  USING (
    change_request_id IN (
      SELECT id FROM order_change_requests WHERE
        EXISTS (SELECT 1 FROM user_profiles WHERE id = (SELECT auth.uid()))
    )
  );

CREATE POLICY change_request_items_staff_insert ON order_change_request_items
  FOR INSERT TO authenticated
  WITH CHECK (
    change_request_id IN (
      SELECT id FROM order_change_requests WHERE
        EXISTS (SELECT 1 FROM user_profiles WHERE id = (SELECT auth.uid()))
        OR requested_by = (SELECT auth.uid())
    )
  );

-- Customer: can view items on own requests
CREATE POLICY change_request_items_customer_select ON order_change_request_items
  FOR SELECT TO authenticated
  USING (
    change_request_id IN (
      SELECT id FROM order_change_requests
      WHERE requested_by = (SELECT auth.uid())
    )
  );

-- Customer: can insert items on own pending requests
CREATE POLICY change_request_items_customer_insert ON order_change_request_items
  FOR INSERT TO authenticated
  WITH CHECK (
    change_request_id IN (
      SELECT id FROM order_change_requests
      WHERE requested_by = (SELECT auth.uid()) AND status = 'pending'
    )
  );

-- -----------------------------------------------------------------------------
-- Customer-scoped RLS on orders + order_items (additive — existing staff policies remain)
-- -----------------------------------------------------------------------------
CREATE POLICY customer_orders_select ON orders
  FOR SELECT TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM customers WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY customer_order_items_select ON order_items
  FOR SELECT TO authenticated
  USING (
    order_id IN (
      SELECT id FROM orders WHERE customer_id IN (
        SELECT id FROM customers WHERE user_id = (SELECT auth.uid())
      )
    )
  );

-- -----------------------------------------------------------------------------
-- Schema registry entries
-- -----------------------------------------------------------------------------
INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, state_machine, query_examples)
VALUES
  ('order_change_requests', 'Customer-submitted change requests for orders. Requires admin approval.', 'sales',
   '["belongs_to: orders", "belongs_to: auth.users (requested_by)", "has_many: order_change_request_items"]'::jsonb,
   '["order_id", "status", "requested_by"]'::jsonb,
   '{"stateField": "status", "states": ["pending", "approved", "rejected", "cancelled"]}'::jsonb,
   '["Show pending change requests", "Show change requests for order X"]'::jsonb),
  ('order_change_request_items', 'Individual line-item changes within a change request (add/modify/remove).', 'sales',
   '["belongs_to: order_change_requests", "references: order_items", "references: brands", "references: package_types"]'::jsonb,
   '["change_request_id", "change_type", "order_item_id"]'::jsonb,
   NULL,
   '["Show items in change request X"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  state_machine = EXCLUDED.state_machine,
  query_examples = EXCLUDED.query_examples;
