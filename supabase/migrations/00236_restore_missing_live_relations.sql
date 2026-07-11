-- Migration: 00236_restore_missing_live_relations
--
-- Restores relations found MISSING from the live database on 2026-07-10
-- during a site verification sweep (verified via pg_class — genuinely absent,
-- not stale PostgREST cache). Live↔chain drift repair; no behavioral change
-- vs the chain except where the chain's own definition references schema that
-- no longer exists anywhere (documented inline, following the 00168 precedent
-- of rebuilding keg views against the selling_formats/containers schema).
--
-- Every statement is idempotent under BOTH:
--   (a) the live database, where these objects are missing, and
--   (b) a from-scratch chain replay (db-lint gate), where earlier migrations
--       already created them in their historical shapes.
--
-- RESTORED here (source migrations per block):
--   * order_change_requests        — table/trigger/indexes: 00092;
--                                    staff policies: 00197; customer SELECT:
--                                    00092; customer INSERT: 00095 (guarded —
--                                    references customer_portal_users, which
--                                    is itself absent on live)
--   * order_change_request_items   — table/index: 00092; FK indexes: 00129/
--                                    00136; staff policies: 00197; customer
--                                    policies: 00092. Shape modernized:
--                                    package_type_id/keg_type_id (FKs to the
--                                    long-dropped package_types/keg_types)
--                                    replaced by selling_format_id, which is
--                                    what the app reads and writes
--                                    (change-request-builder.tsx,
--                                    change-request-review.tsx, portal order
--                                    page). Convergence ALTERs below make a
--                                    replay-built table match this shape.
--   * keg_transactions_with_details — view: 00155 (last writer; created there
--                                    inside an `IF keg_types EXISTS` guard that
--                                    no-ops on live). Rebuilt against
--                                    selling_formats/containers exactly as
--                                    00168 did for keg_inventory_with_details:
--                                    keg_type_id -> selling_format_id,
--                                    keg_type_name from selling_formats.name,
--                                    volume_bbl from containers; keg_type_code
--                                    dropped (no source column; 00168 did the
--                                    same); from_bin_id/to_bin_id added
--                                    (00220 columns, expected by
--                                    src/entities/keg-transaction/core.ts).
--
-- Also RESURRECTS three views accidentally CASCADE-dropped by later
-- migrations (00155/00157/00168/00189) and never recreated. For these the
-- chain's own final state was "absent" (chain bugs, not live drift — their
-- app pages 404 on a replay-built DB too), so this block is new state, not a
-- re-statement:
--   * inventory_low_stock_items  — only created 00096; CASCADE-dropped by
--                                  00157's (and 00189's) DROP VIEW
--                                  inventory_lots_with_quantities CASCADE.
--                                  Restored verbatim from the 00096 text.
--   * batches_with_blend_info    — last created 00086; CASCADE-dropped by
--                                  00155's DROP VIEW batches_with_brew_info
--                                  CASCADE (00072/00076/00086 each recreated
--                                  it after identical CASCADEs; 00155 forgot).
--                                  Restored verbatim from the 00086 text.
--   * keg_fleet_summary          — last created 00079; CASCADE-dropped by
--                                  00168's DROP VIEW keg_inventory CASCADE
--                                  (again 00207/00220/00228); never recreated.
--                                  The 00079 text references keg_types, so it
--                                  is rebuilt against selling_formats/
--                                  containers over the netted keg_inventory
--                                  view (00228), preserving the 00079 output
--                                  intent and every column consumed by
--                                  /inventory/kegs/reports.
--
-- NOT restored: apply_change_request() (00094) — deliberately deferred by
-- 00205 as backlog #10 (change-request rebuild); its body writes the dropped
-- order_items.package_type_id/keg_type_id columns, so restoring the chain body
-- would just re-break. The staff approve route (POST .../approve) stays broken
-- until that rebuild.

-- =============================================================================
-- 1. order_change_requests (from 00092; policies per 00197/00095)
-- =============================================================================

