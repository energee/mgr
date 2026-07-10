-- 00231_square_locations_select_staff_read.sql
--
-- Permission-scope square_locations_select to inventory:read (PR #363 review
-- blocker 1).
--
-- Lineage of this policy:
--   * 00222 created square_locations with
--       FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL)
--     "staff-wide" in intent — but any-authenticated-user includes portal
--     wholesale customers (the 'customer' role, 00201), which is the actual
--     threat model. It also tripped the RLS coverage guardrail
--     (src/__tests__/integration/rls-coverage.test.ts) on every PR until
--     00230 documented it with an RLS-EXCEPTION comment.
--   * On fix/square-bin-integrity, 00228 narrowed the policy to
--     user_has_permission('integrations:manage') (admin-only) — already
--     applied to the dev DB — which breaks the bin form's "Square Location"
--     picker (src/entities/bin/presentation.tsx, dynamicOptions on
--     square_locations) for production_manager, who owns bin/POS
--     configuration.
--
-- Fix: gate SELECT on inventory:read — the staff-read permission of the
-- bins/bin_inventory domain this picker serves. Per 00097 that grants
-- admin, production_manager, brewer, sales, and viewer, and excludes the
-- portal 'customer' role (portal users hold an empty staff-permission set,
-- see 00201 header). Writes stay integrations:manage
-- (square_locations_write, unchanged from 00222).
--
-- DROP + CREATE also drops 00230's RLS-EXCEPTION comment along with the old
-- policy object — intended: the recreated policy is permission-based, so the
-- guardrail no longer needs (and must not keep) a permissive-policy
-- exception. This migration converges both known states (main chain:
-- permissive + exception comment; live dev DB: integrations:manage from the
-- branch's 00228) to the same result, and is idempotent on re-run.

DROP POLICY IF EXISTS square_locations_select ON square_locations;

CREATE POLICY square_locations_select ON square_locations
  FOR SELECT
  USING (user_has_permission('inventory:read'));

COMMENT ON POLICY square_locations_select ON square_locations IS
  'Staff read via inventory:read (bins domain, 00097): production_manager and other staff need the bin-form Square Location picker; excludes the portal customer role. Writes gated by integrations:manage (square_locations_write, 00222). Scoped in 00231.';

-- =============================================================================
-- Verification (catalog-level, hard gate)
-- =============================================================================
-- Pure pg_policies assertions — no data rows created, safe on plain
-- postgres:15 (CI replay) and on live. Fails the migration if the policy
-- did not land permission-scoped or if any permissive row filter remains
-- on square_locations.
DO $$
DECLARE
  v_qual TEXT;
  v_permissive INTEGER;
BEGIN
  -- (a) The SELECT policy exists and is gated on inventory:read.
  SELECT qual INTO v_qual
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename  = 'square_locations'
     AND policyname = 'square_locations_select'
     AND cmd        = 'SELECT';
  IF v_qual IS NULL THEN
    RAISE EXCEPTION '00231_ASSERT_FAIL (a): square_locations_select SELECT policy not found';
  END IF;
  IF position('inventory:read' IN v_qual) = 0 THEN
    RAISE EXCEPTION '00231_ASSERT_FAIL (a): square_locations_select qual is not gated on inventory:read (got %)', v_qual;
  END IF;

  -- (b) No policy on square_locations retains a permissive row filter
  --     (USING/WITH CHECK of `true` or `auth.uid() IS NOT NULL`, in either
  --     direct or init-plan form — the forms rls-coverage.test.ts flags).
  SELECT count(*) INTO v_permissive
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename  = 'square_locations'
     AND (
       trim(coalesce(qual, ''))       IN ('true') OR
       trim(coalesce(with_check, '')) IN ('true') OR
       coalesce(qual, '')       ~* 'auth\.uid\(\)[^)]*\)?\s+IS\s+NOT\s+NULL' OR
       coalesce(with_check, '') ~* 'auth\.uid\(\)[^)]*\)?\s+IS\s+NOT\s+NULL'
     );
  IF v_permissive > 0 THEN
    RAISE EXCEPTION '00231_ASSERT_FAIL (b): % permissive polic(y/ies) remain on square_locations', v_permissive;
  END IF;

  RAISE NOTICE '00231 verification passed: square_locations_select is inventory:read-scoped and no permissive policies remain';
END $$;

NOTIFY pgrst, 'reload schema';
