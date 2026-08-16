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

(Checked again 2026-08-16, and the answer changed: the pattern has not
receded and permission-denial counts are climbing, not falling. Four
consecutive scheduled runs, 08-13 through 08-16 (run IDs 31681652529,
31783185641, 31872144951, 31934072087): 08-13 hit `error_max_turns` again
(81 turns, 9 denials); 08-14 failed in a third, previously-unseen shape — the
very first turn errored out (1 turn, `is_error: true`, $0 cost, 364ms) with
no `permission_denials` field at all, consistent with the same-day Sentry
Error Harness `rate_limit` failures noted below rather than a permission
denial; 08-15 finished cleanly at the API level (`is_error: false`, 49 turns)
but with 6 permission denials and ended with **neither a PR nor
`quiet-run.md`**, failing `require-durable-outcome` exactly as gap #2 above
predicts; 08-16 succeeded — opened a PR — but with **27 permission denials**,
the highest count recorded since this pattern was first tracked on 07-26
(previous high: 20 on 07-26, then 18 on 08-08). The 08-12 falsification bar
("two more consecutive scheduled runs land a PR or `quiet-run.md` with zero
permission denials") has not been met, and denial counts on the runs that did
finish (6, then 27) moved the wrong direction. The diagnostic step named on
07-26 and repeated in the 08-12 distillation — a one-off run with
`show_full_output: true`, or an equivalent way to surface the denied tool
name from `claude-code-action`'s redacted job log — still has not happened,
three weeks on. Separately, gap #2's proposed fix — giving `bug-patrol.yml`'s
prompt the same explicit "whatever the outcome, end by writing
`quiet-run.md`" closing guardrail `sentry-harness.yml`'s prompt already
carries — also still has not landed, and 08-15 is a second observed instance
of exactly the failure that guardrail would catch. Both are workflow-file
changes outside this loop's own edit scope; this note exists so the next
session that opens `bug-patrol.yml` does not have to re-derive that both are
still open, and to retire the "recheck permission-denial trend" framing —
without the diagnostic above, the count alone no longer tells you anything:
it has now moved in both directions between consecutive runs.)

(New this week, and possibly the explanation for part of the above: Anthropic
API `rate_limit` errors hit two different scheduled agentic workflows in the
same window. Sentry Error Harness's "Fix error" jobs failed with
`"error": "rate_limit"` at the first turn on two consecutive scheduled runs —
08-13 (run 31728002914, job 94541175983, MGR-17) and 08-14 (run 31825650874,
jobs 94849093727/94849093761/94849094338 — all 3 parallel fix-error jobs that
ran failed the same way within the same ~90-second window). Bug Patrol's
08-14 run (job 94713191689, cited above) failed with the identical shape — 1
turn, `is_error: true`, $0 cost, 364ms — though its `error` field is not
visible in the captured log (`claude-code-action` hides full output), so it
is consistent with, not confirmed as, the same cause. No run since 08-14 has
repeated this shape. One data point short of a pattern: logged here so a
second occurrence is recognized immediately instead of re-diagnosed from
scratch. If it recurs on 2+ more scheduled runs across either workflow, check
whether an account-level concurrent-request or per-minute token limit is
being exceeded when multiple scheduled Claude workflows overlap, or when
sentry-harness's 3 parallel fix-error jobs launch simultaneously — this is a
capacity problem, not a prompt or `--max-turns` problem, and raising the turn
cap would not help it.)

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

**A loop that opens zero PRs across the full 4-week window has a third
possible cause, distinct from the two above: conservative-by-design triage,
not a broken loop.** `loop-scoreboard.md` currently shows sentry-fix at 20
scheduled runs / 0 PRs opened over the last 4 weeks — literally "all quiet,"
the scoreboard's own retire/revise trigger. Checked 2026-08-16: the
Sentry-sourced issue actually filed in that window (#775, opened 08-12) is
explicitly classification-(B) or worse in the harness's own A-D scheme — it
needs a human schema/business-rule decision, not a null-check or query typo
— and the pattern before the scoreboard's window (#636-#642, #492-#526, all
closed as dev-env credential noise, removed routes, or transient HMR
artifacts) shows this loop routes most of what it finds into `needs-human`
issues or closed-as-resolved, not PRs, by design: a high bar for
classification-A auto-fix is the intended behavior, not a malfunction. Before
naming sentry-fix a retire/revise candidate on the 0/20 count alone, check
what its `score-errors` job actually found each run — the scored-but-not-
auto-fixed issues, not just the PR count — via `gh issue list --search
"sentry" --state all`. A 0/20 window is exactly what "correctly declining to
force-fix classification-B+ errors" looks like from the scoreboard alone, and
is indistinguishable from "broken" without reading what it filed instead.
Falsifies (as a concern, not as evidence the loop works) if a future week
shows a classification-A-eligible Sentry error scored and *not* turned into
either a PR or a `needs-human` issue — that would mean real auto-fixable work
is being silently dropped rather than conservatively deferred.)

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
