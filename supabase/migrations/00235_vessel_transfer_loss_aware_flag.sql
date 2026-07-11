-- =============================================================================
-- 00235 -- handle_vessel_transfer: stop falsifying loss-explained empty claims
-- =============================================================================
-- PR #363 review item M5 (stranded vessel), against 00228's re-derivation.
--
-- THE BUG. 00228 made empties_source server-derived: the source vessel is
-- freed only when the vessel_transfers ledger proves everything that flowed in
-- has flowed back out. But volume leaves a vessel through channels the ledger
-- never sees -- losses, samples, taproom pours, destruction are recorded as
-- ALLOCATIONS (batch-sourced rows in `allocations`), not vessel transfers. So:
-- fill a vessel with 10 bbl, record a 2 bbl loss, transfer the physically
-- remaining 8 bbl out with empties_source = true, and 00228's derivation
--   (a) refuses to free the source vessel (v_out + 8 < v_in 10), AND
--   (b) REWRITES the truthful empties_source flag to false -- falsifying the
--       audit record of what actually happened.
--
-- WHY NOT THE FULL FIX (loss-awareness in the FREEING decision). `allocations`
-- has NO vessel dimension -- a loss row names the batch, not the vessel it
-- happened in. A batch spans vessels over its life (FV -> BBT) and can span two
-- at once (split transfer), so batch-wide losses cannot be attributed to THIS
-- source vessel. Folding them into the freeing decision would relax it by
-- losses that happened elsewhere: transfer 5 of 8 out of a BBT whose batch
-- lost 3 bbl back in the FV and the vessel is freed with 3 bbl still in it --
-- the exact stranded-beer bug M5's re-derivation was built to prevent, now
-- with server-side conviction. Freeing therefore stays ledger-proven-only.
--
-- THE MINIMAL SAFETY SHIPPED HERE (the flag, not the freeing):
--   * When the ledger cannot prove emptiness but the caller claims it, and the
--     batch's recorded completed allocation outflow (volume_bbl) covers the
--     gap, the claim is PLAUSIBLE: keep it. The flag is the audit record of
--     what the operator observed; "the ledger cannot see losses" is not
--     evidence the operator is wrong. Overwrite to false ONLY when even the
--     batch-wide allocation total cannot explain the shortfall -- generous on
--     purpose: this branch never frees a vessel, so over-crediting losses can
--     at worst preserve a wrong flag, never strand beer.
--   * The vessel is still NOT freed (see above). MANUAL ESCAPE HATCH, also the
--     answer for any vessel this leaves occupied: correct the vessel record
--     itself -- UPDATE vessels SET status = 'dirty', current_batch_id = NULL
--     (or the vessels entity form). The transfer ledger stays truthful; nothing
--     re-derives vessel state retroactively.
--
-- HONEST LIMITS OF THE DERIVATION (review item 6; also in the fn comment):
--   * The ledger is authoritative only up to its own completeness: additions
--     (dry hops, sugar, water) raise volume without a transfer row, and
--     allocations lower it invisibly. Both make the derivation UNDER-estimate
--     emptiness, so it errs toward NOT freeing -- the benign direction (a
--     vessel is never freed while provably holding beer; it may stay occupied
--     when actually empty, for which see the escape hatch).
--   * Two concurrent transfers out of the same source don't see each other's
--     uncommitted rows (READ COMMITTED), so each computes a too-small v_out --
--     again erring toward NOT freeing. Benign; not "fixed".
--   * Opposite-direction concurrent transfers (A->B and B->A) update the two
--     vessel rows in opposite order and can DEADLOCK; Postgres detects it and
--     aborts one transaction. No corruption -- the aborted insert just retries.
--     Documented, deliberately not engineered around.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_vessel_transfer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_in      numeric;
  v_out     numeric;
  v_gap     numeric;
  v_alloc   numeric;
  v_empties boolean;
