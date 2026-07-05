# The improvement loop

How this repo improves itself, which automation owns which kind of change,
and which model tier each one runs. Read this before adding a new automated
workflow — extend one of these loops instead if it fits.

## The four loops

| Loop | Cadence | Owns | Model |
|------|---------|------|-------|
| [Sentry harness](../sentry-harness-setup.md) | 2× daily (17:00/22:00 UTC) | Production/runtime bugs → fix PRs | Sonnet |
| [autoharness](autoharness.md) | On demand (`autoharness optimize`) | Mechanical `src/lib` refactors | Sonnet |
| Quality re-grade (`quality-regrade.yml`) | Weekly (Mon) | [quality.md](quality.md) scorecard + trend log | Sonnet |
| CI gates (`test.yml`, `db-lint.yml`, `make check`) | Every push | Coverage ratchets, DB lint, type/lint/test | none |

The loops compose: CI gates make the two generative loops safe (a bad
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
  interactive sessions, design decisions, `@claude` mentions and PR review
  (`claude.yml`, `claude-code-review.yml` intentionally stay on default —
  review is the safety net for Sonnet-generated fixes, so don't cheapen it).

## Weekly rhythm

1. Merged sentry-fix PRs accumulate during the week; review/merge them like
   any PR. `needs-human` label = the harness gave up, finish manually.
2. Monday's re-grade PR shows what shifted. A falling grade names the next
   target.
3. Point a bounded loop at that target: an autoharness campaign if it's
   mechanical cleanup in `src/lib`, a normal session otherwise.
4. Ratchet what you fixed: bump the vitest coverage floor / shrink an
   allowlist so the gain can't silently regress.
