-- =============================================================================
-- 00247 -- Revoke PUBLIC/anon/authenticated EXECUTE on SECURITY DEFINER RPCs
-- =============================================================================
-- FOUND BY VERIFYING LIVE, NOT BY READING THE CHAIN.
--
--   After 00245 closed dispatch_email_notification, a check of pg_proc ACLs on the live
--   database found SEVEN more SECURITY DEFINER functions executable by `anon` -- i.e. by
--   anyone holding the public anon key, with no login at all:
--
--     credit_bin_inventory        mutates bin_inventory (bypasses its RLS)
--     debit_bin_inventory         mutates bin_inventory (bypasses its RLS)
--     create_notification         writes a notification to any user
--     notify_all_users            writes a notification to EVERY user
--     cleanup_old_notifications   DELETEs notifications
--     check_low_inventory         reads inventory + dispatches notifications
--     user_has_brewery_access     vestigial (dead multi-tenancy)
--
--   credit_bin_inventory and debit_bin_inventory carry REVOKE/GRANT in their own
--   migrations (00232, 00241) -- so the CHAIN says locked while the LIVE DATABASE says
--   open. The chain was not the source of truth here.
--
-- WHY THE GRANTS CAME BACK
--   Supabase ships ALTER DEFAULT PRIVILEGES granting EXECUTE on public functions to anon
--   and authenticated. A CREATE OR REPLACE re-applies default privileges, so a later replace
--   silently re-opens a function, undoing an earlier REVOKE. Expect this trap to re-fire:
--   any future CREATE OR REPLACE of these functions must re-run its REVOKE.
--
-- SCOPE
--   is_admin_rls is deliberately NOT revoked: two RLS policies on user_profiles call it, and
--   policies evaluate as the querying role, so removing `authenticated` EXECUTE would break
--   them with "permission denied". It only exposes a boolean.
--
--   The only in-app caller of any function below is the Square webhook
--   (src/app/api/square/webhook/route.ts), which uses a service-role client -- unaffected.
--
--   Grants only. No signature, body, table, or policy changes.
-- =============================================================================

-- Bin inventory mutation ------------------------------------------------------
REVOKE ALL ON FUNCTION public.credit_bin_inventory(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_bin_inventory(uuid, uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.debit_bin_inventory(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_bin_inventory(uuid, uuid, integer) TO service_role;

-- Notification write paths ----------------------------------------------------
REVOKE ALL ON FUNCTION public.create_notification(uuid, text, text, text, text, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, text, uuid, text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.notify_all_users(text, text, text, text, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_all_users(text, text, text, text, uuid, text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_old_notifications(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_notifications(integer) TO service_role;

REVOKE ALL ON FUNCTION public.check_low_inventory() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_low_inventory() TO service_role;

-- Vestigial multi-tenancy helper ---------------------------------------------
REVOKE ALL ON FUNCTION public.user_has_brewery_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_brewery_access(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
