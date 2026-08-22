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
-- The audit wording was "positivity", but strict > 0 is applied ONLY where
-- every writer was verified to reject 0 (po_receives.quantity,
-- transfer_lines.quantity — UI-validated, no sync path writes them). The
-- rest are >= 0, because 0 is a value real write paths produce today
-- (per-row rationale on the tuples): the start-brew-day dialog's
-- volume_bbl ?? 0, the packaging line editor's min=0 planned quantity, the
-- 00232 zero-actual skip semantics, and the MongoDB re-sync, which writes
-- legacy zero and rounds-to-zero values (weight*16 rounding for tiny hop
-- amounts) — a single zero legacy value must not abort a whole re-sync
-- aggregate. Non-negative still blocks the garbage the audit cared about.
-- NULL passes a CHECK, so nullable columns still admit NULL.
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
-- Rows, in audit-bundle order. Constraint names say _nonneg where the
-- predicate is >= 0 (00239's chk_bin_inventory_quantity_nonneg precedent)
-- and _positive only where it is strictly > 0, so names stay truthful.
--   - Recipe ingredient junction amounts are enumerated from
--     00011_catalog_and_recipe_junction.sql: recipe_malts / recipe_adjuncts /
--     recipe_sugars use weight_lbs, recipe_hops uses weight_oz,
--     recipe_spices / recipe_fruits / recipe_additions use amount.
--     (recipe_collaborators, also created there, was dropped in 00294.)
--     All >= 0: MongoDB re-sync (src/integrations/mongodb/sync.ts) writes
--     legacy zero weights, and its oz conversion Math.round(weight*16*100)/100
--     rounds tiny hop amounts to 0.
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
      -- >= 0: MongoDB re-sync writes legacy zero transfer volumes
      -- (src/integrations/mongodb/transformers.ts vessel-transfer rows).
      ('vessel_transfers',   'chk_vessel_transfers_volume_nonneg',
       'volume_bbl >= 0'),
      -- >= 0: start-brew-day-dialog.tsx inserts volume_bbl ?? 0 when the
      -- batch has no volume set, and that insert is not atomic with
      -- brew_logs — a CHECK failure would strand an orphan brew_logs row.
      ('brew_log_batches',   'chk_brew_log_batches_volume_nonneg',
       'volume_bbl >= 0'),
      -- >= 0: add-line-item-row.tsx renders min={0} and
      -- use-session-line-items.ts passes it through (auto-suggestion can
      -- compute 0); MongoDB re-sync also writes legacy zero planned
      -- quantities. Symmetric with actual_quantity below.
      ('session_line_items', 'chk_session_line_items_planned_quantity_nonneg',
       'planned_quantity >= 0'),
      -- >= 0: zero-actual lines are valid — create_finished_goods_from_
      -- packaging (00232) explicitly SKIPs them on session completion, and
      -- packaging-completion-trigger.test.ts asserts that semantics.
      ('session_line_items', 'chk_session_line_items_actual_quantity_nonneg',
       'actual_quantity >= 0'),
      -- Strict > 0: UI paths validate positivity and no sync path writes
      -- these two.
      ('po_receives',        'chk_po_receives_quantity_positive',
       'quantity > 0'),
      ('transfer_lines',     'chk_transfer_lines_quantity_positive',
       'quantity > 0'),
      -- Junction amounts all >= 0 (MongoDB re-sync; see section comment).
      ('recipe_malts',       'chk_recipe_malts_weight_nonneg',
       'weight_lbs >= 0'),
      ('recipe_hops',        'chk_recipe_hops_weight_nonneg',
       'weight_oz >= 0'),
      ('recipe_adjuncts',    'chk_recipe_adjuncts_weight_nonneg',
       'weight_lbs >= 0'),
      ('recipe_sugars',      'chk_recipe_sugars_weight_nonneg',
       'weight_lbs >= 0'),
      ('recipe_spices',      'chk_recipe_spices_amount_nonneg',
       'amount >= 0'),
      ('recipe_fruits',      'chk_recipe_fruits_amount_nonneg',
       'amount >= 0'),
      ('recipe_additions',   'chk_recipe_additions_amount_nonneg',
       'amount >= 0'),
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
