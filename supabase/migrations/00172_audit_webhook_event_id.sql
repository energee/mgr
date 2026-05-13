-- Audit finding F-135: webhook dedup race.
--
-- The current Square webhook handler checks `square_sync_log` for a prior
-- entry matching `details->>'order_id'` before inserting. Two concurrent
-- retries of the same webhook can both pass that pre-check before either
-- INSERT lands, resulting in duplicate downstream side effects.
--
-- Fix: promote `event_id` to a top-level column and add a UNIQUE constraint
-- (partial, so logs that lack an event_id can still be inserted multiple
-- times — e.g., the inventory.count.updated entries the handler writes
-- without a Square event id).
--
-- The handler's upsert with `ignoreDuplicates: true` then makes dedup
-- race-safe regardless of how many concurrent retries Square sends.

ALTER TABLE square_sync_log
  ADD COLUMN IF NOT EXISTS event_id TEXT;

-- Backfill from the existing details JSONB so production rows retain the
-- value where it was previously stashed.
UPDATE square_sync_log
SET event_id = details->>'event_id'
WHERE event_id IS NULL
  AND details->>'event_id' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_square_sync_log_event_id
  ON square_sync_log (event_id)
  WHERE event_id IS NOT NULL;

COMMENT ON COLUMN square_sync_log.event_id IS
  'Square webhook event id, promoted from details JSONB so a UNIQUE index '
  'can enforce dedup race-safely (audit F-135).';
