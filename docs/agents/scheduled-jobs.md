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
| Production Health Probe (`prod-health.yml`) | cron `*/15 * * * *` (every 15 min) + dispatch | Post-deploy verification of the auto-deployed Vercel production artifact: `GET /api/health` must be HTTP 200 **and** body `status: "ok"` (a 200 carrying `degraded` fails), `GET /login` must be HTTP 200. 3 attempts with backoff before alerting. Reads the origin from repository **variable** `PRODUCTION_URL`; a missing variable fails the run loudly instead of skipping | Run log + step summary + ONE `prod-down` issue (closed on recovery) | Disable workflow; delete the `prod-down` label if it ever spams. Needs `gh variable set PRODUCTION_URL --body "https://<production-host>"` to run at all |
| Live DB Drift Check (`live-drift.yml`) | cron `0 12 * * *` (daily 12:00 UTC) | Diffs live DB catalog vs `supabase/live-catalog.snapshot.txt`; missing/changed = FAIL, additions = WARN. Upserts ONE `live-drift` issue on real drift, closes it on a clean run | Run log + step summary + `live-drift` issue | Disable workflow. Note: billing-blocked or secret-missing runs never reach the drift step, so a silent issue means infra failure, not resolved drift |
| Scheduled Health Audit (`health-audit.yml`) | cron `37 13 * * 3` (Wed 13:37 UTC) | Read-only AI audit of recent commits + rotating focus; deterministic publisher opens deduped issues | GitHub issues (publisher job) | Disable workflow; publisher is the only job with issue write |
| Sentry Error Harness (`sentry-harness.yml`) | cron `0 17 * * 1-5` (weekdays 17:00 UTC) | Scores recent Sentry errors, AI-fixes at most 3 per run (45-min cap), opens PRs | Fix PRs | Disable workflow; close its PRs. Bounded per run to cap API spend |
| Build PROGRESS.md (`progress.yml`) | push to main touching `docs/progress/**` | Regenerates PROGRESS.md via bot PR (main ruleset blocks direct push) | Bot PR updating PROGRESS.md | Disable workflow; PROGRESS.md just goes stale |
| Nightly Bug Patrol (`bug-patrol.yml`) | cron `0 7 * * *` (daily 07:00 UTC) + dispatch | Finds ONE small, high-confidence bug in recently changed code, fixes it minimally, opens a single `bug-patrol` PR. Never merges; PR + required CI + human are the gate. Bounded by `--max-turns 80` (raised from 60 in #598) and a 40-min timeout — see [`improvement-loop.md`](improvement-loop.md) for the 2026-07-26 failure streak at that cap | `bug-patrol` PR (for review) | Disable workflow; close its PRs. One PR/run caps API spend |
| Weekly Feedback Distillation (`feedback-distill.yml`) | cron `0 8 * * 0` (Sun 08:00 UTC) + dispatch | Deterministic loop scoreboard first (`loop-scoreboard.ts` — 4-week PR acceptance per loop), then harvests recurring corrections (merged-PR review comments, needs-human issues, failed runs) into ONE docs-only `feedback-distill` PR proposing promotions AND retirements. Edits only AGENTS.md/docs; never code; never merges | `feedback-distill` PR (docs only) + scoreboard in step summary | Disable workflow; it writes docs proposals only |
| Weekly Quality Re-grade (`quality-regrade.yml`) | cron `0 6 * * 1` (Mon 06:00 UTC) + dispatch | Re-grades `docs/agents/quality.md` from measured evidence (coverage run, git log, merge activity) into ONE docs-only `quality-regrade` PR — the improvement loop's steering signal. Explicit `--allowedTools` (v1 died silently without it) + durable-outcome gate | `quality-regrade` PR (docs only) | Disable workflow; the trend log just goes stale |
| Branch Hygiene (`hygiene.yml`) | cron `23 7 * * 1` (Mon 07:23 UTC) | Prunes remote-tracking refs in its checkout, lists commit-merged branches and 30-day-stale branches (cross-referenced with open PRs). **Report-only — never deletes anything** | Job summary of the run | Disable workflow; nothing depends on it |
| db-lint (`db-lint.yml`) | pull_request only (not scheduled; listed for completeness) | Replays the full migration chain with `ON_ERROR_STOP` as the PR gate | PR check | It is the PR-time drift gate — do not remove without a replacement |

## pg_cron jobs (run inside the live Postgres)

| Job | Schedule | What it does | Output | Kill / rollback |
|---|---|---|---|---|
| `check-low-inventory` (migration 00174) | daily 06:00 UTC | `check_low_inventory()` scans items below reorder point, notifies users (24h dedupe per item) | `notifications` rows | `SELECT cron.unschedule('check-low-inventory');` on live |
| `check-data-integrity` (migrations 00272 + 00273) | daily 05:30 UTC | `check_data_integrity()` sweeps cheap invariants — over-allocated lots (`inventory_lots_with_quantities.remaining_quantity < 0`), negative `bin_inventory.quantity`, negative `inventory_lots.quantity` — and upserts violations into `data_integrity_findings`, stamping `resolved_at` when they clear | `data_integrity_findings` rows (staff-readable with `inventory:read`), **consumed by `notify-data-integrity-findings` below** (issue #586: before 00281 nothing read this table) | `SELECT cron.unschedule('check-data-integrity');` on live; table can stay |
| `notify-data-integrity-findings` (migration 00281) | daily 05:45 UTC | `notify_data_integrity_findings()` announces OPEN, never-announced findings to active staff via `notify_all_users()` (type `data_integrity`, priority `high`) and stamps `data_integrity_findings.notified_at`. Dedupe: an open finding alerts ONCE — `notified_at` survives nightly re-detection and is cleared only when a resolved finding re-opens. Itemises at most 20 findings per run plus one "N still queued" summary | `notifications` rows (+ email/Slack via `notify_all_users`) | `SELECT cron.unschedule('notify-data-integrity-findings');` on live — the sweep keeps recording findings, they just go unannounced again |

All three jobs tolerate environments without `pg_cron` (CI replays) — the
migrations skip scheduling with a NOTICE there.

**Every job needs a consumer.** A findings table nobody reads is
indistinguishable from a disabled job: `check-data-integrity` recorded
violations for weeks with no UI, report, or alert reading them (#586). If a job's
output is a table, name the thing that reads it in the Output column above.

**A cron job's SQL is not verified by the migration applying.** PL/pgSQL plans
statements on first *execution*, so a function body referencing a dropped
column still creates fine and then fails on every scheduled run, silently —
that is exactly how 00272's original `negative_on_hand` check (it read
`allocations.inventory_item_id`, gone since 00010) went unnoticed until 00273.
When adding or editing a scheduled DB function:

1. End the migration with a `DO $$ BEGIN PERFORM <fn>(); EXCEPTION WHEN OTHERS
   THEN RAISE EXCEPTION ... END $$;` self-check, so a bad plan rolls the
   migration back instead of scheduling a broken job (00273 does this).
   **A bare call only plans the statements the data actually reaches.** For a
   body with data-dependent branches, probe inside a nested block (a
   subtransaction) that ends with a deliberate `RAISE`, which rolls the probe —
   and anything it wrote or dispatched — back while still proving the plans.
   00281 is the worked example: it seeds `cap + 1` probe findings so both the
   per-finding loop *and* the over-cap summary statement plan, asserts the run
   hit the cap (otherwise the probe proved less than it claims), and first masks
   the real open findings so the probe cannot alert staff about live data.
2. Add an integration test that actually calls it
   (`src/__tests__/integration/data-integrity-check.test.ts`) — replaying the
   chain proves nothing about a function nobody executes.

## Claude scheduled agents (not in-repo)

None exist, by design. Every recurring generative loop (bug patrol, feedback
distillation, quality re-grade) runs as a committed Actions workflow — bounded,
never merging, ending in the `require-durable-outcome` gate — so the repo, not
someone's machine, carries the operating knowledge. (An earlier plan to run
the quality re-grade as a scheduled agent was retired 2026-07-24 when
`quality-regrade.yml` was rebuilt.)

The one loop still worth running locally is **`autoharness`**
(`docs/agents/autoharness.md`): it needs the local pipx/OAuth shim and a
long interactive campaign, so it stays off Actions. Run it monthly (or when a
falling quality grade points at a `src/lib` area) from the user's machine,
after `scripts/autoharness-setup.sh` verifies the local venv patches.

## Adding a new scheduled job

1. Prefer the simplest home: pure-DB invariant → pg_cron; repo-state check →
   Actions cron; AI generative work that opens PRs for review → Actions cron
   with `claude-code-action` (bounded turns, never merges); only work that needs
   the local pipx/OAuth shim or interactive worktrees → Claude scheduled agent.
2. Every job must have: a stable single output channel (one deduped issue, a
   findings table, or a job summary — never unbounded issue creation), and a
   documented kill/rollback step in this file.
3. That output channel must have a *named consumer* — a UI surface, a
   notification path, or a report that a human or another job actually reads
   — confirmed before merge, not assumed. `check-data-integrity` (migration
   00272) shipped a findings table with no reader for months before issue
   #586 caught it; a job nobody reads is indistinguishable from a disabled
   one, and the API/compute cost is spent for zero signal either way. If no
   consumer exists yet, add the minimal one (e.g. reuse the `notifications`
   path from `check-low-inventory`, migration 00174) in the same PR.
4. AI-driven jobs must cap work per run (fixes, PRs, or turns).
5. Add the job to the tables above in the same PR.
