# Data-Layer / RLS / Migrations Audit — raw report (agent: data-layer-expert, 2026-07-10, final version @ 00fbe791)

Live DB not contacted; live-state claims sourced from PROGRESS.md, migration headers, live-catalog.snapshot.txt — marked needs-live-verification.

## Re-verification of shipped fixes
- **RECONFIRMED — P0 #1 (C1 customer role):** 00201:37-83 (role assignment + viewer backfill); invite route roles:["customer"] (invite/route.ts:41-47); staff gate uses isPortalUser(roles) — any role set containing customer bounced to portal ((app)/layout.tsx:43-46, permissions.ts:177-179). Caveat: runtime effect on live limited by DL-7.
- **RECONFIRMED — P0 #2 portal half:** portal-login-form.tsx:43 shouldCreateUser:false; public /signup removed. Staff half regressed-by-omission — DL-2.
- **RECONFIRMED — P0 #3 (H9):** 00201 §3 notify_all_users → active non-customer profiles (00201:105-108).
- **RECONFIRMED — P1 #4:** transition-side-effects.ts:228 (fulfilled) + :324 (cancelled).
- **RECONFIRMED — P1/P2 chain 00202–00218** all present in order.
- **RECONFIRMED — sensitive-settings RESTRICTIVE policy** untouched since 00200.
- **RECONFIRMED — query-key discipline:** binKeys (:635 incl contents), finishedGoodKeys.binInventory (:694), squareKeys (:720 incl syncLog/draftSales); zero hand-rolled queryKey arrays outside module.

## New findings

**DL-1 · C · Live DB is behind the merged migration chain; every packaging-session revision on live currently aborts** — needs-live-verification
PROGRESS.md: live has 00219–00229 applied; NOT applied live: 00230, 00232/00233, 00234/00235. 00232:66-80 Part 5: 'revised' never registered in enum_values → 00040 validate_enum_value rejects revise_packaging_session's final status flip.
Live today: (a) "Revise Quantities" aborts with Invalid packaging_session_status value: revised; (b) merged webhook logs sync_type='inventory_event' (00233:30-36 relaxes CHECK) — live's old 00091 CHECK rejects it (logged-not-thrown → audit logging of inbound inventory events silently lost); (c) 00233 split-tender historical re-key partially ineffective until applied; (d) live square_locations_select still 00228's integrations:manage → bin-form Square Location picker empty for production_manager (exactly what 00231 fixes); (e) db-push no-op invariant broken.
Fix: run scripts/db-push.sh (pushes 00230–00235 --include-all + regenerates snapshot), commit snapshot. Owner: data-layer-expert. Preflight: confirm still pending (concurrent session may have pushed). [= IN-13, broader]

**DL-2 · H · Staff OTP login still self-registers (shouldCreateUser not set) — residual of P0 #2 / M16**
login-form.tsx:92-98 — signInWithOtp({email, options:{emailRedirectTo}}) with no shouldCreateUser:false (contrast portal :43).
With hosted "allow new signups" ON (per memory it still is — needs-live-verification): any email on staff /login passwordless tab mints an auth user → create_user_profile() assigns ['viewer'] (full staff read) unless email matches a customer. Portal fix closed only one of two OTP doors.
Fix: shouldCreateUser:false on staff passwordless path (staff provisioned via /api/users/invite); disable hosted signup toggle (user action). Owner: data-layer-expert.

