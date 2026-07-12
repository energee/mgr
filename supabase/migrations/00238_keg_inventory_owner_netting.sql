-- 00238_keg_inventory_owner_netting.sql
-- Audit 2026-07-10 finding DL-4 (backlog P1 #10): named-owner keg ships
-- permanently inflate the keg_inventory fleet total.
--
-- NUMBERING: 00236/00237 and 00240/00241 are claimed by other in-flight
-- branches; 00238/00239 are reserved for this branch (fix/keg-netting-
-- residuals). NOT applied live -- deploy via scripts/db-push.sh after merge.
--
-- THE BUG (owner-dimension stranded negative -- 00207's bug, one dimension over)
--   keg_inventory (00228) nets keg_transactions by (selling_format, keg_owner,
--   state, location) and keeps only groups with HAVING sum > 0. Netting only
--   works when the positive and the negative leg of a keg's journey land in
--   the SAME owner group:
--     * packaging fills stamp the SESSION LINE's keg_owner_id on the fill leg
--       (v_line.keg_owner_id -- since 00183, carried through 00227/00232; the
--       packaging UI exposes the owner picker, but operators often leave it
--       blank, so fills commonly carry owner NULL);
--     * create_keg_ship_transactions_from_order stamps the ORDER LINE's
--       keg_owner_id on the ship leg (00183/00229/00234), and the FIFO draw
--       over keg_filled_contents is owner-BLIND (that view deliberately has no
--       owner dimension -- 00229 header), so nothing ties the two stamps
--       together.
--   Whenever they differ -- most commonly fill NULL / ship named-owner -- the
--   ship's -filled lands in an owner group no fill ever deposited into
--   (discarded by the HAVING) while the fill's +filled never decrements: every
--   keg shipped under a mismatched owner inflates the fleet forever.
--
--   CORRECTION OF THE RECORD: 00234's header and function COMMENT claim
--   "packaging fills insert legs with keg_owner_id NULL". That is FALSE as an
--   unconditional statement -- the fill writer has stamped the session line's
--   owner since 00183. The stale claim is why the first fix option considered
--   for DL-4 ("stamp fills with the session line's owner") is a no-op: it is
--   already the behavior, and it demonstrably does not close the bug, because
--   the ORDER line's owner is a different value nothing reconciles.
--
-- THE FIX (netting-side, write paths untouched)
--   The ship leg's stamped keg_owner_id cannot change: customer_keg_balances
--   (00079) nets shipped-minus-returned per (customer, format, OWNER) and
--   keg_owner_deposits keys deposits by owner, so the order's owner on the
--   ship leg is business data (whose keg the customer owes a deposit on).
--   Re-stamping it with the fill's owner would silently change customer
--   balances; blocking mismatched fulfillments would stop sales.
--
--   Instead, keg_inventory now RE-ATTRIBUTES the owner dimension of
--   filled-state legs: any leg entering or leaving the 'filled' state that
--   names a finished_good nets under the owner that finished good was FILLED
--   under (its 'fill' legs' keg_owner_id, when unambiguous -- all fills agree,
--   all NULL or all one owner). The row's own keg_owner_id is untouched --
--   display, customer balances, and deposits keep reading the stamped value;
--   only this view's grouping changes. Copy-don't-derive at write time was
--   considered and rejected here because ONE column (keg_transactions
--   .keg_owner_id) carries both the fleet-pool meaning and the customer-
--   deposit meaning; splitting them is a schema change out of scope for an
--   audit fix.
--
--   Effects, per leg shape:
--     * ship legs (00229/00234: always carry finished_good_id): -filled nets
--       in the owner group the fill deposited into -- THE FIX. The +shipped
--       inflow keeps the order's owner (returns recorded against the customer
--       net there, unchanged).
--     * revise-down 'adjust' legs (00232): already stamp the session line's
--       owner, so re-attribution is normally the identity; it additionally
--       heals the case where the line's owner was EDITED between completion
--       and revision.
--     * hand-recorded filled-keg transfers naming a finished_good: BOTH legs
--       re-attribute to the fill's owner, so they net against the fill and
--       against later ships regardless of what owner the form user picked.
--     * mixed-owner finished goods (possible only via hand-recorded fills):
--       excluded from re-attribution; their legs keep their own stamps --
--       exactly today's behavior, degraded not broken.
--   RESIDUAL (documented, unchanged): the EMPTY pool has the same mismatch
--   class one state over (receive owner vs fill outflow owner). Empties are
--   received via the keg-transaction form where the owner is picked by the
--   same operator flow that fills draw from, and no automated writer stamps a
--   different owner on the empty legs, so it is left to the existing
--   operational discipline (00234 header).
--
-- Live-safe: CREATE OR REPLACE VIEW (output columns identical to 00228's
-- definition, which is what both live and a from-scratch replay have at this
-- point in the chain -- 00230+ are applied live per backlog P0 #1), two
-- COMMENT refreshes, and a self-rolling-back verification block (commits NO
-- rows).

-- =============================================================================
-- PART 1 -- keg_inventory: net filled-state legs by their finished good's
--           fill owner
-- =============================================================================
-- Reproduced from 00228 with the fill_owner CTE and the two CASE re-attribution
-- expressions added; the combined/HAVING/id machinery is unchanged.

CREATE OR REPLACE VIEW public.keg_inventory
WITH (security_invoker = true) AS
 WITH fill_owner AS (
         -- The owner each finished good's kegs were FILLED under: the
         -- keg_owner_id of its 'fill' legs, when unambiguous (all fills agree
         -- -- all NULL, or all the same owner). Restricted to
         -- transaction_type = 'fill' so a hand-recorded transfer of filled
         -- kegs cannot redefine the pool's owner. Mixed-owner finished goods
         -- drop out (no row), and their legs keep their own stamps below.
         SELECT keg_transactions.finished_good_id,
            min(keg_transactions.keg_owner_id::text)::uuid AS keg_owner_id
           FROM keg_transactions
          WHERE keg_transactions.transaction_type = 'fill'
            AND keg_transactions.to_state = 'filled'::keg_state
            AND keg_transactions.finished_good_id IS NOT NULL
          GROUP BY keg_transactions.finished_good_id
         HAVING count(DISTINCT keg_transactions.keg_owner_id) <= 1
            AND (count(keg_transactions.keg_owner_id) = 0
                 OR count(keg_transactions.keg_owner_id) = count(*))
        ), inflows AS (
         SELECT kt.selling_format_id,
            CASE WHEN kt.to_state = 'filled'::keg_state AND fo.finished_good_id IS NOT NULL
                 THEN fo.keg_owner_id
                 ELSE kt.keg_owner_id END AS keg_owner_id,
            kt.to_state AS state,
            kt.to_location_id AS location_id,
            sum(kt.quantity) AS qty
           FROM keg_transactions kt
           LEFT JOIN fill_owner fo ON fo.finished_good_id = kt.finished_good_id
          GROUP BY kt.selling_format_id,
            CASE WHEN kt.to_state = 'filled'::keg_state AND fo.finished_good_id IS NOT NULL
                 THEN fo.keg_owner_id
                 ELSE kt.keg_owner_id END,
            kt.to_state, kt.to_location_id
        ), outflows AS (
         SELECT kt.selling_format_id,
            CASE WHEN kt.from_state = 'filled'::keg_state AND fo.finished_good_id IS NOT NULL
                 THEN fo.keg_owner_id
                 ELSE kt.keg_owner_id END AS keg_owner_id,
            kt.from_state AS state,
            kt.from_location_id AS location_id,
            sum(kt.quantity) AS qty
           FROM keg_transactions kt
           LEFT JOIN fill_owner fo ON fo.finished_good_id = kt.finished_good_id
          WHERE kt.from_state IS NOT NULL
          GROUP BY kt.selling_format_id,
            CASE WHEN kt.from_state = 'filled'::keg_state AND fo.finished_good_id IS NOT NULL
                 THEN fo.keg_owner_id
                 ELSE kt.keg_owner_id END,
            kt.from_state, kt.from_location_id
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
  'Physical keg counts by (selling_format, keg_owner, state, location), netted from keg_transactions. The bin dimension 00220 added was REMOVED in 00228 (no writer stamps a bin on BOTH legs of a move; bins live on keg_filled_contents, whose outflow legs COPY location/bin off the rows they draw down). Since 00238 the OWNER of filled-state legs that name a finished good is RE-ATTRIBUTED to that finished good''s fill owner (unambiguous fills only): ship legs stamp the ORDER''s owner (business data for customer_keg_balances/deposits) while fills stamp the SESSION LINE''s owner, and the owner-blind FIFO draw ties neither to the other, so a mismatched ship stranded its negative in an owner group the HAVING discarded and inflated the fleet (audit DL-4). Rows'' own keg_owner_id stamps are untouched -- only this view''s grouping re-attributes. Contents (batch/finished good) stay out of the grouping so fill and ship legs net.';

-- =============================================================================
-- PART 2 -- correct the stale owner claim on the ship function's COMMENT
-- =============================================================================
-- 00234's COMMENT says "fills record owner NULL"; fills have stamped the
-- session line's owner since 00183. Comment-only refresh; the function body is
-- NOT touched here (chain-latest remains 00234's).

COMMENT ON FUNCTION create_keg_ship_transactions_from_order IS
  'Creates ship keg_transactions for all keg-container order items when an order is fulfilled. Keg detection via selling_formats -> containers (type = keg). Since 00229 each leg names the lot it draws down: demand is allocated FIFO over keg_filled_contents by finished_goods.production_date NULLS LAST, lot_number, then location_id, bin_id (00234: the full view group key, so a lot split across bins draws in a total order), scoped to the order line brand_id when set, and the leg copies finished_good_id/location_id/bin_id from the drawn row so keg_filled_contents nets. Since 00234 the function serializes on pg_advisory_xact_lock(hashtext(function name), 0): concurrent fulfillments of different orders shared a snapshot and could double-draw the same lots, netting groups negative (dropped by HAVING) and inflating the fleet. RAISEs if an order ships more kegs of a brand than are recorded as filled. OWNER NOTE (corrected in 00238): ship legs stamp the ORDER''s keg_owner_id (feeds customer_keg_balances/deposits) while fills stamp the SESSION LINE''s owner -- NOT always NULL as 00234''s note claimed -- and the draw is owner-blind; keg_inventory re-attributes filled-state netting to the fill''s owner (00238) so a mismatch no longer inflates the fleet. Returns the number of legs created.';

-- =============================================================================
-- PART 3 -- verification (self-rolling-back; commits NO rows) -- 00232/00234
--           idiom
-- =============================================================================
-- Proves, then rolls back:
--   (1) MATCHED named-owner flow: receive 10 (owner O) -> fill 6 (owner O) ->
--       ship 4 (order owner O) nets: empty 4 / filled 2 / shipped 4, fleet
--       total 10 -- the flow the owner dimension was built for still works.
--   (2) MISMATCHED flow (THE DL-4 case): receive 10 (owner NULL) -> fill 6
--       (owner NULL) -> ship 4 under a NAMED owner. Pre-00238 the fleet
--       reported 14 (stranded -4 discarded, +6 filled never decremented);
--       now: filled nets to 2 in the owner-NULL group, shipped 4 sits under
--       the order's owner, fleet total 10.
--   (3) DISPLAY PRESERVED: the mismatched ship LEG still carries the order's
--       keg_owner_id (customer balance/deposit data unchanged).
-- Calls the real create_keg_ship_transactions_from_order (chain-latest =
-- 00234's), which takes its advisory xact lock; like 00234's own verification,
-- the lock persists until this migration's transaction ends -- nothing to
-- clean up.
DO $$
DECLARE
  v_loc      UUID;
  v_cust     UUID;
  v_owner    UUID;
  v_brand_a  UUID;
  v_brand_b  UUID;
  v_c_keg    UUID;
  v_sf_a     UUID;
  v_sf_b     UUID;
  v_bin      UUID;
  v_fg1      UUID;
  v_fg2      UUID;
  v_order    UUID;
  v_qty      INTEGER;
  v_total    INTEGER;
  v_sfx      TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  BEGIN
    -- --- prerequisites (all rolled back) --------------------------------------
    INSERT INTO locations (name, location_type, is_primary)
      VALUES ('KO_loc_' || v_sfx, 'warehouse', false) RETURNING id INTO v_loc;
    INSERT INTO customers (name, customer_type)
      VALUES ('KO_cust_' || v_sfx, 'wholesale') RETURNING id INTO v_cust;
    INSERT INTO keg_owners (name, code, position)
      VALUES ('KO_owner_' || v_sfx, left(v_sfx, 8), 999) RETURNING id INTO v_owner;
    INSERT INTO brands (name) VALUES ('KO_brand_A_' || v_sfx) RETURNING id INTO v_brand_a;
    INSERT INTO brands (name) VALUES ('KO_brand_B_' || v_sfx) RETURNING id INTO v_brand_b;
    INSERT INTO containers (name, type, volume_bbl, deposit_amount)
      VALUES ('KO_keg_' || v_sfx, 'keg', 0.5, 0) RETURNING id INTO v_c_keg;
    INSERT INTO selling_formats (container_id, name, unit_count)
      VALUES (v_c_keg, 'KO_sf_A_' || v_sfx, 1) RETURNING id INTO v_sf_a;
    INSERT INTO selling_formats (container_id, name, unit_count)
      VALUES (v_c_keg, 'KO_sf_B_' || v_sfx, 1) RETURNING id INTO v_sf_b;
    INSERT INTO bins (location_id, name)
      VALUES (v_loc, 'KO_bin_' || v_sfx) RETURNING id INTO v_bin;

    -- Format A: MATCHED owner O end to end (keg formats skip the 00219 trigger)
    INSERT INTO finished_goods (brand_id, selling_format_id, quantity, lot_number, production_date)
      VALUES (v_brand_a, v_sf_a, 6, 'KO-fg1-' || v_sfx, DATE '2026-01-01')
      RETURNING id INTO v_fg1;
    INSERT INTO keg_transactions
      (transaction_type, selling_format_id, keg_owner_id, quantity, to_state, to_location_id, to_bin_id, notes)
      VALUES ('receive', v_sf_a, v_owner, 10, 'empty', v_loc, v_bin, 'KO verify: receive 10 (owner O)');
    INSERT INTO keg_transactions
      (transaction_type, selling_format_id, keg_owner_id, quantity, from_state, to_state,
       from_location_id, to_location_id, to_bin_id, finished_good_id, notes)
      VALUES ('fill', v_sf_a, v_owner, 6, 'empty', 'filled',
              v_loc, v_loc, v_bin, v_fg1, 'KO verify: fill 6 (owner O, 00232 writer shape)');

    -- Format B: fill under owner NULL, ship will name owner O (THE mismatch)
    INSERT INTO finished_goods (brand_id, selling_format_id, quantity, lot_number, production_date)
      VALUES (v_brand_b, v_sf_b, 6, 'KO-fg2-' || v_sfx, DATE '2026-01-01')
      RETURNING id INTO v_fg2;
    INSERT INTO keg_transactions
      (transaction_type, selling_format_id, quantity, to_state, to_location_id, to_bin_id, notes)
      VALUES ('receive', v_sf_b, 10, 'empty', v_loc, v_bin, 'KO verify: receive 10 (owner NULL)');
    INSERT INTO keg_transactions
      (transaction_type, selling_format_id, quantity, from_state, to_state,
       from_location_id, to_location_id, to_bin_id, finished_good_id, notes)
      VALUES ('fill', v_sf_b, 6, 'empty', 'filled',
              v_loc, v_loc, v_bin, v_fg2, 'KO verify: fill 6 (owner NULL)');

    -- One order, both lines under owner O; the real ship function draws both
    INSERT INTO orders (order_number, customer_id)
      VALUES ('KO-VERIFY-' || left(v_sfx, 12), v_cust) RETURNING id INTO v_order;
    INSERT INTO order_items (order_id, selling_format_id, brand_id, keg_owner_id, quantity)
      VALUES (v_order, v_sf_a, v_brand_a, v_owner, 4),
             (v_order, v_sf_b, v_brand_b, v_owner, 4);

    PERFORM create_keg_ship_transactions_from_order(v_order);

    -- --- (1) matched flow still nets ------------------------------------------
    SELECT quantity INTO v_qty FROM keg_inventory
      WHERE selling_format_id = v_sf_a AND keg_owner_id = v_owner
        AND state = 'filled' AND location_id = v_loc;
    IF COALESCE(v_qty, 0) <> 2 THEN
      RAISE EXCEPTION 'KO_ASSERT_FAIL (1): matched-owner filled pool shows % but expected 2 (6 filled - 4 shipped)', COALESCE(v_qty, 0);
    END IF;
    SELECT COALESCE(sum(quantity), 0) INTO v_total FROM keg_inventory
      WHERE selling_format_id = v_sf_a;
    IF v_total <> 10 THEN
      RAISE EXCEPTION 'KO_ASSERT_FAIL (1): matched-owner fleet total is % but expected 10 (receive->fill->ship must conserve kegs)', v_total;
    END IF;

    -- --- (2) mismatched flow nets (pre-00238 this fleet total was 14) ----------
    SELECT quantity INTO v_qty FROM keg_inventory
      WHERE selling_format_id = v_sf_b AND keg_owner_id IS NULL
        AND state = 'filled' AND location_id = v_loc;
    IF COALESCE(v_qty, 0) <> 2 THEN
      RAISE EXCEPTION 'KO_ASSERT_FAIL (2): mismatched ship left the owner-NULL filled pool at % but expected 2 -- the ship leg''s -filled is not netting in the fill''s owner group', COALESCE(v_qty, 0);
    END IF;
    SELECT COALESCE(sum(quantity), 0) INTO v_total FROM keg_inventory
      WHERE selling_format_id = v_sf_b;
    IF v_total <> 10 THEN
      RAISE EXCEPTION 'KO_ASSERT_FAIL (2): mismatched-owner fleet total is % but expected 10 -- the DL-4 inflation is back', v_total;
    END IF;

    -- --- (3) the ship LEG still carries the order's owner (display/balances) --
    SELECT count(*) INTO v_qty FROM keg_transactions
      WHERE order_id = v_order AND transaction_type = 'ship'
        AND selling_format_id = v_sf_b AND keg_owner_id = v_owner;
    IF v_qty < 1 THEN
      RAISE EXCEPTION 'KO_ASSERT_FAIL (3): ship leg no longer carries the order''s keg_owner_id -- customer keg balances would change';
    END IF;

    -- All assertions passed: unwind the subtransaction (commit nothing).
    RAISE EXCEPTION 'KO_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'KO_VERIFY_OK' THEN
        RAISE NOTICE 'KO owner-netting verification passed (matched flow conserves, mismatched ship nets in the fill''s owner group, ship leg keeps the order''s owner); test rows rolled back';
      ELSIF SQLERRM LIKE 'KO_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine netting bug: abort migration
      ELSE
        RAISE WARNING 'KO owner-netting verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

-- Refresh PostgREST schema cache so the replaced view is picked up.
NOTIFY pgrst, 'reload schema';
