-- =============================================================================
-- Migration: yeast_strains.recommended_max_generations
-- =============================================================================
-- Yeast strains have practical repitch limits (lab guidance is commonly
-- 5-10 generations) but the schema had nowhere to record them, so the pitch
-- picker could not warn when a pitch exceeds the strain's recommendation.
--
-- Nullable on purpose: null means "no recommendation recorded", not zero.
--
-- Follow-up (see docs/plans/2026-06-09-audit-findings-fix-plan.md item 8.4):
-- after this migration is applied and `bun db:generate` refreshes
-- src/types/supabase.ts, surface a warning in the pitch picker and in the
-- searchYeastPitches AI tool when generation >= recommended_max_generations.
-- =============================================================================

ALTER TABLE yeast_strains
  ADD COLUMN IF NOT EXISTS recommended_max_generations smallint
  CHECK (recommended_max_generations IS NULL OR recommended_max_generations > 0);

COMMENT ON COLUMN yeast_strains.recommended_max_generations IS
  'Lab/brewer-recommended maximum repitch generation for this strain. Null = no recommendation recorded.';
