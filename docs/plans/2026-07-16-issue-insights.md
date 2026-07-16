# Issue-queue insights — 2026-07-16

Analysis of the 50 most recent GitHub issues (#2–#514, bulk from 2026-07-13→15) to find recurring failure patterns and encode mitigations into the expert-agent files. Companion changes in this commit: new `transaction-safety-reviewer` agent, rule additions to `data-layer-expert`, `entity-architect`, `integrations-expert`.

Method: `gh issue list --state all --limit 100 --json number,title,body,labels`, clustered by `type:` label (the queue is already well-labeled), bodies read for every issue in the top clusters. Reproducible any time with the same command — no tooling was built or needed.

## Cluster 1 — Multi-step writes treated as transactions (16 issues, mostly severity:high)

`type:transaction-integrity` (11) plus adjacent `account-provisioning` (2), `silent-failure` (1), `data-lifecycle` (2). One root fact underlies all of them: **PostgREST calls are per-request autocommit; only a SQL RPC gives app code a transaction.** Sub-patterns, each observed in shipped code:

| Sub-pattern | Issues |
|---|---|
| Delete-then-insert child-row replacement, no transaction/lock | #446, #480, #488 |
| Status committed before side effects run (fire-and-forget) | #434, #416 |
| External system ack'd before local persistence verified (`{error}` discarded) | #445, #443, #436 |
| Claim/replay unit smaller than side-effect set; compensation math reads original not remaining state | #443, #477 |
| Compensation covers only the newest branch | #442, #479 |
| Client-computed balance, no DB constraint | #447 |
| Resync reports `failed: 0` after thrown phase | #444 |
| Derived data recalculated by some mutation paths but not others | #489 |
| RPC references columns a later migration dropped | #476 |
| Merge migration drops semantic flag on collision delete | #478 |

**Mitigation shipped:** new read-only gate agent `.claude/agents/transaction-safety-reviewer.md` carrying this full failure catalog and a 10-point checklist; `data-layer-expert`, `entity-architect`, and `integrations-expert` each gained the sub-patterns in their territory plus a "dispatch transaction-safety-reviewer" trigger.

## Cluster 2 — Sentry harness re-triaging the same dead events (16 issues filed, ~6 distinct Sentry issues)

MGR-H was triaged **4 separate times** (#405, #408, #414, #430), MGR-G 3× (#406, #409, #431), MGR-N 2× (#492, #509), MGR-7 2× (#496, #510), MGR-6 2× (#498, #511), MGR-R 1× (#512) — every one classified (C) unfixable: dev-mode HMR artifacts from since-removed worktrees, or hydration errors on the deleted `/production/planning` route.

Two harness defects cause this (`.github/scripts/sentry-harness/`):

1. **No dedup for (B)/(C) triage outcomes.** `dedup.ts`'s `filterFixedIssues` only recognizes *merged PRs* (`sentry-fix/SENTRY-<id>` branches). A (B)/(C) run ends in a GitHub issue, the Sentry issue stays unresolved, and the next scheduled run re-picks and re-triages it. Fix: also filter Sentry issues that already have a GitHub issue titled `[sentry] <shortId>:` (open **or** closed, unless `lastSeen` postdates the issue's closure) — mirror of the existing merged-PR logic. Alternative/simpler: after a (C) classification, resolve/ignore the issue via the Sentry API so it leaves the unresolved list.
2. **No cheap staleness pre-filter before burning a Claude run.** Two checks are decidable in the scorer for pennies: (a) stack-trace chunk paths containing `_agents_worktrees_` / `_claude_worktrees_` are worktree dev artifacts, never fixable from main; (b) `SENTRY_ENVIRONMENT=development` events whose culprit route no longer exists on main. Filter (a) in `sentry-api.ts`/`scoring.ts`; (b) can be a step-0 prompt instruction ("if the culprit path is deleted on main, comment on the existing issue and exit — do not file a new one").

**Mitigation:** filed as a follow-up issue (harness code + tests, separate PR). Not an agent-file fix — the agents never see these; the workflow does.

Related but distinct: #400/#401/#433/#514 are (D)-class "root cause unknown" issues where error *reporting* was broken — destructured PostgrestError copies passed to `log.error` degrade to `captureMessage` with no stack (`src/lib/client-logger.ts` only routes `instanceof Error` to `captureException`). The reporting fixes are merged; these issues correctly wait for the next diagnostic event. A lint rule banning `log.error({...spread of error fields})` would prevent recurrence, but with 4 known instances already fixed, waiting to see if it recurs is the cheaper move.

## Cluster 3 — Authorization gaps (3 issues, all shipped)

- #435: QuickBooks OAuth routes checked `withAuth` (authenticated) not `withPermission` (authorized) — any account could replace global QBO tokens.
- #448: `/api/chat` same pattern — customer accounts can spend brewery-funded Anthropic credits (still OPEN).
- #441: inactive users kept full access — all four auth layers (staff layout, `withPermission`, TS checks, `user_has_permission()`) authorized from roles alone, ignoring `user_profiles.status`.

**Mitigation shipped:** `data-layer-expert` gained the "authorization ≠ authentication, roles ≠ active" gotcha + checklist item 12 (new routes use `withPermission`; auth changes cover all four layers).

## Cluster 4 — Test/CI infrastructure (5 issues, mostly needs-human)

#437 (PRs never run E2E; DB behavior untested), #418 (E2E credentials never provisioned), #438 (dependency audit runs an invalid Bun command, non-blocking, 41 high advisories unblocked), #500 (Actions billing), #403 (check-db drift on main). These are operator decisions/actions, not agent-knowledge gaps — no agent edits. #418 + #438 are the two with concrete, small fixes waiting.

## Cluster 5 — Migration/deployment drift (2 issues)

#439, #440 — already a tracked arc with its own tooling (db-lint replay gate, live-drift watchdog, PR #365). No new mitigation needed; #476 (cluster 1) added the one new lesson: column drops must grep RPC bodies.

## What was NOT done, deliberately

- No new tooling/scripts for the report itself — `gh` + labels + reading is the whole pipeline. Re-run this analysis by re-running the command above; make it a recurring skill only if it's asked for a third time.
- No lint rule for the `log.error` destructuring pattern (4 instances known, all fixed; revisit on recurrence).
- No changes to `ui-systems-expert`/`brewing-domain-expert`/`test-surgeon` — zero issues in the queue traced to their territory.
