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
-- CHECKs use strict > 0 (audit wording: "positivity") except where 0 is a
-- documented state (see the actual_quantity row). NULL passes a CHECK, so
-- nullable columns (e.g. session_line_items.planned_quantity /
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
-- 1. CHECK constraints — one loop over (table, constraint name, expression)
-- =============================================================================
-- Rows, in audit-bundle order:
--   - Production volumes: vessel_transfers / brew_log_batches volume_bbl.
--   - Packaging / purchasing / transfer quantities. actual_quantity admits
--     0, not just NULL: "planned but nothing produced" is a real state —
--     create_finished_goods_from_packaging (00232) explicitly SKIPs
--     zero-actual lines on session completion, and
--     packaging-completion-trigger.test.ts asserts that semantics. Only
--     negative actuals are invalid.
--   - Recipe ingredient junction amounts, enumerated from
--     00011_catalog_and_recipe_junction.sql: recipe_malts / recipe_adjuncts /
--     recipe_sugars use weight_lbs, recipe_hops uses weight_oz,
--     recipe_spices / recipe_fruits / recipe_additions use amount.
--     (recipe_collaborators, also created there, was dropped in 00294.)
--   - batch_logs.log_type: 00001 documents status_change / measurement /
--     note in a comment but never enforced it. Every writer (readings page,
--     chat write route, MongoDB sync transformers, sync_batch_readings_atomic
--     in 00258) emits 'measurement' today; the constraint allows exactly the
--     three documented values so the other two remain usable without a
--     migration.
DO $$
DECLARE
  _c RECORD;
BEGIN
  FOR _c IN
    SELECT * FROM (VALUES
      ('vessel_transfers',   'chk_vessel_transfers_volume_positive',
       'volume_bbl > 0'),
      ('brew_log_batches',   'chk_brew_log_batches_volume_positive',
       'volume_bbl > 0'),
      ('session_line_items', 'chk_session_line_items_planned_quantity_positive',
       'planned_quantity > 0'),
      -- >= 0, not > 0: zero-actual lines are valid (00232 skip semantics).
      ('session_line_items', 'chk_session_line_items_actual_quantity_nonneg',
       'actual_quantity >= 0'),
      ('po_receives',        'chk_po_receives_quantity_positive',
       'quantity > 0'),
      ('transfer_lines',     'chk_transfer_lines_quantity_positive',
       'quantity > 0'),
      ('recipe_malts',       'chk_recipe_malts_weight_positive',
       'weight_lbs > 0'),
      ('recipe_hops',        'chk_recipe_hops_weight_positive',
       'weight_oz > 0'),
      ('recipe_adjuncts',    'chk_recipe_adjuncts_weight_positive',
       'weight_lbs > 0'),
      ('recipe_sugars',      'chk_recipe_sugars_weight_positive',
       'weight_lbs > 0'),
      ('recipe_spices',      'chk_recipe_spices_amount_positive',
       'amount > 0'),
      ('recipe_fruits',      'chk_recipe_fruits_amount_positive',
       'amount > 0'),
      ('recipe_additions',   'chk_recipe_additions_amount_positive',
       'amount > 0'),
      ('batch_logs',         'chk_batch_logs_log_type',
       'log_type IN (''status_change'', ''measurement'', ''note'')')
    ) AS t(tbl, con, expr)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = _c.con
        AND conrelid = _c.tbl::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID',
        _c.tbl, _c.con, _c.expr
      );
    END IF;
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', _c.tbl, _c.con);
  END LOOP;
END;
$$;

-- =============================================================================
-- 2. locations — UNIQUE(name)
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
