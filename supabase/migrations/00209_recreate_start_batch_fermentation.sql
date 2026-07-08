-- 00209_recreate_start_batch_fermentation.sql
-- Drift fix (backlog-adjacent, flagged by 00205's function-bug list, item #22):
-- start_batch_fermentation() no longer exists on live (dropped during the
-- vessel-model refactor) and its 00024 body wrote batches.fermenter — a column
-- that was removed when vessel assignment moved to vessels.current_batch_id.
--
-- The brew-log completion dialog still calls this RPC (brew-log-completion-
-- dialog.tsx) for batches that need a vessel assigned; with the function absent,
-- that path fails at runtime ("function does not exist"). The dialog's other
-- branch (batch already has current_vessel_id) does a plain status update and
-- works — but a batch being knocked out for the first time hits the RPC path.
--
-- Recreate the function with the SAME signature (so the dialog + call site are
-- unchanged) against the current model:
--   * INSERT the knockout vessel_transfer (from NULL / kettle -> to vessel),
--     recording the vessel name in the note (the only remaining use of
--     p_vessel_name now that batches.fermenter is gone);
--   * assign the vessel via vessels.current_batch_id (replaces the fermenter
--     text write) so batches_with_brew_info.current_vessel_id/_name resolve;
--   * transition the batch to 'fermenting' and stamp volume_bbl.
-- Atomic (all-or-nothing), which was the original function's whole purpose.
-- SECURITY INVOKER preserved — RLS applies to the caller.
--
-- NOTE: this does not guard against double-booking a vessel that already holds
-- another batch (vessels.current_batch_id overwrite) — that guard is backlog #16
-- (vessel integrity). Behavior here matches the original's unconditional write.

CREATE OR REPLACE FUNCTION start_batch_fermentation(
  p_batch_id UUID,
  p_vessel_id UUID,
  p_volume_bbl NUMERIC,
  p_vessel_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Knockout transfer from kettle into the fermentation vessel.
  INSERT INTO vessel_transfers (
    batch_id,
    from_vessel_id,
    to_vessel_id,
    volume_bbl,
    transferred_at,
    notes
  ) VALUES (
    p_batch_id,
    NULL, -- Knockout from kettle
    p_vessel_id,
    p_volume_bbl,
    NOW(),
    'Knockout to ' || COALESCE(p_vessel_name, 'vessel') || ' - start of fermentation'
  );

  -- Assign the vessel to the batch (current model: vessels.current_batch_id).
  UPDATE vessels SET current_batch_id = p_batch_id WHERE id = p_vessel_id;

  -- Transition the batch and record the knockout volume.
  UPDATE batches
  SET status = 'fermenting',
      volume_bbl = p_volume_bbl
  WHERE id = p_batch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch % not found', p_batch_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION start_batch_fermentation(UUID, UUID, NUMERIC, TEXT) IS
  'Atomically starts fermentation: knockout vessel_transfer + vessels.current_batch_id assignment + batch -> fermenting with volume_bbl. Recreated in 00209 off the dropped batches.fermenter column.';

GRANT EXECUTE ON FUNCTION start_batch_fermentation(UUID, UUID, NUMERIC, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