**DL-3 · H · Drift snapshot has zero POLICY/RLS baseline lines — new policy-drop protection is dormant**
scripts/live-catalog.sql:44-57 (POLICY|/RLS| arms added by PR #367 "so an out-of-band DROP POLICY registers as drift") vs live-catalog.snapshot.txt = 316 lines: 108 FUNC/100 TABLE/108 TRIG, NO POLICY/RLS lines (last regenerated at #361, before the query gained those arms).
(a) Out-of-band DROP POLICY today → no missing baseline line → no FAIL — the C2-class hole the redesign was meant to close is open until re-baseline; (b) next cron run classifies every live policy/RLS flag as an addition → wall of BEHAVIOR-ALTERING WARNs burying real signal.
Fix: regenerate snapshot immediately after DL-1 push (db-push.sh does both), commit. Order matters: push FIRST (else baselines wrong square_locations policy). Owner: data-layer-expert.

**DL-4 · M · Keg owner-dimension netting mismatch: named-owner ships inflate the fleet (documented, unfixed)**
00234:56-60 ("OWNER DIMENSION … comment-only") + function COMMENT: fills insert legs keg_owner_id NULL (+filled in owner-NULL group of keg_inventory); create_keg_ship_transactions_from_order stamps order's keg_owner_id on ship leg → −filled lands in owner-X group with no positive, dropped by HAVING sum>0; owner-NULL positive never decrements.
Every keg shipped under a named owner permanently inflates keg_inventory/summary — H4's monotonic-inflation class, one dimension over. Customer-owned/leased kegs hit immediately.
Fix: decide owner attribution (stamp fills with owner at packaging — revise path already does — or strip keg_owner_id from ship-leg netting, display-only); netting assertion in DO-block idiom. Owner: data-layer + brewing-domain.

**DL-5 · M · revise_packaging_session revise-down doesn't take the 00234 advisory lock — double-draw residual**
00234:40-43 documents it. Revise-down racing an order fulfillment reads same keg_filled_contents snapshot, both draw same rows, group nets negative and discarded by HAVING → fleet inflates; neither txn errors.
Fix: PERFORM pg_advisory_xact_lock(hashtext('create_keg_ship_transactions_from_order'), 0) at top of keg-decrease branch (same key, per 00234's header). Owner: data-layer-expert.

**DL-6 · M · Portal auto-link email match is case-sensitive; role assignment is case-insensitive — mixed-case customers get an empty portal**
portal/(main)/layout.tsx:38-40 .eq("email", user.email) (exact) vs 00201:44-48 lower()=lower().
customers.email="Buyer@Acme.com"; user signs in as buyer@acme.com (Supabase lowercases auth emails). 00201 assigns ['customer'] → isPortalUser locks out of staff app → portal auto-link finds no match → permanently empty portal.
Fix: normalize comparison (.ilike or lowercase both sides) to match 00201. Owner: data-layer-expert.

**DL-7 · M · CARRIED (C3, not new): portal junction/change-request tables still absent on live**
snapshot has no TABLE|customer_portal_users / order_change_requests / order_change_request_items; no migration after 00095 recreates them; portal layout queries junction at runtime (:27,:44).
On live the junction select errors/empty → portal empty for every invited customer — shipped C1 fix delivers isolation but no portal function. Tracked backlog #20 phase 1. Owner: data-layer-expert.

**DL-8 · L · place_finished_good_in_bin AFTER INSERT has no WHEN clause and ignores production location (documented, accepted)**
00219:155-159; PROGRESS "deliberately NOT fixed". Any future non-session FG insert path auto-places into primary location's default bin regardless of physical location → wrong Square per-bin sync. Revisit if bulk-import/manual path lands. Owner: data-layer-expert.

**DL-9 · L · square_locations policies hand-written, not in a 00097 domain array (deliberate deviation)**
00222:107-111, final state 00231:37-39 (select=inventory:read, write=integrations:manage), pinned by rls-policy-coverage.test.ts EXPECTATIONS. Acceptable (split-permission shape) but first staff table with read/write from different domains; keep test pin authoritative. Awareness only.

**DL-10 · L · Migration-numbering ordering hazards accumulating**
00207/00210 applied below already-applied 00208/00209; 00228 applied live before 00230–00233 existed; 00231's header narrates three-way policy convergence forced by live-apply order diverging from filename order. Replay currently converges, but each out-of-band early apply widens the replay-vs-live ordering surface db-lint must keep proving safe. Fix: enforce "push only via scripts/db-push.sh after merge" (violated by 00228/00229 early pushes). No code change.

## Summary
Counts: 1 C, 2 H, 4 M, 3 L; 7 prior fixes RECONFIRMED, 0 REGRESSED in code (DL-2 = residual gap in a P0 item).
Top risk: DL-1 — live six migrations behind: packaging revisions abort live, webhook writes rejected by old CHECK, wrong square_locations RLS; one scripts/db-push.sh run closes DL-1 + DL-3 together (push first, then snapshot).
Structural conventions held: query-key nesting, unwrap()/pg-error-code discipline, RESTRICTIVE sensitive-settings policy, auth boundary split (proxy refresh-only, layouts authorize) all intact on current main.
