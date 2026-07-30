-- 00282_revision_trigger_supplier_catalog_enum_values.sql
-- Preventive follow-up to #549: put `supplier_catalog` — and the one sibling
-- table that carries the same exposure, `enum_values` — under the same
-- append-only revision trail that 00019/00211/00213 gave the other ten
-- tracked tables.
--
-- THE GAP THIS CLOSES
-- 00252_merge_duplicate_suppliers.sql (applied live ~2026-07-15) resolved
-- `supplier_catalog`'s UNIQUE(supplier_id, catalog_type, catalog_id)
-- collisions by DELETEing the duplicate-loser row. The pre-fix version of that
-- migration dropped the loser's `is_preferred` flag on the floor; #494 added
-- the carry-forward, but only fresh replays benefit. The already-lost flags are
-- unrecoverable precisely because nothing recorded the deleted rows:
-- `supplier_catalog` is seeded by no migration, the MongoDB sync writes only
-- `suppliers` (src/integrations/mongodb/sync.ts:324), and — until this
-- migration — `entity_revisions` had no trigger on it. Every write path is a
-- deliberate human act (add / edit / remove a catalog row, mark a preferred
-- supplier: src/components/domain/purchasing/supplier-catalog-section.tsx,
-- src/domain/purchasing/supplier-catalog.ts), so a row that disappears is
-- information nothing else in the system holds. `is_preferred` in particular
-- has no derivable ground truth: it defaults false and drives the DISTINCT ON
-- supplier resolution behind the shortfall views.
--
-- After this migration every INSERT/UPDATE/DELETE on `supplier_catalog` and
-- `enum_values` writes an `entity_revisions` row (entity_type = the table name,
-- changed_by = auth.uid(), full old_data/new_data jsonb), so the next
-- destructive data migration or hand-edit is reconstructible from the ledger.
-- This does NOT repair the flags already lost in July — that needs a human with
-- live credentials and a pre-2026-07-15 PITR clone, so #549 stays open for it.
--
-- WHY A TRIGGER, NOT NEW COLUMNS
-- Same reasoning as 00213: `log_entity_revision()` (00019) already records the
-- actor and the complete row image per change, so no created_by / updated_by
-- columns are needed on the base table — and unlike such columns, the trail
-- survives DELETE, which is the loss mode #549 actually hit.
--
-- SIBLING SWEEP (enumerated, not asserted)
-- The exposure being fixed is "a one-shot data migration or hand-edit destroys
-- a human decision and leaves no trail". Every `DELETE FROM` in
-- supabase/migrations was classified by whether it sits at the top level of a
-- migration (runs once, against live data) or inside a dollar-quoted function
-- body (an app-path delete that runs on every call). Of 35 statements, 25 are
-- inside function bodies and 10 are top level. An earlier draft of this header
-- claimed "all but two run inside function bodies" — that was wrong, and the
-- full list is written out below so the next reader does not have to trust it.
--
-- The 25 app-path deletes are not candidates: they sit in the recipe-save,
-- order-change, MongoDB-sync and packaging functions (00020, 00094, 00241,
-- 00250, 00258, 00259, 00261, 00263, 00265) and touch notifications,
-- order_items, order_materials, bin_inventory, recipe_malts / hops / yeasts /
-- adjuncts / sugars / spices / fruits / additions, session_line_items,
-- batch_logs, brew_log_batches and mongodb_sync_mappings. Their parent rows are
-- already tracked and their churn is high enough that a full-row ledger per
-- write would be pure write amplification.
--
-- The 10 top-level one-shot deletes, in full:
--
--   00002:162   _schema_registry    ('breweries', 'user_breweries')
--   00038:10    enum_values         WHERE enum_type = 'po_status'
--   00039:15    enum_values         WHERE enum_type = 'batch_status'
--   00039:29    enum_values         WHERE enum_type = 'order_status'
--   00044:14    _schema_registry    WHERE table_name = 'settings'
--   00050:6     enum_values         WHERE enum_type = 'vessel_status'
--   00077:285   _schema_registry    ('price_tiers', 'tier_prices', ...)
--   00242:51    square_catalog_map  (duplicate cleanup)
--   00252:64    supplier_catalog    <- the #549 incident
--   00252:86    suppliers
--
-- INCLUDED HERE
--  * `supplier_catalog` (00252:64) — the incident itself.
--  * `enum_values` (00038:10, 00039:15, 00039:29, 00050:6) — delete-and-reseed
--    by `enum_type`, four separate times. `enum_values` is a registered,
--    user-editable entity (src/entities/enum-value/core.ts, surfaced at
--    /settings/status-options) whose form lets an admin set label, description,
--    color, icon, sort_order, group_name, is_default, is_active and metadata,
--    and whose rows drive dropdowns app-wide (src/hooks/use-brew-enums.ts). A
--    wholesale reseed destroys those human edits with no trail: exactly the
--    #549 loss mode, on a table where it has already happened four times.
--    Churn is negligible — no integration writes it. Every write in the chain
--    is a top-level migration statement (00037/00038/00039/00045/00050/00052/
--    00232/00260) and the only runtime writer is the admin settings UI, so a
--    full row ledger costs nothing.
--
-- EXCLUDED, with the reason for each
--  * `_schema_registry` (00002, 00044, 00077) — cannot take this trigger at
--    all: its primary key is `table_name TEXT` and it has no `id` column
--    (00001:16-26), so log_entity_revision()'s COALESCE(NEW.id, OLD.id) raises
--    `record "new" has no field "id"`. It is also machine-authored schema
--    metadata that no user edits and that the migration chain regenerates, so
--    there is no human decision to lose.
--  * `suppliers` (00252:86) — same incident, still deliberately excluded.
--    `syncSuppliers` upserts every Mongo supplier document on every sync run
--    (src/integrations/mongodb/sync.ts:324), so an AFTER UPDATE trigger would
--    append one revision row per supplier per run, nearly all recording no
--    change. Supplier deletions therefore still have no trail. Tracked in #694;
--    ponytail: the cheap fix there is a DELETE-only trigger (deletion is the
--    loss mode, not edit), not the full trigger used here.
--  * `square_catalog_map` (00242:51) — machine-derived Square object ids, fully
--    re-derivable by re-running the catalog push, and rewritten by the
--    integration on every sync.
--
-- The other tables carrying a comparable preference/default flag were checked
-- against the same list — `locations.is_primary`, `bins.is_default_fg`,
-- `pricing_tiers.is_default`, `recipe_yeasts.is_primary`,
-- `recipe_additions.is_default`: no top-level one-shot delete touches any of
-- them. `enum_values.is_default` was in that list and did NOT survive the
-- check, which is why `enum_values` is included above rather than excluded.
--
-- LOCKS THIS MIGRATION TAKES (measured on PostgreSQL 15 via pg_locks inside a
-- rolled-back transaction; live is 17, and none of these lock levels differ
-- between the two)
--   CREATE TRIGGER              -> SHARE ROW EXCLUSIVE on the target table
--                                  (it was ACCESS EXCLUSIVE only before PG 11)
--   DROP TRIGGER IF EXISTS      -> no lock at all when the trigger is absent
--   DROP POLICY / CREATE POLICY -> ACCESS EXCLUSIVE on `entity_revisions`
-- So the heaviest lock here is NOT on supplier_catalog or enum_values: it is
-- the ACCESS EXCLUSIVE on `entity_revisions`, taken by the policy re-statement
-- and held until COMMIT. Every write to all twelve tracked tables INSERTs into
-- `entity_revisions`, so that lock briefly pauses tracked writes app-wide, not
-- just writes to the two tables gaining a trigger. The migration does no data
-- work, so the window is short — but apply it off peak. An earlier draft of
-- this header claimed "no lock beyond the brief ACCESS EXCLUSIVE that CREATE
-- TRIGGER takes"; that was wrong on both halves.
--
-- Otherwise purely additive: no data change and no schema change.
--
-- WHAT THE SECURITY DEFINER TRIGGER DOES AND DOES NOT GUARANTEE
-- `log_entity_revision()` is SECURITY DEFINER (00019:85), so its INSERT runs as
-- the function's owner (`postgres`), which owns `entity_revisions` and is
-- therefore not subject to that table's RLS policies — no table in this schema
-- sets FORCE ROW LEVEL SECURITY. SECURITY DEFINER alone would not achieve
-- that: RLS is evaluated against the definer role, so a definer that held
-- neither ownership nor BYPASSRLS would still be checked against
-- `entity_revisions_insert` (`WITH CHECK (changed_by = (SELECT auth.uid()))`,
-- 00102:18), which evaluates to NULL -> deny whenever auth.uid() is NULL, as it
-- is inside a migration. And because these are AFTER ROW triggers, any error
-- the function raises aborts the triggering statement. The correct claim is
-- narrow: under the current ownership the trail cannot be blocked by *RLS*. It
-- is not unconditionally incapable of blocking a write, which an earlier draft
-- of this header asserted.
--
-- Heads up for anyone following the "mirroring 00213" pointer above: 00213's
-- own header carries both of the claims corrected here — "inserts into
-- entity_revisions regardless of caller RLS, so these triggers never block a
-- legitimate write" (00213:20-21) and "no lock beyond the brief ACCESS
-- EXCLUSIVE for CREATE TRIGGER" (00213:26-27). 00213 is already applied live
-- and is not edited here; read this section instead of that one.
--
-- `entity_revisions.entity_type` is free text (only `operation` is
-- constrained), so no allow-list changes. Both tables gaining a trigger have
-- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
-- (00010_unified_allocations.sql:34, 00037_enum_registry.sql:13), which
-- log_entity_revision() requires via COALESCE(NEW.id, OLD.id).
--
-- NOT YET APPLIED LIVE
-- This file is committed, not pushed: applying it needs an operator with
-- SUPABASE_DB_URL running scripts/db-push.sh. Until then the live ledger has no
-- supplier_catalog or enum_values coverage and a destructive edit made before
-- the push is still untraceable. Nothing in CI detects that gap — the
-- live-drift watchdog compares live against the committed snapshot, and both
-- are post-apply artifacts. Tracked in #693.
--
-- Refs #549.

