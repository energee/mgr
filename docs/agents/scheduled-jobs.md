# Scheduled jobs

Catalogue of every scheduled/automated job in the system: GitHub Actions
crons, Postgres `pg_cron` jobs, and recommended Claude scheduled agents. Keep
this file current whenever a job is added, retired, or rescheduled — it is the
one place an agent (or human) can answer "what runs unattended, and how do I
stop it?".

Actions minutes are free (public repo); per-run Anthropic/Sentry API spend is
real money, so AI-driven jobs stay bounded (caps on fixes/PRs per run).

## GitHub Actions crons

| Job (workflow) | Trigger | What it does | Output | Kill / rollback |
|---|---|---|---|---|
| Nightly build + E2E (`test.yml`) | cron `13 6 * * 1-5` (weekdays 06:13 UTC) + PRs (static/unit only) | Full build and Playwright E2E against main; PRs get lint/typecheck/vitest | Red/green run; consumed by Nightly Watch | Disable workflow in Actions UI; PR gate keeps running |
| Nightly Watch (`nightly-watch.yml`) | `workflow_run` completion of Test (scheduled runs only) | Opens/updates ONE `nightly-red` tracking issue when the nightly fails; closes it on the next green scheduled run | GitHub issue "Nightly CI failing: Test" | Disable workflow; delete `nightly-red` label if it ever spams |
| Live DB Drift Check (`live-drift.yml`) | cron `0 12 * * *` (daily 12:00 UTC) | Diffs live DB catalog vs `supabase/live-catalog.snapshot.txt`; missing/changed = FAIL, additions = WARN. Upserts ONE `live-drift` issue on real drift, closes it on a clean run | Run log + step summary + `live-drift` issue | Disable workflow. Note: billing-blocked or secret-missing runs never reach the drift step, so a silent issue means infra failure, not resolved drift |
| Scheduled Health Audit (`health-audit.yml`) | cron `37 13 * * 3` (Wed 13:37 UTC) | Read-only AI audit of recent commits + rotating focus; deterministic publisher opens deduped issues | GitHub issues (publisher job) | Disable workflow; publisher is the only job with issue write |
| Sentry Error Harness (`sentry-harness.yml`) | cron `0 17 * * 1-5` (weekdays 17:00 UTC) | Scores recent Sentry errors, AI-fixes at most 3 per run (45-min cap), opens PRs | Fix PRs | Disable workflow; close its PRs. Bounded per run to cap API spend |
| Build PROGRESS.md (`progress.yml`) | push to main touching `docs/progress/**` | Regenerates PROGRESS.md via bot PR (main ruleset blocks direct push) | Bot PR updating PROGRESS.md | Disable workflow; PROGRESS.md just goes stale |
| Branch Hygiene (`hygiene.yml`) | cron `23 7 * * 1` (Mon 07:23 UTC) | Prunes remote-tracking refs in its checkout, lists commit-merged branches and 30-day-stale branches (cross-referenced with open PRs). **Report-only — never deletes anything** | Job summary of the run | Disable workflow; nothing depends on it |
| db-lint (`db-lint.yml`) | pull_request only (not scheduled; listed for completeness) | Replays the full migration chain with `ON_ERROR_STOP` as the PR gate | PR check | It is the PR-time drift gate — do not remove without a replacement |

## pg_cron jobs (run inside the live Postgres)

| Job | Schedule | What it does | Output | Kill / rollback |
|---|---|---|---|---|
| `check-low-inventory` (migration 00174) | daily 06:00 UTC | `check_low_inventory()` scans items below reorder point, notifies users (24h dedupe per item) | `notifications` rows | `SELECT cron.unschedule('check-low-inventory');` on live |
| `check-data-integrity` (migration 00272) | daily 05:30 UTC | `check_data_integrity()` sweeps cheap invariants — negative on-hand (allocation sums), negative `bin_inventory.quantity`, negative `inventory_lots.quantity` — and upserts violations into `data_integrity_findings`, stamping `resolved_at` when they clear | `data_integrity_findings` rows (staff-readable with `inventory:read`) | `SELECT cron.unschedule('check-data-integrity');` on live; table can stay |

Both jobs tolerate environments without `pg_cron` (CI replays) — the
migrations skip scheduling with a NOTICE there.

## Recommended Claude scheduled agents (not in-repo)

These run on the user's machine/cloud via the Claude Code schedule mechanism,
not as committed workflows — they need interactive-grade AI sessions and
worktree write access that a repo cron shouldn't own. Documented here so the
system inventory is complete; the coordinator sets them up.

| Agent run | Suggested cadence | What it does | Output | Kill criterion |
|---|---|---|---|---|
| `/bug-patrol` | nightly | Unattended bug hunt: triage, fix in isolated worktrees, open bounded number of PRs | PRs + sweep report | Stop the scheduled agent; close its PRs. Bound PRs per run (API spend) |
| Feedback distillation / retro (`/retro`) | weekly | Reviews the week's commits, friction, and guardrails; distills learnings into memory/docs | Retro notes, memory updates | Stop the scheduled agent; it writes docs only |

## Adding a new scheduled job

1. Prefer the simplest home: pure-DB invariant → pg_cron; repo-state check →
   Actions cron; needs AI + write access → Claude scheduled agent.
2. Every job must have: a stable single output channel (one deduped issue, a
   findings table, or a job summary — never unbounded issue creation), and a
   documented kill/rollback step in this file.
3. AI-driven jobs must cap work per run (fixes, PRs, or turns).
4. Add the job to the tables above in the same PR.
