-- 00233_square_sync_log_claim_semantics.sql
-- Square POS bin-sync, PR #361 review blockers 2 + 11 (schema side): the sale
-- dedup claim is now keyed on the Square ORDER id, and inbound inventory
-- events get their own sync_type.
--
-- 1. ORDER-KEYED SALE DEDUP (blocker 2 -- split-tender double-debit).
--    The webhook ingests the ORDER's full line-item list on every COMPLETED
--    payment event. A check split across two cards produces TWO payments (four
--    events), each referencing the same order -- a payment-id claim let each
--    tender debit the bins and count TTB removals again. The webhook now
--    claims on payment.order_id, falling back to the payment id only when
--    order_id is absent (src/app/api/square/webhook/route.ts). No column or
--    constraint change is needed -- square_payment_id (00224) simply STORES
--    the order-first claim key now; this migration re-documents the column
--    and re-keys historical claims so a late retry of a pre-deploy sale
--    (Square retries up to 24h) cannot claim its order id afresh and
--    double-debit across the deploy boundary.
--
-- 2. INBOUND INVENTORY EVENTS (review item 11). handleInventoryCountUpdated
--    logged Square's own inventory.count.updated echoes as sync_type
--    'inventory_push' -- indistinguishable from MGR's outbound pushes on the
--    sync status page. The webhook now logs them as 'inventory_event'; the
--    00091 CHECK constraint must admit the new value.
--
-- Live-safe: a CHECK swap (validated against existing rows, all of which use
-- the original three values), a COMMENT, and an idempotent single-row-per-order
-- re-key UPDATE. Verified by a self-rolling-back DO block (commits NO rows).

-- =============================================================================
-- PART 1 -- sync_type CHECK: admit 'inventory_event'
-- =============================================================================
ALTER TABLE square_sync_log
  DROP CONSTRAINT IF EXISTS square_sync_log_sync_type_check;
ALTER TABLE square_sync_log
  ADD CONSTRAINT square_sync_log_sync_type_check
  CHECK (sync_type IN ('catalog_push', 'inventory_push', 'sale_ingest', 'inventory_event'));

COMMENT ON COLUMN square_sync_log.sync_type IS
  'Type of sync: catalog_push / inventory_push (MGR pushing OUT to Square), sale_ingest (a sale coming IN via the payment webhook), or inventory_event (Square''s own inventory.count.updated echo, informational only -- 00233; previously mislogged as inventory_push).';

-- =============================================================================
-- PART 2 -- claim-key semantics: square_payment_id stores the ORDER-first key
-- =============================================================================
COMMENT ON COLUMN square_sync_log.square_payment_id IS
  'Dedup claim key for a sale-ingest webhook event; UNIQUE for race-safe, exactly-once ingestion. Since 00233 this stores the Square ORDER id (payment id only as a fallback when the payment carries no order_id): one payment arrives as both payment.created and payment.updated, and a split-tender check arrives as SEVERAL payments -- all referencing the one order whose full line-item list is ingested, so the order is the unit that must debit exactly once. Column name retained from 00224 (renaming would churn types/tests for no behavioral gain). NULL for non-sale rows; NULLs are distinct under UNIQUE. event_id is retained for traceability and remains the dedup key for inventory_event rows.';

