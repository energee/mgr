-- Audit finding F-135: webhook dedup race.
--
-- The prior order_id-based pre-check in square_sync_log was racy: two
-- concurrent retries could both read "not seen" before either INSERT landed.
-- Promote event_id to a top-level column with a UNIQUE constraint so the
-- handler's upsert+ignoreDuplicates is race-safe regardless of concurrency.
-- A full UNIQUE constraint (not a partial index) is required for Supabase's
-- ON CONFLICT (event_id) to resolve. NULLs are distinct under UNIQUE, so
-- rows without event_id are still insertable.

ALTER TABLE square_sync_log
  ADD COLUMN IF NOT EXISTS event_id TEXT;

-- Backfill rows whose event_id was previously stashed in details JSONB.
UPDATE square_sync_log
SET event_id = details->>'event_id'
WHERE event_id IS NULL
  AND details->>'event_id' IS NOT NULL;

ALTER TABLE square_sync_log
  ADD CONSTRAINT uniq_square_sync_log_event_id UNIQUE (event_id);

COMMENT ON COLUMN square_sync_log.event_id IS
  'Square webhook event id; UNIQUE for race-safe dedup (audit F-135).';

-- Keep _schema_registry in sync with the new dedup column so AI tooling and
-- docs reflect that event_id is a primary identifier on this table.
UPDATE _schema_registry
SET key_fields = '["sync_type", "event_id", "items_synced", "items_failed"]'::jsonb
WHERE table_name = 'square_sync_log';