CREATE TABLE IF NOT EXISTS order_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  notes TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_change_requests_order ON order_change_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_change_requests_status ON order_change_requests(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_change_requests_requested_by ON order_change_requests(requested_by);

DROP TRIGGER IF EXISTS set_updated_at ON order_change_requests;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON order_change_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE order_change_requests ENABLE ROW LEVEL SECURITY;

-- Drop the legacy 00092 staff policies. 00197 intended to replace the staff
-- side with permission-based policies but dropped different policy NAMES than
-- 00092 created, so on a replay-built DB the permissive 00092 trio
-- (any user_profiles row => SELECT/INSERT/UPDATE) still OR-ed itself on top of
-- the tightened 00197 pair. Removing them here converges replay with 00197's
-- documented intent ("tighten staff side"). No-ops on live (table was absent).
DROP POLICY IF EXISTS change_requests_staff_select ON order_change_requests;
DROP POLICY IF EXISTS change_requests_staff_insert ON order_change_requests;
DROP POLICY IF EXISTS change_requests_staff_update ON order_change_requests;

-- Staff policies — verbatim 00197 shape.
DROP POLICY IF EXISTS order_change_requests_staff_select ON order_change_requests;
CREATE POLICY order_change_requests_staff_select ON order_change_requests
  FOR SELECT
  USING (user_has_permission('orders:read'));

DROP POLICY IF EXISTS order_change_requests_staff_write ON order_change_requests;
CREATE POLICY order_change_requests_staff_write ON order_change_requests
  FOR ALL
  USING (user_has_permission('orders:write'))
  WITH CHECK (user_has_permission('orders:write'));

-- Customer SELECT — verbatim 00092 shape (own requests only).
DROP POLICY IF EXISTS change_requests_customer_select ON order_change_requests;
CREATE POLICY change_requests_customer_select ON order_change_requests
  FOR SELECT TO authenticated
  USING (
    requested_by = (SELECT auth.uid())
  );

-- Customer INSERT — verbatim 00095 shape (customer_portal_users junction).
-- Guarded: customer_portal_users is ALSO missing from live (dropped
-- out-of-band after the 2026-02-26 audit; see 00197's guards), and a policy
-- referencing a missing table fails at CREATE time. On replay the junction
-- exists and the policy is (re)created; on live this block no-ops and the
-- portal customer INSERT path stays disabled until customer_portal_users is
-- itself restored.
DO $$
BEGIN
  IF to_regclass('public.customer_portal_users') IS NOT NULL THEN
    EXECUTE $sql$DROP POLICY IF EXISTS change_requests_customer_insert ON order_change_requests$sql$;
    EXECUTE $sql$CREATE POLICY change_requests_customer_insert ON order_change_requests
      FOR INSERT TO authenticated
      WITH CHECK (
        requested_by = (SELECT auth.uid())
        AND order_id IN (
          SELECT id FROM orders WHERE customer_id IN (
            SELECT customer_id FROM customer_portal_users WHERE user_id = (SELECT auth.uid())
          )
        )
      )$sql$;
  ELSE
    RAISE NOTICE 'customer_portal_users missing; skipping change_requests_customer_insert (portal customer INSERT path stays disabled on this database)';
  END IF;
END $$;

-- =============================================================================
-- 2. order_change_request_items (from 00092/00129/00136; policies per 00197)
-- =============================================================================
-- Modern shape: selling_format_id REFERENCES selling_formats replaces the
-- 00092 package_type_id/keg_type_id pair, whose FK targets (package_types /
-- keg_types) no longer exist on live. The app exclusively uses
-- selling_format_id, including a PostgREST embed (selling_formats(name)) that
-- requires a real FK.

CREATE TABLE IF NOT EXISTS order_change_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_request_id UUID NOT NULL REFERENCES order_change_requests(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('add', 'modify', 'remove')),
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  brand_id UUID REFERENCES brands(id),
  selling_format_id UUID REFERENCES selling_formats(id),
  quantity INTEGER,
  original_quantity INTEGER
);

-- Convergence ALTERs: on a replay-built DB the table pre-exists in its 00092
-- shape (package_type_id/keg_type_id, no selling_format_id), so the CREATE
-- above is skipped there. Bring that shape to the modern one. On live (table
-- just created above) all three statements no-op.
ALTER TABLE order_change_request_items
  ADD COLUMN IF NOT EXISTS selling_format_id UUID REFERENCES selling_formats(id);
-- Dropping the legacy columns also drops their FK constraints and the
-- 00129/00136 indexes on them (idx_order_change_request_items_package_type_id
-- / _keg_type_id) — those FK targets are gone, and no code reads the columns.
ALTER TABLE order_change_request_items DROP COLUMN IF EXISTS package_type_id;
ALTER TABLE order_change_request_items DROP COLUMN IF EXISTS keg_type_id;

-- Indexes: 00092 + the still-applicable 00129/00136 FK indexes + the FK-index
-- convention applied to the new selling_format_id column.
CREATE INDEX IF NOT EXISTS idx_change_request_items_request ON order_change_request_items(change_request_id);
CREATE INDEX IF NOT EXISTS idx_order_change_request_items_order_item_id ON order_change_request_items (order_item_id);
CREATE INDEX IF NOT EXISTS idx_order_change_request_items_brand_id ON order_change_request_items (brand_id);
CREATE INDEX IF NOT EXISTS idx_order_change_request_items_selling_format_id ON order_change_request_items (selling_format_id);

ALTER TABLE order_change_request_items ENABLE ROW LEVEL SECURITY;

-- Drop the legacy 00092 staff policies (same 00197 name-mismatch as above).
DROP POLICY IF EXISTS change_request_items_staff_select ON order_change_request_items;
DROP POLICY IF EXISTS change_request_items_staff_insert ON order_change_request_items;

-- Staff policies — verbatim 00197 shape.
DROP POLICY IF EXISTS order_change_request_items_staff_select ON order_change_request_items;
CREATE POLICY order_change_request_items_staff_select ON order_change_request_items
  FOR SELECT
  USING (user_has_permission('orders:read'));

DROP POLICY IF EXISTS order_change_request_items_staff_write ON order_change_request_items;
CREATE POLICY order_change_request_items_staff_write ON order_change_request_items
  FOR ALL
  USING (user_has_permission('orders:write'))
  WITH CHECK (user_has_permission('orders:write'));

-- Customer policies — verbatim 00092 shapes (scoped through the parent
-- request's requested_by; no customer_portal_users dependency).
DROP POLICY IF EXISTS change_request_items_customer_select ON order_change_request_items;
CREATE POLICY change_request_items_customer_select ON order_change_request_items
  FOR SELECT TO authenticated
  USING (
    change_request_id IN (
      SELECT id FROM order_change_requests
      WHERE requested_by = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS change_request_items_customer_insert ON order_change_request_items;
CREATE POLICY change_request_items_customer_insert ON order_change_request_items
  FOR INSERT TO authenticated
  WITH CHECK (
    change_request_id IN (
      SELECT id FROM order_change_requests
      WHERE requested_by = (SELECT auth.uid()) AND status = 'pending'
    )
  );

-- =============================================================================
-- 3. keg_transactions_with_details (from 00155, rebuilt per 00168 precedent)
-- =============================================================================
-- DROP + CREATE (not CREATE OR REPLACE): on a replay-built DB the 00155
-- version exists with a different column list (keg_type_id/keg_type_code, no
-- selling_format_id/bins), and CREATE OR REPLACE cannot rename or remove view
-- columns. Nothing else in the chain depends on this view, so a plain
-- non-CASCADE drop is safe.

DROP VIEW IF EXISTS keg_transactions_with_details;

CREATE VIEW keg_transactions_with_details
WITH (security_invoker = true)
AS
SELECT
  kt.id,
  kt.transaction_type,
  kt.selling_format_id,
  kt.quantity,
  kt.from_state,
  kt.to_state,
  kt.from_location_id,
  kt.to_location_id,
  kt.from_bin_id,
  kt.to_bin_id,
  kt.order_id,
  kt.customer_id,
  kt.packaging_session_id,
  kt.batch_id,
  kt.finished_good_id,
  kt.keg_owner_id,
  kt.notes,
  kt.created_by_name,
  kt.created_at,
  sf.name AS keg_type_name,
  c.volume_bbl,
  ko.name AS keg_owner_name,
  ko.code AS keg_owner_code,
  cust.name AS customer_name,
  o.order_number,
  b.batch_code,
  fg.lot_number AS finished_good_lot,
  fg_brand.name AS finished_good_brand,
  fg_brand.name AS finished_good_name,
  fl.name AS from_location_name,
  tl.name AS to_location_name,
  tl.name AS location_name
FROM keg_transactions kt
LEFT JOIN selling_formats sf ON sf.id = kt.selling_format_id
LEFT JOIN containers c ON c.id = sf.container_id
LEFT JOIN keg_owners ko ON ko.id = kt.keg_owner_id
LEFT JOIN customers cust ON cust.id = kt.customer_id
LEFT JOIN orders o ON o.id = kt.order_id
LEFT JOIN batches b ON b.id = kt.batch_id
LEFT JOIN finished_goods fg ON fg.id = kt.finished_good_id
LEFT JOIN brands fg_brand ON fg_brand.id = fg.brand_id
LEFT JOIN locations fl ON fl.id = kt.from_location_id
LEFT JOIN locations tl ON tl.id = kt.to_location_id
ORDER BY kt.created_at DESC;

COMMENT ON VIEW keg_transactions_with_details IS
  'Keg transactions with joined display names (selling_format/container/owner/customer/order/batch/brand/locations). 00155 shape rebuilt against selling_formats/containers (00236).';

-- =============================================================================
-- 4. Views accidentally CASCADE-dropped by later migrations, resurrected
-- =============================================================================
-- These do not exist on live OR on a replay-built DB (see header), so the
-- DROP VIEW IF EXISTS guards are pure belt-and-braces for hand-managed
-- environments.

-- 4a. inventory_low_stock_items — verbatim from 00096. Deps at this point in
-- the chain: inventory_items (00001+) and inventory_lots_with_quantities
-- (final shape 00189: il.* + item_name/received/allocated/remaining_quantity).
-- Consumed by src/app/(app)/dashboard/inventory/page.tsx
-- (id, name, category, unit, reorder_point, current_qty — all present).

DROP VIEW IF EXISTS inventory_low_stock_items;

CREATE VIEW inventory_low_stock_items
WITH (security_invoker = true)
AS
SELECT
  ii.id,
  ii.name,
  ii.category,
  ii.unit,
  ii.reorder_point,
  COALESCE(lq.current_qty, 0)::numeric AS current_qty
FROM inventory_items ii
LEFT JOIN (
  SELECT
    inventory_item_id,
    SUM(remaining_quantity) AS current_qty
  FROM inventory_lots_with_quantities
  GROUP BY inventory_item_id
) lq ON lq.inventory_item_id = ii.id
WHERE ii.reorder_point IS NOT NULL
  AND COALESCE(lq.current_qty, 0) <= ii.reorder_point;

-- 4b. batches_with_blend_info — verbatim from 00086 (including its COMMENT).
-- Deps at this point in the chain: batch_blends (table, live+replay),
-- batches_with_brew_info (final shape 00155 — b.* plus computed actual_og),
-- recipes, recipes_with_estimates (final shape 00218 — keeps id/est_ibu/
-- est_srm), batches.actual_fg/actual_abv (00001). Consumed by
-- batch-blend-dialog.tsx and batch-blend-history.tsx.

DROP VIEW IF EXISTS batches_with_blend_info;

CREATE VIEW batches_with_blend_info
WITH (security_invoker = true)
AS
WITH blended_away AS (
  SELECT
    bb.source_batch_id AS batch_id,
    COALESCE(SUM(bb.volume_bbl), 0) AS volume_blended_away_bbl
  FROM batch_blends bb
  GROUP BY bb.source_batch_id
),
blended_in AS (
  SELECT
    bb.blend_batch_id AS batch_id,
    COUNT(*) AS blend_source_count,
    SUM(bb.volume_bbl) AS blended_volume_in_bbl,
    ROUND(
      SUM(src.actual_og * bb.volume_bbl) FILTER (WHERE src.actual_og IS NOT NULL)
      / NULLIF(SUM(bb.volume_bbl) FILTER (WHERE src.actual_og IS NOT NULL), 0),
      3
    ) AS blended_og,
    ROUND(
      SUM(src.actual_fg * bb.volume_bbl) FILTER (WHERE src.actual_fg IS NOT NULL)
      / NULLIF(SUM(bb.volume_bbl) FILTER (WHERE src.actual_fg IS NOT NULL), 0),
      3
    ) AS blended_fg,
    ROUND(
      SUM(src.actual_abv * bb.volume_bbl) FILTER (WHERE src.actual_abv IS NOT NULL)
      / NULLIF(SUM(bb.volume_bbl) FILTER (WHERE src.actual_abv IS NOT NULL), 0),
      1
    ) AS blended_abv,
    ROUND(
      SUM(rwe.est_ibu * bb.volume_bbl) FILTER (WHERE rwe.est_ibu IS NOT NULL)
      / NULLIF(SUM(bb.volume_bbl) FILTER (WHERE rwe.est_ibu IS NOT NULL), 0)
    ) AS blended_ibu,
    ROUND(
      SUM(rwe.est_srm * bb.volume_bbl) FILTER (WHERE rwe.est_srm IS NOT NULL)
      / NULLIF(SUM(bb.volume_bbl) FILTER (WHERE rwe.est_srm IS NOT NULL), 0),
      1
    ) AS blended_srm,
    ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL) AS blend_source_recipes
  FROM batch_blends bb
  JOIN batches_with_brew_info src ON src.id = bb.source_batch_id
  LEFT JOIN recipes r ON r.id = src.recipe_id
  LEFT JOIN recipes_with_estimates rwe ON rwe.id = src.recipe_id
  GROUP BY bb.blend_batch_id
)
SELECT
  b.id,
  COALESCE(ba.volume_blended_away_bbl, 0) AS volume_blended_away_bbl,
  b.volume_bbl - COALESCE(ba.volume_blended_away_bbl, 0) AS available_volume_bbl,
  COALESCE(bi.blend_source_count, 0) AS blend_source_count,
  COALESCE(bi.blended_volume_in_bbl, 0) AS blended_volume_in_bbl,
  bi.blended_og,
  bi.blended_fg,
  bi.blended_abv,
  bi.blended_ibu,
  bi.blended_srm,
  bi.blend_source_recipes
FROM batches b
LEFT JOIN blended_away ba ON ba.batch_id = b.id
LEFT JOIN blended_in bi ON bi.batch_id = b.id;

COMMENT ON VIEW batches_with_blend_info IS 'Per-batch blend data: volume blended away, available volume, and weighted estimates from source batches blended in.';

-- 4c. keg_fleet_summary — 00079 output intent rebuilt against the modern
-- schema (same adaptation 00168 made for keg_inventory_with_details):
--   keg_types            -> selling_formats JOIN containers (c.type = 'keg')
--   kt.id/name           -> sf.id AS selling_format_id / sf.name AS keg_type_name
--                           (the page type FleetSummary in
--                           src/app/(app)/inventory/kegs/reports/page.tsx
--                           already expects selling_format_id, and its
--                           .order("keg_type_name") is preserved)
--   kt.volume_bbl        -> c.volume_bbl
--   kt.is_active         -> sf.is_active
--   keg_inventory        -> the netted keg_inventory view (00228:
--                           selling_format_id/keg_owner_id/state/location_id/
--                           quantity), same LEFT JOIN so zero-keg formats
--                           still get a row
--   deposit override     -> DROPPED: 00079's keg_owner_deposits join keyed on
--                           kod.keg_type_id, but that column diverged (live
--                           renamed it to selling_format_id out-of-band;
--                           replay still has the 00079 keg_type_id shape), so
--                           no single join compiles on both. No app code
--                           reads keg_owner_deposits today. deposit_amount
--                           falls back to containers.deposit_amount
--                           (NOT NULL DEFAULT 0), which also feeds
--                           deposits_outstanding.
-- All seven keg_state values used below exist since 00031; enum never altered.

DROP VIEW IF EXISTS keg_fleet_summary;

CREATE VIEW keg_fleet_summary
WITH (security_invoker = true)
AS
SELECT
  sf.id AS selling_format_id,
  sf.name AS keg_type_name,
  c.volume_bbl,
  ki.keg_owner_id,
  ko.name AS keg_owner_name,
  c.deposit_amount,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'empty'::keg_state), 0::bigint)::integer AS empty_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'filled'::keg_state), 0::bigint)::integer AS filled_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'shipped'::keg_state), 0::bigint)::integer AS shipped_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'returned_dirty'::keg_state), 0::bigint)::integer AS dirty_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'cleaning'::keg_state), 0::bigint)::integer AS cleaning_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'maintenance'::keg_state), 0::bigint)::integer AS maintenance_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'retired'::keg_state), 0::bigint)::integer AS retired_count,
  COALESCE(SUM(ki.quantity), 0::bigint)::integer AS total_kegs,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state <> ALL (ARRAY['retired'::keg_state, 'maintenance'::keg_state])), 0::bigint)::integer AS active_kegs,
  CASE
    WHEN COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state <> ALL (ARRAY['retired'::keg_state, 'maintenance'::keg_state])), 0::bigint) > 0
    THEN (COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = ANY (ARRAY['filled'::keg_state, 'shipped'::keg_state])), 0::bigint)::numeric
          / COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state <> ALL (ARRAY['retired'::keg_state, 'maintenance'::keg_state])), 1::bigint)::numeric
          * 100::numeric)::numeric(5,1)
    ELSE 0::numeric
  END AS utilization_pct,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'shipped'::keg_state), 0::bigint)::numeric
    * COALESCE(c.deposit_amount, 0::numeric) AS deposits_outstanding
