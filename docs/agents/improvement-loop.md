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

(**Bug Patrol's `error_max_turns`/no-durable-outcome pattern, condensed
history:** first flagged 07-26, receded through a 7-run green streak and was
marked retired 08-02, then recurred 08-03 through 08-08 in the same two
modes — denial-driven `error_max_turns`, and clean completions that still
leave no PR/`quiet-run.md` — which reopened the question under this doc's
own falsification clause. Full blow-by-blow of that cycle lived here through
2026-09-27; it is summarized rather than repeated because the cycle has
since repeated again, below, and re-narrating each prior round costs more
doc than it returns.

**Reopened again, 2026-10-04.** #959 (08-30) already proposed the concrete
fix for this exact recurrence — default `show_full_output: true`
permanently in `bug-patrol.yml`, since that workflow handles no secrets in
its own output — and named "a fifth unresolved occurrence with the
diagnostic still not run" as its own recurrence signal. That is what
happened: sampled the last 10 scheduled runs (2026-09-20 through 09-29) via
`gh api repos/<owner>/<repo>/actions/runs/<id>/jobs`, a lighter check that
confirms *which step* failed without needing `show_full_output: true`. 8 of
10 failed: of the 5 sampled in detail, 2 failed at the `Hunt, fix, and open
a PR` step (the agent-side `error_max_turns`/permission-denial mode) and 3
at `Require durable outcome` (the clean-completion-but-no-artifact mode) —
both modes this doc already named, confirming #959's "still not run" is
now "still not run, and the failure rate got worse in the meantime" (2/10
green vs. the ~6/10 `error_max_turns`-era baseline this doc records for
08-03–08-08). The one gap the job-step check does *not* close: it still
doesn't name which *tool* was denied inside `Hunt, fix, and open a PR` —
only `show_full_output: true` (or equivalent) does that, and #959's fix is
still unmerged alongside everything else in the review-capacity backlog
below. **Observable behavior this should change:** the rolling 10-run
window should read ≥8 green (it reads 2/10 as of 09-29), and the next
`Hunt, fix, and open a PR` failure's log should name the denied tool
without a follow-up research task. **Falsifies** if #959 merges and the
next failure's log names the tool, or if the next 10 scheduled runs return
to ≥8 green regardless; **stays failed** if a third 10-run sample still
shows 3+ failures in either step with the responsible tool still
unidentified.)

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
distinct signatures. Stays open otherwise.

**Confirmed toward (b), 2026-10-04 — not yet acted on.** #959 (08-30, still
unmerged) already caught that the noise isn't one signature: it catalogued
a second one (Turbopack Fast-Refresh HMR `ReferenceError`s, now 13 instances
across #405–#955) in `gotchas.md` and proposed checking future needs-human
issues against that growing catalog rather than the one hardcoded string.
Today's 7 open needs-human issues split 2 `Unregistered API key` (#832,
#833) + 3 Turbopack (#951, #953, #955) + 2 unrelated (#775, #549) — 5 of 7
(71%) catalog-noise, same ratio #959 found, and sentry-fix is still at 0
merged PRs across 16 scheduled runs this window. The evidence hasn't
changed; #959's fix just hasn't landed yet, for the same review-capacity
reason named below. Not re-promoting this as a new finding — recording that
it's confirmed, not stale, so a future pass doesn't have to re-derive it.)

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

**Rechecked 2026-10-04: the gap has widened every week it's been checked,
not just persisted.** Nothing has merged to `main` since #949 (2026-08-23) —
42 days, up from 35 (09-27 reading), 28 (09-20), and 21 (09-13) the three
prior weeks this was checked. 25 PRs are open, almost all green
(`gh pr list --state open --json statusCheckRollup`), oldest (#950) at 41
days. Five consecutive feedback-distill PRs (#959, #965, #968, #973, #978)
have now rechecked and restated this exact finding without one of them
merging either — the gap this doc already names ("a docs-only promotion
cannot fix a pure review-capacity shortage") applies to this entry's own
output, not just to bug-patrol/sentry-fix. Restating the day count a sixth
time would add prose without adding anything enforceable, so this pass adds
one new, concrete piece instead: **nothing currently pages a human when
this backlog grows.** `live-drift.yml` and `nightly-watch.yml` both upsert
one deduped tracking issue when their condition is true and close it on
recovery — the same pattern applied here (a deterministic, non-AI check:
count open PRs carrying an automation label that are green and older than 7
days; open/update one `stale-automated-prs` issue naming them; close it when
the count drops to zero) would convert this paragraph's manual `gh pr list`
check into something that pages without needing a human or an agent to
remember to run it. This is a proposal for a new entry in
[`scheduled-jobs.md`](scheduled-jobs.md)'s Actions-cron table, not an
implemented job — it needs an actual workflow file, which is outside this
loop's docs-only scope. **Observable behavior this should change:** a
human should learn about a growing stale-PR backlog from a GitHub
notification, not from next week's distillation PR. **Falsifies** if the
watchdog is built and a week passes with the issue correctly opening/closing
on the backlog's state; **stays open** — and the "review-capacity gap" entry
above should stop being re-proposed verbatim — until either the watchdog
lands or a queue-clearing session actually closes the backlog.

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
