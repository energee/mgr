-- =============================================================================
-- 00245 -- Lock down dispatch_email_notification (SECURITY DEFINER RLS bypass)
-- =============================================================================
-- PROBLEM
--   public.dispatch_email_notification(uuid, text, text, text, text, text, jsonb)
--   was created in 00190_capture_out_of_band_objects.sql as SECURITY DEFINER with
--   no REVOKE/GRANT. Postgres grants EXECUTE to PUBLIC by default, so the function
--   was callable over PostgREST RPC by ANY authenticated role -- including
--   customer-portal accounts.
--
--   Every argument is caller-controlled (p_user_id, p_title, p_message,
--   p_action_url), and the function reads email_settings + the service-role key and
--   dispatches a real email through the send-email edge function. Any logged-in user
--   could therefore send a system-branded email, with arbitrary body and link, to any
--   other user: a phishing vector using the brewery's own return address.
--
--   Contrast with the sibling SECURITY DEFINER RPCs debit_bin_inventory (00232) and
--   credit_bin_inventory (00241), which correctly REVOKE from PUBLIC and GRANT only
--   to service_role. This migration brings dispatch_email_notification in line.
--
-- FIX
--   Revoke EXECUTE from PUBLIC, and from anon/authenticated explicitly in case they
--   hold a direct grant rather than inheriting the PUBLIC one. Grant it only to
--   service_role. The function keeps SECURITY DEFINER: its legitimate callers are
--   notification triggers and service-role server paths, which must bypass the
--   recipient's RLS to write the notification log.
--
--   Grants only -- no signature or body change. Service-role callers are unaffected.
-- =============================================================================

REVOKE ALL ON FUNCTION public.dispatch_email_notification(uuid, text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_email_notification(uuid, text, text, text, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.dispatch_email_notification(uuid, text, text, text, text, text, jsonb) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.dispatch_email_notification(uuid, text, text, text, text, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.dispatch_email_notification(uuid, text, text, text, text, text, jsonb) IS
  'Sends a notification email via the send-email edge function. SECURITY DEFINER: must bypass the recipient''s RLS to write the notification log. EXECUTE locked to service_role in 00245 -- it was PUBLIC-callable from 00190 until then, letting any authenticated user send arbitrary system email to any user.';
