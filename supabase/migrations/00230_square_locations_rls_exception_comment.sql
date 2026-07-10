-- 00230_square_locations_rls_exception_comment.sql
--
-- 00222 created square_locations with a staff-wide SELECT policy (any
-- authenticated user) but no RLS-EXCEPTION comment, so the RLS coverage
-- test (src/__tests__/integration/rls-coverage.test.ts) flags it as an
-- undocumented permissive policy. Staff-wide read is the intended model
-- (reviewed in the bin-sync C1 pass): the table holds Square location
-- metadata staff need for bin/POS configuration; writes stay gated by
-- integrations:manage. Document the exception. Metadata-only — no
-- catalog/snapshot impact.

COMMENT ON POLICY square_locations_select ON square_locations IS
  'RLS-EXCEPTION: staff-wide read of Square location metadata for bin/POS configuration; writes gated by integrations:manage (square_locations_write)';
