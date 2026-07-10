-- scripts/live-catalog.sql
--
-- Emits one line per public-schema catalog object, for the live-drift check
-- (scripts/check-live-drift.sh). Format (pipe-delimited):
--
--   FUNC|<name>(<identity args>)|<md5 of pg_get_functiondef>
--   TRIG|<trigger>|<table>|<md5 of pg_get_triggerdef>
--   TABLE|<name>
--   POLICY|<table>|<policy>|<cmd>|<permissive>|<roles, csv sorted>|<md5 of qual~with_check>
--   RLS|<table>|<row_security true/false>|<force_row_security true/false>
--
-- POLICY and RLS lines exist so an out-of-band DROP POLICY / ALTER POLICY /
-- DISABLE ROW LEVEL SECURITY registers as drift (a missing snapshot line →
-- FAIL) — this schema is RLS-heavy and those were previously invisible to
-- the watchdog. qual/with_check are hashed the same way function bodies are.
--
-- Extension-owned functions (pg_depend deptype 'e') are excluded so installing/
-- upgrading an extension doesn't register as drift. Ordered by C collation so
-- the output is byte-stable regardless of the database's default collation and
-- matches an LC_ALL=C sort on the runner.
--
-- Run with: psql -tA --no-psqlrc -v ON_ERROR_STOP=1 -f scripts/live-catalog.sql
SELECT line FROM (
  SELECT 'FUNC|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
         || md5(pg_get_functiondef(p.oid)) AS line
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
    )
  UNION ALL
  SELECT 'TRIG|' || t.tgname || '|' || c.relname || '|' || md5(pg_get_triggerdef(t.oid))
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
  UNION ALL
  SELECT 'TABLE|' || c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  UNION ALL
  SELECT 'POLICY|' || pol.tablename || '|' || pol.policyname || '|' || pol.cmd || '|'
         || pol.permissive || '|'
         || (SELECT coalesce(string_agg(r::text, ',' ORDER BY r::text), '')
             FROM unnest(pol.roles) AS r)
         || '|' || md5(coalesce(pol.qual, '') || '~' || coalesce(pol.with_check, ''))
  FROM pg_policies pol
  WHERE pol.schemaname = 'public'
  UNION ALL
  SELECT 'RLS|' || c.relname || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
) cat
ORDER BY line COLLATE "C";
