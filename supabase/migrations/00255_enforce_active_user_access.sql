-- Issue #441: make user_profiles.status an enforced authorization boundary.
--
-- A valid JWT is deliberately insufficient. Only a matching ACTIVE profile
-- may use authenticated RLS policies; pending, inactive, and missing profiles
-- fail closed. Service-role provisioning continues to bypass RLS.

-- RLS policies on user_profiles cannot safely query user_profiles directly
-- without infinite recursion. This no-argument SECURITY DEFINER helper can
-- inspect only the caller's own auth.uid(), so it does not expose arbitrary
-- profile status while bypassing RLS for the recursive lookup.
-- security-definer: justified reads only auth.uid()'s active flag to break user_profiles RLS recursion; no caller-selected identity or profile data is exposed
CREATE OR REPLACE FUNCTION current_user_is_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = (SELECT auth.uid())
      AND status = 'active'
  );
$$;

COMMENT ON FUNCTION current_user_is_enabled() IS
  'RLS-safe current-user gate. True only when auth.uid() has an active user_profiles row; pending, inactive, and missing profiles fail closed.';

-- Supabase default privileges grant new functions to PUBLIC. Revoke that
-- implicit grant explicitly, then admit only API roles that may evaluate RLS.
REVOKE ALL ON FUNCTION current_user_is_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION current_user_is_enabled() TO authenticated, service_role;

