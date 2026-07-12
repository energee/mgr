-- 00243_square_catalog_map_pour_size.sql
-- Draft (keg-pour) Square sales -> TTB removals: schema for audit findings
-- BD-2 (draft-sale reconciliation) and BD-3 (per-variation pour size).
--
-- NUMBERING: 00236-00242 are claimed (00241 refund_ingest is on main; 00242 by
-- the 00236 renumber, PR #381); 00243 is the
-- number reserved for this branch. NOT applied live -- deploy via
-- scripts/db-push.sh after merge; do not apply this file to any live DB by hand.
--
-- 1. BD-3 -- square_catalog_map.pour_size_oz. The webhook staged every draft
--    line at a hard-coded 16 oz per unit sold (STANDARD_POUR_OZ,
--    src/integrations/square/utils.ts), so a 10 oz tulip pour or a 32 oz
--    crowler variation mis-recorded its volume. Each ITEM_VARIATION mapping
--    can now carry its own pour size; NULL keeps the 16 oz default (the app
--    falls back to STANDARD_POUR_OZ, which stays as the documented default).
--
-- 2. BD-2 -- square_draft_sales.reconciled_at. Draft sales are staged volume
--    that never reached TTB taxpaid removals (taproom pours are taxpaid
--    removals -- docs/knowledge/brewing-domain.md). The reconciliation route
--    (api/square/reconcile-draft-sales) converts unreconciled rows into
--    COMPLETED finished_good -> taproom_sale allocations (the
--    get_ttb_removals_summary arm added in 00203) and stamps this column.
--    NULL = not yet reconciled. No backfill: historical rows are reconciled by
--    running the route, not by fiat.
--
-- 3. BD-2 observability -- square_sync_log.sync_type gains 'draft_reconcile'
--    so each reconciliation run logs a durable per-run summary (per-row
--    failures in details), same discipline as the other Square sync flows.
--
-- Live-safe: two additive nullable columns, one partial index, a CHECK swap
-- validated against existing rows (all use the four 00233 values). Verified by
-- a self-rolling-back DO block at the end (commits NO rows).

-- =============================================================================
-- PART 1 -- BD-3: per-variation pour size
-- =============================================================================

ALTER TABLE square_catalog_map
  ADD COLUMN IF NOT EXISTS pour_size_oz NUMERIC CHECK (pour_size_oz > 0);

COMMENT ON COLUMN square_catalog_map.pour_size_oz IS
  'Fluid ounces poured per unit sold of this ITEM_VARIATION when it is a draft (keg) line (00243, audit BD-3). NULL = the app default of 16 oz (STANDARD_POUR_OZ in src/integrations/square/utils.ts). Only meaningful for keg-container variations; ignored for packaged lines, which debit whole selling units.';

-- =============================================================================
-- PART 2 -- BD-2: draft-sale reconciliation stamp
-- =============================================================================

ALTER TABLE square_draft_sales
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

COMMENT ON COLUMN square_draft_sales.reconciled_at IS
  'When this staged draft sale was converted into COMPLETED finished_good -> taproom_sale allocations for TTB removals by api/square/reconcile-draft-sales (00243, audit BD-2). NULL = not yet reconciled. Exactly-once is enforced app-side via allocations.idempotency_key = ''square_draft_sale:<id>'' (00215 pattern); this stamp is the queue marker, not the idempotency guard.';

-- The reconciliation route reads WHERE reconciled_at IS NULL ORDER BY sold_at;
-- the settings page badge counts the same predicate.
CREATE INDEX IF NOT EXISTS idx_square_draft_sales_unreconciled
  ON square_draft_sales (sold_at)
  WHERE reconciled_at IS NULL;

-- =============================================================================
-- PART 3 -- BD-2: sync_type admits 'draft_reconcile'
-- =============================================================================

ALTER TABLE square_sync_log
  DROP CONSTRAINT IF EXISTS square_sync_log_sync_type_check;
ALTER TABLE square_sync_log
  ADD CONSTRAINT square_sync_log_sync_type_check
  CHECK (sync_type IN ('catalog_push', 'inventory_push', 'sale_ingest', 'inventory_event', 'refund_ingest', 'draft_reconcile'));
-- ^ MUST list 00241's refund_ingest too: this rewrite replaces 00241's CHECK,
--   and dropping a value here would break the refund webhook's logging.

COMMENT ON COLUMN square_sync_log.sync_type IS
  'Type of sync: catalog_push / inventory_push (MGR pushing OUT to Square), sale_ingest (a sale coming IN via the payment webhook), inventory_event (Square''s own inventory.count.updated echo, informational only -- 00233), refund_ingest (a refund coming IN via the refund webhook, reversing an ingested sale -- 00241), or draft_reconcile (a draft-sale -> TTB-removal reconciliation run -- 00243). Mirror of SquareSyncType in src/integrations/square/types.ts.';

-- =============================================================================
-- PART 4 -- verification (self-rolling-back; commits NO rows)
-- =============================================================================
-- Proves, then rolls back:
--   (a) pour_size_oz accepts a positive value and REJECTS a non-positive one
--       (check_violation);
--   (b) sync_type 'draft_reconcile' is accepted; an unknown value is still
--       rejected by the CHECK;
--   (c) reconciled_at exists on square_draft_sales, defaults NULL, and is
--       stampable.
--
-- Same self-rolling-back idiom as 00223/00224/00233: a passing run RAISEs
-- 'PS_VERIFY_OK' to unwind the subtransaction (commits nothing); a genuine
-- logic failure RAISEs 'PS_ASSERT_FAIL...' and re-raises to ABORT the
-- migration; any other error (missing prerequisites -- e.g. a from-scratch
-- replay where 00091's original square_draft_sales shape with NOT NULL
-- keg_type_id still exists) is downgraded to a WARNING so the DDL above still
-- applies. Check (c) runs LAST for exactly that reason: its fixture insert is
-- the one step that can fail on a replayed chain, and putting it last lets
-- (a) and (b) assert unconditionally first.
DO $$
DECLARE
  v_sfx      TEXT := replace(gen_random_uuid()::text, '-', '');
  v_brand    UUID;
  v_loc      UUID;
  v_draft    UUID;
  v_stamp    TIMESTAMPTZ;
  v_rejected BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO brands (name) VALUES ('PS_brand_' || v_sfx) RETURNING id INTO v_brand;

    -- (a) positive pour size inserts fine ...
    INSERT INTO square_catalog_map (brand_id, square_catalog_id, object_type, pour_size_oz)
      VALUES (v_brand, 'PS_var_ok_' || v_sfx, 'ITEM_VARIATION', 12.5);

    -- ... a non-positive pour size must be rejected.
    BEGIN
      INSERT INTO square_catalog_map (brand_id, square_catalog_id, object_type, pour_size_oz)
        VALUES (v_brand, 'PS_var_bad_' || v_sfx, 'ITEM_VARIATION', 0);
    EXCEPTION WHEN check_violation THEN
      v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'PS_ASSERT_FAIL (a): pour_size_oz = 0 was NOT rejected by the CHECK';
    END IF;

    -- (b) the new sync_type inserts fine; an unknown one is still rejected.
    INSERT INTO square_sync_log (sync_type, started_at, details)
      VALUES ('draft_reconcile', now(), jsonb_build_object('verify', v_sfx));
    v_rejected := false;
    BEGIN
      INSERT INTO square_sync_log (sync_type, started_at, details)
        VALUES ('PS_bogus_type', now(), jsonb_build_object('verify', v_sfx));
    EXCEPTION WHEN check_violation THEN
      v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'PS_ASSERT_FAIL (b): unknown sync_type was NOT rejected by square_sync_log_sync_type_check';
    END IF;

    -- (c) reconciled_at defaults NULL and stamps. (Last: the fixture insert
    -- can fail on a from-scratch replay -- see the block comment.)
    INSERT INTO locations (name) VALUES ('PS_loc_' || v_sfx) RETURNING id INTO v_loc;
    INSERT INTO square_draft_sales (square_order_id, brand_id, quantity, volume_oz, location_id, sold_at)
      VALUES ('PS_order_' || v_sfx, v_brand, 2, 32, v_loc, now())
      RETURNING id INTO v_draft;
    SELECT reconciled_at INTO v_stamp FROM square_draft_sales WHERE id = v_draft;
    IF v_stamp IS NOT NULL THEN
      RAISE EXCEPTION 'PS_ASSERT_FAIL (c): reconciled_at defaulted non-NULL (%)', v_stamp;
    END IF;
    UPDATE square_draft_sales SET reconciled_at = now() WHERE id = v_draft;
    SELECT reconciled_at INTO v_stamp FROM square_draft_sales WHERE id = v_draft;
    IF v_stamp IS NULL THEN
      RAISE EXCEPTION 'PS_ASSERT_FAIL (c): reconciled_at did not stamp';
    END IF;

    RAISE EXCEPTION 'PS_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'PS_VERIFY_OK' THEN
        RAISE NOTICE 'PS pour-size/reconciliation verification passed (a CHECK rejects non-positive, b draft_reconcile admitted + bogus rejected, c reconciled_at stamps); test rows rolled back';
      ELSIF SQLERRM LIKE 'PS_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine constraint bug: abort migration
      ELSE
        RAISE WARNING 'PS pour-size/reconciliation verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
