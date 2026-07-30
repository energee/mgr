# CI workflows

Quick reference for `.github/workflows/`. Load this before touching any
workflow file. Contract tests in `.github/scripts/ci-workflows.test.ts` pin
the structural expectations below — update them in the same commit as any
workflow change, or the unit suite fails.

## The workflow set

| Workflow | Trigger | What it does |
|---|---|---|
| `test.yml` | Every PR to main (docs-only included — required checks must always report) | Static checks + unsharded vitest with coverage + `make check-db` / `check-wip` / `check-agent-config` + dependency audit. Build + Playwright E2E run only on the weekday-nightly schedule / `workflow_dispatch`, not per-PR. E2E boots an isolated local Supabase, builds against it (`NEXT_PUBLIC_*` are inlined at build time, so the hosted-credential build artifact cannot serve it), and runs Playwright against `bun start` — the shipped artifact, not a dev server. |
| `db-lint.yml` | PR touching `supabase/migrations/**` or `supabase/config.toml` | Replays the full migration chain from scratch (`ON_ERROR_STOP`) and runs the RLS integration tests against it. |
| `shell-lint.yml` | PR touching `scripts/**` | `bash -n` + shellcheck over every shebang-bearing file under `scripts/` (selection is by shebang, not extension, so extensionless scripts like `scripts/agent-worktree` are covered). No database, no build. |
| `live-drift.yml` | Daily schedule + dispatch | Watchdog comparing the live database catalog to `supabase/live-catalog.snapshot.txt` — catches out-of-band drift no PR would surface. Missing/changed objects FAIL; additions WARN. Two tracking issues, deliberately distinct: `live-drift` (real drift) and `watchdog-down` (the check never reached the database — missing secret, billing block, connection error). While `watchdog-down` is open there is **no** drift detection at all. |
| `nightly-watch.yml` | `workflow_run` completion of scheduled Test runs, or dispatch with a simulated `conclusion` | Opens/updates ONE `nightly-red` tracking issue when the nightly fails; closes it on the next green run. Dispatch exists so the watchdog can be exercised without waiting for a red nightly. |
| `progress.yml` | Push to main touching `docs/progress/**` | Regenerates `PROGRESS.md` via `scripts/build-progress.sh` and lands it through an auto-merged bot PR. This is why PROGRESS.md must never be edited on a branch (AGENTS.md constraint 18). |
| `hygiene.yml` | Weekly schedule | Report-only branch hygiene summary (merged/stale branches). Never deletes anything. |
| `sentry-harness.yml` | Weekday schedule + dispatch | Scores recent Sentry errors and dispatches up to 3 Claude fix jobs (45-min cap each). |
| `health-audit.yml` | Weekly schedule + dispatch | Read-only Claude audit job → separate publisher job with `issues: write` files deduplicated issues. See [`health-audit-and-issue-triage.md`](health-audit-and-issue-triage.md). |
| `bug-patrol.yml` | Nightly schedule + dispatch | Finds ONE small high-confidence bug in recent changes, fixes it, opens one `bug-patrol` PR. |
| `feedback-distill.yml` | Weekly schedule + dispatch | Deterministic loop scoreboard (`loop-scoreboard.ts`), then harvests recurring corrections into ONE docs-only `feedback-distill` PR proposing promotions AND retirements. |
| `quality-regrade.yml` | Weekly schedule (Mon) + dispatch | Re-grades `docs/agents/quality.md` from measured evidence into ONE docs-only `quality-regrade` PR — the improvement loop's steering signal. |
| `claude.yml` | `@claude` mention in issue/PR comments | On-demand Claude runs against the repo. Needs `contents`/`pull-requests`/`issues: write` — the action posts a tracking comment before doing any work, so read-only permissions fail it on the first API call. Safety comes from the insider gate (`OWNER`/`MEMBER`/`COLLABORATOR`), not from withholding write. |

There is no per-merge CI on main — the nightly build/E2E lane covers it.

**Durable-outcome gate.** Every workflow that invokes `claude-code-action` on
a schedule must end in `.github/actions/require-durable-outcome` (PR produced,
evidence-cited quiet run, or the job goes red) or carry a `durable-state:
exempt` comment naming the deterministic step that owns its outcome instead.
Contract-tested. This exists because a silently dead agent run is otherwise
indistinguishable from a quiet night: `quality-regrade.yml` v1 ran 10 times
producing nothing (missing `--allowed-tools`) before anyone noticed, and the
sentry harness once failed the same way. The gate also echoes
`worker-epoch: model=<id>` into each run's step summary — see
[`improvement-loop.md`](improvement-loop.md) for what to do when it changes.

**No web egress from credentialed generative jobs.** Every job that invokes
`claude-code-action` with any `write` permission must pass
`--disallowedTools "WebFetch,WebSearch"`, and must not grant either tool
through `--allowedTools`. Contract-tested per job, so a new workflow inherits
the rule. The reason is the pairing, not the tools: these agents read
attacker-influenceable text (Sentry event payloads, fork-PR diffs, issue
bodies) while a push-capable `GITHUB_TOKEN` sits on the runner, so an outbound
network tool is what turns a prompt injection into exfiltration.
`sentry-harness.yml` was the outlier that motivated the contract (issue #645) —
it granted `WebFetch` for "occasional docs lookup" while the other four denied
it. Denial is explicit rather than by omission because a missing entry in an
allowlist reads as an oversight and gets "fixed". If a run genuinely needs an
external page, paste the content into the prompt or the mention thread.

**`claude.yml` is not exempt (issue #669).** Its job is the most defensible
candidate for an exception — human `@claude` mention, insider-gated
(`OWNER`/`MEMBER`/`COLLABORATOR`), `persist-credentials: false`, and a human
watching the run — so it was worth deciding deliberately rather than
inheriting the denial from #645's unrelated fix. Decision: no exemption. The
insider gate controls who can *start* a run, not what attacker-influenceable
text the run then reads (a linked fork-PR diff, a third-party issue body), and
the job still holds `contents`/`pull-requests`/`issues: write` the whole time
a human is watching. Cost accepted: `@claude` can't fetch a page linked in the
mention thread — paste the content into the comment instead. The exemption
list in `ci-workflows.test.ts` stays empty; a future PR reintroducing one
needs the same explicit sign-off this note records. Revisit only if that
paste-it-in friction becomes common enough to justify scoping the denial to
non-interactive event branches (e.g. `issues: opened`) instead of the whole
job — that needs the contract to move from per-job to per-event, which is
more machinery than the current cost justifies.

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
2. **Generative jobs may run as Actions workflows only with the full harness:**
   bounded turns + timeout, an explicit `--allowedTools` list (the missing
   allowlist is what silently killed quality-regrade v1), never merging, and
   the `require-durable-outcome` gate so a dead run goes red. Reserve local
   scheduled agents for work that genuinely needs local state (autoharness's
   pipx/OAuth shim); everything else belongs in the repo where the operating
   knowledge is versioned and any agent can repair it.
3. Keep write permissions out of analysis jobs: follow `health-audit.yml`'s
   split (read-only audit job → minimal publisher job).
4. Scheduled prompts must not interpolate event-derived text (PR titles,
   issue bodies) — that's a command-injection surface.
5. Any generative job holding a `write` permission must pass
   `--disallowedTools "WebFetch,WebSearch"` (see the egress note above).
