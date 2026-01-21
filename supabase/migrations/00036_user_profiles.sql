-- Migration: 00036_user_profiles.sql
-- Purpose: Create user_profiles table for user management
-- Phase: 8.2 User Management
--
-- Per CLAUDE.md: "Never expose auth.users" - we cache user info in this table
-- instead of joining auth.users directly in views.

-- =============================================================================
-- 1. Create user_profiles table
-- =============================================================================

CREATE TABLE user_profiles (
  -- Primary key matches auth.users.id
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Cached user info (synced from auth.users)
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,

  -- Role and status
  role TEXT NOT NULL DEFAULT 'viewer'
    CONSTRAINT chk_user_role CHECK (role IN ('admin', 'production_manager', 'brewer', 'sales', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active'
    CONSTRAINT chk_user_status CHECK (status IN ('active', 'inactive', 'pending')),

  -- Activity tracking
  last_active_at TIMESTAMPTZ,

  -- Invitation tracking
  invited_at TIMESTAMPTZ,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_user_profiles_email ON user_profiles(email);
CREATE INDEX idx_user_profiles_role ON user_profiles(role);
CREATE INDEX idx_user_profiles_status ON user_profiles(status);

-- Comments
COMMENT ON TABLE user_profiles IS 'User profiles with cached auth info and role assignment. Avoids direct auth.users joins per CLAUDE.md.';
COMMENT ON COLUMN user_profiles.role IS 'User role: admin (full access), production_manager (production/inventory/purchasing), brewer (recipes/batches/brewing), sales (orders/customers), viewer (read-only)';
COMMENT ON COLUMN user_profiles.status IS 'Account status: active, inactive (disabled), pending (invited but not confirmed)';

-- =============================================================================
-- 2. Auto-create profile on user signup with metadata sync
-- =============================================================================

CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_profiles (
    id,
    email,
    display_name,
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

-- Trigger on auth.users insert
DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_user_profile();

-- =============================================================================
-- 3. Sync email changes from auth.users
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_user_profile_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.email IS DISTINCT FROM NEW.email THEN
    UPDATE user_profiles
    SET email = NEW.email, updated_at = now()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION sync_user_profile_email();

-- =============================================================================
-- 4. Create profiles for existing users
-- =============================================================================

INSERT INTO user_profiles (id, email, display_name, status, created_at)
SELECT
  id,
  email,
  COALESCE(
    raw_user_meta_data->>'display_name',
    raw_user_meta_data->>'full_name',
    raw_user_meta_data->>'name',
    split_part(email, '@', 1)
  ),
  'active',
  COALESCE(created_at, now())
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- Set the first user as admin (if any users exist)
UPDATE user_profiles
SET role = 'admin'
WHERE id = (
  SELECT id FROM user_profiles ORDER BY created_at ASC LIMIT 1
);

-- =============================================================================
-- 5. View with user details
-- =============================================================================

CREATE OR REPLACE VIEW user_profiles_with_details
WITH (security_invoker = true)
AS
SELECT
  up.*,
  -- Format role for display
  CASE up.role
    WHEN 'admin' THEN 'Admin'
    WHEN 'production_manager' THEN 'Production Manager'
    WHEN 'brewer' THEN 'Brewer'
    WHEN 'sales' THEN 'Sales'
    WHEN 'viewer' THEN 'Viewer'
  END AS role_display,
  -- Status display
  CASE up.status
    WHEN 'active' THEN 'Active'
    WHEN 'inactive' THEN 'Inactive'
    WHEN 'pending' THEN 'Pending'
  END AS status_display,
  -- Invited by name (from profiles, not auth.users)
  inviter.display_name AS invited_by_name,
  -- Days since last active
  CASE
    WHEN up.last_active_at IS NOT NULL THEN
      EXTRACT(DAY FROM now() - up.last_active_at)::INTEGER
    ELSE NULL
  END AS days_since_active
FROM user_profiles up
LEFT JOIN user_profiles inviter ON inviter.id = up.invited_by;

-- =============================================================================
-- 6. RLS Policies
-- =============================================================================

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view profiles (needed for showing names, etc.)
CREATE POLICY user_profiles_select ON user_profiles
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Users can update their own profile (name, avatar only)
CREATE POLICY user_profiles_update_own ON user_profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admins can update any profile (role, status changes)
-- Note: We check role in a subquery to avoid circular dependency
CREATE POLICY user_profiles_update_admin ON user_profiles
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Admins can insert (for invitations)
CREATE POLICY user_profiles_insert_admin ON user_profiles
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- =============================================================================
-- 7. Updated at trigger
-- =============================================================================

CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 8. Helper function to check user role
-- =============================================================================

CREATE OR REPLACE FUNCTION get_user_role(p_user_id UUID DEFAULT auth.uid())
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT role FROM user_profiles WHERE id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION is_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = p_user_id AND role = 'admin'
  );
$$;

-- =============================================================================
-- 9. Function to update last active timestamp
-- =============================================================================

CREATE OR REPLACE FUNCTION update_last_active()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE user_profiles
  SET last_active_at = now()
  WHERE id = auth.uid();
END;
$$;

-- =============================================================================
-- 10. Schema Registry Entry
-- =============================================================================

INSERT INTO _schema_registry (
  table_name,
  description,
  domain,
  relationships,
  key_fields,
  query_examples,
  ai_context,
  calculated_fields
) VALUES (
  'user_profiles',
  'User profiles with roles and activity tracking. Caches auth.users info per security guidelines.',
  'settings',
  '{"belongs_to": [], "has_many": [{"name": "preferences", "table": "user_preferences"}]}'::jsonb,
  '["display_name", "email", "role", "status", "last_active_at"]'::jsonb,
  '["List all users", "Show admins", "Find inactive users", "Who was last active?"]'::jsonb,
  'User management entity. Contains cached auth info (email, name) to avoid joining auth.users directly. Role-based access: admin, production_manager, brewer, sales, viewer.'::text,
  '["days_since_active", "role_display", "status_display"]'::jsonb
)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples,
  ai_context = EXCLUDED.ai_context,
  calculated_fields = EXCLUDED.calculated_fields;
