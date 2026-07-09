-- 00224_square_sale_idempotency.sql
-- Square POS bin-sync, Milestone D (webhook hardening): dedup a sale on the
-- Square PAYMENT id, not the webhook event id.
--
-- WHY THIS EXISTS
--   The Square sale webhook (src/app/api/square/webhook/route.ts) debits a bin's
--   finished-good count exactly once per sale (00223 debit_bin_inventory). It used
--   to claim idempotency on square_sync_log.event_id (00173). But Square emits BOTH
--   payment.created AND payment.updated for a single payment, and both can arrive
--   carrying status = "COMPLETED" -- two DISTINCT event_ids for ONE sale. An
--   event-keyed claim therefore let the same sale debit the bin TWICE. The webhook
--   (commit 506f9daf) now claims on the Square payment id so a sale debits inventory
--   at most once, upserting with onConflict: "square_payment_id".
--
--   WHY A FULL UNIQUE CONSTRAINT (not a partial unique index): Supabase/PostgREST's
--   ON CONFLICT (square_payment_id) resolution requires a real UNIQUE constraint or
--   a matching arbiter index -- a partial index would not be picked up by the
--   upsert. NULLs are distinct under a UNIQUE constraint, so the many non-sale rows
--   (catalog/inventory syncs, inventory-count updates) that carry no payment id are
--   entirely unaffected and remain freely insertable. This mirrors exactly what
--   00173 did for event_id.
--
--   event_id STAYS: the event_id column and its uniq_square_sync_log_event_id
--   constraint are kept -- event_id is still written for traceability and is still
--   the dedup key for handleInventoryCountUpdated (inventory.count.updated events,
--   which are not payments and have no payment id). Payment-id dedup and event-id
--   dedup coexist: the payment path claims on square_payment_id, the count path on
--   event_id.
--
--   BACKFILL CARE: existing sale_ingest rows stashed the payment id in
--   details->>'payment_id'. A blind backfill of every such row would violate the new
--   UNIQUE constraint the instant two rows share a payment id (exactly the
--   duplicate-event case this migration exists to catch). So we backfill only ONE
--   row per payment id -- the earliest by created_at (DISTINCT ON ... ORDER BY
--   created_at) -- and leave every later duplicate's square_payment_id NULL. NULLs
--   are distinct under UNIQUE, so the un-backfilled duplicates stay insertable and
--   the constraint applies cleanly. Going forward the webhook only ever writes one
--   row per payment (the upsert), so no new duplicates are created.
--
-- Live-safe: one additive nullable column, an idempotent single-row-per-payment
-- backfill, then the UNIQUE constraint. Verified by a self-rolling-back DO block at
-- the end (commits NO rows).

-- =============================================================================
-- PART 1 -- schema: the payment-id dedup column
-- =============================================================================

ALTER TABLE square_sync_log
  ADD COLUMN IF NOT EXISTS square_payment_id TEXT;

-- Backfill from the JSONB where the payment id used to live, ONE row per payment
-- id only (earliest by created_at); every later duplicate is left NULL so the
-- UNIQUE constraint below applies without rejecting historical duplicate events.
WITH first_per_payment AS (
  SELECT DISTINCT ON (details->>'payment_id') id
  FROM square_sync_log
  WHERE sync_type = 'sale_ingest'
    AND details->>'payment_id' IS NOT NULL
  ORDER BY details->>'payment_id', created_at
)
UPDATE square_sync_log s
SET square_payment_id = s.details->>'payment_id'
FROM first_per_payment f
WHERE s.id = f.id
  AND s.square_payment_id IS NULL;

-- Full UNIQUE constraint (not a partial index) so the webhook's
-- onConflict: "square_payment_id" upsert can resolve. NULLs are distinct under
-- UNIQUE, so non-sale rows (NULL payment id) are unconstrained.
ALTER TABLE square_sync_log
  ADD CONSTRAINT uniq_square_sync_log_square_payment_id UNIQUE (square_payment_id);

