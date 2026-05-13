-- ============================================================================
-- RLS Posture Audit
-- ============================================================================
--
-- Run this script in production (or a recent snapshot) to surface RLS
-- regressions. It addresses audit findings F-125 and F-129:
--
--   F-125 — policies that re-evaluate auth.uid() per row (regression from
--           the InitPlan pattern standardised in migration 00013).
--   F-129 — views with security_invoker = true whose base tables lack
--           RLS or lack brewery_id-scoped policies (cross-tenant leak risk).
--
-- The queries are read-only. They produce three result sets — one per
-- audit class. Copy each result into the team's incident-response channel
-- if anything non-empty turns up.
--
-- Re-run after every migration that touches policies or views.

-- ============================================================================
-- 1. F-125 — Policies calling auth.uid() outside a SELECT subquery
-- ============================================================================
--
-- Expected: zero rows. Any hit is a regression that should be fixed by
-- wrapping auth.uid() in a subquery: (SELECT auth.uid()). See
-- supabase/migrations/00013_rls_performance_fix.sql for the pattern.

SELECT
  '01-auth-uid-regression' AS check_id,
  schemaname,
  tablename,
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    qual ~ 'auth\.uid\(\)' AND qual !~ '\(SELECT auth\.uid\(\)\)'
    OR with_check ~ 'auth\.uid\(\)' AND with_check !~ '\(SELECT auth\.uid\(\)\)'
  )
ORDER BY tablename, policyname;

-- ============================================================================
-- 2. F-129 — Base tables of public views with security_invoker that lack RLS
-- ============================================================================
--
-- Views with security_invoker = true evaluate RLS in the caller's role.
-- If a base table the view depends on lacks RLS (or lacks brewery_id-scoped
-- policies), the view inherits the gap and may leak cross-tenant data.
--
-- Expected: every base table appearing here should have rls_enabled = true
-- AND at least one policy referencing brewery_id. Anything else is a
-- finding to investigate.

WITH view_bases AS (
  SELECT
    c.relname AS view_name,
    t.relname AS base_table,
    t.relrowsecurity AS rls_enabled,
    (
      SELECT COUNT(*)
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = t.relname
        AND p.qual LIKE '%brewery_id%'
    ) AS brewery_scoped_policies,
    (
      SELECT COUNT(*)
      FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.relname
    ) AS total_policies
  FROM pg_class c
  JOIN pg_rewrite r ON r.ev_class = c.oid
  JOIN pg_depend dep ON dep.objid = r.oid AND dep.refobjsubid = 0
  JOIN pg_class t ON t.oid = dep.refobjid
  WHERE c.relkind = 'v'
    AND c.relnamespace = 'public'::regnamespace
    AND t.relkind = 'r'
    AND t.relnamespace = 'public'::regnamespace
    AND t.relname <> c.relname  -- ignore self-reference
)
SELECT DISTINCT
  '02-view-base-rls-gap' AS check_id,
  view_name,
  base_table,
  rls_enabled,
  total_policies,
  brewery_scoped_policies
FROM view_bases
WHERE rls_enabled = false
   OR brewery_scoped_policies = 0
ORDER BY view_name, base_table;

-- ============================================================================
-- 3. Bonus — public tables missing RLS entirely
-- ============================================================================
--
-- Every public-schema table that the API can reach should have RLS enabled.
-- Tables that intentionally bypass RLS (e.g. lookup tables, _schema_registry)
-- should be added to the allowlist below and explicitly justified.

WITH allowlist AS (
  SELECT unnest(ARRAY[
    -- Add table names here that legitimately do not need RLS.
    -- Document the reason in a comment next to each.
    '_schema_registry'  -- audited under separate finding; see F-129 follow-up
  ]) AS table_name
)
SELECT
  '03-public-table-no-rls' AS check_id,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled
FROM pg_class c
WHERE c.relkind = 'r'
  AND c.relnamespace = 'public'::regnamespace
  AND c.relrowsecurity = false
  AND c.relname NOT IN (SELECT table_name FROM allowlist)
  AND c.relname NOT LIKE 'spatial_%'  -- PostGIS internals if any
  AND c.relname NOT LIKE 'pg_%'
ORDER BY c.relname;
