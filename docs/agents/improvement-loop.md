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

(Bug Patrol's 07-26 permission-denial pattern receded, then came back. Seven
straight scheduled runs (07-27 through 08-02) went green with no
`error_max_turns`, opening PRs that mostly merged, and the 07-26
revise-candidate flag was retired on that basis — in still-unmerged PR #732.
But the underlying cause was never diagnosed, only outlasted: starting 08-03
the pattern resumed on 4 of the next 6 scheduled runs. 08-05 hit
`error_max_turns` again (81 turns, 10 permission denials) and 08-08 did too
(18 denials — the most since the pattern's 08-03 recurrence, though still
below 07-26's 20). The other two failures in that window (08-04,
08-07) are a distinct, newly observed mode: the agent finishes cleanly —
`is_error: false`, 0-10 permission denials, well under the turn cap — but the
run still ends with **no PR and no `quiet-run.md`**, so
`require-durable-outcome` fails it red anyway. Two separate gaps, not one:

1. Something in the task still reaches for a disallowed tool on a large
   minority of runs, and the diagnostic step recommended on 07-26 — "audit
   which tool that is" — has not happened in two weeks, because
   `claude-code-action`'s job log hides full agent output by design
   (`"Running Claude Code via SDK (full output hidden for security)"`), so the
   tool name behind `permission_denials_count` is not visible in any run log
   sampled. Confirming it needs either a one-off run with `show_full_output:
   true` or an equivalent way to surface the denied tool name, not another
   `--max-turns` increase.
2. Even a clean run does not reliably leave the durable-outcome artifact the
   gate requires. `sentry-harness.yml`'s prompt carries an explicit closing
   guardrail for exactly this case — *"Whatever the outcome, end by writing
   `outbox/plan.json`... A run that ends without it fails red"* — and
   `bug-patrol.yml`'s prompt should carry the equivalent: finishing with
   nothing to fix still requires writing `quiet-run.md`, stated as a
   guardrail rather than left implicit.

Falsifies if two more consecutive scheduled runs land a PR or `quiet-run.md`
with zero permission denials. Stays failed if either failure mode recurs
after two more scheduled runs — and if so, the retire/revise question should
be reopened, not re-closed under the 07-26 framing.)

(**2026-08-30: the failure mode recurred four more times (08-21, 08-27,
08-28, 08-30 all scheduled-run `conclusion: failure`, cross-checked against
`bug-patrol` PRs — no PR exists dated between 08-26's #954 and 08-29's #958,
so 08-27/08-28 produced neither a PR nor a `quiet-run.md`) and the diagnostic
step this section has now recommended twice — a `show_full_output: true`
dispatch, or an equivalent way to see the denied tool name — still has not
happened, over three weeks after the 08-10 write-up called it out and five
weeks after the 07-26 original. Re-stating "someone should audit this" a
third time is exactly the prose-without-enforcement pattern this loop is
meant to correct, not repeat. Concrete proposal for a human to action instead
of another watch note: default `show_full_output: true` in
`bug-patrol.yml`'s `claude-code-action` step permanently (the workflow never
handles secrets in its own output — it's a docs/code-search/fix agent — so
the security rationale for hiding output doesn't obviously apply here); that
turns every future occurrence into a self-diagnosing run instead of a fourth
research task nobody has picked up. Falsifies once that change lands and the
next occurrence names the denied tool in its own log.)

(Bug Patrol's 2026-07-26 revise-candidate flag is retired as of 2026-08-02:
its own falsification clause fired. The two `error_max_turns` runs on
07-25/07-26 were followed by seven consecutive green scheduled runs
(07-27 through 08-02, run IDs 30248989067 through 30738495520), none hitting
the turn/permission-denial ceiling, and the loop scoreboard now shows 7 PRs
opened / 5 merged / 0 closed unmerged / 2 still open since the loop started —
a merge rate that is not trending toward zero. No workflow-file change
coincides with the recovery (`bug-patrol.yml` was last touched by #599 on
07-25, before the streak began), so whatever combination of task content and
the 80-turn cap from #598 was hitting the ceiling simply stopped recurring.
Re-open the investigation the next time a scheduled run hits
`error_max_turns`; until then there is nothing to revise.)

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

(**2026-08-30 update: the single-signature falsification test above was too
narrow, and this window's evidence shows why.** Scoreboard is unchanged (20
scheduled runs / 0 PRs / 0 merged, still entirely quiet). But of the 7 open
`needs-human` issues this window, only 2 (#832, #833) match the literal
`Unregistered API key` signature the test named — 29%, under the ">half"
bar — while 3 more (#951, #953, #955) are a *second*, previously
uncatalogued noise signature: Turbopack Fast-Refresh HMR `ReferenceError`
artifacts (13 instances total going back to #405; now documented in
`gotchas.md`). Counting both catalogued non-actionable signatures together,
5 of 7 (71%) of this window's needs-human output is dev-tooling noise with
no code fix possible — comfortably over the bar — but the test as literally
written measured only one signature and would have reported "falsifies
toward (a)" on a technicality, because the noise this loop produces doesn't
stay one shape. Revised test: check needs-human issues against `gotchas.md`'s
growing noise catalog (2 entries now) rather than one exact string. Falsifies
toward (b) — a `score-errors` pre-filter is worth building — if next
window's needs-human issues are still majority catalog-matched with 0 merged
PRs. Falsifies toward (a) if a PR merges, or if new needs-human issues stop
matching any catalogued signature. Still a human call, not yet acted on.)

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
