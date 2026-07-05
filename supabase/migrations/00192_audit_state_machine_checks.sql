-- Migration: 00192_audit_state_machine_checks.sql
-- Audit findings F-130 + F-148: status columns are TEXT with no CHECK
-- constraint enforcing the canonical state-machine values. A typo or a
-- direct INSERT/UPDATE bypassing the API layer can silently land an
-- invalid status (e.g. "COMPLETED", "compleated") that breaks every
-- downstream filter. The 00143 transition triggers only fire on
-- UPDATE OF status, so they catch bad transitions but not bad INSERTs
-- or values outside the canonical set on rows they never see.
--
-- Value sets are mirrored from the state machines in src/entities/*/core.ts
-- (and src/lib/schemas/batch.ts for batches), which also back the
-- get_state_transitions() map in 00143. If those drift, update the
-- constraints in lock-step.
--
-- Tables intentionally NOT touched here:
--   - pick_lists (00057), allocations (00010), recipes (00071):
--     pre-existing status CHECKs.
--   - yeast_pitches (00035) and deliveries (00073): their CREATE TABLE
--     already includes an identical table-level CHECK, auto-named
--     <table>_status_check. Re-adding would be redundant (and a plain
--     ADD CONSTRAINT would collide with the existing name).
--
-- Safety / idempotency:
--   - Each ADD CONSTRAINT is guarded by a pg_constraint existence check
--     (same pattern as 00149) so the migration is re-runnable and safe
--     if a constraint was ever applied out-of-band.
--   - Constraints are added NOT VALID (no table scan under the brief
--     ACCESS EXCLUSIVE lock), then immediately VALIDATEd. VALIDATE
--     scans under SHARE UPDATE EXCLUSIVE only, so concurrent writes are
--     not blocked. VALIDATE on an already-valid constraint is a no-op.
--   - Existing data: batches historically allowed 'brewing' (removed
--     from enum_values in 00039 with no row backfill), but the live DB
--     was checked on 2026-07-05 and holds zero rows outside the
--     canonical sets on all six tables, so the in-migration VALIDATE
--     passes. On a fresh reset the tables are empty and VALIDATE is
--     trivially clean.

-- =============================================================================
-- batches
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'batches_status_check'
      AND conrelid = 'batches'::regclass
  ) THEN
    ALTER TABLE batches
      ADD CONSTRAINT batches_status_check
      CHECK (status IN (
        'planned', 'fermenting', 'conditioning', 'packaging',
        'completed', 'cancelled', 'archived'
      )) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE batches VALIDATE CONSTRAINT batches_status_check;

-- =============================================================================
-- orders
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_status_check'
      AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_status_check
      CHECK (status IN (
        'draft', 'confirmed', 'scheduled', 'picking', 'packed',
        'fulfilled', 'cancelled'
      )) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE orders VALIDATE CONSTRAINT orders_status_check;

-- =============================================================================
-- packaging_sessions
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'packaging_sessions_status_check'
      AND conrelid = 'packaging_sessions'::regclass
  ) THEN
    ALTER TABLE packaging_sessions
      ADD CONSTRAINT packaging_sessions_status_check
      CHECK (status IN (
        'planned', 'in_progress', 'completed', 'revised', 'cancelled'
      )) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE packaging_sessions VALIDATE CONSTRAINT packaging_sessions_status_check;

-- =============================================================================
-- location_transfers
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'location_transfers_status_check'
      AND conrelid = 'location_transfers'::regclass
  ) THEN
    ALTER TABLE location_transfers
      ADD CONSTRAINT location_transfers_status_check
      CHECK (status IN (
        'planned', 'in_transit', 'partial', 'completed', 'cancelled'
      )) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE location_transfers VALIDATE CONSTRAINT location_transfers_status_check;

-- =============================================================================
-- brew_logs
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brew_logs_status_check'
      AND conrelid = 'brew_logs'::regclass
  ) THEN
    ALTER TABLE brew_logs
      ADD CONSTRAINT brew_logs_status_check
      CHECK (status IN (
        'draft', 'in_progress', 'completed', 'cancelled'
      )) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE brew_logs VALIDATE CONSTRAINT brew_logs_status_check;

-- =============================================================================
-- purchase_orders
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_orders_status_check'
      AND conrelid = 'purchase_orders'::regclass
  ) THEN
    ALTER TABLE purchase_orders
      ADD CONSTRAINT purchase_orders_status_check
      CHECK (status IN (
        'draft', 'submitted', 'confirmed', 'partial',
        'fulfilled', 'cancelled', 'closed'
      )) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE purchase_orders VALIDATE CONSTRAINT purchase_orders_status_check;
