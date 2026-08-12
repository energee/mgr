-- 00286_suppliers_delete_revision_trail.sql
-- Closes the residual 00282 deliberately left open (#694): `suppliers` row
-- deletions leave no `entity_revisions` trail.
--
-- WHY DELETE-ONLY, NOT THE FULL TRIGGER
-- 00282 excluded `suppliers` from the full AFTER INSERT OR UPDATE OR DELETE
-- trigger because `syncSuppliers` upserts every Mongo supplier document on
-- every sync run (src/integrations/mongodb/sync.ts:324) — the full trigger
-- would append one revision row per supplier per run, nearly all recording no
-- change: write amplification with no audit value. But deletion, not edit, is
-- the loss mode: 00252_merge_duplicate_suppliers.sql:86 is a top-level
-- one-shot `DELETE FROM suppliers` (the same incident class as #549) that ran
-- against live data. A future dedup or cleanup migration would destroy
-- supplier rows with no ledger entry. An AFTER DELETE trigger records exactly
-- the loss mode and never fires on sync churn.
--
-- `log_entity_revision()` (00019) already handles TG_OP = 'DELETE' — it
-- writes `old_data = to_jsonb(OLD)`, leaves `new_data` NULL and returns OLD —
-- and `suppliers.id` is `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
-- (00010_unified_allocations.sql:16), which the function requires via
-- COALESCE(NEW.id, OLD.id). No function change is needed.
--
-- LOCKS (same shapes 00282 measured)
--   CREATE TRIGGER              -> SHARE ROW EXCLUSIVE on suppliers
--   DROP TRIGGER IF EXISTS      -> no lock when the trigger is absent
--   DROP POLICY / CREATE POLICY -> ACCESS EXCLUSIVE on entity_revisions,
--                                  held until COMMIT
-- As in 00282, the heaviest lock is the ACCESS EXCLUSIVE on
-- `entity_revisions`, which briefly pauses writes to all tracked tables (every
-- tracked write INSERTs there). No data work, so the window is short — apply
-- off peak, and (per #694) after 00282 is live so the two trigger sets are not
-- introduced in the same window.
--
-- NOT YET APPLIED LIVE
-- Committed, not pushed: live apply is an operator step via
-- scripts/db-push.sh (needs SUPABASE_DB_URL). Until then live `suppliers`
-- deletions remain untraceable. Sequenced behind 00282's live apply (#693).
--
-- Fixes #694. Refs #549, #693.

DROP TRIGGER IF EXISTS tr_suppliers_revision ON suppliers;
CREATE TRIGGER tr_suppliers_revision
  AFTER DELETE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION log_entity_revision();

COMMENT ON TRIGGER tr_suppliers_revision ON suppliers IS
  'Appends an entity_revisions row (entity_type = suppliers, operation = DELETE, full old_data image) for every row deletion, so supplier rows destroyed by a data migration or hand-edit stay reconstructible (#694). Deliberately DELETE-only: the MongoDB sync upserts every supplier on every run, so an INSERT/UPDATE trigger would be pure write amplification (see 00282 header).';

-- ---------------------------------------------------------------------------
-- Read authorization for the new entity_type.
-- ---------------------------------------------------------------------------
-- docs/data-model/system.md requires the CASE branch to land in the same
-- migration as the trigger, so `entity_revisions_select` is re-stated here
-- with the `suppliers` branch added. `suppliers` -> purchasing:read is a
-- literal mirror of `suppliers_select` (00097 purchasing-domain loop, line
-- 364), the same permission `purchase_orders` and `supplier_catalog`
-- revisions already use. Every other branch, the ELSE fallback, the
-- `TO authenticated` grant and the absence of UPDATE/DELETE policies are
-- carried over from 00282 verbatim; the restrictive `current_user_enabled`
-- policy (00255) is untouched and still ANDs in.

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
      WHEN 'suppliers'           THEN user_has_permission('purchasing:read')
      WHEN 'supplier_catalog'    THEN user_has_permission('purchasing:read')
      WHEN 'finished_goods'      THEN user_has_permission('inventory:read')
      WHEN 'inventory_lots'      THEN user_has_permission('inventory:read')
      WHEN 'keg_transactions'    THEN user_has_permission('inventory:read')
      WHEN 'packaging_sessions'  THEN user_has_permission('batches:read')
      WHEN 'allocations'         THEN user_has_permission('inventory:read')
      WHEN 'pricing_tier_prices' THEN user_has_permission('settings:manage')
      WHEN 'enum_values'         THEN user_has_permission('settings:manage')
      -- Fail closed: an entity_type nobody enumerated is admin-only.
      ELSE user_has_permission('settings:manage')
    END
  );

-- Re-stated because DROP POLICY discards the 00282 comment with the policy.
COMMENT ON POLICY entity_revisions_select ON entity_revisions IS
  'Reads inherit the tracked table''s own read permission: entity_type is mapped to the permission that table''s SELECT policy requires, and any unenumerated entity_type falls back to settings:manage (admin-only). Two settings tables (pricing_tier_prices, enum_values) map to settings:manage rather than to their own permissive SELECT policy, because their revision rows are full row images while their base SELECT policy admits any authenticated principal. Portal customers hold no staff permission and therefore read no revisions. Rows remain immutable — no UPDATE or DELETE policy exists — and writes continue via the SECURITY DEFINER trigger log_entity_revision().';
