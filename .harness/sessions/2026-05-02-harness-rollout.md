# Session: harness rollout (F001–F009)

- Started: 2026-05-02 ~19:00 PT
- Branch: `harness`
- Starting commit: `73c49c7`

## Plan

Adopt the walkinglabs harness framework end-to-end. Audit current state,
identify gaps across the five subsystems (instructions / tools /
environment / state / feedback), then land them in order: Makefile +
init.sh first, then AGENTS.md / topic docs, then state files, then
feature list + WIP rule, then DB security checks, then observability.

## Decisions

- **Delete `CLAUDE.md`, make `AGENTS.md` canonical** — `AGENTS.md` is the
  cross-tool standard (Codex / Cursor / Gemini / Aider all default to it).
  Symlinking would cause Windows + CI portability issues. Stub redirect
  invited contributor surprise. Cleanest path: split content into
  `docs/agents/{patterns,query-keys,db-security,ui-rules,debugging}.md`
  and have `AGENTS.md` route.
- **WIP=1 per branch (option B)** — multi-worktree pattern means a global
  WIP=1 would block parallelism; per-branch keeps the discipline at the
  unit where context lives.
- **Backfill `feature_list.json` from `docs/plans/` and `docs/superpowers/`
  (option C)** — gives the file real content immediately. Older plans
  marked `passing` with `verification: "manual"`; only F200
  (dashboard-activity-heatmap) is `in_progress`.
- **DB security checks block `make check` (option A)** — strict policy.
  Surfaced 13 pre-existing violations (10 security_invoker + 3 auth.users).
- **Fix violations via corrective migration (option B from the next
  prompt)** — wrote `00156_security_invoker_corrections.sql` instead of
  whitelisting. Refactored `recent_vessel_cleanings` to use
  `user_profiles.email` (cached from `auth.users` via 00036 trigger).
  Two `notify_all_users` SECURITY DEFINER functions kept as-is with
  explicit `-- check-auth-users-leak: skip` comments — server-side
  broadcast, IDs only, not exposed via PostgREST.
- **Made both DB checks history-aware** — `security_invoker` and
  `auth.users-leak` now respect later `ALTER VIEW … SET (…)` and
  `CREATE OR REPLACE VIEW` statements. A view's compliance is judged on
  the latest definition in migration history, not the first.
- **Full Lecture 11 observability (option C)** — Sentry covers runtime,
  agent task traces in `.harness/sessions/`, weekly quality grading in
  `docs/agents/quality.md`. Initial domain/layer grades are `_TBD_`
  pending the user's pass.

## Verification log

- `make check-db` — first run: 10 + 3 violations. After 00156 + check
  rewrite: green.
- `bun run test .github/scripts/sentry-harness/prompt.test.ts` — 6/6
  pass after `CLAUDE.md` → `AGENTS.md` rename.
- `make typecheck` — clean throughout.

## Outcome

- Ending commit: _pending — work uncommitted at session end_
- Feature states (post-session):
  - F001–F009 → `passing` (harness primitives in place)
  - F200 (dashboard-activity-heatmap) → still `in_progress` on `main`
- Followups:
  - Apply migration `00156_security_invoker_corrections.sql` to the live
    database (`bun run db:migrate`).
  - Fill in `_TBD_` grades in `docs/agents/quality.md`.
  - Refactor the two `notify_all_users` functions to use `user_profiles`
    instead of `auth.users` (low priority — currently whitelisted).