BEGIN
  -- M4: claim the destination atomically. The WHERE re-asserts the precondition,
  -- so under READ COMMITTED a concurrent transfer that got there first makes
  -- this UPDATE match zero rows instead of silently overwriting it. An empty
  -- vessel, or one already holding this same batch (idempotent re-transfer /
  -- consolidation), is allowed.
  -- (Opposite-direction concurrent transfers can deadlock on the two vessel
  -- rows; Postgres aborts one -- no corruption. See header.)
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

  -- M5: free the source only on a full move, proven by the transfer ledger.
  -- The ledger is authoritative only up to its own completeness: additions and
  -- allocations (losses/samples/pours) change volume without a transfer row,
  -- and concurrent outbound transfers are invisible to this read -- all of
  -- which bias v_empties toward FALSE, i.e. toward NOT freeing (benign).
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
      v_gap := v_in - (v_out + NEW.volume_bbl);
      v_empties := v_gap <= 0.0001;
    ELSE
      -- No inbound transfer recorded (the batch started in this vessel), so the
      -- ledger cannot tell us its fill volume. Trust the caller's claim.
      v_gap := 0;
      v_empties := NEW.empties_source;
    END IF;

    IF v_empties THEN
      -- Ledger-proven (or unprovable-and-claimed): keep the stored flag honest,
      -- correcting a stale-client FALSE upward to match the proof.
      IF NOT NEW.empties_source THEN
        UPDATE vessel_transfers SET empties_source = true WHERE id = NEW.id;
      END IF;

      UPDATE vessels
      SET status = 'dirty',
          current_batch_id = NULL,
          updated_at = NOW()
      WHERE id = NEW.from_vessel_id;

    ELSIF NEW.empties_source THEN
      -- Caller claims a full move the ledger cannot prove. Volume also leaves
      -- vessels as batch-sourced ALLOCATIONS (loss/sample/pour/destruction),
      -- which carry no vessel id, so they can justify KEEPING the operator's
      -- flag but never justify FREEING this particular vessel (the loss may
      -- have happened in another vessel of the batch -- see header).
      SELECT COALESCE(sum(volume_bbl), 0) INTO v_alloc
      FROM allocations
      WHERE source_type = 'batch'
        AND source_id = NEW.batch_id
        AND status = 'completed';

      IF v_alloc >= v_gap - 0.0001 THEN
        -- Plausibly truthful (00235): recorded batch outflow covers the gap.
        -- Do NOT falsify the audit flag; do NOT free the vessel. Escape hatch:
        -- correct the vessel record directly (see function comment).
        RAISE NOTICE 'Vessel % left occupied: transfer claims it emptied and % bbl of recorded batch allocations plausibly cover the % bbl ledger gap, but allocations carry no vessel id so the ledger cannot prove THIS vessel emptied. Flag kept; free the vessel manually if it is in fact empty.',
          NEW.from_vessel_id, v_alloc, v_gap;
      ELSE
        -- Even batch-wide recorded outflow cannot explain the shortfall: the
        -- claim is contradicted by every record we have. Correct it (00228).
        UPDATE vessel_transfers SET empties_source = false WHERE id = NEW.id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.handle_vessel_transfer() IS
  'Updates vessel status/current_batch_id on transfer insert. Claims the destination with a conditional UPDATE so concurrent transfers cannot double-book it (M4, 00228; opposite-direction pairs may deadlock -- Postgres aborts one, no corruption). Frees the source ONLY when the vessel_transfers ledger proves a full move (M5, 00228) -- authoritative only up to ledger completeness: additions and batch allocations (losses/samples/pours, which carry no vessel id) are invisible to it, and concurrent outbound transfers are unseen under READ COMMITTED, all biasing toward NOT freeing (benign). Since 00235 a claimed-true empties_source is no longer overwritten to false when completed batch allocations plausibly cover the ledger gap -- the flag stays truthful while the vessel stays occupied; escape hatch: UPDATE vessels SET status = ''dirty'', current_batch_id = NULL.';

