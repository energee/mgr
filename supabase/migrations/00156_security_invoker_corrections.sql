-- Migration: 00156_security_invoker_corrections.sql
-- Purpose: Backfill `security_invoker = true` on legacy public-schema views
--          and remove the only real auth.users data leak (recent_vessel_cleanings
--          exposing email through PostgREST).
--
-- Context: see docs/agents/db-security.md (DEC-SEC-001 / DEC-SEC-002).
--          Surfaced by scripts/check-security-invoker.ts and
--          scripts/check-auth-users-leak.ts during harness rollout.
--
-- Server-side notify_all_users functions in 00022 and 00090 are intentionally
-- left as-is (SECURITY DEFINER admin broadcast functions; iterate user IDs
-- only; not exposed through the data API). They are whitelisted with explicit
-- skip comments in their original migrations.

-- =============================================================================
-- 1. Apply security_invoker = true to legacy views
-- =============================================================================

ALTER VIEW vessels_with_batch                SET (security_invoker = true);
ALTER VIEW available_vessels                 SET (security_invoker = true);
ALTER VIEW recipes_with_estimates            SET (security_invoker = true);
ALTER VIEW po_line_items_with_quantities     SET (security_invoker = true);
ALTER VIEW inventory_lots_with_quantities    SET (security_invoker = true);
ALTER VIEW finished_goods_with_availability  SET (security_invoker = true);
ALTER VIEW batches_with_remaining_volume     SET (security_invoker = true);
ALTER VIEW batches_with_brew_info            SET (security_invoker = true);
ALTER VIEW brew_log_metrics                  SET (security_invoker = true);

-- =============================================================================
-- 2. Refactor recent_vessel_cleanings: auth.users.email -> user_profiles.email
-- =============================================================================
--
-- The original view (00006:218) joined auth.users to surface
-- `cleaned_by_email` through PostgREST. user_profiles (00036) already mirrors
-- auth.users.email via the create_user_profile / sync_user_profile_email
-- triggers, so the cached column is the correct source. Same column shape.

CREATE OR REPLACE VIEW recent_vessel_cleanings
WITH (security_invoker = true)
AS
SELECT
  vc.*,
  v.name AS vessel_name,
  v.vessel_type,
  up.email AS cleaned_by_email
FROM vessel_cleanings vc
JOIN vessels v ON vc.vessel_id = v.id
LEFT JOIN user_profiles up ON vc.cleaned_by = up.id
WHERE vc.cleaned_at > NOW() - INTERVAL '7 days'
ORDER BY vc.cleaned_at DESC;

COMMENT ON VIEW recent_vessel_cleanings IS 'Cleaning events from the last 7 days for dashboard/activity feed. Uses user_profiles instead of auth.users (DEC-SEC-002).';

-- =============================================================================
-- 3. Refresh PostgREST schema cache
-- =============================================================================

NOTIFY pgrst, 'reload schema';
