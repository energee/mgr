# CI workflows

Quick reference for `.github/workflows/`. Load this before touching any
workflow file. Contract tests in `.github/scripts/ci-workflows.test.ts` pin
the structural expectations below — update them in the same commit as any
workflow change, or the unit suite fails.

## The workflow set

| Workflow | Trigger | What it does |
|---|---|---|
| `test.yml` | Every PR to main (docs-only included — a check has to report on every PR to be usable as a required one) | Static checks + unsharded vitest with coverage + `make check-db` / `check-wip` / `check-deploy-state` / `check-agent-config`. Playwright E2E runs on every PR too as of 2026-07-30 (#437) — see [Why E2E runs on pull requests](#why-e2e-runs-on-pull-requests) for the shape and the reasoning, including why it never did before, despite #506 having been written to do it. Only `Production Build` stays nightly / `workflow_dispatch`: it compiles against the **hosted** Supabase credentials that fork PRs cannot read, and it is also the only job that runs `bun audit`, so the **dependency audit is a nightly signal, not a PR-time one**. PRs are not left without build coverage — the E2E job runs its own `bun run build` against its local stack. E2E boots an isolated local Supabase, builds against it (`NEXT_PUBLIC_*` are inlined at build time, so the hosted-credential build artifact cannot serve it), and runs Playwright against `bun start` — the shipped artifact, not a dev server. Because that server is a production build, the job sets `E2E_DEV_LOGIN: "1"` so `/api/auth/dev-login` (how `e2e/auth.setup.ts` gets a session, absent any hosted E2E credentials) answers instead of 404ing; the flag belongs to this job alone and must never be set on a deployed environment. The flag is not sufficient by itself — on that path the route also requires the Supabase project URL to have a **loopback hostname**, which this job satisfies via its own local stack. That narrows a stray `E2E_DEV_LOGIN=1` to databases reachable only on the serving machine (#656); it is not a guarantee that no real data is reachable, since a self-hosted Supabase, a sidecar, a tunnel or a local proxy can all sit behind a loopback name. The URL is resolved through `getSupabaseUrl()` — the same accessor `createAdminClient()` uses — precisely so a build-time-inlined `NEXT_PUBLIC_*` literal cannot make the gate disagree with the database the route actually connects to. The route's separate `NODE_ENV === "development"` path now requires the same loopback hostname by default, with `DEV_LOGIN_ALLOW_REMOTE_DB=1` as an explicit per-developer opt-in for a hosted project (#679); that variable must never be set in a workflow — a contract test asserts it appears in none. Full reasoning, including what is *not* guaranteed, is in the route's docstring (`src/app/api/auth/dev-login/route.ts`). |
| `db-lint.yml` | PR touching `supabase/migrations/**` or `supabase/config.toml` | Replays the full migration chain from scratch (`ON_ERROR_STOP`) and runs the RLS integration tests against it. |
| `shell-lint.yml` | PR touching `scripts/**` | `bash -n` + shellcheck over every shebang-bearing file under `scripts/` (selection is by shebang, not extension, so extensionless scripts like `scripts/agent-worktree` are covered). No database, no build. |
| `live-drift.yml` | Daily schedule + dispatch | Watchdog comparing the live database catalog to `supabase/live-catalog.snapshot.txt` — catches out-of-band drift no PR would surface. Missing/changed objects FAIL; additions WARN. Two tracking issues, deliberately distinct: `live-drift` (real drift) and `watchdog-down` (the check never reached the database — missing secret, billing block, connection error). While `watchdog-down` is open there is **no** drift detection at all. |
| `nightly-watch.yml` | `workflow_run` completion of scheduled Test runs, or dispatch with a simulated `conclusion` | Opens/updates ONE `nightly-red` tracking issue when the nightly fails; closes it on the next green run. Dispatch exists so the watchdog can be exercised without waiting for a red nightly. |
| `prod-health.yml` | Schedule every 15 min + dispatch | Post-deploy verification: probes `${vars.PRODUCTION_URL}/api/health` (HTTP 200 **and** body `status: "ok"` — a 200 carrying `degraded` is a failure) and `/login` (the auth wall), retrying 3× with backoff. Maintains ONE `prod-down` issue; closes it on recovery. Checkout-free, `issues: write` only. A missing `PRODUCTION_URL` variable fails the run loudly rather than skipping. |
| `progress.yml` | Push to main touching `docs/progress/**` | Regenerates `PROGRESS.md` via `scripts/build-progress.sh` and lands it through an auto-merged bot PR. This is why PROGRESS.md must never be edited on a branch (AGENTS.md constraint 18). |
| `hygiene.yml` | Weekly schedule | Report-only branch hygiene summary (merged/stale branches). Never deletes anything. |
| `sentry-harness.yml` | Weekday schedule + dispatch | Scores recent Sentry errors and dispatches up to 3 Claude fix jobs (45-min cap each). Three jobs split on the credential boundary (#668): `score-errors` (read-only), `fix-error` (the agent — **all** scopes `read`, no `id-token: write`, `github_token` bound to the job's own token; it writes `outbox/plan.json` + body files and cannot push or publish), `land-fix` (deterministic, holds the write scopes; validates the artifact, `git apply`s the patch, pushes, opens the PR/issue). |
| `health-audit.yml` | Weekly schedule + dispatch | Read-only Claude audit job → separate publisher job with `issues: write` files deduplicated issues. The audit job is read-only in its `permissions:` **and** in the token its agent's shell holds: every scope `read`, no `id-token: write`, `github_token` bound to the job's own token (#689). See [`health-audit-and-issue-triage.md`](health-audit-and-issue-triage.md). |
| `bug-patrol.yml` | Nightly schedule + dispatch | Finds ONE small high-confidence bug in recent changes, fixes it, opens one `bug-patrol` PR. |
| `feedback-distill.yml` | Weekly schedule + dispatch | Deterministic loop scoreboard (`loop-scoreboard.ts`), then harvests recurring corrections into ONE docs-only `feedback-distill` PR proposing promotions AND retirements. |
| `quality-regrade.yml` | Weekly schedule (Mon) + dispatch | Re-grades `docs/agents/quality.md` from measured evidence into ONE docs-only `quality-regrade` PR — the improvement loop's steering signal. |
| `claude.yml` | `@claude` mention in issue/PR comments | On-demand Claude runs against the repo. Needs `contents`/`pull-requests`/`issues: write` — the action posts a tracking comment before doing any work, so read-only permissions fail it on the first API call. Safety comes from the insider gate (`OWNER`/`MEMBER`/`COLLABORATOR`), not from withholding write. |

There is no per-merge CI on main — PRs run static, unit and E2E before the
merge, and the **weekday**-nightly build lane picks up squash-merge drift on
its next run (so a Friday-evening merge is uncovered until Monday).

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

**No web tool in generative jobs.** Every job that invokes
`claude-code-action` must pass `--disallowedTools "WebFetch,WebSearch"` and must
not grant either tool through `--allowedTools`. Contract-tested per job, so a
new workflow inherits the rule; a job that genuinely needs the network declares
`web-egress: allowed (job: <name>) — <rationale>` in a comment, the same escape
hatch as `durable-state: exempt`, and the contract enumerates every marker so an
opt-out is never silent. `sentry-harness.yml` motivated the rule (issue #645):
it granted `WebFetch` for "occasional docs lookup" while reading raw Sentry
event text. Denial is explicit rather than by omission because a missing entry
in an allowlist reads as an oversight and gets "fixed".

**Be precise about what this buys.** It is one channel, not the whole class.
Removing `WebFetch`/`WebSearch` removes the egress an injected instruction can
use in a *single tool call* with no shell work, which is worth having — it is
the difference between a one-line injection and a conspicuous one that shows up
in the job log. It does **not** make a credentialed job exfiltration-proof, and
writing a workflow comment that says it does is worse than saying nothing.
Anything that can reach the network still can:

- `Bash(git:*)` — `git push` / `git ls-remote` to an attacker-controlled URL,
  which also carries `.git/config` credentials when the checkout persisted them
- `Bash(bun:*)` / `Bash(bunx:*)` — `bun -e 'fetch(...)'`, or fetching and
  executing an arbitrary npm package
- `Bash(gh …:*)` — on a public repo an issue or PR body is itself a publishing
  channel

So `--disallowedTools "WebFetch,WebSearch"` next to `Bash(bun:*)` and
`Bash(git:*)` is **not** a closed egress posture. Nor can it become one: an
agent holding `Edit` plus `bun run test` or `make check` has arbitrary code
execution by construction (`make check` runs `bun run scripts/*.ts`; `bun run
test` executes test files the agent just wrote), so *every* allow-list that lets
a fix pipeline work is also a code-execution grant. Narrowing `Bash(bun:*)` to
subcommands removes no capability and adds denial risk.

**The remedy that does work: leave nothing in the agent's reach worth stealing.**
Three facts make this concrete, and the second is the one that surprises people
— `persist-credentials: false` is not the answer, and neither is a read-only
`permissions:` block on its own:

- `claude-code-action`'s run step assigns `process.env.GITHUB_TOKEN` and
  `process.env.GH_TOKEN` before it starts the agent, and configures git auth
  with the same value (`src/entrypoints/run.ts`, `src/modes/agent/index.ts`).
  Whatever token it resolves is readable by every Bash tool call.
  **`persist-credentials: false` does not leave the workspace token-free** —
  verify this against the SHA you pin before you rely on it. At `be7b93b`,
  `configureGitAuth()` (`src/github/operations/git-config.ts`) unsets the
  `http.<server>/.extraheader` `actions/checkout` writes and then runs
  `git remote set-url origin https://x-access-token:<token>@github.com/…`,
  putting the resolved token straight back into `.git/config` — a *more*
  durable copy than the header it just removed. (The token-free branch of that
  function is gated on `ALLOWED_NON_WRITE_USERS`, which no job here sets.) The
  flag is still worth setting: it covers the window between checkout and the
  action's own git setup. It is not what makes the workspace safe.
- **Which token it resolves is not decided by your `permissions:` block.** With
  no `github_token` input, the action exchanges an OIDC assertion for a Claude
  GitHub **App** installation token whose permissions are hardcoded to
  `contents`/`pull_requests`/`issues: write` (`src/github/token.ts`,
  `DEFAULT_PERMISSIONS`). The observable tell: this repo's `bug-patrol` PRs are
  authored by `app/claude`, not `github-actions[bot]`. Passing
  `github_token: ${{ secrets.GITHUB_TOKEN }}` takes the early return instead, so
  the agent gets the job's own token; dropping `id-token: write` removes the
  assertion the exchange needs, so the path cannot return by deleting one line.
- Only then does the `permissions:` block decide the token's power, because
  Actions mints one token per job at those scopes — and on a public repo a
  `contents: read` token is worth nothing to an exfiltrator.

**`health-audit.yml`'s audit job was the second bullet's textbook case, and is
fixed (#689).** Its `permissions:` were read-only, its prompt forbade every
mutation, and `issues: write` was deliberately isolated in the separate
`publish` job — and none of that bounded the token its agent held, because the
step passed no `github_token`. It now passes one and holds no
`id-token: write`, so the app-token path is both unused and unavailable. Two
notes on what that did and did not change:

- The `additional_permissions: actions: read` input was removed at the same
  time rather than left inert. At `be7b93b` its only consumer is
  `parseAdditionalPermissions()` inside `setupGitHubToken()`, which is
  unreachable once `OVERRIDE_GITHUB_TOKEN` takes the early return, and the
  `github_ci` MCP server it looks like it enables is gated on
  `isEntityContext(context) && context.isPR` — never true for a schedule or
  dispatch run. The job keeps `actions: read` in its own `permissions:` block.
- The audit agent needs no write to do its job: its allowlist is `Task`, five
  `Bash(git …)` read commands against a `fetch-depth: 0` checkout (local, no
  network), and `gh issue list` / `gh issue view` / `gh label list`, all of
  which the job's own `issues: read` covers. The action's own preflight
  (`checkWritePermissions`) runs only for entity contexts — `schedule` and
  `workflow_dispatch` are automation contexts — so nothing in the run path
  needs more than this token grants.

`sentry-harness.yml` is the worked example (#668). Its `fix-error` job declares
every scope `read` with no `id-token: write`, passes
`github_token: ${{ secrets.GITHUB_TOKEN }}`, and grants no write-capable `gh`
command; it declares its outcome in `outbox/plan.json` plus one markdown body
file per outcome, and a deterministic `land-fix` job holds the write scopes,
validates the artifact (`.github/scripts/sentry-harness/outbox.ts`), `git
apply`s the patch and publishes. The artifact is untrusted agent output, so the
lander applies it and never executes it: `git apply` evaluates nothing, bodies
reach `gh` as `--body-file`, every subprocess is spawned with an argv array, and
a patch touching anything CI or a build/tooling entry point
(`.github/`, `Makefile`, `scripts/`, `package.json`, `bun.lock`, `bunfig.toml`,
`.claude/`, `.agents/`) is rejected outright. The job still sets
`persist-credentials: false`, but see the first bullet above for what that flag
does and does not buy.

**The pack step can silently drop a classification-(A) patch (open, found
2026-08-02).** `/outbox/` is gitignored (`.gitignore:114`, added on purpose so
the artifact directory is never committed), and the "Pack the agent outbox"
step's `git add -A -- . ':(exclude)outbox' ':(exclude)sentry-outcome.md'`
(`sentry-harness.yml:274`) fails on that exact pathspec: git treats naming an
ignored directory inside `:(exclude)` magic the same as an explicit add of an
ignored path ("The following paths are ignored by one of your .gitignore
files: outbox") and exits 1 under the step's `set -euo pipefail`, before
`outbox/fix.patch` is ever written. `land-fix`'s own contract check catches
the empty result and fails loud — `[land-sentry-fix] outbox: plan.json asks
for a PR but the packed patch is empty` (run 30566343703, job 90957329205,
MGR-K, 2026-07-30) — which is the right response to a bad artifact, but the
net effect is that a real classification-(A) fix the agent spent its full
budget producing is discarded outright, not merely delayed: nothing retries
it, because the next scheduled run scores fresh issues, not the one that just
failed to land. The same pack-step failure signature ("paths are ignored by
one of your .gitignore files: outbox", then "Process completed with exit code
1") also fired standalone on job 91225679847 (2026-07-31, classification B,
harmless there since no patch was needed). Not fixed here — it needs a
workflow-file change. Whoever picks this up: stop the two mechanisms from
fighting each other — either write the patch to a location outside the repo
tree (`$RUNNER_TEMP`) instead of a gitignored in-tree directory, or drop the
`.gitignore` entry and rely solely on the `:(exclude)` pathspec to keep
`outbox/` out of the diff — and consider whether a discarded
classification-(A) fix should re-file as a `needs-human` issue instead of
vanishing with no trace. **Watch for:** this exact
`git add`/ignored-path error recurring in a `sentry-harness.yml` run log, or
another `land-fix` failure reading "packed patch is empty" against a
classification-A plan — either means the fix above hasn't landed yet.

**What is still true for `fix-error` after that split.** It can still execute
arbitrary code and still reach the network, and two credentials remain readable
by its shell: `secrets.CLAUDE_CODE_OAUTH_TOKEN` (the Anthropic credential —
unavoidable while an agent runs at all, and the same exposure every generative
job in this repo has) and the `id-token: write` OIDC minting endpoint. Neither
can write to this repository. What is gone is the push-capable
`GITHUB_TOKEN` — #645's stated impact.

**The pack step has been failing on most scheduled runs since the credential
split (#690, merged 2026-07-30) landed, independent of what the agent decided
(recurring; first found 2026-08-02, still failing 2026-08-08 — a
near-identical diagnosis also sits in still-unmerged PR #732, which this
entry supersedes with a week of further evidence).** `/outbox/` is gitignored
(`.gitignore:114`, deliberately, so the artifact directory never gets
committed), and the "Pack the agent outbox" step's
`git add -A -- . ':(exclude)outbox' ':(exclude)sentry-outcome.md'`
(`sentry-harness.yml:274`) exits 1 under the step's `set -euo pipefail`: git
treats naming an ignored directory inside `:(exclude)` pathspec magic the same
as an explicit add of an ignored path — `"The following paths are ignored by
one of your .gitignore files: outbox"` / `"hint: Use -f if you really want to
add them"` — and errors out before `outbox/fix.patch` is ever written. Sampled
across every scheduled run since the split:

- **07-30** (job 90957329205, MGR-K): a real classification-(A) patch the
  agent spent its full budget producing was discarded outright — `land-fix`'s
  own contract check caught the empty result: `"plan.json asks for a PR but
  the packed patch is empty."` Nothing retries it; the next scheduled run
  scores fresh issues, not the one that just failed to land.
- **07-31** (job 91225679847, classification B): same pack-step failure,
  harmless here because no patch was needed.
- **08-03** (job 91766123955): worse than a dropped patch — `land-fix` itself
  errored, `"[land-sentry-fix] outbox: classification must be one of A, B, C,
  D (got undefined)"`, meaning the `plan.json` the agent wrote never reached
  the lander intact either.
- **08-07** (job 92949470812, MGR-K again): the agent correctly triaged a
  stale re-delivery as a quiet run, wrote a valid `outbox/plan.json` and
  `outbox/evidence.md` — and the pack step still failed the same way.

The net effect: this workflow's own run conclusion has read red on most
scheduled runs for over a week even when the agent's diagnosis and outbox
contract were both correct. **Do not read a `sentry-harness.yml` red X as "the
agent got it wrong"** without opening the "Fix error" step log and checking
for this exact ignored-path message first — and do not read the loop as
unhealthy from Actions-tab history alone; check the PR list instead (`gh pr
list --state open --label sentry-fix --json number,createdAt,statusCheckRollup`;
10 of 10 `sentry-fix` PRs opened since 2026-07-12 have merged, per the loop
scoreboard). **Not fixable from here**, since it requires a workflow-file
change: the likely fix is to drop the redundant `:(exclude)outbox` pathspec
(the directory is already gitignored, so a plain `git add -A -- .` already
skips it without an explicit exclude) or to write the patch to `$RUNNER_TEMP`
instead of an in-tree gitignored directory. **Watch for:** this exact message
recurring in a future "Pack the agent outbox" step log, or a `land-fix`
failure reading "packed patch is empty" or "classification must be one of A,
B, C, D" against a plan the agent actually wrote correctly — either means the
fix hasn't landed yet.

**The outbox is itself a publishing channel, by construction.** `pr-body.md`,
`issue-body.md` and `comment-body.md` are agent-authored free text that a
credentialed job publishes verbatim to a public repository. Splitting the
credential out did not remove that — it is the *point* of the split, the agent
has to be able to say something — so it is a deterministic, always-available
outbound channel, not a residual hole that a later patch closes. What the
lander bounds is reach, not content: bodies are truncated at
`MAX_BODY_CHARS`, and a comment may only target an issue this harness itself
filed (the lander re-reads the target's labels and requires `sentry-fix`). Any
generative job that publishes at all inherits this property; say so in its
comment rather than describing the job as "cannot write".

The patch denylist is the same kind of claim and deserves the same honesty. It
refuses the build and automation surface — the files that get *executed* rather
than reviewed. It is **not** a general defense against a hostile patch: a test
file the agent adds runs in CI on the resulting PR like any other file (prompt
step 5 requires one), which is #699's residual, not something this list closes.
Do not describe it as closing "the one path".

Every other agent job still holds a push-capable token: `bug-patrol`,
`feedback-distill` and `quality-regrade` legitimately push from inside the
agent; `claude.yml` is the declared exemption below and #669 owns its
tightening. Those three keep the app token on purpose and not only for the
write scope — a PR opened with `secrets.GITHUB_TOKEN` does not trigger
workflows, so binding them would stop `test.yml` running on the PRs they open.
Giving them the `fix-error` treatment means splitting each loop on the
credential boundary, which is a per-loop change.

`ci-workflows.test.ts` covers this two ways, and the second exists because the
first was not enough. It **enumerates** every agent job by exact credential, so
a job that gains a write scope *or* starts minting an app token fails the
suite, and the two that gave both up (`fix-error`, `audit`) cannot silently
take them back. But an enumeration only catches a *change*: `health-audit`'s
audit job sat in that list for weeks, reviewed as read-only, because a listed
entry reads as an accepted one. So there is also a **rule**
(`readOnlyMintContradictions`): a job whose `permissions:` block grants no
repository write has declared itself read-only, and must therefore pass
`github_token`. `id-token: write` does not exempt a job from it — that shape is
exactly the one it exists to catch.

**Know where that rule stops.** It fires on a job that *declares* itself
read-only: one carrying an explicit `permissions:` block with no write scope.
`declaresReadOnly()` returns false for `{kind: "inherited"}`, so **a job with no
`permissions:` block at all is not covered** — and that is the most common
copy-paste shape. Such a job inherits the workflow or repository default, which
may well be read-only at runtime, while its agent still mints a write-capable
app token through the OIDC exchange. That is precisely the #689 defect, and the
contract would not see it. Until the gap is closed, give every agent job an
explicit `permissions:` block rather than relying on the default.

Two further limits worth knowing before trusting either rule: `bindsOwnToken` is
satisfied by any non-empty `github_token` input, so a PAT *stronger* than the app
token passes silently, and a typo'd secret name resolves to an empty string and
takes the OIDC path anyway. And a PAT handed to a step through `env:` is a
credential neither rule sees at all.

When you add a generative job, deny the web tools, keep the Bash allowlist to
the command families the prompt actually names, and give the job read-only
scopes, `github_token: ${{ secrets.GITHUB_TOKEN }}`, no `id-token: write`, and a
deterministic follow-on job for the writes.

**The one declared exemption: `claude.yml`.** It carries a
`web-egress: allowed (job: claude)` marker instead of the denial, for two
reasons worth understanding before you copy either pattern. Its Bash allowlist
(#661) already includes `Bash(bunx:*)`, `Bash(bun run:*)` and `Bash(make:*)`, so
the job can reach the network regardless — adding `--disallowedTools` beside
those would be exactly the false posture described above. And its threat model
is genuinely weaker than the scheduled loops': a human triggered the run and is
watching it. Note what is *not* part of that argument — `persist-credentials:
false` is set on its checkout, but per the first bullet above the action writes
its own token back into the remote URL, and this job's token carries three
`write` scopes, so a push-capable credential does sit in that workspace. It is
not risk-free — fork-PR diffs and third-party issue bodies are unvetted input —
so #669 tracks whether to tighten it. The lesson generalises: an exemption is for
when the denial would be *cosmetic*, and it must say so in writing.

## Deploy verification

CI does not deploy and does not gate the deploy: every merge to main
auto-deploys to Vercel production, and `scripts/vercel-ignore-build.sh` only
decides whether a commit is worth *building* (docs-only pushes skip). Nothing
in the pipeline asserts the promoted artifact actually serves traffic — a
failed build, a broken database connection, or a dead auth wall would only
surface once a real user tripped Sentry.

`prod-health.yml` is the net for that (issue #587). Every 15 minutes it probes
the production origin held in the **repository variable `PRODUCTION_URL`**
(a variable, not a secret — the URL is public, and it is deliberately not
committed):

- `GET /api/health` must answer HTTP 200 **and** a JSON body with
  `status: "ok"`. The route (`src/app/api/health/route.ts`) answers 503
  `{status:"degraded"}` when Postgres is unreachable; checking only the status
  code would let a degraded body read as healthy.
- `GET /login` must answer HTTP 200. A broken auth wall locks every user out
  while the API route still answers. Only the status code is asserted —
  matching page copy would turn wording changes into false alerts.

Each probe retries 3× with a short backoff, so a single dropped connection
does not alert. On failure it opens (or comments on) ONE `prod-down` issue;
on the next passing probe it comments and closes. **If `PRODUCTION_URL` is
unset the run fails loudly** and touches no issue: a health gate that turns
green when unconfigured is worse than no gate — that is precisely how the old
secrets-gated E2E job silently skipped for months (issue #437). Set it with
`gh variable set PRODUCTION_URL --body "https://<production-host>"`, then
`gh workflow run prod-health.yml`.

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

## Why E2E runs on pull requests

`test.yml`'s Playwright job runs on **every** pull request, with no `if:` gate,
no path filter, and no `needs:` at all. Each of those is deliberate and
contract-tested. Note the framing: this is the first time it has run on a
`pull_request` event, not a restoration — see the history below.

**The history.** Issue #437 was filed because the E2E job was gated on hosted
Playwright secrets that were never configured, so it skipped silently for
months and read as a passing check. PR #506 rebuilt the job around an isolated
local Supabase stack and was authored as a per-PR gate — but it merged
**14 minutes after** #522's CI-minutes diet (2026-07-17T04:04Z vs 03:50Z), and
it merged in nightly form. On `main`, therefore, the rebuilt job carried
`if: schedule || workflow_dispatch` from the day it first existed. That was a
documented cost decision rather than a defect, which is why nobody flagged it —
and why #437's criterion 1 reads as "achieved" in the PR comments while never
having been true on the default branch.

**Why the cost decision no longer applies.** It expired on 2026-07-24, when
this repository went public: Actions minutes are free. Keeping the browser
suite off pull requests now buys nothing, and the standing instruction is that
automation is not limited on minutes. **Do not "restore the diet" for this
job** — the constraint it optimised for is gone. The rest of #522 still stands
(unsharded vitest, docs-only skips elsewhere, no per-merge CI on main, one
weekday Sentry run); only the E2E-off-PRs clause is reversed.

**Why the shape matters as much as the trigger.** GitHub reports a job that did
not run as *skipped*, and a skipped check **reads as green** wherever
conclusions are consumed — including as a required status check, were one
configured. So every way of not running this job is a way of turning its check
green without testing anything:

- an `if:` on the job — what stood here from 2026-07-17 to 2026-07-30;
- a `paths:`/`paths-ignore:` filter — "only PRs that touch relevant paths"
  is the same defect in a new costume, because the PRs it declines to run for
  still report green;
- **any `needs:` edge at all** — not just a gated one. A dependency that is
  skipped, *red* or cancelled skips its dependents, and that skip reads as
  green too. Both halves are measured, not hypothetical. The job carried
  `needs: build`, and `build` is nightly-only *and* failed `bun audit` every
  night from the day the job was written until #658 cleared the advisories on
  2026-07-30T10:27Z (#639) — so between the two gates the browser suite had
  **never once executed on `main`**; its first successful run was 30551975249
  on 2026-07-30. And on the nightlies of 2026-07-20..24 `Static Checks` itself
  failed, taking `Unit Tests` and everything downstream to `skipped` with it.
  The E2E job consumes nothing from any other job — it re-checks out,
  re-installs, boots its own Supabase and runs its own `bun run build` — so it
  declares no `needs:`, which also takes the static -> unit chain off the PR's
  critical path.
- a **skip token in the commit message**, anywhere in the message and not just
  the subject. This route is in no workflow file at all, which is what makes it
  easy to hit by accident: a commit that merely *quotes* the token while
  explaining it suppresses every workflow on that head. **Measured here on
  2026-07-30**, which is why this bullet exists — the first draft of this
  section's own commit (`117725d1`, since amended away) had `[skip ci]` inside
  backticks in its body, describing `progress.yml`'s comment, and produced
  **zero** workflow runs:

  ```
  gh api "repos/energee/mgr/actions/runs?head_sha=117725d1…" -q .total_count -> 0  # token present
  gh api "repos/energee/mgr/actions/runs?head_sha=3eb41ff4…" -q .total_count -> 1  # parent
  gh api "repos/energee/mgr/actions/runs?head_sha=a7d25268…" -q .total_count -> 1  # amended, token gone
  ```

  No red X, no skipped check — the contexts simply never exist, and a PR with
  no contexts is as green as one that passed. `[skip ci]` is the variant
  observed; GitHub documents `[ci skip]`, `[no ci]`, `[skip actions]` and
  `[actions skip]` as equivalent, which is read from their docs, not tested
  here. Refer to them by description ("the skip-CI marker"), or break them up,
  when writing a commit message *about* them.

Only `build` keeps an event gate, and nothing that must report on a PR may
depend on it.

**Failing loudly instead of testing nothing** — the same rule `prod-health.yml`
follows for an unset `PRODUCTION_URL`. The job exits 1 with an `::error::`
annotation when:

- `supabase status -o env` exports no `API_URL`/`ANON_KEY`/`SERVICE_ROLE_KEY`.
  `bun run build` sets `SKIP_ENV_VALIDATION=1`, so an empty-but-set URL
  compiles fine and would surface only as opaque Playwright timeouts.
- the local API URL has no loopback hostname — `/api/auth/dev-login` stays 404
  on the `E2E_DEV_LOGIN` path without it (#656), so nothing could authenticate.
- fewer than `E2E_MIN_PASSING` tests actually passed. **A Playwright run in
  which every test skips exits 0** (verified against the `@playwright/test`
  this repo resolves, 1.61.1), so a `test.skip` at file scope or a bad
  `testMatch` would otherwise leave a green gate that exercised nothing. The
  floor is a tripwire, not a coverage target, but it is not free-floating: a
  contract in `ci-workflows.test.ts` counts the enabled `test(` declarations
  under `e2e/` and reds if the floor drifts more than 2 below them (16 against
  17 enabled specs + the auth setup today). Raise both together as the
  remaining scaffolds get implemented.

**Cost**, measured on the real `pull_request` runs of this job — all of which
landed on 2026-07-30, because before that day it had never run on a pull
request at all. The count is deliberately not stated: every commit that edits
this section adds another run to it.

| Run | Shape | E2E job | Whole PR |
|---|---|---|---|
| [30559728366](https://github.com/energee/mgr/actions/runs/30559728366) | still had `needs: unit-tests` | 5m01s (16:07:01Z -> 16:12:02Z) | 7m55s — e2e started 2m54s late |
| [30569164797](https://github.com/energee/mgr/actions/runs/30569164797) | no `needs:` (shipped shape) | 5m14s (18:09:29Z -> 18:14:43Z) | **5m14s** — e2e and `static` both started 18:09:29Z |
| [30569862548](https://github.com/energee/mgr/actions/runs/30569862548) | no `needs:` | 4m53s (18:19:01Z -> 18:23:54Z) | **4m53s** — `18 passed (22.8s)` |
| [30572709446](https://github.com/energee/mgr/actions/runs/30572709446) | no `needs:` | 5m16s (18:57:28Z -> 19:02:44Z) | **5m16s** — `18 passed (23.6s)` |
| [30573551199](https://github.com/energee/mgr/actions/runs/30573551199) | no `needs:` | 4m55s (19:08:53Z -> 19:13:48Z) | **4m55s** — `18 passed (22.5s)` |

So the E2E job costs about 5 minutes (4m53s-5m16s across the five: Supabase
boot, a `next build` against it, and ~23s of tests — `Running 23 tests using 1
worker` / `5 skipped` / `18 passed`, identical on every run), and because it no
longer queues behind `static -> unit-tests` it
*sets* the PR's critical path rather than extending it: PR latency went **down**
by ~2m40s even though a five-minute browser suite was added to every PR.

**Still outstanding — the "required" half, so #437's criterion 1 is only half
met.** The `main` ruleset declares no `required_status_checks` rule at all
today (`gh api repos/energee/mgr/rulesets/11725742` returns `deletion`,
`non_fast_forward`, `pull_request`, `required_linear_history` and nothing
else), and `main` has no legacy branch protection either
(`gh api repos/energee/mgr/branches/main/protection` -> 404 "Branch not
protected"). So nothing is literally blocking: not `E2E Tests`, not
`Static Checks`, not `Unit Tests`. They run and **report** on every PR, and a
failure is a visible red X, but a merge is not prevented. Read every "gate" in
this section as *reporting*, not *blocking*. Making those three contexts
required is a repository-settings change (ruleset `main`, id `11725742`), not
a workflow change, and it is a deliberate owner call — `Production Build` must
**not** be added, since it does not run on PRs.

**Side effect of the missing rule: `progress.yml`'s auto-merge intermittently
fails outright (found 2026-08-02).** `progress.yml`'s `gh pr merge --auto`
goes through GitHub's `enablePullRequestAutoMerge`, and roughly a third of
recent `Build PROGRESS.md` runs (10 of the last 30 as of 2026-08-01) fail with
`GraphQL: Pull request Pull request is in unstable status
(enablePullRequestAutoMerge)` instead of merging (e.g. runs 30664808886,
30657705808) — a PR whose checks are still running, not failing, reads as
"unstable" rather than something GitHub will queue behind, because there is no
`required_status_checks` rule for it to queue behind. This is not data loss:
`progress.yml` retriggers on the next push to `docs/progress/**`, and the
retry has so far always succeeded. It is noisy enough to read as a fresh
regression each time someone notices it, so treat a
lone `Build PROGRESS.md` failure with this exact error as expected until #713
lands, not a new bug to chase. **Watch for:** this note going stale once #713
adds the required-checks rule — the failure should stop recurring, and if a
future harvest still finds it after that rule lands, the fix didn't address
this side effect and needs its own look.

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
5. Any job invoking `claude-code-action` must pass
   `--disallowedTools "WebFetch,WebSearch"` (see the egress note above), and
   must keep its Bash allowlist to the command families its prompt names —
   denying the web tools alone does not close egress.
6. Prefer read-only scopes on the agent job and a deterministic follow-on job
   for the writes (`health-audit.yml`'s audit/publish split;
   `sentry-harness.yml`'s `fix-error`/`land-fix` split). Read-only scopes are
   not enough on their own: also pass `github_token` and drop `id-token: write`,
   or the action mints its own write-capable app token. Declaring read-only
   scopes *without* `github_token` now fails `ci-workflows.test.ts` outright
   (#689) — that combination is a contradiction, not a configuration. If a new
   agent job must genuinely hold a credential, give it the write scope it needs
   and add it to the enumerated inventory in the same commit; the suite fails
   otherwise, which is the point.
7. A job that consumes an artifact another job's agent produced must **apply**
   it, never execute it: `git apply` a patch, `--body-file` a body, argv arrays
   instead of shell strings, and no `eval`/`bash <agent output>`.
8. **A check that is meant to always report must never be event-gated,
   path-filtered, or hung off a `needs:` edge.** GitHub reports a job that did
   not run as "skipped" and a skipped check reads as passing, so all three
   silently turn it green on exactly the runs it declined to make — see
   [Why E2E runs on pull requests](#why-e2e-runs-on-pull-requests) for the two
   times this repo shipped that bug. The same rule in its other form: a check
   that passes when it is unconfigured is worse than no check — fail loudly
   with an `::error::` instead.

   This applies to the always-report set only: `test.yml`'s `static`,
   `unit-tests` and `e2e`. `db-lint.yml` (`supabase/migrations/**`) and
   `shell-lint.yml` (`scripts/**`) are **deliberately** path-filtered, and both
   filters are pinned in `.github/scripts/ci-workflows.test.ts` (removing
   either `paths:` list reds the suite) — they are opt-in lanes for the diffs
   that need them, they report nothing on unrelated PRs, and for that reason
   they must never be made required. Adding a job to the always-report set means giving
   it a trigger that fires on every PR, not adding a path filter and hoping.