-- Role-derived authorization helpers must all honor the same enabled-account
-- predicate. user_has_permission is the main staff RLS gate; the remaining
-- helpers close direct-RPC and user_profiles-policy paths.
CREATE OR REPLACE FUNCTION user_has_permission(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT current_user_is_enabled()
    AND EXISTS (
      SELECT 1
      FROM user_profiles
      WHERE id = (SELECT auth.uid())
        AND roles && get_roles_for_permission(p_permission)
    );
$$;

CREATE OR REPLACE FUNCTION user_has_role(p_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT current_user_is_enabled()
    AND EXISTS (
      SELECT 1
      FROM user_profiles
      WHERE id = (SELECT auth.uid())
        AND p_role = ANY(roles)
    );
$$;

CREATE OR REPLACE FUNCTION get_user_role(p_user_id UUID DEFAULT auth.uid())
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT roles[1]
  FROM user_profiles
  WHERE id = p_user_id
    AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION is_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_profiles
    WHERE id = p_user_id
      AND status = 'active'
      AND 'admin' = ANY(roles)
  );
$$;

-- SECURITY DEFINER is required here because user_profiles policies call this
-- helper while evaluating user_profiles itself. The status condition ensures
-- an inactive admin's old JWT cannot use the admin branch. The identity check
-- prevents callers from using the RLS-bypassing function as an arbitrary
-- profile-status probe; every policy passes the current auth.uid().
-- security-definer: justified checks only whether the auth.uid()-matched profile is an active admin, avoiding recursive user_profiles policy evaluation
CREATE OR REPLACE FUNCTION is_admin_rls(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id = (SELECT auth.uid())
    AND EXISTS (
    SELECT 1
    FROM user_profiles
    WHERE id = p_user_id
      AND status = 'active'
      AND 'admin' = ANY(roles)
  );
$$;

COMMENT ON FUNCTION is_admin_rls(UUID) IS
  'RLS-recursion-safe active-admin check restricted to the current auth.uid() for user_profiles policies.';

REVOKE ALL ON FUNCTION is_admin_rls(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_admin_rls(UUID) TO authenticated, service_role;

-- A database claim serializes the non-transactional boundary between the
-- profile row and Supabase Auth. It deliberately has no automatic expiry: an
-- old process must never resume after a newer opposite command and overwrite
-- Auth state. Known failures release their claim through the matching token;
-- an unknown/crashed attempt stays fenced for explicit recovery.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS account_status_operation_id UUID,
  ADD COLUMN IF NOT EXISTS account_status_operation TEXT,
  ADD COLUMN IF NOT EXISTS account_status_operation_started_at TIMESTAMPTZ;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS chk_user_account_status_operation;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT chk_user_account_status_operation CHECK (
    (
      account_status_operation_id IS NULL
      AND account_status_operation IS NULL
      AND account_status_operation_started_at IS NULL
    )
    OR
    (
      account_status_operation_id IS NOT NULL
      AND account_status_operation IN ('deactivate', 'reactivate')
      AND account_status_operation_started_at IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION begin_user_account_status_operation(
  p_user_id UUID,
  p_command TEXT
)
RETURNS TABLE(operation_id UUID, profile_status TEXT)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_existing_operation UUID;
  v_operation_id UUID := gen_random_uuid();
BEGIN
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin')
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'account status operations require the service role'
      USING ERRCODE = '42501';
  END IF;

  IF p_command NOT IN ('deactivate', 'reactivate') THEN
    RAISE EXCEPTION 'invalid account status command: %', p_command
      USING ERRCODE = '22023';
  END IF;

  SELECT status, account_status_operation_id
  INTO v_status, v_existing_operation
  FROM public.user_profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user profile not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_existing_operation IS NOT NULL THEN
    RAISE EXCEPTION 'another account status operation is already in progress'
      USING ERRCODE = '55P03';
  END IF;

  UPDATE public.user_profiles
  SET status = CASE WHEN p_command = 'deactivate' THEN 'inactive' ELSE status END,
      account_status_operation_id = v_operation_id,
      account_status_operation = p_command,
      account_status_operation_started_at = now(),
      updated_at = now()
  WHERE id = p_user_id;

  RETURN QUERY SELECT v_operation_id, v_status;
END;
$$;

COMMENT ON FUNCTION begin_user_account_status_operation(UUID, TEXT) IS
  'Service-role-only per-user claim. Deactivation closes the DB gate while taking the claim; reactivation keeps the profile non-active until Auth succeeds.';

CREATE OR REPLACE FUNCTION complete_user_account_status_operation(
  p_user_id UUID,
  p_operation_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_command TEXT;
  v_status TEXT;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin')
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'account status operations require the service role'
      USING ERRCODE = '42501';
  END IF;

  SELECT account_status_operation, status
  INTO v_command, v_status
  FROM public.user_profiles
  WHERE id = p_user_id
    AND account_status_operation_id = p_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account status operation is no longer current'
      USING ERRCODE = '55P03';
  END IF;

  UPDATE public.user_profiles
  SET status = CASE WHEN v_command = 'reactivate' THEN 'active' ELSE 'inactive' END,
      account_status_operation_id = NULL,
      account_status_operation = NULL,
      account_status_operation_started_at = NULL,
      updated_at = now()
  WHERE id = p_user_id
  RETURNING status INTO v_status;

  RETURN v_status;
END;
$$;

COMMENT ON FUNCTION complete_user_account_status_operation(UUID, UUID) IS
  'Completes only the current fenced operation; reactivation opens the DB gate in the same transaction that releases the claim.';

CREATE OR REPLACE FUNCTION abort_user_account_status_operation(
  p_user_id UUID,
  p_operation_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin')
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'account status operations require the service role'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_profiles
  SET account_status_operation_id = NULL,
      account_status_operation = NULL,
      account_status_operation_started_at = NULL,
      updated_at = now()
  WHERE id = p_user_id
    AND account_status_operation_id = p_operation_id
  RETURNING status INTO v_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account status operation is no longer current'
      USING ERRCODE = '55P03';
  END IF;

  RETURN v_status;
END;
$$;

COMMENT ON FUNCTION abort_user_account_status_operation(UUID, UUID) IS
  'Releases only the matching fenced operation after the caller has restored or confirmed a safe DB/Auth ordering.';

REVOKE ALL ON FUNCTION begin_user_account_status_operation(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_user_account_status_operation(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION abort_user_account_status_operation(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION begin_user_account_status_operation(UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION complete_user_account_status_operation(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION abort_user_account_status_operation(UUID, UUID)
  TO service_role;

-- The own-profile UPDATE policy intentionally retains display-name/avatar
-- writes. Status/operation changes must use the service-role command; active
-- admins may still manage OTHER profiles' roles.
CREATE OR REPLACE FUNCTION guard_user_profile_authorization_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  v_auth_role TEXT := COALESCE(auth.role(), '');
BEGIN
  IF NEW.roles IS NOT DISTINCT FROM OLD.roles
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.account_status_operation_id IS NOT DISTINCT FROM OLD.account_status_operation_id
     AND NEW.account_status_operation IS NOT DISTINCT FROM OLD.account_status_operation
     AND NEW.account_status_operation_started_at IS NOT DISTINCT FROM OLD.account_status_operation_started_at THEN
    RETURN NEW;
  END IF;

  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR v_auth_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.account_status_operation_id IS DISTINCT FROM OLD.account_status_operation_id
     OR NEW.account_status_operation IS DISTINCT FROM OLD.account_status_operation
     OR NEW.account_status_operation_started_at IS DISTINCT FROM OLD.account_status_operation_started_at THEN
    RAISE EXCEPTION 'account status must be changed through the dedicated server command'
      USING ERRCODE = '42501';
  END IF;

  IF v_uid = OLD.id THEN
    RAISE EXCEPTION 'roles cannot be changed through self-service profile updates'
      USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_rls(v_uid) THEN
    RAISE EXCEPTION 'only an active administrator may change another user''s roles'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_user_profile_authorization_fields
  ON public.user_profiles;
CREATE TRIGGER guard_user_profile_authorization_fields
  BEFORE UPDATE OF roles, status,
    account_status_operation_id, account_status_operation,
    account_status_operation_started_at
  ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION guard_user_profile_authorization_fields();

-- Multiple permissive policies OR together, including portal self-access and
-- legacy `auth.uid() IS NOT NULL` policies. One restrictive policy per current
-- RLS table composes with every permissive path, closing them uniformly.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS current_user_enabled ON %I.%I',
      r.schema_name,
      r.table_name
    );
    EXECUTE format(
      'CREATE POLICY current_user_enabled ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT current_user_is_enabled())) WITH CHECK ((SELECT current_user_is_enabled()))',
      r.schema_name,
      r.table_name
    );
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
