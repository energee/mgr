-- 00228_keg_netting_and_transfer_integrity.sql
-- Code-review follow-ups that 00223-00227 did not cover.
--
--   1. keg_inventory FLEET INFLATION (regression of the bug 00207 fixed).
--      00220 added bin_id to the keg_inventory netting GROUP BY. Netting only
--      works when the positive and the negative leg of a move land in the SAME
--      group, and no writer stamps a bin on both legs:
--        * the keg-transaction form lets a user receive empties with
--          to_bin_id = X, so the inflow sits in (empty, loc, X);
--        * the automated fill writer's OUTFLOW leg (from_state = 'empty') has
--          from_bin_id = NULL, so the -qty lands in (empty, loc, NULL) and is
--          discarded by `HAVING sum(qty) > 0`.
--      The empty pool at X is never decremented -> the fleet inflates.
--      00227 made this WORSE, not better: it now stamps to_bin_id on fill legs,
--      so the FILLED pool sits in (filled, loc, bin) while the ship leg's
--      from_bin_id is still NULL -- the filled pool no longer nets down either.
--      FIX: bin is not a sound netting dimension. Revert keg_inventory to the
--      00207 grouping (selling_format, keg_owner, state, location). The bin
--      dimension stays on keg_filled_contents, whose legs are inflow-only and
--      which 00227 now populates correctly -- that is what the per-bin Square
--      sync reads. keg_transactions.from_bin_id / to_bin_id are untouched.
--
--   2. bins_one_default_fg_per_location IGNORED is_active. The partial unique
--      index is `WHERE is_default_fg` while place_finished_good_in_bin's
--      fallback (00219) filters `is_default_fg AND is_active`. A soft-deleted
--      default bin therefore holds its location's slot -- designating a
--      replacement fails with 23505 -- while matching nothing in the fallback,
--      so finished goods at that location are silently left unplaced.
--
--   3. handle_vessel_transfer (00210) DOUBLE-BOOKS UNDER CONCURRENCY. The M4
--      guard is a check-then-act: an EXISTS read with no row lock, followed by
--      an unconditional UPDATE that never re-asserts the precondition. Two
--      transfers into the same empty vessel both pass the check and both write;
--      the later commit silently orphans the first batch -- exactly what M4 was
--      added to prevent. FIX: claim the destination with one conditional UPDATE
--      whose WHERE re-checks occupancy (atomic under READ COMMITTED, which is
--      Postgres's default).
--
--   4. empties_source WAS CLIENT-TRUSTED. vessel-transfer-dialog.tsx computes it
--      as a float `volume_bbl >= remainingVolume` against a react-query value
--      with no staleTime, and the trigger frees (dirties + clears) the source
--      vessel on that boolean alone -- nothing re-derives it server-side. A
--      refetch between auto-fill and submit flips it, stranding beer in a vessel
--      the DB believes is empty. FIX: re-derive from the transfer ledger and
--      correct the stored flag when the client's claim disagrees.
--
--   5. square_locations SELECT RLS (00222) matched ANY authenticated user via
--      `auth.uid() IS NOT NULL`. Invite-only portal wholesale customers share
--      the auth.users pool and hold a real auth.uid(), so they could read the
--      brewery's Square location mapping. Narrowed to integrations:manage,
--      mirroring the table's own write policy and square_settings /
--      square_catalog_map (00097).

-- =============================================================================
-- PART 1 -- keg_inventory: drop the unsound bin netting dimension
-- =============================================================================
-- keg_inventory_with_details and keg_inventory_summary depend on keg_inventory,
-- so the CASCADE drop takes all three; all three are recreated (the same set
-- 00220 dropped and recreated). Nothing in src/ reads keg_inventory.bin_id or
-- keg_inventory_with_details.bin_name -- chat/tools.ts selects an explicit
-- column list without them, and the keg-inventory entity never referenced them.

DROP VIEW IF EXISTS keg_inventory CASCADE;

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
 SELECT md5(((((((COALESCE(selling_format_id::text, ''::text) || ':'::text) || COALESCE(keg_owner_id::text, ''::text)) || ':'::text) || COALESCE(state::text, ''::text)) || ':'::text) || COALESCE(location_id::text, ''::text)))::uuid AS id,
    selling_format_id,
    keg_owner_id,
    state,
    location_id,
    quantity::integer AS quantity
   FROM combined;

COMMENT ON VIEW keg_inventory IS
  'Physical keg counts by (selling_format, keg_owner, state, location), netted from keg_transactions. The bin dimension 00220 added was REMOVED in 00228: no writer stamps a bin on BOTH the inflow and the outflow leg of a move, so grouping by bin stranded the negative leg in its own group (discarded by HAVING > 0) and inflated the fleet -- the 00207 bug. Bins live on keg_filled_contents, whose legs are inflow-only. Contents (batch/finished good) stay out of the grouping so fill and ship legs net.';

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
  'Keg inventory (physical counts) with joined display names (selling_format/container/owner/location). bin_id/bin_name were added in 00220 and removed again in 00228 -- see the keg_inventory comment. Batch/brand contents dropped in 00207; use keg_filled_contents for the filled-keg brand breakdown.';

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

-- =============================================================================
-- PART 2 -- default-FG-bin uniqueness must ignore inactive bins
-- =============================================================================
DROP INDEX IF EXISTS bins_one_default_fg_per_location;
CREATE UNIQUE INDEX bins_one_default_fg_per_location
  ON bins (location_id)
  WHERE is_default_fg AND is_active;

COMMENT ON COLUMN bins.is_default_fg IS
  'Marks this bin as the location''s default finished-goods bin: the fallback placement target for place_finished_good_in_bin (00219) when a packaging session carries no default_bin_id. At most one ACTIVE default per location (bins_one_default_fg_per_location, narrowed to is_active in 00228 so a soft-deleted bin no longer holds the slot).';

-- =============================================================================
-- PART 3 -- handle_vessel_transfer: atomic claim + server-derived empties_source
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_vessel_transfer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_in      numeric;
  v_out     numeric;
  v_empties boolean;
BEGIN
  -- M4: claim the destination atomically. The WHERE re-asserts the precondition,
  -- so under READ COMMITTED a concurrent transfer that got there first makes
  -- this UPDATE match zero rows instead of silently overwriting it. An empty
  -- vessel, or one already holding this same batch (idempotent re-transfer /
  -- consolidation), is allowed.
  UPDATE vessels
  SET status = 'in_use',
      current_batch_id = NEW.batch_id,
      updated_at = NOW()
  WHERE id = NEW.to_vessel_id
    AND (current_batch_id IS NULL OR current_batch_id = NEW.batch_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The destination vessel already holds a different batch — refresh and choose an empty vessel.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- M5: free the source only on a full move. empties_source arrives from the
  -- client as a float comparison against a possibly-stale cached remaining
  -- volume, so re-derive it from the ledger: the source is emptied when
  -- everything that ever flowed into it for this batch has now flowed back out.
  -- NULL from_vessel_id = knockout from kettle (no source vessel to free).
  IF NEW.from_vessel_id IS NOT NULL THEN
    SELECT COALESCE(sum(volume_bbl), 0) INTO v_in
    FROM vessel_transfers
    WHERE batch_id = NEW.batch_id
      AND to_vessel_id = NEW.from_vessel_id
      AND id <> NEW.id;

    SELECT COALESCE(sum(volume_bbl), 0) INTO v_out
    FROM vessel_transfers
    WHERE batch_id = NEW.batch_id
      AND from_vessel_id = NEW.from_vessel_id
      AND id <> NEW.id;

    IF v_in > 0 THEN
      -- 0.0001 bbl ~= 0.4 fl oz: absorbs decimal noise, far below any real pour.
      v_empties := (v_out + NEW.volume_bbl) >= (v_in - 0.0001);
    ELSE
      -- No inbound transfer recorded (the batch started in this vessel), so the
      -- ledger cannot tell us its fill volume. Trust the caller's claim.
      v_empties := NEW.empties_source;
    END IF;

    -- Keep the stored flag honest: it is the audit record of what happened.
    IF v_empties IS DISTINCT FROM NEW.empties_source THEN
      UPDATE vessel_transfers SET empties_source = v_empties WHERE id = NEW.id;
    END IF;

    IF v_empties THEN
      UPDATE vessels
      SET status = 'dirty',
          current_batch_id = NULL,
          updated_at = NOW()
      WHERE id = NEW.from_vessel_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.handle_vessel_transfer() IS
  'Updates vessel status/current_batch_id on transfer insert. Claims the destination with a conditional UPDATE so concurrent transfers cannot double-book it (M4, race fixed in 00228). Frees the source only on a full move, re-deriving empties_source from the transfer ledger rather than trusting the client flag (M5, 00228).';

-- =============================================================================
-- PART 4 -- square_locations: staff-only read
-- =============================================================================
DROP POLICY IF EXISTS square_locations_select ON square_locations;
CREATE POLICY square_locations_select ON square_locations
  FOR SELECT USING (user_has_permission('integrations:manage'));

NOTIFY pgrst, 'reload schema';
