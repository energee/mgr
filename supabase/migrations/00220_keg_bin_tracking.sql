-- 00220_keg_bin_tracking.sql
-- Square POS bin-sync, Milestone A: give the keg fleet a BIN dimension.
--
-- WHY THIS EXISTS
--   Non-keg finished goods already live in bins (bin_inventory, writer added in
--   00219). Kegs do NOT: keg stock is netted from keg_transactions by 00207
--   (keg_inventory / keg_inventory_with_details / keg_inventory_summary /
--   keg_filled_contents, all security_invoker). Those views carry a *location*
--   dimension but no *bin* dimension, so the later per-bin Square sync cannot see
--   which bin an on-premise keg sits in (empties -> filled -> cold-room -> shipped).
--   This migration adds a bin dimension to the keg fleet, exactly parallel to the
--   existing location dimension.
--
--   NULLABLE BY DESIGN: bin_id is nullable. Off-premise kegs (shipped out, sitting
--   at a customer) are in NO bin -- their to_bin_id/from_bin_id is NULL and they
--   net normally into a "no bin" group. Only on-premise kegs carry a bin.
--
--   THE BIN FOLLOWS THE KEG: mirroring from_location_id/to_location_id, each keg
--   transaction gains from_bin_id (the bin the kegs left) and to_bin_id (the bin
--   they entered). The netted views take the bin from the inflow leg's to_bin_id
--   and the outflow leg's from_bin_id, exactly as they already do for location.
--
--   CALLER COMPATIBILITY: record_keg_transaction (00190) gains two params, but they
--   are APPENDED at the end of the parameter list with DEFAULT NULL, so every
--   existing positional and named caller keeps working untouched. The body is
--   otherwise byte-identical to 00190 (two INSERT columns + two VALUES added).
--
--   A6 -- NO BACKFILL: existing keg_transactions rows keep from_bin_id/to_bin_id =
--   NULL. There is no lossy guessing of which bin historical kegs were in; a
--   pre-existing keg simply shows "no bin" in the netted views until its next
--   transaction records a bin. This is intentional -- inventing a bin per
--   historical leg would fabricate placement the physical fleet never had.
--
--   FK ON DELETE: from_bin_id/to_bin_id use ON DELETE SET NULL, matching the
--   from_location_id/to_location_id FKs (00060) and packaging_sessions.default_bin_id
--   (00219). Deleting a bin nulls the historical reference (leg becomes "no bin")
--   rather than destroying the keg-movement history or blocking the bin delete.
--
--   The set_keg_transaction_states BEFORE INSERT trigger (00190) is UNCHANGED: it
--   derives from_state/to_state from transaction_type and is untouched here.
--
-- Live-safe: additive nullable columns + FK indexes, an append-only signature
-- change to record_keg_transaction, and CREATE-OR-REPLACE / drop-recreate of the
-- 00207 views with bin_id added as a grouping/output dimension parallel to
-- location. Verified by a self-rolling-back DO block at the end (commits NO rows).

-- =============================================================================
-- A1 -- schema: bin columns on keg_transactions (parallel to location columns)
-- =============================================================================

ALTER TABLE keg_transactions
  ADD COLUMN IF NOT EXISTS from_bin_id UUID REFERENCES bins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_bin_id   UUID REFERENCES bins(id) ON DELETE SET NULL;

COMMENT ON COLUMN keg_transactions.from_bin_id IS
  'Bin the kegs moved OUT of (outflow leg). NULL for off-premise kegs (at a customer, in no bin) or when bin is unknown. Parallel to from_location_id; netted by keg_inventory (00220) exactly as location is.';
COMMENT ON COLUMN keg_transactions.to_bin_id IS
  'Bin the kegs moved INTO (inflow leg). NULL for off-premise kegs (shipped to a customer, in no bin) or when bin is unknown. Parallel to to_location_id; netted by keg_inventory (00220) exactly as location is.';

