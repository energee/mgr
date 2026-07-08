# Progress

> **Single source of truth** for what's done, what's in flight, and what's next.
> Read at session start. Update at session end.

## Current state

- **2026-07-07 (this session)**: branch `fix-audit-p2-enforcement` off `origin/main` `9b4f2fec` (post-#341). **[PR #343](https://github.com/energee/mgr/pull/343)** open (not merged) — audit backlog **#9 (C2) server-side enforcement restore** + **live-drift CI**. Migration `00205` applied live and verified; `db push` a clean no-op. Since the snapshot below was written, **#341 (P0, 00201) and #342 (P1, 00202–00204) already merged** and are live. Lint + typecheck clean, suite **2025 tests** green. **Drift CI verified working 2026-07-07** — `SUPABASE_DB_URL` secret configured, workflow run green (`OK: live database catalog matches supabase/live-catalog.snapshot.txt`). Remaining user action: flip Supabase "Allow new signups" OFF. Next migration number = **00206** (00205 is claimed by open PR #343).
- **Reflects**: `feat/integrations-expert-agent` rebased onto `origin/main` `ea713bb9` (the #336 squash-merge) — 2026-07-05 (second session). **PR #336 merged mid-session** with only its original commit; the follow-up commits live in **[PR #338](https://github.com/energee/mgr/pull/338)**
- **Last verified**: 2026-07-05 — lint + typecheck clean, suite green at **1,959 tests** (+2: transition call-site enforcement). Migration `00200` applied to live and verified (`is_sensitive_setting` returns true for all six `*_api_key` keys, false for non-secrets)
- **Diverged from `main`**: yes — five follow-up commits in PR #338: `04609164` (routing-gap review fixes), `9dad496b` (remaining 14 review findings), `03fd5aa9` (00200 RLS fix, applied live), `0d6ceb41` (backlog #7), plus this docs refresh
- **Gap notice**: this file went un-updated between 2026-05-12 and 2026-07-05. The "Completed (historical)" and "Deferred" sections below are a May 2026 snapshot — re-verify before acting on them.

## Completed (this branch — `feat/integrations-expert-agent`; #336 merged, follow-ups in PR #338)

- [x] **integrations-expert agent** added (`.claude/agents/integrations-expert.md`); entity-architect + data-layer-expert scopes extended; CLAUDE.md agent table updated (`37539de1`)
- [x] **xhigh 10-angle review of PR #336** — 15 verified findings (14 CONFIRMED / 1 PLAUSIBLE). Top: the doc's claim that `system_settings_hide_sensitive` conceals integration API keys is false (`is_sensitive_setting()` covers only the 3 `qbo_*` token keys — see Known issues); the "wire the 00100 RPCs" guidance would silently break QBO OAuth (they're SECURITY INVOKER and UPDATE-only); `notify_all_users` anchored to the superseded `00090` body (00191 added email dispatch); `(auth)`↔`(app)` staff-auth-surface mix-up
- [x] **Review fixes applied on-branch**: entity API routes (`api/{batches,orders,customers,recipes,users}`) assigned to entity-architect; `api/auth` + `update-password` to data-layer-expert; explicit "no expert owner" table row (`api/{dev,health}`; `chat` deferred to `ai-features-expert`, Phase 4A); services bullet trimmed to invariants + module-header pointer; stale "~30" query-key factory counts corrected (43 actual → "dozens"); backlog fix #7 added (transfer-route side-effects bypass) (`04609164`)
- [x] **Remaining 14 review findings fixed in doc text** (`9dad496b`): integrations-expert — API keys not RLS-hidden (pre-00200), qbo tokens bypass the api-key route, email's `email_settings`/`dispatch_email_notification` dependency, `square_draft_sales` reframed as replay drift (live column dropped), 00100 RPCs must NOT be wired (INVOKER/UPDATE-only), `mapAddress` is tested, `notify_all_users` anchored to 00191, four email templates, broader name-resolution risks; data-layer-expert — staff gate is `(app)/layout.tsx`, portal RLS via `customer_portal_users` junction, `src/proxy.ts` replaces root `middleware.ts`; CLAUDE.md — integrations route dirs named, entity triad convention; all agents — redundant Search tooling section dropped
- [x] **00200_extend_sensitive_settings.sql** (`03fd5aa9`): `is_sensitive_setting()` extended with `%_api_key` LIKE — closes the Known-issues API-key exposure. Applied to live via `db push --include-all` + verified; agent docs updated to post-00200 state
- [x] **Backlog #7 — transfer-route side-effects bypass** (`0d6ceb41`): `POST /api/batches/[id]/transfer` now calls `runTransitionSideEffects` (was silently skipping `completeBatchConsumption` on `packaging → completed`); new `src/services/__tests__/transition-call-sites.test.ts` walks all API routes for future bypasses (red → green; suite 1,957 → 1,959)

## Completed (historical — Sentry fixes + harness rollout, May 2026)

- [x] **SENTRY-7479939863 — Error: No QueryClient set, use QueryClientProvider to set one** (Sentry fix, MGR-8)
  `NotificationsProvider` called `useQueryClient()` unconditionally at render time (line 80 of `src/contexts/notifications.tsx`), which throws immediately if no `QueryClientProvider` ancestor exists. The error was captured from the `polish` git worktree at `GET /` (localhost:3002). The fix adds an outer guard component that reads `QueryClientContext` directly via `useContext` (which returns `undefined` safely instead of throwing when no provider is present). If no QueryClient is found, the guard renders children with a stable no-op `EMPTY_NOTIFICATIONS` context and logs a production error for observability; in the normal path it delegates to the original inner implementation unchanged. Three Vitest tests at `src/contexts/__tests__/notifications.test.tsx` cover the no-QueryClient render, empty context defaults, and no-op action handlers. All 41 test files (1105 tests) pass; typecheck and lint clean.

- [x] **SENTRY-7454377645 — ReferenceError: sgToPlato is not defined** (Sentry fix)
  Sentry issue MGR-3 fired on 2026-05-01 when `RecipeSidebar` rendered the OG/FG estimates with `displayUnit = "plato"`. A local `formatSg` helper had been added inline to `recipe-sidebar.tsx` that called `sgToPlato` directly without importing it, causing a `ReferenceError` at runtime. The structural fix had already landed in commit `73c49c7` (added `formatGravityFromSg` to `@/lib/units` where `sgToPlato` is in scope, then updated `recipe-sidebar.tsx` to import and use it). This session closed the gap by adding six Vitest tests for `formatGravityFromSg` — covering null/undefined guards, SG passthrough, Plato conversion, and custom decimal places — which would have caught the missing-import bug before it reached the development environment. All 1036 tests pass; lint and typecheck clean.

- [x] **SENTRY-7452842898 — MGR-2: ReferenceError: SaveAllButton is not defined** (sentry-fix/SENTRY-7452842898)
  Root cause: During Turbopack Fast Refresh (HMR), module code is re-evaluated top-to-bottom without the JavaScript hoisting guarantee for function declarations. `SaveAllButton`, `MobileEstimatesBar`, and `RecipeEditorSkeleton` were declared after `RecipeEditorPage` in `recipe-editor-page.tsx`, and `EstimateCard`, `SummaryRow`, `formatNum`, `formatGrainWeight`, `formatHopWeight`, and `bagLabel` were declared after `RecipeSidebar` in `recipe-sidebar.tsx`. Moving all helper functions and components before the exported component that uses them eliminates the HMR re-evaluation race. Regression coverage: `src/components/domain/recipe-editor/__tests__/recipe-editor-page-definition-order.test.ts` reads the source files and asserts that each helper is textually defined before the main component.

- [x] **SENTRY-7465830666 — MGR-4: Module not found: react-activity-calendar** (sentry-fix/SENTRY-7465830666)
  Root cause: `react-activity-calendar` was removed from `package.json` by a knip dependency audit in commit `33c0793` (April 1, 2026). The `batch-activity-heatmap.tsx` component was then added in PR #248 (commit `e3c1af3`, May 6, 2026) which correctly re-added the package. The Sentry error (MGR-4) fired the next day when a developer loaded the dashboard without running `bun install` after pulling. The first harness pass (PR #258) closed the Sentry issue and added harness tracking files. This pass adds a Vitest regression test at `src/components/dashboard/__tests__/react-activity-calendar-dep.test.ts` that verifies `ActivityCalendar` is exported as a valid React element type — if the package is removed, the test file fails to load immediately.

- [x] **Audit MGR against walkinglabs harness framework** (12 lectures + resource library) — produced gap checklist
- [x] **Step 1 — Feedback subsystem** (F001)
  - `Makefile` with layered gate (`check-fast` / `check` / `check-all` / `check-db`)
  - `scripts/init.sh` bootstrap with the four-line bootstrap contract
  - Cleanups: cut Makefile sprawl (22 → 17 targets), removed `WARNINGS` counter and `require make` from init.sh, added `OK: check passed` line, merged `init` into `setup`
- [x] **Step 9 — AGENTS.md fixes** (F002)
  - Reframed `AGENTS.md` as 165-line router; deleted `CLAUDE.md`
  - Split content into `docs/agents/{patterns,query-keys,db-security,ui-rules,debugging}.md`
  - Updated cross-references: `.github/scripts/sentry-harness/prompt.{ts,test.ts}`, `README.md`, `src/entities/user-profile.tsx`, `docs/data-model/kegs.md`
- [x] **Step 3 — Scope subsystem** (F003)
  - `docs/feature_list.json` — 44 features (9 harness rollout F001-F009 + 35 backfilled from `docs/plans/` and `docs/superpowers/`)
  - `scripts/verify-feature.sh` reads feature list, runs `verification` command (or reports manual / null)
  - WIP=1 per branch rule documented in `AGENTS.md`
- [x] **Step 4 — Executable DB security checks** (F004) — wired into `make check`
  - `scripts/check-security-invoker.ts` — migration-history-aware
  - `scripts/check-rls.ts`
  - `scripts/check-auth-users-leak.ts` — migration-history-aware
  - All three default to fail-on-violation; whitelist via `-- check-X: skip <reason>` comments
- [x] **Corrective migration `00156_security_invoker_corrections.sql`**
  - 9 `ALTER VIEW … SET (security_invoker = true)` for legacy views from 00004–00011
  - `recent_vessel_cleanings` rebuilt with `user_profiles.email` instead of `auth.users.email`
  - `NOTIFY pgrst, 'reload schema'`
  - **Pending**: `bun run db:migrate` against the live database
- [x] **Skip comments** added to two `notify_all_users` SECURITY DEFINER functions (server-side admin broadcast, IDs only)
- [x] **Step 5 — State subsystem** (F005)
  - `PROGRESS.md` (this file)
  - `DECISIONS.md` (project-level decision log; distinct from schema `docs/spec/decisions.md`)
  - `docs/agents/session-handoff.md` template
- [x] **Step 7 — Cleanup** (F006)
  - `docs/agents/clean-state-checklist.md`
  - `scripts/cleanup-session.sh` (idempotent)
- [x] **Step 8 — Evaluator** (F007)
  - `docs/agents/evaluator-rubric.md` (six dimensions, 0–2 scoring)
- [x] **Step 6 — Observability** (F008)
  - `docs/agents/observability.md` — Sentry / agent traces / quality snapshot
  - `docs/agents/quality.md` — A–D grading template (most domains `_TBD_` pending baseline pass)
  - `.harness/sessions/` directory + worked example `2026-05-02-harness-rollout.md`
- [x] **Sentry verification** (F009)
  - Confirmed `prompt.test.ts` 6/6 pass after CLAUDE.md → AGENTS.md rename
  - Bumped CI workflows from `bun-version: 1.2.9` → `1.3.10` to match `engines.bun: ">=1.3"`
- [x] **Version pins**
  - `package.json` — `engines.node: ">=24"`, `engines.bun: ">=1.3"`, `packageManager: bun@1.3.10`

## In progress

- **[PR #338](https://github.com/energee/mgr/pull/338)** (this branch) — open, ready to merge. PR #336 was squash-merged mid-session with only its original commit; #338 carries all 15 review-finding fixes, the 00200 API-key RLS migration (already applied to live), and backlog #7 (transfer-route side effects + enforcement test).

## Deferred

Open work that's logged but not currently being executed. Pull from this list when picking up new work.

- **`notify_all_users` SECURITY DEFINER refactor** — function still reads from `auth.users` (defined in `00090_slack_integration.sql:117`; callers in `00070`, `00145`, `00148`). Whitelisted via `check-auth-users-leak` skip comments. Should move to `user_profiles`. Low priority.
- **Pick list — no bin-level detail** — `pick_list_items` lacks `bin_id`; UI shows only location name. Legacy `OrderPickList` displays bin + location, which matters for warehouse travel. Needs migration + `generate_pick_list` update + UI change. See `docs/plans/deferred-gaps.md`.
- **Pick list — no location-based sort** — items sorted by `sort_order` (generation order). Should sort `location_name → bin_name → lot_number`. See `docs/plans/deferred-gaps.md`.
- **Hardcoded 7-day PO lead time** — `src/lib/purchasing/po-generator.ts:215` uses `+ 7`; should use `Math.max(...leadTimes)` from shortfall data. See `docs/plans/deferred-gaps.md`.
- **Normalize `containers.volume_oz`** — heuristic disambiguation in `src/hooks/use-catalog.ts:100` (per-unit vs rolled-up case totals). Should be normalized at the schema level so the heuristic can be dropped.
- **Deeper E2E flows** — `test.skip` in `e2e/{batch-transfer, customer-order, dashboard, production-workflow, recipe-editor, packaging-session}.spec.ts` pending seed data. Smoke routes pass; F114/F128/F134/F135/F136 are marked `passing` on that basis.
- **Tighten DB allowlists** — `~30` grandfathered entries across permissive-RLS / SECURITY DEFINER / search_path / data-model docs allowlists. Tighten over time.
- **Raise `src/lib/**` coverage threshold** — currently 50% in `vitest.config.ts`; raise gradually as coverage improves.
- **Harness soak** — promote `Harness` layer grade A− → A after a 2-week multi-session soak proves drift detection works in practice (target: 2026-05-18).

## Recent history

- **2026-07-07** — Audit P0/P1 shipped (#341 P0/00201; #342 P1/00202–00204, both merged + live). **#9 P2 enforcement restore (PR #343, open, 00205 applied live)**: live had lost a cluster of 00075–00150-era objects out-of-band (all 8 state-transition triggers + `validate_state_transition`, pick-list triggers, advisory-lock number generators, `calculate_ingredient_shortfalls` on_order_qty, `get_yeast_lineage_root`, `get_unaccepted_po_receives`) while `db push` stayed a no-op; `get_state_transitions` was the stale 00167 map (no orders picking/packed). Restored + re-synced the map to entities. New live-drift CI: `scripts/check-live-drift.sh` + `supabase/live-catalog.snapshot.txt` (298 objects, body-hash) + `.github/workflows/live-drift.yml` (needs `SUPABASE_DB_URL`). Deferred/filed: backlog #21 (`get_inventory_overview` package_types rewrite), #22 (`start_batch_fermentation` fermenter-col rewrite).
- **2026-07-05** — Big merge day: #331 Sentry-harness restore (automation tiered to Sonnet), #295 user-invite dialog + hardened invite API, #332 ExportMenu wired into five report pages, #322 RLS coverage-gap completion (10/10 tasks), #334 react-harness test migration (−295 LOC), #333 expert-agent team + knowledge base + fix backlog, #335 animated-icon factory (−2,064 LOC), #337 guards for 00197/00198 against out-of-band table drops. #336 (integrations-expert agent) opened + given a 10-angle verified review (15 findings)
- **2026-06-30** — #328 dedup/simplification merged: dead-code removal, engine-file splits, prefill-store zustand→sessionStorage, two orphaned components wired; characterization coverage for recipe displays + schedule editors (#329/#330). Full detail: `docs/plans/2026-06-30-dedup-extraction-backlog.md`
- **2026-05-12** — #254 BOM whole-unit math + intuitive BOM/receive UX
- **2026-05-04..** — Sentry-harness hardening: #257 grants Claude Code the required toolset; #256 streams Claude Code Action output to job log; #255 reads org/project from `vars` to avoid output redaction
- **2026-05-04** — Migration `00156_security_invoker_corrections` applied to production via `bun run db:migrate -- --include-all` (9 legacy views + `recent_vessel_cleanings` rebuild now live)
- **2026-05-04** — `docs/agents/quality.md` baselines filled (no remaining `_TBD_` cells); F200 dashboard activity heatmap marked passing (#252); redundant Vercel deploy workflow removed (#253)
- **2026-05-03** — #251 autoharness screening + Claude OAuth shim; #250 `src/lib` dead-code removal + dedup
- **2026-05-02..03** — Walkinglabs harness rollout (#249, merged): `Makefile` with layered gates, `AGENTS.md` router + topic docs, `feature_list.json` (48 features), 8 executable DB checks, ESLint custom rules (DEC-008 / centralized query keys / `EntityDetail` re-introduction block), WIP=1 enforcement, bootstrap contract validation, Sentry harness writes harness state, coverage thresholds, migration dry-run

## Known issues

- ~~Integration API keys readable by any authenticated user~~ — **FIXED 2026-07-05** by `00200_extend_sensitive_settings.sql` (`is_sensitive_setting()` now also matches `%_api_key`; applied to live and verified). Was: only the 3 `qbo_*` token keys were hidden from the permissive SELECT policy (00097:402-403).
- `make` warnings about `xcrun_db` permission errors only appear inside Claude Code's sandbox; normal terminals don't show them.
- `make check` cannot be exercised end-to-end inside the agent sandbox because Turbopack `next build` requires port binding. Verified piecewise: `make check-fast`, `bun run test`, `make check-db`.

## Next steps

1. **Review + merge PR #343** (audit #9 enforcement restore + live-drift CI); add the read-only `SUPABASE_DB_URL` repo secret so the drift job runs.
2. **Audit fix backlog** (`docs/plans/2026-07-06-audit-fix-backlog.md`): P0 #1–#3 (#341) and P1 #4–#7 (#342) shipped; #9 = PR #343. Remaining data-layer items to pick up next as separate PRs: **#11 keg_inventory netting, #12 server-side availability guard, #13 chk_fg_entry_point, #15 ledger audit hardening, #16 vessel integrity, and the new #21 (get_inventory_overview rewrite) / #22 (start_batch_fermentation rewrite)**. Product-decision/other-agent items (#10, #17, #19, #20) need the user / entity-architect.
3. Migration-replay drift: from-scratch replay still recreates `square_draft_sales.keg_type_id NOT NULL` + its stale UNIQUE index (00091, never dropped) — fold into the next replay-repair pass.
4. Older **Deferred** items below are a May 2026 snapshot — re-verify before pulling.
