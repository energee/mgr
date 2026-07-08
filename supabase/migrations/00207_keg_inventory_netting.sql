-- 00207_keg_inventory_netting.sql
-- Audit fix H4 (backlog #11): keg_inventory fleet counts inflate monotonically.
--
-- The keg_inventory view (00168, live-verified via 00191) grouped keg legs by
-- (selling_format, keg_owner, state, location, batch_id, finished_good_id) with
-- HAVING sum > 0. batch_id/finished_good_id are keg *contents*, not keg identity,
-- and the transaction writer tags them inconsistently across legs:
--   * create_finished_goods_from_packaging (fill) sets batch_id+finished_good_id
--     on BOTH the empty→ and →filled legs, so the negative "empty" leg lands in
--     (empty, batch, fg) — a group with no positive counterpart — and is dropped
--     by HAVING; the empty pool (empty, NULL, NULL) is never decremented.
--   * create_keg_ship_transactions_from_order (ship) sets neither, so the
--     negative "filled" leg (filled, NULL, NULL) never nets against the fill's
--     (filled, batch, fg) inflow; the filled pool is never decremented either.
-- Net effect: receive 50 → fill 10 → ship 10 reports 70 kegs of a 50-keg fleet.
--
-- Fix: keg identity is (selling_format, keg_owner, state, location). Drop
-- batch_id/finished_good_id from the pool grouping so fill/ship legs net. Contents
-- (which batch/brand a filled keg holds) are a separate concern the aggregate pool
-- cannot express once netted, so keg_inventory_with_details drops its batch_code /
-- finished_good_name columns. The one consumer that needs filled-keg contents (the
-- Square catalog inventory sync) reads the new keg_filled_contents view instead.
--
-- Live impact: zero (1 keg_transaction exists). Correctness fix, not data repair.
--
-- CASCADE note: keg_inventory_summary and keg_inventory_with_details both depend
-- on keg_inventory; the summary references only (selling_format_id, state,
-- quantity) so it is recreated verbatim (and now nets correctly for free).

DROP VIEW IF EXISTS keg_inventory CASCADE;

-- -----------------------------------------------------------------------------
-- keg_inventory: physical keg counts by (selling_format, owner, state, location)
-- -----------------------------------------------------------------------------
CREATE VIEW public.keg_inventory
WITH (security_invoker = true) AS
 WITH inflows AS (
         SELECT keg_transactions.selling_format_id,
            keg_transactions.keg_owner_id,
            keg_transactions.to_state AS state,
            keg_transactions.to_location_id AS location_id,
            sum(keg_transactions.quantity) AS qty
           FROM keg_transactions
          GROUP BY keg_transactions.selling_format_id, keg_transactions.keg_owner_id, keg_transactions.to_state, keg_transactions.to_location_id
        ), outflows AS (
         SELECT keg_transactions.selling_format_id,
            keg_transactions.keg_owner_id,
            keg_transactions.from_state AS state,
            keg_transactions.from_location_id AS location_id,
            sum(keg_transactions.quantity) AS qty
           FROM keg_transactions
          WHERE keg_transactions.from_state IS NOT NULL
          GROUP BY keg_transactions.selling_format_id, keg_transactions.keg_owner_id, keg_transactions.from_state, keg_transactions.from_location_id
        ), combined AS (
         SELECT sub.selling_format_id,
            sub.keg_owner_id,
            sub.state,
            sub.location_id,
            COALESCE(sum(sub.qty), 0::numeric) AS quantity
           FROM ( SELECT inflows.selling_format_id, inflows.keg_owner_id, inflows.state, inflows.location_id, inflows.qty
                   FROM inflows
                UNION ALL
                 SELECT outflows.selling_format_id, outflows.keg_owner_id, outflows.state, outflows.location_id, - outflows.qty
                   FROM outflows) sub
          GROUP BY sub.selling_format_id, sub.keg_owner_id, sub.state, sub.location_id
         HAVING COALESCE(sum(sub.qty), 0::numeric) > 0::numeric
        )
 SELECT md5((((((COALESCE(selling_format_id::text, ''::text) || ':'::text) || COALESCE(keg_owner_id::text, ''::text)) || ':'::text) || COALESCE(state::text, ''::text)) || ':'::text) || COALESCE(location_id::text, ''::text))::uuid AS id,
    selling_format_id,
    keg_owner_id,
    state,
    location_id,
    quantity::integer AS quantity
   FROM combined;

COMMENT ON VIEW keg_inventory IS
  'Physical keg counts by (selling_format, keg_owner, state, location), netted from keg_transactions. Contents (batch/finished good) are intentionally excluded from the grouping so fill and ship legs net — see keg_filled_contents for filled-keg brand breakdown.';

-- -----------------------------------------------------------------------------
-- keg_inventory_with_details: keg_inventory + joined display names
-- -----------------------------------------------------------------------------
CREATE VIEW keg_inventory_with_details
WITH (security_invoker = true) AS
SELECT
  ki.id,
  ki.selling_format_id,
  ki.keg_owner_id,
  ki.state,
  ki.location_id,
  ki.quantity,
  sf.name           AS keg_type_name,
  c.volume_bbl      AS volume_bbl,
  ko.name           AS keg_owner_name,
  ko.code           AS keg_owner_code,
  l.name            AS location_name
FROM keg_inventory ki
JOIN selling_formats sf ON sf.id = ki.selling_format_id
LEFT JOIN containers c ON c.id = sf.container_id
LEFT JOIN keg_owners ko ON ko.id = ki.keg_owner_id
LEFT JOIN locations l ON l.id = ki.location_id;

COMMENT ON VIEW keg_inventory_with_details IS
  'Keg inventory (physical counts) with joined display names (selling_format/container/owner/location). Batch/brand contents dropped in 00207 — a netted pool row can span multiple batches; use keg_filled_contents for filled-keg brand breakdown.';

-- -----------------------------------------------------------------------------
-- keg_inventory_summary: per-format state breakdown (recreated verbatim after
-- the CASCADE drop; references only selling_format_id/state/quantity)
-- -----------------------------------------------------------------------------
CREATE VIEW keg_inventory_summary
WITH (security_invoker = true) AS
 SELECT sf.id AS selling_format_id,
    c.name AS keg_type_name,
    c.volume_bbl,
    COALESCE(sum(ki.quantity) FILTER (WHERE ki.state = 'empty'::keg_state), 0::bigint) AS empty_count,
    COALESCE(sum(ki.quantity) FILTER (WHERE ki.state = 'filled'::keg_state), 0::bigint) AS filled_count,
    COALESCE(sum(ki.quantity) FILTER (WHERE ki.state = 'shipped'::keg_state), 0::bigint) AS shipped_count,
    COALESCE(sum(ki.quantity) FILTER (WHERE ki.state = 'returned_dirty'::keg_state), 0::bigint) AS dirty_count,
    COALESCE(sum(ki.quantity) FILTER (WHERE ki.state = 'cleaning'::keg_state), 0::bigint) AS cleaning_count,
    COALESCE(sum(ki.quantity) FILTER (WHERE ki.state = 'maintenance'::keg_state), 0::bigint) AS maintenance_count,
    COALESCE(sum(ki.quantity) FILTER (WHERE ki.state = 'retired'::keg_state), 0::bigint) AS retired_count,
    COALESCE(sum(ki.quantity), 0::bigint) AS total_count
   FROM selling_formats sf
     JOIN containers c ON c.id = sf.container_id AND c.type = 'keg'::text
     LEFT JOIN keg_inventory ki ON sf.id = ki.selling_format_id
  GROUP BY sf.id, c.name, c.volume_bbl
  ORDER BY c.volume_bbl DESC NULLS LAST;

-- -----------------------------------------------------------------------------
-- keg_filled_contents: filled kegs by contents (finished good / brand), for the
-- Square catalog inventory sync. Nets filled-state legs by finished_good_id.
--
-- LIMITATION: the ship writer (create_keg_ship_transactions_from_order) does not
-- record contents (finished_good_id is NULL on ship legs), so this is NOT
-- decremented when filled kegs ship — it reproduces the pre-00207 keg_inventory
-- filled-by-brand behavior ("ever filled by brand"). Correctly netting outbound
-- filled kegs requires the ship writer to carry contents forward (a separate
-- fix); until then Square keg counts can over-report shipped-out inventory, as
-- they did before this migration.
-- -----------------------------------------------------------------------------
CREATE VIEW keg_filled_contents
WITH (security_invoker = true) AS
 WITH legs AS (
         SELECT keg_transactions.selling_format_id,
            keg_transactions.to_location_id AS location_id,
            keg_transactions.finished_good_id,
            keg_transactions.quantity AS qty
           FROM keg_transactions
          WHERE keg_transactions.to_state = 'filled'::keg_state
            AND keg_transactions.finished_good_id IS NOT NULL
        UNION ALL
         SELECT keg_transactions.selling_format_id,
            keg_transactions.from_location_id AS location_id,
            keg_transactions.finished_good_id,
            - keg_transactions.quantity AS qty
           FROM keg_transactions
          WHERE keg_transactions.from_state = 'filled'::keg_state
            AND keg_transactions.finished_good_id IS NOT NULL
        )
 SELECT legs.selling_format_id,
    legs.location_id,
    legs.finished_good_id,
    fg.brand_id,
    sum(legs.qty)::integer AS quantity
   FROM legs
     JOIN finished_goods fg ON fg.id = legs.finished_good_id
  GROUP BY legs.selling_format_id, legs.location_id, legs.finished_good_id, fg.brand_id
 HAVING sum(legs.qty) > 0;

COMMENT ON VIEW keg_filled_contents IS
  'Filled kegs by (selling_format, location, finished_good, brand), for the Square inventory sync. Not decremented on ship (ship legs carry no contents) — see the migration comment; reproduces pre-00207 filled-by-brand behavior.';

-- Refresh PostgREST schema cache so the changed views are visible immediately.
NOTIFY pgrst, 'reload schema';