DROP TRIGGER IF EXISTS tr_supplier_catalog_revision ON supplier_catalog;
CREATE TRIGGER tr_supplier_catalog_revision
  AFTER INSERT OR UPDATE OR DELETE ON supplier_catalog
  FOR EACH ROW EXECUTE FUNCTION log_entity_revision();

COMMENT ON TRIGGER tr_supplier_catalog_revision ON supplier_catalog IS
  'Appends an entity_revisions row (entity_type = supplier_catalog) for every INSERT/UPDATE/DELETE, so supplier-preference and pricing rows destroyed by a data migration or hand-edit stay reconstructible (#549).';

DROP TRIGGER IF EXISTS tr_enum_values_revision ON enum_values;
CREATE TRIGGER tr_enum_values_revision
  AFTER INSERT OR UPDATE OR DELETE ON enum_values
  FOR EACH ROW EXECUTE FUNCTION log_entity_revision();

COMMENT ON TRIGGER tr_enum_values_revision ON enum_values IS
  'Appends an entity_revisions row (entity_type = enum_values) for every INSERT/UPDATE/DELETE. Migrations 00038, 00039 and 00050 already delete-and-reseeded this table wholesale by enum_type four times, discarding admin-set labels, colors, sort_order and is_default with no trail — the same loss mode as #549.';