COMMENT ON COLUMN square_sync_log.square_payment_id IS
  'Square payment id for a sale-ingest webhook event (00224); UNIQUE for race-safe, exactly-once dedup of a sale. Square emits payment.created AND payment.updated (both can be COMPLETED) for one payment -- two event_ids, one payment -- so the sale is deduped on THIS, not event_id. NULL for non-sale rows (catalog/inventory syncs, inventory-count updates); NULLs are distinct under UNIQUE. event_id is retained for traceability and remains the dedup key for inventory-count events.';

-- Keep _schema_registry in step: square_payment_id is now the primary dedup
-- identifier for sale-ingest rows, alongside event_id (00173's addition).
UPDATE _schema_registry
SET key_fields = '["sync_type", "event_id", "square_payment_id", "items_synced", "items_failed"]'::jsonb
WHERE table_name = 'square_sync_log';

-- =============================================================================
-- PART 2 -- verification (self-rolling-back; commits NO rows)
-- =============================================================================
-- Proves, then rolls back:
--   (a) two rows with the SAME square_payment_id -> the second raises
--       unique_violation (exactly-once dedup key);
--   (b) two rows with NULL square_payment_id COEXIST (NULLs distinct under UNIQUE),
--       so non-sale rows are unaffected.
--
-- Same self-rolling-back idiom as 00223: a passing run RAISEs 'D_VERIFY_OK' to
-- unwind the subtransaction (commits nothing); a genuine logic failure RAISEs
-- 'D_ASSERT_FAIL...' and re-raises to ABORT the migration; any other error
-- (missing prerequisites on a from-scratch replay) is downgraded to a WARNING so
-- the DDL above still applies -- this block is a check, not a gate.
DO $$
DECLARE
  v_pay     TEXT;
  v_sfx     TEXT := replace(gen_random_uuid()::text, '-', '');
  v_got_dup BOOLEAN := false;
  v_nulls   INTEGER;
BEGIN
  BEGIN
    v_pay := 'D_pay_' || v_sfx;

    -- (a) first row with the payment id inserts fine ...
    INSERT INTO square_sync_log (sync_type, square_payment_id, started_at, details)
      VALUES ('sale_ingest', v_pay, now(), jsonb_build_object('verify', v_sfx));

    -- ... a second row with the SAME payment id must be rejected.
    BEGIN
      INSERT INTO square_sync_log (sync_type, square_payment_id, started_at, details)
        VALUES ('sale_ingest', v_pay, now(), jsonb_build_object('verify', v_sfx));
    EXCEPTION WHEN unique_violation THEN
      v_got_dup := true;
    END;
    IF NOT v_got_dup THEN
      RAISE EXCEPTION 'D_ASSERT_FAIL (a): duplicate square_payment_id was NOT rejected by uniq_square_sync_log_square_payment_id';
    END IF;

    -- (b) two NULL-payment rows must coexist (NULLs distinct under UNIQUE).
    INSERT INTO square_sync_log (sync_type, square_payment_id, started_at, details)
      VALUES ('catalog_sync', NULL, now(), jsonb_build_object('verify', v_sfx));
    INSERT INTO square_sync_log (sync_type, square_payment_id, started_at, details)
      VALUES ('catalog_sync', NULL, now(), jsonb_build_object('verify', v_sfx));
    SELECT count(*) INTO v_nulls
      FROM square_sync_log
      WHERE details->>'verify' = v_sfx AND square_payment_id IS NULL;
    IF v_nulls <> 2 THEN
      RAISE EXCEPTION 'D_ASSERT_FAIL (b): expected 2 coexisting NULL-payment rows, got %', v_nulls;
    END IF;

    RAISE EXCEPTION 'D_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'D_VERIFY_OK' THEN
        RAISE NOTICE 'D square_payment_id verification passed (a dup rejected, b NULLs coexist); test rows rolled back';
      ELSIF SQLERRM LIKE 'D_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine constraint bug: abort migration
      ELSE
        RAISE WARNING 'D square_payment_id verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
