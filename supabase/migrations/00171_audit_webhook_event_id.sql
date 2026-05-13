-- Audit finding F-135: webhook dedup race.
--
-- The current Square webhook handler checks `square_sync_log` for a prior
-- entry matching `details->>'order_id'` before inserting. Two concurrent
-- retries of the same webhook can both pass that pre-check before either
-- INSERT lands, resulting in duplicate downstream side effects.
--
-- Fix: promote `event_id` to a top-level column and add a UNIQUE constraint.
-- PostgreSQL UNIQUE constraints already allow multiple NULLs (each NULL is
-- distinct), so rows without event_id can still be inserted freely.
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

-- Full UNIQUE constraint (not a partial index) is required so that Supabase's
-- ON CONFLICT (event_id) clause can resolve to a constraint rather than an
-- index, which PostgreSQL requires for DO NOTHING / DO UPDATE to work.
ALTER TABLE square_sync_log
  ADD CONSTRAINT uniq_square_sync_log_event_id UNIQUE (event_id);

COMMENT ON COLUMN square_sync_log.event_id IS
  'Square webhook event id, promoted from details JSONB so a UNIQUE index '
  'can enforce dedup race-safely (audit F-135).';
