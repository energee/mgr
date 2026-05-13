# Progress

> **Single source of truth** for what's done, what's in flight, and what's next.
> Read at session start. Update at session end.

## Current state

- **Reflects**: `main` at `9eeb3da` (feat(bom): whole-unit math and intuitive BOM/receive UX, #254) — 2026-05-12
- **Last verified**: 2026-05-04 (see `docs/agents/quality.md` trend log)
  - `make check-fast` — clean (lint + typecheck)
  - `make check-db` — clean (security_invoker / RLS / auth.users — all history-aware)
  - `bun run test` — **1018 / 1018** pass
  - `bun run test .github/scripts/sentry-harness/prompt.test.ts` — **6 / 6** pass
  - `bun run build` — not exercised in this session (sandbox blocks Turbopack port binding); should run clean in a normal terminal
- **Diverged from `main`**: yes (harness scaffolding)

## Completed (this branch)

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

_(none known)_

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

- **2026-05-12** — #254 BOM whole-unit math + intuitive BOM/receive UX
- **2026-05-04..** — Sentry-harness hardening: #257 grants Claude Code the required toolset; #256 streams Claude Code Action output to job log; #255 reads org/project from `vars` to avoid output redaction
- **2026-05-04** — Migration `00156_security_invoker_corrections` applied to production via `bun run db:migrate -- --include-all` (9 legacy views + `recent_vessel_cleanings` rebuild now live)
- **2026-05-04** — `docs/agents/quality.md` baselines filled (no remaining `_TBD_` cells); F200 dashboard activity heatmap marked passing (#252); redundant Vercel deploy workflow removed (#253)
- **2026-05-03** — #251 autoharness screening + Claude OAuth shim; #250 `src/lib` dead-code removal + dedup
- **2026-05-02..03** — Walkinglabs harness rollout (#249, merged): `Makefile` with layered gates, `AGENTS.md` router + topic docs, `feature_list.json` (48 features), 8 executable DB checks, ESLint custom rules (DEC-008 / centralized query keys / `EntityDetail` re-introduction block), WIP=1 enforcement, bootstrap contract validation, Sentry harness writes harness state, coverage thresholds, migration dry-run

## Known issues

- `make` warnings about `xcrun_db` permission errors only appear inside Claude Code's sandbox; normal terminals don't show them.
- `make check` cannot be exercised end-to-end inside the agent sandbox because Turbopack `next build` requires port binding. Verified piecewise: `make check-fast`, `bun run test`, `make check-db`.

## Next steps

Pick from **Deferred** based on priority. No active in-flight work.
