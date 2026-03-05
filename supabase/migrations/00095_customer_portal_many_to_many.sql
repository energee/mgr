-- =============================================================================
-- Migration: Replace customers.user_id (1:1) with customer_portal_users (M:M)
-- =============================================================================

-- 1. Create junction table
CREATE TABLE customer_portal_users (
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, user_id)
);

CREATE INDEX idx_customer_portal_users_user ON customer_portal_users(user_id);

ALTER TABLE customer_portal_users ENABLE ROW LEVEL SECURITY;

-- Staff can see all links
CREATE POLICY portal_users_staff_select ON customer_portal_users
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = (SELECT auth.uid()))
  );

-- Staff can manage links
CREATE POLICY portal_users_staff_all ON customer_portal_users
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = (SELECT auth.uid()) AND role IN ('admin', 'sales'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = (SELECT auth.uid()) AND role IN ('admin', 'sales'))
  );

-- Customers can see their own links
CREATE POLICY portal_users_customer_select ON customer_portal_users
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 2. Migrate existing data from customers.user_id
INSERT INTO customer_portal_users (customer_id, user_id)
SELECT id, user_id FROM customers WHERE user_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 3. Drop customers.user_id column (and its index)
DROP INDEX IF EXISTS idx_customers_user_id;
ALTER TABLE customers DROP COLUMN user_id;

-- 4. Replace RLS policies that referenced customers.user_id

-- 4a. Orders: customer can see their own orders
DROP POLICY IF EXISTS customer_orders_select ON orders;
CREATE POLICY customer_orders_select ON orders
  FOR SELECT TO authenticated
  USING (
    customer_id IN (
      SELECT customer_id FROM customer_portal_users WHERE user_id = (SELECT auth.uid())
    )
  );

-- 4b. Order items: customer can see items on their orders
DROP POLICY IF EXISTS customer_order_items_select ON order_items;
CREATE POLICY customer_order_items_select ON order_items
  FOR SELECT TO authenticated
  USING (
    order_id IN (
      SELECT id FROM orders WHERE customer_id IN (
        SELECT customer_id FROM customer_portal_users WHERE user_id = (SELECT auth.uid())
      )
    )
  );

-- 4c. Change requests: customer can insert on their own orders
DROP POLICY IF EXISTS change_requests_customer_insert ON order_change_requests;
CREATE POLICY change_requests_customer_insert ON order_change_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = (SELECT auth.uid())
    AND order_id IN (
      SELECT id FROM orders WHERE customer_id IN (
        SELECT customer_id FROM customer_portal_users WHERE user_id = (SELECT auth.uid())
      )
    )
  );

-- 5. Update create_user_profile trigger to use junction table
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := 'viewer';
  v_customer RECORD;
  v_found BOOLEAN := false;
BEGIN
  -- Link all matching customers via junction table
  FOR v_customer IN
    SELECT id FROM customers WHERE email = NEW.email
  LOOP
    INSERT INTO customer_portal_users (customer_id, user_id)
    VALUES (v_customer.id, NEW.id)
    ON CONFLICT DO NOTHING;
    v_found := true;
  END LOOP;

  IF v_found THEN
    v_role := 'customer';
  END IF;

  INSERT INTO user_profiles (
    id,
    email,
    display_name,
    role,
    status,
    created_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    v_role,
    'active',
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = COALESCE(user_profiles.display_name, EXCLUDED.display_name),
    updated_at = now();

  RETURN NEW;
END;
$$;

-- 6. Schema registry entry
INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, state_machine, query_examples)
VALUES
  ('customer_portal_users', 'Junction table linking customers to portal auth users (many-to-many). A portal user can see orders from all linked customers.', 'sales',
   '["belongs_to: customers", "belongs_to: auth.users"]'::jsonb,
   '["customer_id", "user_id"]'::jsonb,
   NULL,
   '["Which customers can user X access?", "Which users have portal access to customer Y?"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  state_machine = EXCLUDED.state_machine,
  query_examples = EXCLUDED.query_examples;
