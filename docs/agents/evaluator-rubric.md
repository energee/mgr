# Evaluator rubric

Score each session / feature on the six dimensions below, 0–2 per dimension.
Use at session end and during code review (`/code-review`). The **score
matters less than the consistency** — same rubric applied across sessions
makes drift visible.

| Score | Meaning |
|---|---|
| 0 | Missing — would fail handoff |
| 1 | Present but incomplete |
| 2 | Solid — a fresh agent could pick this up |

## Dimensions

### 1. Correctness (0–2)

Does the code do what the feature description says it does, against the
verification command?

- 2 — Verification command passes; output matches the documented behavior.
- 1 — Mostly works; one edge case or shaky path exists.
- 0 — Verification fails, or the agent claimed success without running it.

### 2. Verification (0–2)

Is the gate honest?

- 2 — `make check-all` ran clean; no skipped tests; no `it.skip` / `xit` added.
- 1 — `make check` ran but E2E was skipped (and the change touches cross-component code).
- 0 — Verification skipped, manually overridden, or `--no-verify` used on commit.

### 3. Scope discipline (0–2)

Did the change stay within the requested scope?

- 2 — Diff matches the feature; no opportunistic refactors; no new abstractions.
- 1 — Minor incidental cleanup that's clearly justified (typo fixes, etc.).
- 0 — Refactored or rewrote unrelated code; added "while I was here" features.

### 4. Reliability (0–2)

Will this still work next week?

- 2 — Idempotent migrations; no race conditions; no time/locale assumptions; cleanup ops are safe to re-run.
- 1 — One identified risk, called out in `PROGRESS.md` "Known Issues".
- 0 — Hidden flakiness, time-of-day dependency, or unhandled concurrency.

### 5. Maintainability (0–2)

Will the next agent (or human) understand this?

- 2 — Follows entity / page / query-keys / db-security conventions; no comments explaining what — only why.
- 1 — Mostly idiomatic; one or two patterns invented or duplicated.
- 0 — New abstraction not justified by existing code; deprecated `EntityDetail` / `EntityForm` used; hardcoded query keys.

### 6. Handoff readiness (0–2)

Can a fresh session pick up cleanly?

- 2 — `PROGRESS.md` updated; `feature_list.json` reflects current state; `DECISIONS.md` has any new judgment calls; `make check` green at HEAD.
- 1 — One of those is stale.
- 0 — `PROGRESS.md` not touched, or its "Next steps" no longer match reality.

## Scoring

- **10–12** — Ship it.
- **7–9** — Ship after addressing the 0/1 dimensions in a follow-up commit.
- **0–6** — Don't ship. Fix the rubric gaps first.

The rubric is **iterative**. If consistent 2s correlate with bugs in
production, tighten the dimension. If consistent 0s correlate with no real
problems, the dimension is too strict — relax it.
