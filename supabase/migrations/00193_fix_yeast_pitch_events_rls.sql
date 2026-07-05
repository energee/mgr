-- Task 2 (RLS coverage-gap plan): fix yeast_pitch_events policy regression.
--
-- Migration 00158 created yeast_pitch_events with a single FOR ALL policy
-- of USING (auth.uid() IS NOT NULL) — granting any authenticated user
-- full read/write access regardless of role. This contradicts the
-- permission-based model established in 00097 and was already flagged as
-- HIGH-1 in docs/security/rls-policy-audit.md.
--
-- This migration replaces the regression with the standard production-domain
-- pattern: batches:read for SELECT, batches:write for INSERT/UPDATE/DELETE.

DROP POLICY IF EXISTS yeast_pitch_events_access ON yeast_pitch_events;

CREATE POLICY yeast_pitch_events_select ON yeast_pitch_events
  FOR SELECT
  USING (user_has_permission('batches:read'));

CREATE POLICY yeast_pitch_events_write ON yeast_pitch_events
  FOR ALL
  USING (user_has_permission('batches:write'))
  WITH CHECK (user_has_permission('batches:write'));
