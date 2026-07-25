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

## Live apply and rollback

CI never touches the live database. Migrations reach live only when a human
runs `scripts/db-push.sh` (see [`gotchas.md`](gotchas.md)), so "merged" and
"applied" are two separate events and can drift apart for days — issue #440
is exactly that. When you merge a migration, say in the PR whether live has
it yet.

**There are no down migrations.** Rolling back means writing a new forward
migration that reverses the change, numbered above the bad one, pushed the
same way. Never edit or delete an applied migration file: the chain replayed
by `db-lint.yml` and the `schema_migrations` version rows on live both key
off the filename.

Order of operations when a live migration goes bad:

1. Confirm the damage against the catalog, not against intent — run
   `scripts/check-live-drift.sh` (needs `SUPABASE_DB_URL`).
2. Write the reversing migration; verify it with `make db-local` and
   `make db-dry-run` before it goes anywhere near live.
3. Push with `scripts/db-push.sh`, which refreshes the snapshot in the same
   step. Commit the snapshot with the migration.
4. Re-run `live-drift.yml` (`gh workflow run live-drift.yml`) and confirm it
   is green before closing anything out.

**The watchdog is only as live as its secret.** `SUPABASE_DB_URL` is a
read-only connection string held as a repository secret; when it is rotated
or expires, `live-drift.yml` fails with `password authentication failed`
rather than reporting drift, and the repo has *no* net for out-of-band schema
changes until it is restored. A failing live-drift run is therefore urgent
even when the failure looks like plumbing. Scheduled runs fail loudly on a
missing secret by design (a green cron with no secret would be worse).

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
