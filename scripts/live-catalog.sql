-- scripts/live-catalog.sql
--
-- Emits one line per public-schema catalog object, for the live-drift check
-- (scripts/check-live-drift.sh). Format (pipe-delimited):
--
--   FUNC|<name>(<identity args>)|<md5 of pg_get_functiondef>
--   TRIG|<trigger>|<table>|<md5 of pg_get_triggerdef>
--   TABLE|<name>
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
) cat
ORDER BY line COLLATE "C";
