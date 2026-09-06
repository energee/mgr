# The improvement loop

How this repo improves itself, which automation owns which kind of change,
and which model tier each one runs. Read this before adding a new automated
workflow — extend one of these loops instead if it fits.

## The loops

| Loop | Cadence | Owns | Model |
|------|---------|------|-------|
| [Sentry harness](../sentry-harness-setup.md) | Weekdays (17:00 UTC) | Production/runtime bugs → fix PRs | Sonnet |
| [Scheduled health audit](health-audit-and-issue-triage.md#scheduled-automation) | Weekly (Wed 13:37 UTC) | Static correctness audit → deduplicated issues | Default |
| Nightly Bug Patrol (`bug-patrol.yml`) | Daily (07:00 UTC) | One small, high-confidence bug fix → single PR | Sonnet |
| [autoharness](autoharness.md) | On demand (`autoharness optimize`) | Mechanical `src/lib` refactors | Sonnet |
| Quality re-grade (`quality-regrade.yml`) | Weekly (Mon 06:00 UTC) | [quality.md](quality.md) scorecard + trend log → docs-only PR | Sonnet |
| Weekly Feedback Distillation (`feedback-distill.yml`) | Weekly (Sun 08:00 UTC) | Recurring corrections → docs-only PR (this loop) | Default |
| Docs Dream Sweep (`docs-dream.yml`) | Weekly (Sat 04:00 UTC) | Doc rot — broken links, provable doc contradictions → docs-only PR | Sonnet |
| CI gates (`test.yml`, `db-lint.yml`, `make check`) | Every PR (static+unit); weekday nightly (build+E2E) | Coverage ratchets, DB lint, type/lint/test | none |

(The re-grade was rebuilt 2026-07-24: v1 was removed the same day after 10
runs that produced nothing — it lacked `--allowedTools`. The rebuild pins the
allowlist explicitly and, like every scheduled agentic workflow, ends in the
`require-durable-outcome` gate; the once-promised scheduled-agent replacement
was never built and that route is retired.)

(**Bug Patrol's two named-but-unfixed failure modes are both still live as of
2026-09-06, and one has now spread to a second loop.** Permission-denial/
max-turns (first flagged 07-26; the recommended diagnostic — a one-off run
with `show_full_output: true` to see which tool is denied, since
`claude-code-action`'s job log hides full agent output by design — still has
not been run, over five weeks later): recurred again on 09-03
(`error_max_turns` at 81 turns, 14 permission denials), the third confirmed
spike after 07-26 (20 denials) and 08-05/08-08 (10 and 18). Clean-run-no-
durable-outcome (first flagged 08-10; proposed fix — add `sentry-harness.yml`'s
explicit "write `quiet-run.md` even when there is nothing to fix" guardrail to
`bug-patrol.yml`'s prompt — has not been applied to the workflow file in the
month since): recurred on 08-27, 08-30, 09-02, and 09-06 — 4 of the last 10
scheduled bug-patrol runs failed at the `require-durable-outcome` step while
the agent's own "hunt and fix" step reported a clean exit. **New this week:**
Docs Dream Sweep hit both of the same failure modes for the first time —
clean-run-no-durable-outcome on 08-29, and `error_max_turns` with 8 permission
denials on 09-05 — so whatever keeps reaching for a disallowed tool and
skipping the closing artifact is not specific to bug-patrol's prompt.
Falsifies if the next 5 scheduled runs across both loops each land a PR or
`quiet-run.md` with zero permission denials. Stays open — and should escalate
from "name the fix" to "apply the fix to the workflow file," since naming it
has not been sufficient for a month — if either failure mode recurs in either
loop before the next distillation.)

(**New this week: Bug Patrol generated three near-duplicate PRs for the same
bug** — #958 (08-29), #962 (09-01), and #964 (09-04) all fix "mobile filter
badge counts an entity's default quick filter as active" with materially the
same diagnosis and the same `countActiveFilters`/`activeFilterCount` fix
shape. Cause: each run only reads the live tree, not its own loop's open PR
queue, so when a prior fix PR for the same bug sits unreviewed (see the
review-capacity-gap entry below), the next run rediscovers the bug fresh and
files another PR for it — compounding the review backlog rather than just
sitting in it, three PRs to read instead of one. Durable owner: bug-patrol's
prompt should list currently-open `bug-patrol`-labeled PRs before hunting and
skip a bug whose description already matches one. Falsifies if a week passes
with no 2+-PR duplicate cluster; stays a live gap if another duplicate cluster
appears before the prompt changes.)

(**sentry-fix flagged 2026-08-23 as a retire/revise candidate to watch, not
yet acted on.** The loop scoreboard's 4-week window (since 07-26) reads 20
scheduled runs / 0 PRs opened / 0 merged — entirely quiet, which is the
scoreboard's own named criterion ("a loop whose PRs trend toward zero
merges"). The needs-human issues it did file in that window cluster on one
recurring, already-diagnosed signature: dev-machine `Unregistered API key`
credential noise (five prior instances, #636–#642, recurring again as
#832/#833 on 08-18) that `gotchas.md`'s "Unregistered API key" entry
diagnoses in full, yet nothing short-circuits a fresh `fix-error` dispatch
the next time the same signature resurfaces in Sentry. Two competing reads,
not yet distinguished: (a) the scored issue stream is genuinely dominated by
dev-environment noise with no production signal to act on, in which case 0
PRs is correct and this loop is a rare-event safety net rather than a weekly
producer; or (b) `score-errors` should recognize a known-noise signature
(matching message + no Postgres error code, per the gotchas.md tell) and skip
it before spending a fix-job on a diagnosis it already reached five times.
Falsifies toward (b) if the next 4-week scoreboard window still shows 0
merged PRs for sentry-fix *and* more than half its needs-human issues in that
window are the same `Unregistered API key` signature — that combination means
the loop is spending its bounded run budget re-diagnosing one known
non-actionable pattern instead of triaging anything new. Falsifies toward (a)
if a PR merges, or if the needs-human issues in the next window are mostly
distinct signatures. Stays open otherwise.)

(**Postscript, 2026-09-06:** the scoreboard's 4-week window still shows 0
merged sentry-fix PRs, but the needs-human signature shifted — the three most
recent needs-human issues (#951, #953, #955, all 2026-08-24–26) are not the
old `Unregistered API key` cluster but a new one: a `ReferenceError` naming an
identifier that is plainly declared/imported at the cited line, always in
`environment: development` with `turbopack: True`, immediately after a
`[Fast Refresh] rebuilding` breadcrumb. Each of the three independently
re-derived the same multi-paragraph "this is a Turbopack HMR artifact, not a
real defect" reasoning. Added a `gotchas.md` entry for the pattern (mirroring
the existing `Unregistered API key` one) so the next occurrence is a lookup,
not a re-diagnosis — orthogonal to whether sentry-fix itself should
special-case known-noise clusters before spending a run, which is still open.
This is evidence for reading (a) over (b) from the 08-23 note above (the
issues are a distinct signature, not a recurrence of the one named there),
but the general shape — a bounded loop repeatedly re-diagnosing a known
non-actionable pattern from scratch — persists under a new name.)

The loops compose: CI gates make the generative loops safe (a bad
automated PR cannot merge green), and the weekly re-grade tells you whether
the week's merges actually moved codebase health — its trend log is the
feedback signal for where to point the next autoharness campaign or manual
session.

## Model-tier policy

Rule of thumb: **the stronger the external gate, the lighter the model.**

- **Sonnet** for anything whose output is mechanically validated before it
  lands: sentry-fix PRs (reproducing test + typecheck/test/lint + `make
  check` + review pass), autoharness proposals (typecheck+vitest screening),
  rubric-driven regrades. A weaker model here costs retries, not correctness.
- **Default/stronger model** for work where the gate is human judgment:
  interactive sessions, design decisions, `@claude` mentions (`claude.yml`
  intentionally stays on default). Automated per-PR review was removed
  2026-07-16 with the CI minutes diet — run `/code-review` locally before
  pushing, or comment `@claude review this` on a PR for an on-demand pass.
  The scheduled health audit also stays on the default model because a schema
  can validate finding shape but cannot mechanically prove the diagnosis.

## Durable outcomes

Every scheduled agentic workflow ends in
`.github/actions/require-durable-outcome`: it must leave a PR, a verifiable
citation, or an evidence-citing `quiet-run.md` — otherwise the run goes red.
Quiet no-op runs are healthy; an *undetectable* no-op run is the failure mode
that killed re-grade v1. The weekly distillation reads a deterministic loop
scoreboard (4-week PR acceptance per loop) so a loop whose output stops being
merged becomes a visible retire/revise candidate instead of silent API spend.

Distillation itself is two-directional: every promotion must name the
observable behavior it should change and the recurrence signal that would mark
it failed, and every weekly PR must also propose retirements (gotchas entries
now enforced by gates, routes to removed things, promotions that changed
nothing). Enforced knowledge accumulates; prose must not.

**A zero-merge stretch on the scoreboard has two different causes — check
which one before naming a retire/revise candidate.** Observed 2026-08-09: 8
automated PRs sat open, green across every check, and unreviewed — spanning
`bug-patrol`, `sentry-fix`, `quality-regrade`, this loop's own #732, and one
dependabot bump, open 0-9 days. #722 was the last PR of any kind to merge, on
07-31, a 9-day gap as of this writing. That is a review-capacity gap,
not a loop-quality signal, and it would produce exactly the same flat merge
line the scoreboard uses to flag a failing loop. Before naming a loop a
retire/revise candidate on a falling merge rate, check `gh pr list --state
open --json number,createdAt,statusCheckRollup` for that loop's label: if the
open PRs are clean and mergeable, the signal is a human backlog, and the
fix is "clear the queue," not "revise the prompt." Falsifies if next week's
scoreboard shows merges resuming without a queue-clearing session; stays a
live risk to scoreboard-reading — recheck it every week — as long as 5+
mergeable automated PRs stay open past 7 days.

(**Recheck, 2026-09-06:** still live, and this is now a second stall of
comparable length to the one above. Six `bug-patrol`-labeled PRs are open,
green, and mergeable — #952, #954, #958, #961, #962, #964 — the oldest (#952)
open 12 days. No PR of any kind has merged since #949 on 08-23, a 14-day gap
as of this writing. Three of the six (#958/#962/#964) are the duplicate
cluster named above, so clearing the backlog now also means recognizing
duplicates rather than reviewing all six as distinct fixes. Falsifies next
week if merges resume without a dedicated queue-clearing session; the
5+/7-day condition still holds, so this stays a live risk to
scoreboard-reading.)

## Worker epochs

Two loops (health audit, feedback distillation) deliberately ride the
claude-code-action **default** model; the others pin Sonnet. The durable-
outcome gate echoes `worker-epoch: model=<id>` into every run's step summary.
When that id changes — usually via a dependabot bump of the pinned
claude-code-action SHA, or Anthropic moving the action default — treat it as a
**new worker epoch**: requalify the affected prompts against a recent run or
two, and ask the subtraction question (is any scaffolding now redundant?)
before adding anything new. Current epoch at last review (2026-07-24):
Sonnet loops on `claude-sonnet-5`, default loops on the action default.

## Weekly rhythm

1. Merged sentry-fix PRs accumulate during the week; review/merge them like
   any PR. `needs-human` label = the harness gave up, finish manually.
2. Monday's re-grade PR shows what shifted. A falling grade names the next
   target.
3. Wednesday's health audit checks recent changes and one rotating correctness
   domain. Review its automated issues before implementation.
4. Point a bounded loop at that target: an autoharness campaign if it's
   mechanical cleanup in `src/lib`, a normal session otherwise.
5. Ratchet what you fixed: bump the vitest coverage floor / shrink an
   allowlist so the gain can't silently regress.