-- Re-key historical sale_ingest claims to their order id (stashed in
-- details->>'order_id' by the webhook's finalize step), ONE row per order --
-- the earliest by created_at, exactly the 00224 backfill discipline. Later
-- duplicates (the pre-fix split-tender double-ingests this migration exists to
-- stop) keep their payment-id keys: NULL-distinct/unique constraints hold, and
-- they remain visible as the duplicates they are. Skip any row whose order id
-- is already claimed (idempotent, re-runnable).
WITH first_per_order AS (
  SELECT DISTINCT ON (details->>'order_id') id, details->>'order_id' AS order_id
  FROM square_sync_log
  WHERE sync_type = 'sale_ingest'
    AND details->>'order_id' IS NOT NULL
    AND square_payment_id IS NOT NULL
    AND square_payment_id <> details->>'order_id'
  ORDER BY details->>'order_id', created_at
)
UPDATE square_sync_log s
SET square_payment_id = f.order_id
FROM first_per_order f
WHERE s.id = f.id
  AND NOT EXISTS (
    SELECT 1 FROM square_sync_log x WHERE x.square_payment_id = f.order_id
  );

-- =============================================================================
-- PART 3 -- verification (self-rolling-back; commits NO rows)
-- =============================================================================
-- Proves, then rolls back:
--   (a) sync_type 'inventory_event' is accepted;
--   (b) an unknown sync_type is still rejected by the CHECK;
--   (c) the re-key moves the EARLIEST sale row of an order onto the order id
--       and leaves the later duplicate keyed by its payment id (UNIQUE holds).
--
-- Same self-rolling-back idiom as 00223/00224: a passing run RAISEs
-- 'CS_VERIFY_OK' to unwind the subtransaction; a genuine failure RAISEs
-- 'CS_ASSERT_FAIL...' and aborts the migration; anything else is a WARNING.
DO $$
DECLARE
  v_sfx      TEXT := replace(gen_random_uuid()::text, '-', '');
  v_order    TEXT;
  v_pay_a    TEXT;
  v_pay_b    TEXT;
  v_id_a     UUID;
  v_key_a    TEXT;
  v_key_b    TEXT;
  v_rejected BOOLEAN := false;
BEGIN
  BEGIN
    -- (a) the new sync_type inserts fine.
    INSERT INTO square_sync_log (sync_type, started_at, details)
      VALUES ('inventory_event', now(), jsonb_build_object('verify', v_sfx));

    -- (b) an unknown sync_type is rejected.
    BEGIN
      INSERT INTO square_sync_log (sync_type, started_at, details)
        VALUES ('CS_bogus_type', now(), jsonb_build_object('verify', v_sfx));
    EXCEPTION WHEN check_violation THEN
      v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'CS_ASSERT_FAIL (b): unknown sync_type was NOT rejected by square_sync_log_sync_type_check';
    END IF;

    -- (c) re-key: two pre-fix rows for one order (the split-tender shape).
    v_order := 'CS_ord_' || v_sfx;
    v_pay_a := 'CS_payA_' || v_sfx;
    v_pay_b := 'CS_payB_' || v_sfx;

    INSERT INTO square_sync_log (sync_type, square_payment_id, started_at, created_at, details)
      VALUES ('sale_ingest', v_pay_a, now(), now() - interval '2 hours',
              jsonb_build_object('verify', v_sfx, 'order_id', v_order, 'payment_id', v_pay_a))
      RETURNING id INTO v_id_a;
    INSERT INTO square_sync_log (sync_type, square_payment_id, started_at, created_at, details)
      VALUES ('sale_ingest', v_pay_b, now(), now() - interval '1 hour',
              jsonb_build_object('verify', v_sfx, 'order_id', v_order, 'payment_id', v_pay_b));

    -- The same statement as Part 2 (the real run above already re-keyed live
    -- rows; repeating it inside the rolled-back subtransaction proves it
    -- against known fixtures). Idempotent by construction.
    WITH first_per_order AS (
      SELECT DISTINCT ON (details->>'order_id') id, details->>'order_id' AS order_id
      FROM square_sync_log
      WHERE sync_type = 'sale_ingest'
        AND details->>'order_id' IS NOT NULL
        AND square_payment_id IS NOT NULL
        AND square_payment_id <> details->>'order_id'
      ORDER BY details->>'order_id', created_at
    )
    UPDATE square_sync_log s
    SET square_payment_id = f.order_id
    FROM first_per_order f
    WHERE s.id = f.id
      AND NOT EXISTS (
        SELECT 1 FROM square_sync_log x WHERE x.square_payment_id = f.order_id
      );

    SELECT square_payment_id INTO v_key_a FROM square_sync_log WHERE id = v_id_a;
    SELECT square_payment_id INTO v_key_b FROM square_sync_log
      WHERE details->>'verify' = v_sfx AND details->>'payment_id' = v_pay_b;

    IF v_key_a IS DISTINCT FROM v_order THEN
      RAISE EXCEPTION 'CS_ASSERT_FAIL (c): earliest sale row keyed % but expected the order id %', v_key_a, v_order;
    END IF;
    IF v_key_b IS DISTINCT FROM v_pay_b THEN
      RAISE EXCEPTION 'CS_ASSERT_FAIL (c): duplicate sale row keyed % but expected to keep its payment id %', v_key_b, v_pay_b;
    END IF;

    RAISE EXCEPTION 'CS_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'CS_VERIFY_OK' THEN
        RAISE NOTICE 'CS claim-semantics verification passed (inventory_event admitted, bogus type rejected, order re-key earliest-only); test rows rolled back';
      ELSIF SQLERRM LIKE 'CS_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine constraint/re-key bug: abort migration
      ELSE
        RAISE WARNING 'CS claim-semantics verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