FROM selling_formats sf
JOIN containers c ON c.id = sf.container_id AND c.type = 'keg'
LEFT JOIN keg_inventory ki ON ki.selling_format_id = sf.id
LEFT JOIN keg_owners ko ON ko.id = ki.keg_owner_id
WHERE sf.is_active = true
GROUP BY sf.id, sf.name, c.volume_bbl, c.deposit_amount,
         ki.keg_owner_id, ko.name
ORDER BY sf.name;

COMMENT ON VIEW keg_fleet_summary IS
  'Fleet counts/utilization/deposits by keg selling format (and owner dimension), netted from keg_inventory. 00079 shape rebuilt against selling_formats/containers (00236); per-owner deposit overrides dropped — deposits use containers.deposit_amount.';

-- =============================================================================
-- 5. _schema_registry rows (from 00092, relationships updated for the modern
--    selling_format_id column)
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, state_machine, query_examples)
VALUES
  ('order_change_requests', 'Customer-submitted change requests for orders. Requires admin approval.', 'sales',
   '["belongs_to: orders", "belongs_to: auth.users (requested_by)", "has_many: order_change_request_items"]'::jsonb,
   '["order_id", "status", "requested_by"]'::jsonb,
   '{"stateField": "status", "states": ["pending", "approved", "rejected", "cancelled"]}'::jsonb,
   '["Show pending change requests", "Show change requests for order X"]'::jsonb),
  ('order_change_request_items', 'Individual line-item changes within a change request (add/modify/remove).', 'sales',
   '["belongs_to: order_change_requests", "references: order_items", "references: brands", "references: selling_formats"]'::jsonb,
   '["change_request_id", "change_type", "order_item_id"]'::jsonb,
   NULL,
   '["Show items in change request X"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  state_machine = EXCLUDED.state_machine,
  query_examples = EXCLUDED.query_examples;

-- =============================================================================
-- 6. Refresh PostgREST schema cache (pattern per 00168)
-- =============================================================================

NOTIFY pgrst, 'reload schema';
