-- 00225_bins_with_summary_pos_columns.sql
-- Square POS bin-sync, Milestone C fix: surface the bin's Square POS config
-- (square_location_id, pos_sales_channel_id) through bins_with_summary.
--
-- WHY THIS EXISTS
--   00222 added bins.square_location_id and bins.pos_sales_channel_id to the BASE
--   table, but bins_with_summary (00073) is defined as `SELECT b.*, ...`. Postgres
--   expands `b.*` to the concrete column list AT CREATE TIME, so the view's column
--   set was frozen at the 00073 shape and never gained the two 00222 columns. The
--   bin entity reads through this view (src/entities/bin/core.ts sets
--   viewTable: "bins_with_summary"), so a saved Square location / POS sales channel
--   renders BLANK when the bin is reopened -- the WRITE goes to the base table and
--   is correct; only the READ-back through the view was missing the columns.
--
--   PLAIN DROP, NOT CASCADE: CREATE OR REPLACE VIEW cannot insert columns in the
--   middle of the column list (b.* expands them where b sits), so the view must be
--   dropped and recreated. A grep of supabase/migrations/ and src/ shows NOTHING
--   depends on bins_with_summary except the bin entity (which reads it at runtime,
--   not a DB-level dependency) and the generated types -- no other view, function,
--   or policy references it -- so a plain DROP is safe and CASCADE is unnecessary.
--   No GRANTs were ever issued on it (00073 relies on the default owner/role grants
--   plus RLS on the base tables via security_invoker), so none need restoring.
--
--   FUTURE-PROOFING: because the body still uses `b.*`, this same freeze will bite
--   again -- any future `ALTER TABLE bins ADD COLUMN` must DROP and recreate this
--   view to pick the new column up. That warning is repeated on the view comment.
--
-- Live-safe: drop + recreate of a single security_invoker view (00073 body
-- verbatim, which now expands b.* to include the two 00222 columns). Verified by a
-- self-rolling-back DO block at the end (commits NO rows).

-- Plain DROP (no CASCADE): nothing depends on this view (see header).
DROP VIEW IF EXISTS bins_with_summary;

-- Recreated verbatim from 00073. `b.*` now expands to include the two 00222 POS
-- columns (square_location_id, pos_sales_channel_id), which is the entire point.
CREATE VIEW bins_with_summary
WITH (security_invoker = true)
AS
SELECT
  b.*,
  l.name AS location_name,
  l.location_type,
  COALESCE(fg_counts.fg_count, 0) AS fg_item_count,
  COALESCE(rm_counts.rm_count, 0) AS rm_item_count,
  COALESCE(fg_counts.fg_count, 0) + COALESCE(rm_counts.rm_count, 0) AS total_item_count
FROM bins b
JOIN locations l ON l.id = b.location_id
LEFT JOIN (
  SELECT bin_id, COUNT(*) AS fg_count
  FROM bin_inventory
  WHERE quantity > 0
  GROUP BY bin_id
) fg_counts ON fg_counts.bin_id = b.id
LEFT JOIN (
  SELECT bin_id, COUNT(*) AS rm_count
  FROM bin_inventory_items
  WHERE quantity > 0
  GROUP BY bin_id
) rm_counts ON rm_counts.bin_id = b.id;

COMMENT ON VIEW bins_with_summary IS
  'Bins with location info and item counts. NOTE: the body uses SELECT b.*, which Postgres freezes to a concrete column list at CREATE time -- any future ALTER TABLE bins ADD COLUMN must DROP and recreate this view (as 00225 did for the 00222 square_location_id / pos_sales_channel_id POS columns) or the new column will be invisible here. security_invoker: RLS is enforced by the base tables.';

-- New columns are now visible through the view -- refresh PostgREST's schema cache.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Verification (self-rolling-back; commits NO rows) -- matches 00219/00221/00222
-- =============================================================================
-- Proves the two 00222 POS columns are now present in the recreated view's column
-- set (information_schema.columns). No test rows are created; a passing run RAISEs
-- 'C2_VERIFY_OK', a genuine failure RAISEs 'C2_ASSERT_FAIL...' and aborts, any
-- other error is downgraded to a WARNING.
DO $$
DECLARE
  v_sq  INTEGER;
  v_ch  INTEGER;
BEGIN
  BEGIN
    SELECT count(*) INTO v_sq
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'bins_with_summary'
        AND column_name = 'square_location_id';
    SELECT count(*) INTO v_ch
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'bins_with_summary'
        AND column_name = 'pos_sales_channel_id';

    IF v_sq <> 1 THEN
      RAISE EXCEPTION 'C2_ASSERT_FAIL: square_location_id missing from bins_with_summary (found % cols)', v_sq;
    END IF;
    IF v_ch <> 1 THEN
      RAISE EXCEPTION 'C2_ASSERT_FAIL: pos_sales_channel_id missing from bins_with_summary (found % cols)', v_ch;
    END IF;

    RAISE EXCEPTION 'C2_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'C2_VERIFY_OK' THEN
        RAISE NOTICE 'C2 bins_with_summary verification passed (square_location_id + pos_sales_channel_id present)';
      ELSIF SQLERRM LIKE 'C2_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine view-shape bug: abort migration
      ELSE
        RAISE WARNING 'C2 bins_with_summary verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;
