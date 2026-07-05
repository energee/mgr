-- =============================================================================
-- 00168 — Recreate keg_inventory_with_details for selling_formats schema
-- =============================================================================
-- Migration 00155 dropped keg_inventory_with_details and only recreated it
-- inside an `IF keg_types EXISTS` guard. The keg_types table was removed when
-- keg formats were unified into selling_formats / containers, so the view was
-- never recreated. PostgREST returns PGRST205 ("table not found") which surfaces
-- in the UI as "Failed to load keg inventory" on /inventory/kegs.
--
-- This migration rebuilds the view against the current schema:
--   keg_inventory.selling_format_id -> selling_formats -> containers (volume_bbl)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. DRIFT HOIST (added retroactively — see PR #322)
-- -----------------------------------------------------------------------------
-- The keg_inventory view was redefined directly in the live DB during the
-- packaging-formats refactor (keg_type_id -> selling_format_id) before this
-- migration ran; 00191 captures that definition as a no-op re-statement.
-- A from-scratch replay still has the 00155-era shape here, so re-state the
-- live definition (verbatim from 00191) first. CASCADE drops of dependent
-- views are safe: nothing in 00169-00189 references them and 00191 recreates
-- them.
DROP VIEW IF EXISTS keg_inventory CASCADE;

CREATE OR REPLACE VIEW public.keg_inventory
WITH (security_invoker = true) AS
 WITH inflows AS (
         SELECT keg_transactions.selling_format_id,
            keg_transactions.keg_owner_id,
            keg_transactions.to_state AS state,
            keg_transactions.to_location_id AS location_id,
            keg_transactions.batch_id,
            keg_transactions.finished_good_id,
            sum(keg_transactions.quantity) AS qty
           FROM keg_transactions
          GROUP BY keg_transactions.selling_format_id, keg_transactions.keg_owner_id, keg_transactions.to_state, keg_transactions.to_location_id, keg_transactions.batch_id, keg_transactions.finished_good_id
        ), outflows AS (
         SELECT keg_transactions.selling_format_id,
            keg_transactions.keg_owner_id,
            keg_transactions.from_state AS state,
            keg_transactions.from_location_id AS location_id,
            keg_transactions.batch_id,
            keg_transactions.finished_good_id,
            sum(keg_transactions.quantity) AS qty
           FROM keg_transactions
          WHERE keg_transactions.from_state IS NOT NULL
          GROUP BY keg_transactions.selling_format_id, keg_transactions.keg_owner_id, keg_transactions.from_state, keg_transactions.from_location_id, keg_transactions.batch_id, keg_transactions.finished_good_id
        ), combined AS (
         SELECT sub.selling_format_id,
            sub.keg_owner_id,
            sub.state,
            sub.location_id,
            sub.batch_id,
            sub.finished_good_id,
            COALESCE(sum(sub.qty), 0::numeric) AS quantity
           FROM ( SELECT inflows.selling_format_id,
                    inflows.keg_owner_id,
                    inflows.state,
                    inflows.location_id,
                    inflows.batch_id,
                    inflows.finished_good_id,
                    inflows.qty
                   FROM inflows
                UNION ALL
                 SELECT outflows.selling_format_id,
                    outflows.keg_owner_id,
                    outflows.state,
                    outflows.location_id,
                    outflows.batch_id,
                    outflows.finished_good_id,
                    - outflows.qty
                   FROM outflows) sub
          GROUP BY sub.selling_format_id, sub.keg_owner_id, sub.state, sub.location_id, sub.batch_id, sub.finished_good_id
         HAVING COALESCE(sum(sub.qty), 0::numeric) > 0::numeric
        )
 SELECT md5((((((((((COALESCE(selling_format_id::text, ''::text) || ':'::text) || COALESCE(keg_owner_id::text, ''::text)) || ':'::text) || COALESCE(state::text, ''::text)) || ':'::text) || COALESCE(location_id::text, ''::text)) || ':'::text) || COALESCE(batch_id::text, ''::text)) || ':'::text) || COALESCE(finished_good_id::text, ''::text))::uuid AS id,
    selling_format_id,
    keg_owner_id,
    state,
    location_id,
    quantity::integer AS quantity,
    batch_id,
    finished_good_id
   FROM combined;

DROP VIEW IF EXISTS keg_inventory_with_details CASCADE;

CREATE VIEW keg_inventory_with_details
WITH (security_invoker = true)
AS
SELECT
  ki.id,
  ki.selling_format_id,
  ki.keg_owner_id,
  ki.state,
  ki.location_id,
  ki.quantity,
  ki.batch_id,
  ki.finished_good_id,
  sf.name           AS keg_type_name,
  c.volume_bbl      AS volume_bbl,
  ko.name           AS keg_owner_name,
  ko.code           AS keg_owner_code,
  l.name            AS location_name,
  b.batch_code      AS batch_code,
  fg_brand.name     AS finished_good_name
FROM keg_inventory ki
JOIN selling_formats sf ON sf.id = ki.selling_format_id
LEFT JOIN containers c ON c.id = sf.container_id
LEFT JOIN keg_owners ko ON ko.id = ki.keg_owner_id
LEFT JOIN locations l ON l.id = ki.location_id
LEFT JOIN batches b ON b.id = ki.batch_id
LEFT JOIN finished_goods fg ON fg.id = ki.finished_good_id
LEFT JOIN brands fg_brand ON fg_brand.id = fg.brand_id;

COMMENT ON VIEW keg_inventory_with_details IS
  'Keg inventory with joined display names (selling_format/container/owner/location/batch/brand).';

-- Refresh PostgREST schema cache so the new view is visible immediately.
NOTIFY pgrst, 'reload schema';
