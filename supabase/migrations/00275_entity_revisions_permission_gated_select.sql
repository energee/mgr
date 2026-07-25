-- Migration 00275 — gate entity_revisions reads on the tracked table's own
-- read permission (issue #604).
--
-- PROBLEM
-- `log_entity_revision()` (00019) stores complete `to_jsonb(OLD/NEW)` row
-- images, so `entity_revisions` is a second, denormalized copy of every
-- tracked table — not a set of references to RLS-protected rows. The only
-- SELECT policy was `(SELECT auth.uid()) IS NOT NULL`, re-created verbatim by
-- 00097:434 from the single-tenant, staff-only 00019 original. Once the
-- `customer` role and the wholesale portal shipped, that predicate admitted
-- portal customers: an authenticated portal session could read every other
-- customer's orders plus recipe formulations, supplier costs and pricing-tier
-- rows via one PostgREST call. Low-privilege staff could likewise read
-- purchase-order and pricing snapshots denied to them on the source tables.
--
-- FIX
-- The audit copy now inherits exactly the authorization of the data it
-- copies: each `entity_type` maps to the permission that the tracked table's
-- own SELECT policy requires. The mapping below was read off the live policy
-- set, not assumed:
--
--   orders              orders_select              -> orders:read
--   recipes             recipes_select             -> recipes:read
--   batches             batches_select             -> batches:read
--   purchase_orders     purchase_orders_select     -> purchasing:read
--   finished_goods      finished_goods_select      -> inventory:read
--   inventory_lots      inventory_lots_select      -> inventory:read
--   keg_transactions    keg_transactions_select    -> inventory:read
--   packaging_sessions  packaging_sessions_select  -> batches:read
--   allocations         allocations_select         -> inventory:read
--   pricing_tier_prices pricing_tier_prices_select -> settings:manage
--
-- Two deliberate departures from a literal mirror:
--
--  * `pricing_tier_prices` — its source SELECT policy is itself the
--    permissive `auth.uid() IS NOT NULL`, while its writes require
--    settings:manage. Mirroring the open read would leave competitor pricing
--    exposed to portal customers, so the audit copy is gated on
--    settings:manage (admin-only). Tightening the source table is a separate,
--    still-open gap tracked by #604.
--  * `orders` — the source table additionally grants customers their own
--    rows through `customer_orders_select` (junction-scoped). That branch is
--    deliberately NOT reproduced here: portal customers have no audit-trail
--    UI, and #604 requires a customer session to read zero revision rows.
--
-- `entity_type` is free text (it is `TG_TABLE_NAME`), so the ELSE branch is
-- load-bearing: a table that gains the revision trigger in a future migration
-- without a matching CASE branch is admin-only until the branch is added.
-- The coupling is intentional — the failure mode is closed, not open.
--
-- NOT CHANGED
--  * Writes. `log_entity_revision()` is SECURITY DEFINER, so customer-
--    initiated actions (e.g. order change requests) keep recording revisions
--    the customer cannot read back.
--  * Immutability. No UPDATE or DELETE policy is added.
--  * The restrictive `current_user_enabled` policy from 00255 still ANDs in.
--    `user_has_permission()` folds in `current_user_is_enabled()` as well.

DROP POLICY IF EXISTS entity_revisions_select ON entity_revisions;

CREATE POLICY entity_revisions_select ON entity_revisions
  FOR SELECT
  TO authenticated
  USING (
    CASE entity_type
      WHEN 'orders'              THEN user_has_permission('orders:read')
      WHEN 'recipes'             THEN user_has_permission('recipes:read')
      WHEN 'batches'             THEN user_has_permission('batches:read')
      WHEN 'purchase_orders'     THEN user_has_permission('purchasing:read')
      WHEN 'finished_goods'      THEN user_has_permission('inventory:read')
      WHEN 'inventory_lots'      THEN user_has_permission('inventory:read')
      WHEN 'keg_transactions'    THEN user_has_permission('inventory:read')
      WHEN 'packaging_sessions'  THEN user_has_permission('batches:read')
      WHEN 'allocations'         THEN user_has_permission('inventory:read')
      WHEN 'pricing_tier_prices' THEN user_has_permission('settings:manage')
      -- Fail closed: an entity_type nobody enumerated is admin-only.
      ELSE user_has_permission('settings:manage')
    END
  );

-- Replaces the RLS-EXCEPTION comment set by 00198:204, which asserted the
-- opposite of what the schema does ("row data references domain rows that are
-- themselves RLS-protected, so the audit row alone does not leak business
-- data"). The rows embed full copies, not references. The policy is no longer
-- a permissive exception, so it is no longer in scope for the
-- `RLS-EXCEPTION:` guardrail in rls-coverage.test.ts.
COMMENT ON POLICY entity_revisions_select ON entity_revisions IS
  'Reads inherit the tracked table''s own read permission: entity_type is mapped to the permission that table''s SELECT policy requires, and any unenumerated entity_type falls back to settings:manage (admin-only). Portal customers hold no staff permission and therefore read no revisions. Rows remain immutable — no UPDATE or DELETE policy exists — and writes continue via the SECURITY DEFINER trigger log_entity_revision().';