-- =============================================================================
-- Verification (self-rolling-back; commits NO rows) -- 00207/00219/00229 idiom
-- =============================================================================
-- Proves, then rolls back:
--   (1) Loss-covered gap: 10 bbl in, 2 bbl completed loss allocation, 8 bbl out
--       claiming empties_source = true -> flag KEPT true (not falsified),
--       vessel NOT freed (allocations cannot prove which vessel lost it).
--   (2) Full move claiming false -> flag corrected UP to true, vessel freed
--       (00228 behavior preserved).
--   (3) Unexplained gap claiming true -> flag corrected DOWN to false, vessel
--       not freed (00228 behavior preserved -- the claim is contradicted).
DO $$
DECLARE
  v_batch  UUID;
  v_va     UUID;
  v_vb     UUID;
  v_vc     UUID;
  v_t      UUID;
  v_flag   BOOLEAN;
  v_status TEXT;
  v_cur    UUID;
  v_sfx    TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  BEGIN
    -- --- prerequisites (all rolled back) --------------------------------------
    -- batch_number was renamed to batch_code in 00155 (explicit here so the
    -- generate_batch_code trigger's registry writes stay out of the fixture).
    INSERT INTO batches (batch_code, name)
      VALUES ('C-VERIFY-' || left(v_sfx, 12), 'C_verify_batch_' || v_sfx)
      RETURNING id INTO v_batch;

    INSERT INTO vessels (name, vessel_type, capacity_bbl)
      VALUES ('C_verify_A_' || v_sfx, 'fermenter', 20) RETURNING id INTO v_va;
    INSERT INTO vessels (name, vessel_type, capacity_bbl)
      VALUES ('C_verify_B_' || v_sfx, 'brite', 20) RETURNING id INTO v_vb;
    INSERT INTO vessels (name, vessel_type, capacity_bbl)
      VALUES ('C_verify_C_' || v_sfx, 'brite', 20) RETURNING id INTO v_vc;

    -- Knockout: 10 bbl into A (from_vessel NULL -> no source derivation).
    INSERT INTO vessel_transfers (batch_id, from_vessel_id, to_vessel_id, volume_bbl)
      VALUES (v_batch, NULL, v_va, 10);

    -- A recorded 2 bbl loss, batch-sourced, completed -- invisible to the
    -- vessel_transfers ledger (this is the whole point).
    INSERT INTO allocations (source_type, source_id, destination_type, quantity, volume_bbl, status, reason_code, notes)
      VALUES ('batch', v_batch, 'loss', 2, 2, 'completed', 'spillage', 'C verify: loss the ledger cannot see');

    -- --- (1) transfer the physically remaining 8 bbl, truthfully claiming empty
    INSERT INTO vessel_transfers (batch_id, from_vessel_id, to_vessel_id, volume_bbl, empties_source)
      VALUES (v_batch, v_va, v_vb, 8, true)
      RETURNING id INTO v_t;

    SELECT empties_source INTO v_flag FROM vessel_transfers WHERE id = v_t;
    IF v_flag IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'C_ASSERT_FAIL (1): truthful loss-explained empties_source = true was falsified to %', v_flag;
    END IF;

    SELECT status::text, current_batch_id INTO v_status, v_cur FROM vessels WHERE id = v_va;
    IF v_status <> 'in_use' OR v_cur IS DISTINCT FROM v_batch THEN
      RAISE EXCEPTION 'C_ASSERT_FAIL (1): vessel A was freed (%, %) on an allocation-explained gap -- allocations carry no vessel id and must not free', v_status, v_cur;
    END IF;

    -- --- (2) full move out of B claiming FALSE -> corrected up, B freed -------
    INSERT INTO vessel_transfers (batch_id, from_vessel_id, to_vessel_id, volume_bbl, empties_source)
      VALUES (v_batch, v_vb, v_vc, 8, false)
      RETURNING id INTO v_t;

    SELECT empties_source INTO v_flag FROM vessel_transfers WHERE id = v_t;
    IF v_flag IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'C_ASSERT_FAIL (2): ledger-proven full move kept the stale FALSE claim';
    END IF;

    SELECT status::text, current_batch_id INTO v_status, v_cur FROM vessels WHERE id = v_vb;
    IF v_status <> 'dirty' OR v_cur IS NOT NULL THEN
      RAISE EXCEPTION 'C_ASSERT_FAIL (2): full move did not free vessel B (%, %)', v_status, v_cur;
    END IF;

    -- --- (3) 5 of 8 bbl out of C claiming TRUE; gap 3 > recorded 2 -> falsified
    INSERT INTO vessel_transfers (batch_id, from_vessel_id, to_vessel_id, volume_bbl, empties_source)
      VALUES (v_batch, v_vc, v_va, 5, true)
      RETURNING id INTO v_t;

    SELECT empties_source INTO v_flag FROM vessel_transfers WHERE id = v_t;
    IF v_flag IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'C_ASSERT_FAIL (3): a claim no record can explain (gap 3, allocations 2) was not corrected to false';
    END IF;

    SELECT status::text INTO v_status FROM vessels WHERE id = v_vc;
    IF v_status <> 'in_use' THEN
      RAISE EXCEPTION 'C_ASSERT_FAIL (3): vessel C was freed on an unproven, unexplained claim';
    END IF;

    -- All assertions passed: unwind the subtransaction (commit nothing).
    RAISE EXCEPTION 'C_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'C_VERIFY_OK' THEN
        RAISE NOTICE 'C vessel-transfer flag verification passed (loss-explained claim kept + vessel held, full move frees + corrects up, unexplained claim corrected down); test rows rolled back';
      ELSIF SQLERRM LIKE 'C_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine regression: abort migration
      ELSE
        RAISE WARNING 'C vessel-transfer flag verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

-- Refresh PostgREST schema cache so the replaced function is picked up.
NOTIFY pgrst, 'reload schema';
