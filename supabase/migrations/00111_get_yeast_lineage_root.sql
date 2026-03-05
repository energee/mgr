-- =============================================================================
-- Migration: 00111_get_yeast_lineage_root
--
-- Adds a server-side function to walk up the yeast pitch parent chain
-- and return the root pitch ID. Replaces client-side N+1 traversal
-- with a single recursive CTE query.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_yeast_lineage_root(p_pitch_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH RECURSIVE lineage AS (
    SELECT id, parent_pitch_id
    FROM yeast_pitches
    WHERE id = p_pitch_id

    UNION ALL

    SELECT yp.id, yp.parent_pitch_id
    FROM yeast_pitches yp
    JOIN lineage l ON l.parent_pitch_id = yp.id
  )
  SELECT id FROM lineage WHERE parent_pitch_id IS NULL LIMIT 1;
$$;

COMMENT ON FUNCTION get_yeast_lineage_root IS 'Walks up the yeast pitch parent chain via recursive CTE and returns the root pitch ID (the original purchase with no parent).';
