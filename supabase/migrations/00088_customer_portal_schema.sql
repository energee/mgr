-- =============================================================================
-- Migration: Customer portal schema — user_id link, cutoff config, customer role
-- =============================================================================

-- 1. Link customers to Supabase auth users (for portal access)
ALTER TABLE customers ADD COLUMN user_id UUID REFERENCES auth.users(id) UNIQUE;
CREATE INDEX idx_customers_user_id ON customers(user_id) WHERE user_id IS NOT NULL;

COMMENT ON COLUMN customers.user_id IS 'Links to auth.users for customer portal access. Set on first magic link login.';

-- 2. Configurable cutoff state per sales channel
ALTER TABLE sales_channels ADD COLUMN change_request_cutoff_state TEXT NOT NULL DEFAULT 'confirmed';

COMMENT ON COLUMN sales_channels.change_request_cutoff_state IS 'Order state at/beyond which customers cannot submit change requests. Picks from order states: draft, confirmed, scheduled, picking, packed, fulfilled.';

-- 3. Add 'customer' role to user_profiles
ALTER TABLE user_profiles DROP CONSTRAINT chk_user_role;
ALTER TABLE user_profiles ADD CONSTRAINT chk_user_role
  CHECK (role IN ('admin', 'production_manager', 'brewer', 'sales', 'viewer', 'customer'));

COMMENT ON COLUMN user_profiles.role IS 'User role: admin (full access), production_manager (production/inventory/purchasing), brewer (recipes/batches/brewing), sales (orders/customers), viewer (read-only), customer (portal access only)';

-- 4. Update create_user_profile trigger to assign 'customer' role when email matches a customer record
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := 'viewer';
BEGIN
  -- If the email matches an existing customer, assign customer role and link
  IF EXISTS (SELECT 1 FROM customers WHERE email = NEW.email AND user_id IS NULL) THEN
    v_role := 'customer';
    UPDATE customers SET user_id = NEW.id WHERE email = NEW.email AND user_id IS NULL;
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
