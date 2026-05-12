# Progress

> **Single source of truth** for what's done, what's in flight, and what's next.
> Read at session start. Update at session end.

## Current state

- **Branch**: `harness`
- **Latest commit**: `73c49c7` (Drag-and-drop reordering for recipe schedule editors, #246) — harness work uncommitted at session end
- **Last verified**: 2026-05-02
  - `make check-fast` — clean (lint + typecheck)
  - `make check-db` — clean (security_invoker / RLS / auth.users — all history-aware)
  - `bun run test` — **1018 / 1018** pass
  - `bun run test .github/scripts/sentry-harness/prompt.test.ts` — **6 / 6** pass
  - `bun run build` — not exercised in this session (sandbox blocks Turbopack port binding); should run clean in a normal terminal
- **Diverged from `main`**: yes (harness scaffolding)

## Completed (this branch)

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

_(none — harness rollout complete; awaiting user review and commit)_

## Round 2 — harness hardening (2026-05-03)

Twelve refinements landed on top of the initial rollout (PR #249).

- [x] **#1 Custom ESLint rules** — DEC-008 (`{ value: "", label: ... }` empty-string in option arrays, scoped via `:has()`), centralized query keys (`useQuery({ queryKey: [...] })` literal arrays), and `no-restricted-imports` blocking re-introduction of `EntityDetail` / `EntityForm`.
- [x] **#2 Schema registry + data-model doc checks** — `scripts/check-schema-registry.ts` and `scripts/check-data-model-docs.ts` (file-level allowlists for grandfathered pre-harness migrations).
- [x] **#3 WIP=1 enforcement** — `scripts/check-wip.ts` reads `feature_list.json`, fails if more than one `in_progress` per branch. Wired into `make check`.
- [x] **#4 Bootstrap contract validation** — `scripts/init.sh` now runs each of the four conditions (can start / can test / can see progress / can pick up next) and exits non-zero on failure. `BOOTSTRAP_SKIP=1` for CI.
- [x] **#5 `scripts/feature-mark.ts`** — safe CLI for state transitions with WIP=1 enforcement.
- [x] **#6 Stop hook for PROGRESS.md drift** — `scripts/check-progress-drift.sh` + `.claude/settings.json` Stop hook emit a `systemMessage` if code changed but PROGRESS.md didn't.
- [x] **#7 `docs/agents/dispatching-agents.md`** — when to spawn subagents and how to brief them, with three worked examples.
- [x] **#8 E2E scaffolds for 5 flows** — `recipe-editor.spec.ts`, `batch-transfer.spec.ts`, `packaging-session.spec.ts`, `dashboard.spec.ts`, `customer-order.spec.ts`. Smoke-level routes pass; deeper flow scaffolded as `test.skip` pending seed data. F114, F128, F134, F135, F136 in `feature_list.json` flipped from `manual` to executable verification commands.
- [x] **#9 More DB checks** — `check-permissive-rls.ts` (USING/WITH CHECK true), `check-search-path.ts`, `check-security-definer.ts` (justification required). Three allowlist files grandfather ~30 pre-existing legitimate uses; new violations fail.
- [x] **#10 Sentry harness writes harness state** — `prompt.ts` now requires updating `feature_list.json`, `PROGRESS.md`, and writing a `.harness/sessions/` trace per fix. Test plan template extended.
- [x] **#11 `scripts/migration-dry-run.sh`** + `make db-dry-run` — boots fresh local Supabase, replays every migration in order.
- [x] **#12 Coverage thresholds** — `vitest.config.ts` enforces 50% on `src/lib/**` (raise gradually). `make check-coverage` runs the gated report.

### Verification (2026-05-03)
- `make check-fast` — clean
- `bun run test` — 1018 / 1018
- `make check-db` — all 8 checks green (security_invoker / RLS / auth.users / search_path / SECURITY DEFINER / permissive RLS / schema_registry / data-model docs)
- `make check-wip` — clean
- `BOOTSTRAP_SKIP=0 bash scripts/init.sh` — all 4 contract conditions PASS

## Blocked / needs decision

_(none)_

## Deferred

- **Apply `00156_security_invoker_corrections.sql`** — needs `bun run db:migrate` against the live database when convenient. After applying, run `NOTIFY pgrst, 'reload schema';` (already in the migration).
- **Refactor `notify_all_users` to use `user_profiles`** — currently whitelisted; low priority. Track as future feature.
- **Fill in `docs/agents/quality.md` baselines** — most domain / layer cells are `_TBD_`. User should grade once and the harness can iterate.

## Next steps

1. Review the diff: `git status` / `git diff`
2. Apply `00156_security_invoker_corrections.sql` to the live DB
3. Commit the harness rollout (suggest a single squash-style commit so feature_list / AGENTS / docs / scripts land atomically)
4. Open a PR and run `/ultrareview` on the branch

## Known issues

- `make` warnings about `xcrun_db` permission errors only appear inside Claude Code's sandbox; normal terminals don't show them.
- `make check` cannot be exercised end-to-end inside the agent sandbox because Turbopack `next build` requires port binding (sandbox blocks). Verified clean piece-by-piece: `make check-fast`, `bun run test` (1018/1018), `make check-db`.
