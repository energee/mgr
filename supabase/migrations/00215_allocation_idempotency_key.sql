-- 00215_allocation_idempotency_key.sql
-- Audit backlog #15 (second half): stop keying allocation idempotence on the
-- mutable free-text `notes` column.
--
-- Two flows re-ran safely only because they searched `notes` for a tag string:
--   * packaging-material depletion (consumePackagingMaterials) guarded on
--     notes = 'Packaging session <id> material consumption';
--   * batch loss reconciliation (reconcileBatchLoss) guarded on
--     notes LIKE 'Completion loss reconciliation%'.
-- `notes` is user-editable (allocations render in a generic editable list), so
-- an innocent edit to those rows silently breaks idempotence -> double
-- depletion / double loss reconciliation.
--
-- Fix — split across DB + app:
--   * Batch loss reconciliation moves to the STRUCTURED `reason_code =
--     'reconciliation'` it already writes (recordBatchLoss) — no new column.
--   * Packaging depletion has no structured link to its session, so this
--     migration adds a dedicated `idempotency_key` column the app tags with
--     'pkg_session:<session_id>' and guards on. It is a system field, never
--     surfaced for editing.
--
-- No backfill: live currently has zero rows matching either notes pattern
-- (verified), so this is forward-looking hardening, not a data migration.
--
-- ponytail: plain partial index, NOT a UNIQUE constraint. Packaging depletion
-- writes MANY allocation rows under one key (one per FIFO lot pick), so a
-- unique index can't fit; idempotence stays an app-level guard on this stable
-- column (upgrade path: a separate depletion-event table with a UNIQUE key if
-- DB-enforced single-run is ever needed).

ALTER TABLE allocations ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

COMMENT ON COLUMN allocations.idempotency_key IS
  'Stable structured idempotence tag for system-generated allocation batches (e.g. pkg_session:<session_id> for packaging-material depletion). Replaces keying idempotence on the mutable free-text notes column (audit #15). Not user-editable in normal flows.';

CREATE INDEX IF NOT EXISTS idx_allocations_idempotency_key
  ON allocations (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
