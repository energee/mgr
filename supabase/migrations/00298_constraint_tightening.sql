-- Migration: 00298_constraint_tightening.sql
-- Schema audit 2026-08-21 (docs/plans/2026-08-21-schema-audit.md, low-severity
-- "constraint-tightening bundle"): quantity/volume positivity CHECKs, a
-- locations name uniqueness constraint, and a batch_logs.log_type CHECK.
--
-- Live pre-checked 2026-08-21 (read-only): ZERO violating rows for every
-- constraint below, so the in-migration VALIDATEs pass on live; on a fresh
-- chain replay the tables are empty and VALIDATE is trivially clean.
--
-- Pattern follows 00192: each ADD CONSTRAINT is guarded by a pg_constraint
-- existence check (re-runnable, tolerant of out-of-band application), added
-- NOT VALID (no table scan under the ACCESS EXCLUSIVE lock), then VALIDATEd
-- (SHARE UPDATE EXCLUSIVE scan; no-op if already valid). The UNIQUE
-- constraint cannot be NOT VALID — locations is a tiny table, so the index
-- build under lock is negligible.
--
-- All CHECKs use strict > 0 (audit wording: "positivity"). NULL passes a
-- CHECK, so nullable columns (e.g. session_line_items.planned_quantity /
-- .actual_quantity, nullable — INTEGER in 00010, NUMERIC since 00288) still
-- admit NULL; only zero and negative values are rejected.
--
-- Deliberately SKIPPED from the audit bundle (already satisfied in the chain
-- and live — verified against supabase/live-catalog.snapshot.txt):
--   - bin_inventory:       CHECK (quantity >= 0) exists as
--     chk_bin_inventory_quantity_nonneg (00239); version column exists (00028).
--   - bin_inventory_items: created (00073) with inline CHECK (quantity >= 0)
--     (live: bin_inventory_items_quantity_check) and a version column.
--   "version parity" between the two tables therefore already holds in both
--   directions; nothing to add.

-- =============================================================================
-- 1. Positivity CHECKs — production volumes
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_vessel_transfers_volume_positive'
      AND conrelid = 'vessel_transfers'::regclass
  ) THEN
    ALTER TABLE vessel_transfers
      ADD CONSTRAINT chk_vessel_transfers_volume_positive
      CHECK (volume_bbl > 0) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE vessel_transfers VALIDATE CONSTRAINT chk_vessel_transfers_volume_positive;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_brew_log_batches_volume_positive'
      AND conrelid = 'brew_log_batches'::regclass
  ) THEN
    ALTER TABLE brew_log_batches
      ADD CONSTRAINT chk_brew_log_batches_volume_positive
      CHECK (volume_bbl > 0) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE brew_log_batches VALIDATE CONSTRAINT chk_brew_log_batches_volume_positive;

-- =============================================================================
-- 2. Positivity CHECKs — packaging / purchasing / transfer quantities
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_session_line_items_planned_quantity_positive'
      AND conrelid = 'session_line_items'::regclass
  ) THEN
    ALTER TABLE session_line_items
      ADD CONSTRAINT chk_session_line_items_planned_quantity_positive
      CHECK (planned_quantity > 0) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE session_line_items VALIDATE CONSTRAINT chk_session_line_items_planned_quantity_positive;

-- actual_quantity admits 0, not just NULL: "planned but nothing produced" is
-- a real state — create_finished_goods_from_packaging (00232) explicitly
-- SKIPs zero-actual lines on session completion, and
-- packaging-completion-trigger.test.ts asserts that semantics. Only negative
-- actuals are invalid.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_session_line_items_actual_quantity_nonneg'
      AND conrelid = 'session_line_items'::regclass
  ) THEN
    ALTER TABLE session_line_items
      ADD CONSTRAINT chk_session_line_items_actual_quantity_nonneg
      CHECK (actual_quantity >= 0) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE session_line_items VALIDATE CONSTRAINT chk_session_line_items_actual_quantity_nonneg;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_po_receives_quantity_positive'
      AND conrelid = 'po_receives'::regclass
  ) THEN
    ALTER TABLE po_receives
      ADD CONSTRAINT chk_po_receives_quantity_positive
      CHECK (quantity > 0) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE po_receives VALIDATE CONSTRAINT chk_po_receives_quantity_positive;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_transfer_lines_quantity_positive'
      AND conrelid = 'transfer_lines'::regclass
  ) THEN
    ALTER TABLE transfer_lines
      ADD CONSTRAINT chk_transfer_lines_quantity_positive
      CHECK (quantity > 0) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE transfer_lines VALIDATE CONSTRAINT chk_transfer_lines_quantity_positive;

-- =============================================================================
-- 3. Positivity CHECKs — recipe ingredient junction amounts (00011 tables)
-- =============================================================================
-- Enumerated from 00011_catalog_and_recipe_junction.sql: recipe_malts /
-- recipe_adjuncts / recipe_sugars use weight_lbs, recipe_hops uses weight_oz,
-- recipe_spices / recipe_fruits / recipe_additions use amount.
-- (recipe_collaborators, also created there, was dropped in 00294.)
DO $$
DECLARE
  _t RECORD;
BEGIN
  FOR _t IN
    SELECT * FROM (VALUES
      ('recipe_malts',     'weight_lbs', 'chk_recipe_malts_weight_positive'),
      ('recipe_hops',      'weight_oz',  'chk_recipe_hops_weight_positive'),
      ('recipe_adjuncts',  'weight_lbs', 'chk_recipe_adjuncts_weight_positive'),
      ('recipe_sugars',    'weight_lbs', 'chk_recipe_sugars_weight_positive'),
      ('recipe_spices',    'amount',     'chk_recipe_spices_amount_positive'),
      ('recipe_fruits',    'amount',     'chk_recipe_fruits_amount_positive'),
      ('recipe_additions', 'amount',     'chk_recipe_additions_amount_positive')
    ) AS t(tbl, col, con)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = _t.con
        AND conrelid = _t.tbl::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I > 0) NOT VALID',
        _t.tbl, _t.con, _t.col
      );
    END IF;
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', _t.tbl, _t.con);
  END LOOP;
END;
$$;

-- =============================================================================
-- 4. locations — UNIQUE(name)
-- =============================================================================
-- Live checked 2026-08-21: no duplicate names. UNIQUE cannot be added
-- NOT VALID; locations is tiny, so the lock window is negligible.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'locations_name_key'
      AND conrelid = 'locations'::regclass
  ) THEN
    ALTER TABLE locations
      ADD CONSTRAINT locations_name_key UNIQUE (name);
  END IF;
END;
$$;

-- =============================================================================
-- 5. batch_logs.log_type — CHECK on the documented value set
-- =============================================================================
-- 00001 documents status_change / measurement / note in a comment but never
-- enforced it. Every writer (readings page, chat write route, MongoDB sync
-- transformers, sync_batch_readings_atomic in 00258) emits 'measurement'
-- today; the constraint allows exactly the three documented values so the
-- other two remain usable without a migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_batch_logs_log_type'
      AND conrelid = 'batch_logs'::regclass
  ) THEN
    ALTER TABLE batch_logs
      ADD CONSTRAINT chk_batch_logs_log_type
      CHECK (log_type IN ('status_change', 'measurement', 'note')) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE batch_logs VALIDATE CONSTRAINT chk_batch_logs_log_type;
