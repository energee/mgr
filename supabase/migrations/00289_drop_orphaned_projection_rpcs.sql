-- Migration: 00289_drop_orphaned_projection_rpcs  (issue #697)
--
-- Removes three RPCs created by 00139_cogs_and_projection_rpcs.sql that exist
-- only in the migration chain and nowhere else:
--
--   * margin_by_channel(date, date)
--   * project_finished_goods(integer)
--   * project_revenue(integer, boolean)
--
-- Evidence they are dead (gathered 2026-08-12, #697):
--
--   1. NOT ON LIVE. Absent from supabase/live-catalog.snapshot.txt (which
--      records functions), and independently confirmed absent by the
--      live-vs-chain diff run against pg_proc on 2026-07-07 — see the header
--      of 00205_restore_server_side_enforcement.sql, which listed all three
--      under "Found broken but DEFERRED ... unused by the app today" and
--      deliberately did not restore them. So this is not snapshot staleness.
--
--   2. NO CALLERS. No reference under src/ or e2e/ — including inside
--      dynamicRpc(supabase, "<name>", ...) string arguments and the AI chat
--      tool RPC wrappers in src/app/api/chat/tools.ts, which a grep for
--      ".rpc(" alone would miss.
--
--   3. THE FEATURE THEY WERE BUILT FOR DOES NOT USE THEM. F132 ("COGS
--      projections") in docs/feature_list.json is audited "migrations": [] —
--      the shipped reports UI under src/app/(app)/reports/ queries base tables
--      through PostgREST and does its aggregation in TypeScript
--      (src/domain/reports/{cogs,summaries}.ts). Adjacent later ground is
--      covered by 00270_revenue_by_month.sql.
--
-- Option 2 of #697 ("drop them from the chain"). Nothing is applied to live by
-- this migration: on live the functions are already absent, so every DROP here
-- is a no-op and only the _schema_registry cleanup has any effect. On a
-- from-scratch replay it undoes 00139's section 2-4.
--
-- cogs_by_period() — 00139's fourth function — IS on live and is NOT dropped
-- here. It has no app caller either, but it exists, later migrations maintain
-- its body (00146 landed-cost allocation, asserted by
-- src/lib/__tests__/cogs-landed-cost-view.test.ts), and removing a live object
-- is a separate decision from removing chain-only dead code.
--
-- The SQL is not lost: it stays in 00139 in git history, and the full bodies
-- are reproduced in docs/plans/2026-03-05-cogs-projections-plan.md. If
-- planned-batch ordering (backlog #19) later wants a projection RPC, it should
-- be written against the current schema rather than resurrected — 00139's
-- bodies were authored before the selling_formats/containers rework.
--
-- No new functions, views, tables or policies are introduced, so the
-- docs/agents/db-security.md rules (security_invoker on views, search_path on
-- functions, RLS on tables with policies) have nothing to apply to here.

DROP FUNCTION IF EXISTS margin_by_channel(DATE, DATE);
DROP FUNCTION IF EXISTS project_finished_goods(INTEGER);
DROP FUNCTION IF EXISTS project_revenue(INTEGER, BOOLEAN);

-- 00139 also inserted a _schema_registry row per RPC. Those rows ARE on live
-- (the migration row is recorded as applied, and the INSERT does not depend on
-- the functions existing), so they would otherwise keep advertising three
-- non-existent RPCs to the AI schema context.
DELETE FROM _schema_registry
WHERE table_name IN (
  'margin_by_channel',
  'project_finished_goods',
  'project_revenue'
);
