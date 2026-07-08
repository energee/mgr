-- 00206_relax_fg_entry_point.sql
-- Audit fix H8 (backlog #13): relax chk_fg_entry_point on finished_goods.
--
-- The original CHECK (00010) required (batch_id AND session_line_item_id) both
-- set, or both NULL — encoding "internal FG links a session line; external FG
-- has neither." Two legitimate flows have since made all four combinations valid,
-- so the constraint now only blocks correct behavior:
--   * session_line_items.batch_id is nullable, so completing a packaging session
--     with a batch-less line inserts an FG with session_line_item_id set but
--     batch_id NULL (00183 completion trigger) → check_violation, session cannot
--     complete.
--   * the manual finished-good form offers a "Source Batch" with no session line,
--     producing an FG with batch_id set but session_line_item_id NULL → always
--     errors on insert.
-- batch_id and session_line_item_id are each independently-optional, FK-backed
-- provenance links (both nullable, ON DELETE SET NULL); FG identity is already
-- enforced by NOT NULL on brand_id/quantity/lot_number. No remaining rule
-- distinguishes valid from invalid, so the constraint is dropped rather than
-- rewritten. Live impact: zero (1 FG row, the "neither"/external case).

ALTER TABLE finished_goods DROP CONSTRAINT IF EXISTS chk_fg_entry_point;

COMMENT ON COLUMN finished_goods.batch_id IS
  'Optional provenance link to the source batch. Independent of session_line_item_id: set for internal FGs and for manual FGs created with a source batch; NULL for external FGs and batch-less packaging lines.';
COMMENT ON COLUMN finished_goods.session_line_item_id IS
  'Optional provenance link to the packaging session line that produced this FG. Independent of batch_id: NULL for manually-created FGs.';
