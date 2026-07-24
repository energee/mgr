-- =============================================================================
-- 00269 - capture live drop of legacy packaging-format constraints (#559)
-- =============================================================================
-- 00080 added chk_sli_format_xor / chk_fg_format_xor (legacy package_type_id
-- XOR keg_type_id) and chk_sli_keg_owner (keg_owner_id requires keg_type_id).
-- Live dropped them out-of-band when packaging moved to the selling_format
-- model, but every fresh migration replay still enforced them. Evidence
-- (live-catalog snapshot cannot show check constraints, so this is empirical):
--   - 00232's self-verification block inserts selling_format-only
--     session_line_items and finished_goods rows and applied live cleanly —
--     impossible if the xor constraints existed live.
--   - The packaging UI writes keg_owner_id on selling_format keg lines with
--     no keg_type_id (packaging-batch-dialog), which chk_sli_keg_owner
--     rejects — those writes succeed on live.
-- Capturing the drop makes replays match live. No-op on live (IF EXISTS).
-- Unblocks (tracked in #437/#559): the skipped e2e/packaging-session.spec.ts
-- full flow and the pg_temp xor shim in
-- src/__tests__/integration/packaging-completion-trigger.test.ts.
-- =============================================================================

ALTER TABLE session_line_items
  DROP CONSTRAINT IF EXISTS chk_sli_format_xor,
  DROP CONSTRAINT IF EXISTS chk_sli_keg_owner;

ALTER TABLE finished_goods
  DROP CONSTRAINT IF EXISTS chk_fg_format_xor;
