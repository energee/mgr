# CI workflows

Quick reference for `.github/workflows/`. Load this before touching any
workflow file. Contract tests in `.github/scripts/ci-workflows.test.ts` pin
the structural expectations below — update them in the same commit as any
workflow change, or the unit suite fails.

## The workflow set

| Workflow | Trigger | What it does |
|---|---|---|
| `test.yml` | PR to main (skips docs-only diffs) | Static checks + unsharded vitest with coverage + `make check-db` / `check-wip` / `check-agent-config` + dependency audit. Build + Playwright E2E run only on the weekday-nightly schedule / `workflow_dispatch`, not per-PR. |
| `db-lint.yml` | PR touching `supabase/migrations/**` or `supabase/config.toml` | Replays the full migration chain from scratch (`ON_ERROR_STOP`) and runs the RLS integration tests against it. |
| `shell-lint.yml` | PR touching `scripts/*.sh` | shellcheck. No database, no build. |
| `live-drift.yml` | Daily schedule + dispatch | Watchdog comparing the live database catalog to `supabase/live-catalog.snapshot.txt` — catches out-of-band drift no PR would surface. Missing/changed objects FAIL; additions WARN. |
| `progress.yml` | Push to main touching `docs/progress/**` | Regenerates `PROGRESS.md` via `scripts/build-progress.sh` and lands it through an auto-merged bot PR. This is why PROGRESS.md must never be edited on a branch (AGENTS.md constraint 18). |
| `sentry-harness.yml` | Weekday schedule + dispatch | Scores recent Sentry errors and dispatches up to 3 Claude fix jobs (45-min cap each). |
| `health-audit.yml` | Weekly schedule + dispatch | Read-only Claude audit job → separate publisher job with `issues: write` files deduplicated issues. See [`health-audit-and-issue-triage.md`](health-audit-and-issue-triage.md). |
| `claude.yml` | `@claude` mention in issue/PR comments | On-demand Claude runs against the repo. |

There is no per-merge CI on main — the nightly build/E2E lane covers it.
`quality-regrade.yml` (weekly quality.md regrade) was removed 2026-07-24
after 10 runs that never produced output (missing `--allowed-tools`); its
replacement will be a scheduled agent, not a workflow.

## Rules when changing workflows

1. Update `.github/scripts/ci-workflows.test.ts` in the same commit — it
   asserts action versions, trigger shapes, and job structure per workflow.
2. **Prefer a scheduled agent or local cron over a new Actions workflow when
   the job is generative or iterative** (LLM-driven grading, fix loops,
   report writing). Actions workflows suit deterministic gates with crisp
   pass/fail output; generative jobs are hard to observe and debug in
   Actions, fail silently when tool permissions are wrong, and are better
   run where a human or coordinating agent sees the transcript.
3. Keep write permissions out of analysis jobs: follow `health-audit.yml`'s
   split (read-only audit job → minimal publisher job).
4. Scheduled prompts must not interpolate event-derived text (PR titles,
   issue bodies) — that's a command-injection surface.
