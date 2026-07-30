# CI workflows

Quick reference for `.github/workflows/`. Load this before touching any
workflow file. Contract tests in `.github/scripts/ci-workflows.test.ts` pin
the structural expectations below — update them in the same commit as any
workflow change, or the unit suite fails.

## The workflow set

| Workflow | Trigger | What it does |
|---|---|---|
| `test.yml` | Every PR to main (docs-only included — required checks must always report) | Static checks + unsharded vitest with coverage + `make check-db` / `check-wip` / `check-agent-config` + dependency audit. Build + Playwright E2E run only on the weekday-nightly schedule / `workflow_dispatch`, not per-PR. E2E boots an isolated local Supabase, builds against it (`NEXT_PUBLIC_*` are inlined at build time, so the hosted-credential build artifact cannot serve it), and runs Playwright against `bun start` — the shipped artifact, not a dev server. Because that server is a production build, the job sets `E2E_DEV_LOGIN: "1"` so `/api/auth/dev-login` (how `e2e/auth.setup.ts` gets a session, absent any hosted E2E credentials) answers instead of 404ing; the flag belongs to this job alone and must never be set on a deployed environment. The flag is not sufficient by itself — on that path the route also requires the Supabase project URL to have a **loopback hostname**, which this job satisfies via its own local stack. That narrows a stray `E2E_DEV_LOGIN=1` to databases reachable only on the serving machine (#656); it is not a guarantee that no real data is reachable, since a self-hosted Supabase, a sidecar, a tunnel or a local proxy can all sit behind a loopback name. The URL is resolved through `getSupabaseUrl()` — the same accessor `createAdminClient()` uses — precisely so a build-time-inlined `NEXT_PUBLIC_*` literal cannot make the gate disagree with the database the route actually connects to. The route's separate `NODE_ENV === "development"` path is unaffected by any of this and remains an accepted exposure (#679). Full reasoning, including what is *not* guaranteed, is in the route's docstring (`src/app/api/auth/dev-login/route.ts`). |
| `db-lint.yml` | PR touching `supabase/migrations/**` or `supabase/config.toml` | Replays the full migration chain from scratch (`ON_ERROR_STOP`) and runs the RLS integration tests against it. |
| `shell-lint.yml` | PR touching `scripts/**` | `bash -n` + shellcheck over every shebang-bearing file under `scripts/` (selection is by shebang, not extension, so extensionless scripts like `scripts/agent-worktree` are covered). No database, no build. |
| `live-drift.yml` | Daily schedule + dispatch | Watchdog comparing the live database catalog to `supabase/live-catalog.snapshot.txt` — catches out-of-band drift no PR would surface. Missing/changed objects FAIL; additions WARN. Two tracking issues, deliberately distinct: `live-drift` (real drift) and `watchdog-down` (the check never reached the database — missing secret, billing block, connection error). While `watchdog-down` is open there is **no** drift detection at all. |
| `nightly-watch.yml` | `workflow_run` completion of scheduled Test runs, or dispatch with a simulated `conclusion` | Opens/updates ONE `nightly-red` tracking issue when the nightly fails; closes it on the next green run. Dispatch exists so the watchdog can be exercised without waiting for a red nightly. |
| `prod-health.yml` | Schedule every 15 min + dispatch | Post-deploy verification: probes `${vars.PRODUCTION_URL}/api/health` (HTTP 200 **and** body `status: "ok"` — a 200 carrying `degraded` is a failure) and `/login` (the auth wall), retrying 3× with backoff. Maintains ONE `prod-down` issue; closes it on recovery. Checkout-free, `issues: write` only. A missing `PRODUCTION_URL` variable fails the run loudly rather than skipping. |
| `progress.yml` | Push to main touching `docs/progress/**` | Regenerates `PROGRESS.md` via `scripts/build-progress.sh` and lands it through an auto-merged bot PR. This is why PROGRESS.md must never be edited on a branch (AGENTS.md constraint 18). |
| `hygiene.yml` | Weekly schedule | Report-only branch hygiene summary (merged/stale branches). Never deletes anything. |
| `sentry-harness.yml` | Weekday schedule + dispatch | Scores recent Sentry errors and dispatches up to 3 Claude fix jobs (45-min cap each). Three jobs split on the credential boundary (#668): `score-errors` (read-only), `fix-error` (the agent — **all** scopes `read`, no `id-token: write`, `github_token` bound to the job's own token, `persist-credentials: false`; it writes `outbox/plan.json` + body files and cannot push or publish), `land-fix` (deterministic, holds the write scopes; validates the artifact, `git apply`s the patch, pushes, opens the PR/issue). |
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
  `persist-credentials: false` removes the copy in `.git/config` and nothing
  else.
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

**`health-audit.yml`'s audit job is affected by the second bullet.** Its
`permissions:` are read-only and its prompt forbids writes, but it passes no
`github_token`, so its agent still holds a write-capable app token. The
inventory below records that rather than pretending otherwise; tightening it is
a separate change.

`sentry-harness.yml` is the worked example (#668). Its `fix-error` job declares
every scope `read` with no `id-token: write`, passes
`github_token: ${{ secrets.GITHUB_TOKEN }}`, sets `persist-credentials: false`,
and grants no
write-capable `gh` command; it declares its outcome in `outbox/plan.json` plus
one markdown body file per outcome, and a deterministic `land-fix` job holds the
write scopes, validates the artifact
(`.github/scripts/sentry-harness/outbox.ts`), `git apply`s the patch and
publishes. The artifact is untrusted agent output, so the lander applies it and
never executes it: `git apply` evaluates nothing, bodies reach `gh` as
`--body-file`, every subprocess is spawned with an argv array, and a patch that
touches `.github/workflows|actions|scripts/` is rejected outright.

**What is still true for `fix-error` after that split.** It can still execute
arbitrary code and still reach the network, and two credentials remain readable
by its shell: `secrets.CLAUDE_CODE_OAUTH_TOKEN` (the Anthropic credential —
unavoidable while an agent runs at all, and the same exposure every generative
job in this repo has) and the `id-token: write` OIDC minting endpoint. Neither
can write to this repository. What is gone is the push-capable
`GITHUB_TOKEN` — #645's stated impact.

Every other agent job still holds a push-capable token: `bug-patrol`,
`feedback-distill` and `quality-regrade` legitimately push from inside the
agent; `health-audit`'s audit job does not push but holds the app token anyway;
`claude.yml` is the declared exemption below and #669 owns its tightening.
`ci-workflows.test.ts` enumerates all of them by exact credential, so a job that
gains a write scope *or* starts minting an app token fails the suite, and
`fix-error` cannot silently take either back. The inventory reads the
`permissions:` block and the step's `github_token` input — a PAT handed to a
step through `env:` is a stronger credential it does not see.

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
is genuinely weaker than the scheduled loops': `persist-credentials: false` is
set, `claude-code-action` authenticates its own writes, and a human triggered the
run and is watching it. It is not risk-free — fork-PR diffs and third-party
issue bodies are unvetted input and the job holds three `write` scopes — so
#669 tracks whether to tighten it. The lesson generalises: an exemption is for
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
   or the action mints its own write-capable app token. If a new agent job must
   hold a credential, add it to the enumerated inventory in
   `ci-workflows.test.ts` in the same commit — the suite fails otherwise, which
   is the point.
7. A job that consumes an artifact another job's agent produced must **apply**
   it, never execute it: `git apply` a patch, `--body-file` a body, argv arrays
   instead of shell strings, and no `eval`/`bash <agent output>`.
