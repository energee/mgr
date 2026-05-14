-- Audit finding F-055: bulk mark/dismiss operations fired N parallel RPC
-- calls (Promise.all on a per-id RPC), saturating the connection pool and
-- multiplying RTT for any meaningful selection size. Add bulk variants so
-- the UI can do one call per action regardless of selection size.
--
-- Security model mirrors the existing single-id RPCs (SECURITY INVOKER,
-- filters by auth.uid()) — the bulk variants can't elevate.

CREATE OR REPLACE FUNCTION mark_notifications_read_bulk(p_notification_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE notifications
  SET read_at = now()
  WHERE id = ANY (p_notification_ids)
    AND user_id = (SELECT auth.uid())
    AND read_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION mark_notifications_read_bulk IS
  'Marks multiple notifications as read in a single statement. The single-id '
  'mark_notification_read is retained for realtime / per-row paths.';

CREATE OR REPLACE FUNCTION dismiss_notifications_bulk(p_notification_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE notifications
  SET dismissed_at = now()
  WHERE id = ANY (p_notification_ids)
    AND user_id = (SELECT auth.uid());

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION dismiss_notifications_bulk IS
  'Dismisses multiple notifications in a single statement (audit F-055).';

-- Refresh PostgREST schema cache so the new RPCs are reachable from the client.
NOTIFY pgrst, 'reload schema';
