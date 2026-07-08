-- 00210_vessel_transfer_integrity.sql
-- Audit fixes M3/M4/M5 (backlog #16): vessel-transfer integrity.
--
-- M3 — no double-submit guard. The transfer dialog comments that a unique index
--   `idx_vessel_transfers_unique_per_batch` provides the constraint and handles
--   23505, but no such index ever existed; a double-click / retry inserts a
--   duplicate transfer row and double-counts transferred volume. Fix: a
--   client-supplied idempotency_key (one per dialog-open) + a partial unique
--   index, so a repeated submit of the same logical transfer collides (23505)
--   instead of duplicating. (Existing rows have NULL keys and are exempt.)
--
-- M4 — handle_vessel_transfer() overwrote destination occupancy unconditionally,
--   so two batches transferred into the same vessel silently reassigned it and
--   orphaned the first. Fix: reject a transfer whose destination already holds a
--   different batch.
--
-- M5 — the trigger always freed the source vessel (dirty + clear batch),
--   regardless of how much volume moved, so a partial/split transfer emptied the
--   source in the DB and made the remaining beer un-addressable. Fix: an
--   empties_source flag (set by the caller; default true preserves the historical
--   full-transfer behavior) gates the source-freeing step.

-- --- M3: idempotency key + partial unique index ------------------------------
ALTER TABLE vessel_transfers ADD COLUMN IF NOT EXISTS idempotency_key UUID;

COMMENT ON COLUMN vessel_transfers.idempotency_key IS
  'Client-supplied key (one per transfer submission) deduped by idx_vessel_transfers_idempotency_key. A repeated submit reuses the key and collides (23505) instead of inserting a duplicate. NULL for pre-00210 rows / server-side inserts.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_vessel_transfers_idempotency_key
  ON vessel_transfers (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- --- M5: partial-vs-full move flag -------------------------------------------
ALTER TABLE vessel_transfers ADD COLUMN IF NOT EXISTS empties_source BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN vessel_transfers.empties_source IS
  'Whether this transfer moves all remaining volume out of the source vessel. When true (default) handle_vessel_transfer() frees the source (dirty + clear current_batch_id); when false (a partial/split move) the source stays occupied.';

-- --- M4 + M5: guarded trigger body ------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_vessel_transfer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- M4: refuse to double-book the destination. Allow an empty vessel or one
  -- already holding this same batch (idempotent re-transfer / consolidation);
  -- reject a vessel currently holding a different batch.
  IF EXISTS (
    SELECT 1 FROM vessels
    WHERE id = NEW.to_vessel_id
      AND current_batch_id IS NOT NULL
      AND current_batch_id <> NEW.batch_id
  ) THEN
    RAISE EXCEPTION 'The destination vessel already holds a different batch — refresh and choose an empty vessel.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Destination vessel now holds this batch.
  UPDATE vessels
  SET status = 'in_use',
      current_batch_id = NEW.batch_id,
      updated_at = NOW()
  WHERE id = NEW.to_vessel_id;

  -- M5: free the source only when this transfer empties it (full move). A
  -- partial/split transfer (empties_source = false) leaves the source occupied.
  -- NULL from_vessel_id = knockout from kettle (no source vessel to free).
  IF NEW.from_vessel_id IS NOT NULL AND NEW.empties_source THEN
    UPDATE vessels
    SET status = 'dirty',
        current_batch_id = NULL,
        updated_at = NOW()
    WHERE id = NEW.from_vessel_id;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.handle_vessel_transfer() IS
  'Updates vessel status/current_batch_id on transfer insert. Rejects double-booking the destination (M4); frees the source only on a full move (empties_source, M5).';

NOTIFY pgrst, 'reload schema';