-- Index the new FKs (repo unindexed-FK convention, cf. 00060/00129/00136).
CREATE INDEX IF NOT EXISTS idx_keg_transactions_from_bin_id ON keg_transactions (from_bin_id);
CREATE INDEX IF NOT EXISTS idx_keg_transactions_to_bin_id   ON keg_transactions (to_bin_id);

-- =============================================================================
-- A2 -- record_keg_transaction: append two bin params (00190 body otherwise
--       byte-identical -- only from_bin_id/to_bin_id added to INSERT + VALUES)
-- =============================================================================
-- The two new params are appended AFTER p_created_by_name with DEFAULT NULL so
-- all existing positional/named callers keep working unchanged. INVOKER (no
-- explicit SECURITY), plpgsql, SET search_path 'public', RETURNS uuid -- all
-- reproduced verbatim from 00190.
-- Appending params yields a NEW overload (not a replace), so DROP the old 14-arg
-- signature first -- exactly one record_keg_transaction remains; the 16-arg
-- version covers every prior 14-arg call via its two DEFAULT NULL bin params.
DROP FUNCTION IF EXISTS public.record_keg_transaction(
  keg_transaction_type, uuid, integer, keg_state, keg_state,
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text
);

CREATE OR REPLACE FUNCTION public.record_keg_transaction(p_transaction_type keg_transaction_type, p_selling_format_id uuid, p_quantity integer, p_from_state keg_state, p_to_state keg_state, p_from_location_id uuid DEFAULT NULL::uuid, p_to_location_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_customer_id uuid DEFAULT NULL::uuid, p_packaging_session_id uuid DEFAULT NULL::uuid, p_batch_id uuid DEFAULT NULL::uuid, p_finished_good_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_created_by_name text DEFAULT NULL::text, p_from_bin_id uuid DEFAULT NULL::uuid, p_to_bin_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_transaction_id UUID;
BEGIN
  INSERT INTO keg_transactions (
    transaction_type, selling_format_id, quantity,
    from_state, to_state,
    from_location_id, to_location_id,
    order_id, customer_id, packaging_session_id,
    batch_id, finished_good_id,
    notes, created_by_name,
    from_bin_id, to_bin_id
  ) VALUES (
    p_transaction_type, p_selling_format_id, p_quantity,
    p_from_state, p_to_state,
    p_from_location_id, p_to_location_id,
    p_order_id, p_customer_id, p_packaging_session_id,
    p_batch_id, p_finished_good_id,
    p_notes, p_created_by_name,
    p_from_bin_id, p_to_bin_id
  )
  RETURNING id INTO v_transaction_id;

  RETURN v_transaction_id;
END;
$function$
;

-- =============================================================================
-- A3 -- extend the 00207 netted views with a bin dimension (parallel to location)
-- =============================================================================
-- keg_inventory_summary and keg_inventory_with_details both depend on
-- keg_inventory, so the CASCADE drop takes all three; recreate all three (the
-- summary references only selling_format_id/state/quantity, so it is reproduced
-- verbatim from 00207 and still nets correctly across bins for free).
DROP VIEW IF EXISTS keg_inventory CASCADE;

-- -----------------------------------------------------------------------------
-- keg_inventory: physical keg counts by (selling_format, owner, state, location,
-- BIN). bin_id is added as a grouping/output dimension exactly parallel to
-- location_id, and folded into the md5 id key so rows in different bins get
-- distinct ids. NULL bins (off-premise kegs) group normally.
-- -----------------------------------------------------------------------------
CREATE VIEW public.keg_inventory
WITH (security_invoker = true) AS
 WITH inflows AS (
         SELECT keg_transactions.selling_format_id,
            keg_transactions.keg_owner_id,
            keg_transactions.to_state AS state,
            keg_transactions.to_location_id AS location_id,
            keg_transactions.to_bin_id AS bin_id,
            sum(keg_transactions.quantity) AS qty
           FROM keg_transactions
          GROUP BY keg_transactions.selling_format_id, keg_transactions.keg_owner_id, keg_transactions.to_state, keg_transactions.to_location_id, keg_transactions.to_bin_id
        ), outflows AS (
         SELECT keg_transactions.selling_format_id,
            keg_transactions.keg_owner_id,
            keg_transactions.from_state AS state,
            keg_transactions.from_location_id AS location_id,
            keg_transactions.from_bin_id AS bin_id,
            sum(keg_transactions.quantity) AS qty
           FROM keg_transactions
          WHERE keg_transactions.from_state IS NOT NULL
          GROUP BY keg_transactions.selling_format_id, keg_transactions.keg_owner_id, keg_transactions.from_state, keg_transactions.from_location_id, keg_transactions.from_bin_id
        ), combined AS (
         SELECT sub.selling_format_id,
            sub.keg_owner_id,
            sub.state,
            sub.location_id,
            sub.bin_id,
            COALESCE(sum(sub.qty), 0::numeric) AS quantity
           FROM ( SELECT inflows.selling_format_id, inflows.keg_owner_id, inflows.state, inflows.location_id, inflows.bin_id, inflows.qty
                   FROM inflows
                UNION ALL
                 SELECT outflows.selling_format_id, outflows.keg_owner_id, outflows.state, outflows.location_id, outflows.bin_id, - outflows.qty
                   FROM outflows) sub
          GROUP BY sub.selling_format_id, sub.keg_owner_id, sub.state, sub.location_id, sub.bin_id
         HAVING COALESCE(sum(sub.qty), 0::numeric) > 0::numeric
        )
 SELECT md5(((((((COALESCE(selling_format_id::text, ''::text) || ':'::text) || COALESCE(keg_owner_id::text, ''::text)) || ':'::text) || COALESCE(state::text, ''::text)) || ':'::text) || COALESCE(location_id::text, ''::text)) || ':'::text || COALESCE(bin_id::text, ''::text))::uuid AS id,
    selling_format_id,
    keg_owner_id,
    state,
    location_id,
    bin_id,
    quantity::integer AS quantity
   FROM combined;

COMMENT ON VIEW keg_inventory IS
  'Physical keg counts by (selling_format, keg_owner, state, location, bin), netted from keg_transactions. bin_id (00220) is a grouping/output dimension parallel to location_id and folded into the id key; NULL bin = off-premise (kegs at a customer). Contents (batch/finished good) are intentionally excluded from the grouping so fill and ship legs net -- see keg_filled_contents for filled-keg brand breakdown.';

-- -----------------------------------------------------------------------------
-- keg_inventory_with_details: keg_inventory + joined display names, now including
-- the bin (ki.bin_id + bins.name AS bin_name).
-- -----------------------------------------------------------------------------
CREATE VIEW keg_inventory_with_details
WITH (security_invoker = true) AS
SELECT
  ki.id,
  ki.selling_format_id,
  ki.keg_owner_id,
  ki.state,
  ki.location_id,
  ki.bin_id,
  ki.quantity,
  sf.name           AS keg_type_name,
  c.volume_bbl      AS volume_bbl,
  ko.name           AS keg_owner_name,
  ko.code           AS keg_owner_code,
  l.name            AS location_name,
  b.name            AS bin_name
FROM keg_inventory ki
JOIN selling_formats sf ON sf.id = ki.selling_format_id
LEFT JOIN containers c ON c.id = sf.container_id
LEFT JOIN keg_owners ko ON ko.id = ki.keg_owner_id
LEFT JOIN locations l ON l.id = ki.location_id
LEFT JOIN bins b ON b.id = ki.bin_id;

COMMENT ON VIEW keg_inventory_with_details IS
  'Keg inventory (physical counts) with joined display names (selling_format/container/owner/location/bin). bin_id + bin_name added in 00220 (NULL = off-premise). Batch/brand contents dropped in 00207 -- a netted pool row can span multiple batches; use keg_filled_contents for filled-keg brand breakdown.';

-- -----------------------------------------------------------------------------
-- keg_inventory_summary: per-format state breakdown (recreated verbatim from
-- 00207 after the CASCADE drop; references only selling_format_id/state/quantity,
-- so it nets across bins automatically -- no bin change needed).
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
-- keg_filled_contents: filled kegs by contents (finished good / brand), now with
-- a BIN dimension, for the Square catalog inventory sync (Milestone B/C read the
-- bin_id from here). Reproduced from 00207 with to_bin_id on the filled-inflow
-- leg, from_bin_id on the filled-outflow leg, and bin_id in the final GROUP BY +
-- SELECT. Column order changes (bin_id inserted after location_id) so this view
-- is DROPped and recreated -- CREATE OR REPLACE cannot reorder columns.
--
-- LIMITATION (unchanged from 00207): the ship writer does not record contents
-- (finished_good_id is NULL on ship legs), so this is NOT decremented when filled
-- kegs ship -- it reproduces the pre-00207 "ever filled by brand" behavior. Until
-- the ship writer carries contents forward, Square keg counts can over-report
-- shipped-out inventory.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS keg_filled_contents;

CREATE VIEW keg_filled_contents
WITH (security_invoker = true) AS
 WITH legs AS (
         SELECT keg_transactions.selling_format_id,
            keg_transactions.to_location_id AS location_id,
            keg_transactions.to_bin_id AS bin_id,
            keg_transactions.finished_good_id,
            keg_transactions.quantity AS qty
           FROM keg_transactions
          WHERE keg_transactions.to_state = 'filled'::keg_state
            AND keg_transactions.finished_good_id IS NOT NULL
        UNION ALL
         SELECT keg_transactions.selling_format_id,
            keg_transactions.from_location_id AS location_id,
            keg_transactions.from_bin_id AS bin_id,
            keg_transactions.finished_good_id,
            - keg_transactions.quantity AS qty
           FROM keg_transactions
          WHERE keg_transactions.from_state = 'filled'::keg_state
            AND keg_transactions.finished_good_id IS NOT NULL
        )
 SELECT legs.selling_format_id,
    legs.location_id,
    legs.bin_id,
    legs.finished_good_id,
    fg.brand_id,
    sum(legs.qty)::integer AS quantity
   FROM legs
     JOIN finished_goods fg ON fg.id = legs.finished_good_id
  GROUP BY legs.selling_format_id, legs.location_id, legs.bin_id, legs.finished_good_id, fg.brand_id
 HAVING sum(legs.qty) > 0;

COMMENT ON VIEW keg_filled_contents IS
  'Filled kegs by (selling_format, location, bin, finished_good, brand), for the Square inventory sync. bin_id added in 00220 (NULL = off-premise); the Square per-bin sync reads it. Not decremented on ship (ship legs carry no contents) -- see the migration comment; reproduces pre-00207 filled-by-brand behavior.';

-- =============================================================================
-- A6 -- NO BACKFILL: existing keg_transactions rows keep from_bin_id/to_bin_id =
-- NULL. Pre-existing kegs show "no bin" in the netted views until their next
-- transaction records a bin. (No DML here -- the additive columns default NULL.)
-- =============================================================================

-- =============================================================================
-- Verification (self-rolling-back; commits NO rows) -- matches 00207/00219
-- =============================================================================
-- Proves, then rolls back:
--   (1) record_keg_transaction accepts the two appended bin params and PERSISTS
--       from_bin_id/to_bin_id on the inserted row.
--   (2) The 00207 netting still holds WITH bins: receive 50 into bin X -> fill 10
--       (empty@X -> filled@X) -> ship 10 off-premise (filled@X -> shipped@no-bin)
--       nets to the same 50-keg total as 00207's receive50/fill10/ship10=50 proof,
--       now carrying bin_id (40 empty in bin X + 10 shipped in no bin).
--   (3) keg_filled_contents surfaces bin_id for a filled keg (bin X, qty 10).
--
-- All test rows are created inside one subtransaction (BEGIN/EXCEPTION = savepoint).
-- A passing run RAISEs the sentinel 'A_VERIFY_OK' to unwind the subtransaction so
-- nothing commits. A genuine failure RAISEs 'A_ASSERT_FAIL...' and is re-raised to
-- ABORT the migration. Any other error (missing prerequisites on a from-scratch
-- replay, etc.) is downgraded to a WARNING so the additive DDL above still applies.
DO $$
DECLARE
  v_loc      UUID;
  v_cust     UUID;
  v_brand    UUID;
  v_c_keg    UUID;
  v_sf_keg   UUID;
  v_bin_x    UUID;
  v_fg       UUID;
  v_txn      UUID;
  v_from_bin UUID;
  v_to_bin   UUID;
  v_bin      UUID;
  v_qty      INTEGER;
  v_total    INTEGER;
  v_sfx      TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  BEGIN
    -- --- prerequisites (all rolled back) --------------------------------------
    INSERT INTO locations (name, location_type, is_primary)
      VALUES ('A_verify_loc_' || v_sfx, 'warehouse', false)
      RETURNING id INTO v_loc;

    -- Ship legs require a customer_id (valid_ship_transaction CHECK, 00183).
    INSERT INTO customers (name, customer_type)
      VALUES ('A_verify_cust_' || v_sfx, 'wholesale')
      RETURNING id INTO v_cust;

    INSERT INTO brands (name)
      VALUES ('A_verify_brand_' || v_sfx)
      RETURNING id INTO v_brand;

    INSERT INTO containers (name, type, volume_bbl, deposit_amount)
      VALUES ('A_verify_keg_' || v_sfx, 'keg', 0.5, 0)
      RETURNING id INTO v_c_keg;

    INSERT INTO selling_formats (container_id, name, unit_count)
      VALUES (v_c_keg, 'A_verify_sf_keg_' || v_sfx, 1)
      RETURNING id INTO v_sf_keg;

    INSERT INTO bins (location_id, name)
      VALUES (v_loc, 'A_verify_bin_X_' || v_sfx)
      RETURNING id INTO v_bin_x;

    -- Keg FG for the fill's contents. selling_format is a keg, so the 00219
    -- placement trigger skips it -> no bin_inventory pollution.
    INSERT INTO finished_goods (brand_id, selling_format_id, quantity, lot_number)
      VALUES (v_brand, v_sf_keg, 10, 'A-fg-' || v_sfx)
      RETURNING id INTO v_fg;

    -- --- (1) receive 50 into bin X: params persist + keg_inventory nets --------
    -- from_state/to_state are overridden by set_keg_transaction_states (00190);
    -- NULL is fine. to_bin_id = bin X; from_bin_id = NULL (nothing to leave).
    v_txn := record_keg_transaction(
      'receive'::keg_transaction_type, v_sf_keg, 50,
      NULL::keg_state, NULL::keg_state,
      NULL::uuid, v_loc,
      NULL::uuid, NULL::uuid, NULL::uuid,
      NULL::uuid, NULL::uuid,
      'A verify: receive 50 into bin X', 'A_verify',
      NULL::uuid, v_bin_x
    );

    SELECT from_bin_id, to_bin_id INTO v_from_bin, v_to_bin
      FROM keg_transactions WHERE id = v_txn;
    IF v_from_bin IS NOT NULL THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (1): from_bin_id persisted % but expected NULL', v_from_bin;
    END IF;
    IF v_to_bin IS DISTINCT FROM v_bin_x THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (1): to_bin_id persisted % but expected bin X %', v_to_bin, v_bin_x;
    END IF;

    SELECT quantity INTO v_qty
      FROM keg_inventory
      WHERE selling_format_id = v_sf_keg AND state = 'empty'::keg_state AND bin_id = v_bin_x;
    IF COALESCE(v_qty, 0) <> 50 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (1): expected 50 empty kegs in bin X, got %', COALESCE(v_qty, 0);
    END IF;

    -- --- (2a) fill 10 (empty@X -> filled@X) -----------------------------------
    PERFORM record_keg_transaction(
      'fill'::keg_transaction_type, v_sf_keg, 10,
      NULL::keg_state, NULL::keg_state,
      v_loc, v_loc,
      NULL::uuid, NULL::uuid, NULL::uuid,
      NULL::uuid, v_fg,
      'A verify: fill 10 in bin X', 'A_verify',
      v_bin_x, v_bin_x
    );

    -- --- (3) keg_filled_contents surfaces bin_id for the filled keg -----------
    SELECT bin_id, quantity INTO v_bin, v_qty
      FROM keg_filled_contents
      WHERE selling_format_id = v_sf_keg AND finished_good_id = v_fg;
    IF v_bin IS DISTINCT FROM v_bin_x THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (3): keg_filled_contents bin_id % but expected bin X %', v_bin, v_bin_x;
    END IF;
    IF COALESCE(v_qty, 0) <> 10 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (3): keg_filled_contents qty % but expected 10', COALESCE(v_qty, 0);
    END IF;

    -- --- (2b) ship 10 off-premise (filled@X -> shipped@no-bin) -----------------
    -- to_bin_id = NULL: shipped kegs leave the premises (no bin). Ship legs carry
    -- no contents (finished_good_id NULL), mirroring the real ship writer.
    PERFORM record_keg_transaction(
      'ship'::keg_transaction_type, v_sf_keg, 10,
      NULL::keg_state, NULL::keg_state,
      v_loc, NULL::uuid,
      NULL::uuid, v_cust, NULL::uuid,
      NULL::uuid, NULL::uuid,
      'A verify: ship 10 off-premise', 'A_verify',
      v_bin_x, NULL::uuid
    );

    -- Netting: 40 empty in bin X + 10 shipped in no bin = 50 total (same as the
    -- 00207 receive50/fill10/ship10=50 proof, now carrying bin_id).
    SELECT COALESCE(sum(quantity), 0) INTO v_total
      FROM keg_inventory WHERE selling_format_id = v_sf_keg;
    IF v_total <> 50 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (2): fleet total % but expected 50', v_total;
    END IF;

    SELECT quantity INTO v_qty
      FROM keg_inventory
      WHERE selling_format_id = v_sf_keg AND state = 'empty'::keg_state AND bin_id = v_bin_x;
    IF COALESCE(v_qty, 0) <> 40 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (2): expected 40 empty in bin X after fill, got %', COALESCE(v_qty, 0);
    END IF;

    SELECT quantity INTO v_qty
      FROM keg_inventory
      WHERE selling_format_id = v_sf_keg AND state = 'shipped'::keg_state AND bin_id IS NULL;
    IF COALESCE(v_qty, 0) <> 10 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (2): expected 10 shipped in no-bin, got %', COALESCE(v_qty, 0);
    END IF;

    -- filled@X must have netted to zero (dropped by HAVING) -> no row.
    PERFORM 1 FROM keg_inventory
      WHERE selling_format_id = v_sf_keg AND state = 'filled'::keg_state AND bin_id = v_bin_x;
    IF FOUND THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (2): filled kegs in bin X did not net to zero';
    END IF;

    -- All assertions passed: unwind the subtransaction (commit nothing).
    RAISE EXCEPTION 'A_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'A_VERIFY_OK' THEN
        RAISE NOTICE 'A keg-bin verification passed (params persist, netting holds, filled contents carry bin); test rows rolled back';
      ELSIF SQLERRM LIKE 'A_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine bin-netting bug: abort migration
      ELSE
        RAISE WARNING 'A keg-bin verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

-- Refresh PostgREST schema cache so the changed columns/views are visible now.
NOTIFY pgrst, 'reload schema';
