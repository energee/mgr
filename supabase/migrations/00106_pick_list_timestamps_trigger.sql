-- Automatically populate started_at and completed_at timestamps
-- when a pick list transitions to in_progress or completed status.

CREATE OR REPLACE FUNCTION set_pick_list_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'in_progress' THEN
    NEW.started_at = NOW();
  END IF;

  IF NEW.status = 'completed' THEN
    NEW.completed_at = NOW();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pick_list_timestamps
  BEFORE UPDATE ON pick_lists
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION set_pick_list_timestamps();