-- ---------------------------------------------------------------------------
-- Read authorization for the two new entity_types.
-- ---------------------------------------------------------------------------
-- `entity_revisions` rows are full row copies, so 00275 gates SELECT on the
-- permission the tracked table's own SELECT policy requires, with an
-- ELSE branch of settings:manage so an unenumerated entity_type is admin-only.
-- docs/data-model/system.md requires the CASE branch to land in the same
-- migration as the trigger, so the policy is re-stated here with both new
-- entity_types added. Every other branch, the ELSE fallback, the
-- `TO authenticated` grant and the absence of UPDATE/DELETE policies are
-- carried over from 00275 verbatim; the restrictive `current_user_enabled`
-- policy (00255) is untouched and still ANDs in.
--
--  * supplier_catalog -> purchasing:read is a literal mirror of
--    `supplier_catalog_select` (00097:366), the same permission already used
--    for `purchase_orders` revisions.
--  * enum_values -> settings:manage is deliberately NOT a literal mirror.
--    `enum_values_select` is `(SELECT auth.uid()) IS NOT NULL` (00097 section
--    5k), and mirroring that literally would reopen the exact hole 00275
--    closed: portal customers are authenticated, so they would read the full
--    row images. Writing `enum_values` is already gated on settings:manage by
--    `enum_values_write`, and 00275 made the same call for
--    `pricing_tier_prices`, which comes out of the same catalog policy loop.
--    This branch is therefore behaviourally identical to the fail-closed ELSE;
--    it is spelled out because system.md requires a branch per tracked table,
--    and because silence would read as an oversight rather than a decision.

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

-- Re-stated because DROP POLICY discards the 00275 comment with the policy.
COMMENT ON POLICY entity_revisions_select ON entity_revisions IS
  'Reads inherit the tracked table''s own read permission: entity_type is mapped to the permission that table''s SELECT policy requires, and any unenumerated entity_type falls back to settings:manage (admin-only). Two settings tables (pricing_tier_prices, enum_values) map to settings:manage rather than to their own permissive SELECT policy, because their revision rows are full row images while their base SELECT policy admits any authenticated principal. Portal customers hold no staff permission and therefore read no revisions. Rows remain immutable — no UPDATE or DELETE policy exists — and writes continue via the SECURITY DEFINER trigger log_entity_revision().';
