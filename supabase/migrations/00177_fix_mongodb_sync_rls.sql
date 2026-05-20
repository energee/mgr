-- Task 5 (RLS coverage-gap plan): restrict mongodb_sync_log and
-- mongodb_sync_mappings to admin-only access.
--
-- Migration 00165 created both tables with FOR SELECT USING (true), meaning
-- any authenticated user could read sync state including potentially
-- sensitive operational data. Writes typically come from the background
-- sync worker (src/integrations/mongodb/sync.ts) using the service-role
-- client, so tightening SELECT to settings:manage does not break the
-- write path.

DROP POLICY IF EXISTS mongodb_sync_log_select ON mongodb_sync_log;

CREATE POLICY mongodb_sync_log_select ON mongodb_sync_log
  FOR SELECT
  USING (user_has_permission('settings:manage'));

CREATE POLICY mongodb_sync_log_write ON mongodb_sync_log
  FOR ALL
  USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

DROP POLICY IF EXISTS mongodb_sync_mappings_select ON mongodb_sync_mappings;

CREATE POLICY mongodb_sync_mappings_select ON mongodb_sync_mappings
  FOR SELECT
  USING (user_has_permission('settings:manage'));

CREATE POLICY mongodb_sync_mappings_write ON mongodb_sync_mappings
  FOR ALL
  USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));
