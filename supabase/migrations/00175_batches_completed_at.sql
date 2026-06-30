-- =============================================================================
-- Migration: batches.completed_at
-- =============================================================================
-- Batches had no completion timestamp, so reports (notably the TTB report at
-- src/app/(app)/reports/ttb/page.tsx) had to attribute completed batches to a
-- month using planned_start_date — wrong-month attribution for any batch whose
-- production spans a month boundary.
--
-- Adds a nullable completed_at, backfills it for already-completed batches,
-- and installs a trigger that stamps it on the transition into 'completed'.
--
-- Batch terminal states are completed / cancelled / archived (see
-- src/lib/schemas/batch.ts batchTransitions). 'archived' is an escape hatch
-- from active production states — it does not pass through 'completed' — so
-- only status = 'completed' rows are backfilled.
--
-- Follow-up (see docs/plans/2026-06-09-audit-findings-fix-plan.md item 8.3):
-- after this migration is applied and `bun db:generate` refreshes
-- src/types/supabase.ts, switch ttb/page.tsx to filter on completed_at.
-- =============================================================================

ALTER TABLE batches ADD COLUMN IF NOT EXISTS completed_at timestamptz;

COMMENT ON COLUMN batches.completed_at IS
  'When the batch transitioned to status=completed. Set by trigger trg_batches_set_completed_at; null for batches that never completed.';

-- Backfill: updated_at is the best available approximation of the completion
-- time for historical rows (status changes touch updated_at, though so does
-- any later edit — acceptable for a one-time backfill).
UPDATE batches
SET completed_at = updated_at
WHERE status = 'completed'
  AND completed_at IS NULL;

-- Stamp completed_at automatically on the transition into 'completed'.
-- A trigger (rather than app code) guarantees the timestamp regardless of
-- which code path performs the status update (UI state machine, AI tools,
-- direct SQL). Does not overwrite an explicitly-set value.
CREATE OR REPLACE FUNCTION set_batch_completed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed'
     AND OLD.status IS DISTINCT FROM 'completed'
     AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_batch_completed_at IS
  'BEFORE UPDATE trigger on batches: stamps completed_at when status transitions to completed (unless already set).';

DROP TRIGGER IF EXISTS trg_batches_set_completed_at ON batches;
CREATE TRIGGER trg_batches_set_completed_at
  BEFORE UPDATE ON batches
  FOR EACH ROW
  EXECUTE FUNCTION set_batch_completed_at();
