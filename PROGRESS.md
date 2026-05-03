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
