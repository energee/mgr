# Sentry Error Harness — Design

**Status:** Draft (pending approval)
**Author:** Ted Slesinski
**Date:** 2026-04-16
**Branch:** `feat/error-harness`

## Goal

Build an autonomous loop that:

1. Harvests production-style runtime errors pushed to Sentry from local development.
2. Deeply analyzes each error (root cause, pattern scan, impact).
3. Opens thorough, self-reviewed pull requests that fix the errors.

The harness runs on a GitHub Actions cron schedule, uses the project's existing Claude Code subscription, and gates every PR through three internal quality reviews before surfacing it to the user.

## Non-Goals

- Replace human judgment on hard-to-fix issues — unfixable errors become *diagnostic PRs* with improved error handling and documentation.
- Automatic merging — the user reviews every PR.
- Real-time webhook response — the harness is batch-oriented.

## Architecture

Three layers, each doing what it is best suited for:

| Layer | File(s) | Responsibility |
|-------|---------|----------------|
| Workflow | `.github/workflows/sentry-harness.yml` | Cron/manual trigger, job orchestration, matrix fan-out |
| Orchestrator | `.github/scripts/sentry-harness.ts` | Deterministic work — Sentry API, scoring, dedup, JSON emission |
| Claude Code Action | `anthropics/claude-code-action@v1` | Judgment work — code analysis, fix, tests, quality gates, PR |

The orchestrator handles anything that must be reliable and reproducible (API calls, ranking math, dedup). Claude Code handles anything that benefits from judgment (root cause, code navigation, fix design, simplification, review).

### Data Flow

```
cron trigger (17:00 / 22:00 UTC)      manual dispatch
         \                             /
          \___________________________/
                      |
                      v
        ┌──────────────────────────────┐
        │  Job: score-errors           │
        │  - fetch unresolved issues   │
        │  - score by frequency+recency│
        │  - check open sentry-fix PRs │
        │  - emit JSON array (≤5)      │
        └──────────────────────────────┘
                      |
                      v
        ┌──────────────────────────────┐
        │  Job: fix-error (matrix)     │
        │  strategy.max-parallel: 1    │
        │  strategy.fail-fast: false   │
        │  one invocation per error    │
        └──────────────────────────────┘
                      |
                      v
        ┌──────────────────────────────┐
        │  Claude Code 12-step pipeline│
        │  → PR                        │
        └──────────────────────────────┘
```

## Triggers

| Trigger | Schedule / Event |
|---------|------------------|
| Cron (noon EST) | `0 17 * * *` (UTC) |
| Cron (5pm EST) | `0 22 * * *` (UTC) |
| Manual | `workflow_dispatch` |

Note: cron is specified against EST (UTC-5). DST transitions will shift the local run time by one hour; acceptable for this workflow.

## Orchestrator Script (`.github/scripts/sentry-harness.ts`)

### Inputs

Environment variables (sourced from GitHub Secrets):

- `SENTRY_AUTH_TOKEN` — Sentry API token (read access to issues)
- `SENTRY_ORG` — Sentry organization slug
- `SENTRY_PROJECT` — Sentry project slug
- `GH_TOKEN` — automatic `GITHUB_TOKEN` (for PR dedup via `gh`)

### Pipeline

1. Call `GET /api/0/projects/{org}/{project}/issues/?query=is:unresolved environment:development&statsPeriod=7d`.
   - Filters to the `development` environment (where local-run errors land).
   - When production deploys begin reporting errors, add `environment:production` to the query or remove the filter.
2. Run `gh pr list --state open --search "head:sentry-fix/"` and extract claimed Sentry issue IDs.
3. Drop any candidate whose ID matches an open PR.
4. Score each remaining candidate:

```
score = (normalized_frequency × 0.6) + (recency_score × 0.4)
```

- `normalized_frequency` = `eventCount7d / max(eventCount7d across batch)`, range 0–1.
- `recency_score` = exponential decay on time since `lastSeen`. 0 hours → 1.0; 24 hours → ~0.5; 7 days → ~0.0.
- Severity (`fatal` / `error` / `warning`) is a tiebreaker when two candidates score within 0.05 of each other: `fatal > error > warning`.

5. Emit the top 5 as a JSON array to stdout and export via GitHub Actions outputs.

### Output Shape

```json
[
  {
    "issueId": "12345",
    "shortId": "MGR-42",
    "title": "TypeError: Cannot read property 'name' of undefined",
    "culprit": "src/lib/foo.ts in handleBar",
    "permalink": "https://sentry.io/...",
    "stackTrace": "<formatted text>",
    "eventCount7d": 342,
    "firstSeen": "2026-04-14T09:00:00Z",
    "lastSeen": "2026-04-16T14:00:00Z",
    "level": "error",
    "environment": "development",
    "tags": { "browser": "Chrome 130", "url": "/production/batches/..." },
    "score": 0.87
  }
]
```

Output also exposes `count` so the downstream job can skip when the batch is empty.

## Fix Pipeline (per error)

Each matrix job invokes Claude Code Action with the error JSON and a prompt enforcing this 12-step pipeline:

1. **Trace stack trace** — resolve Sentry frames to source files, read relevant code.
2. **Root cause analysis** — identify *why* the error occurs (null safety, race condition, stale state, missing error boundary, etc.).
3. **Pattern scan** — grep for similar vulnerabilities elsewhere in the codebase.
4. **Implement fix** — minimal and targeted; follow `CLAUDE.md` project conventions (entity configs, universal components, centralized query keys, no hardcoded status maps, etc.).
5. **Add tests** — write a Vitest test reproducing the error condition; verify it fails on current code and passes after the fix.
6. **Validate** — `bun run typecheck`, `bun run test`, `bun lint`. All must pass.
7. **Simplify** — invoke `/simplify` on changed files; review for reuse, quality, efficiency; fix issues found.
8. **Re-validate** — repeat step 6 if simplify changed anything.
9. **Code review** — invoke `/code-review:code-review` on the diff; catch bugs, logic errors, security issues, convention violations.
10. **Apply review fixes** — address findings from step 9.
11. **Re-validate** — repeat step 6 if review triggered changes.
12. **Open PR** — branch `sentry-fix/SENTRY-{issueId}`, labels `sentry-fix` + `automated`.

### Guardrails in the Prompt

- Follow `CLAUDE.md` conventions strictly (entity configs, universal components, query keys, no empty-string Select values, security-invoker views, RLS on all tables).
- Never modify unrelated code.
- Never skip hooks or bypass validation; if something fails 3 times, open a diagnostic PR instead of forcing a bad fix.
- Never create files the task doesn't need.

### PR Body Format

```
## Sentry Fix: {Issue Title}

**Issue:** [{shortId}]({permalink}) | **Events (7d):** {N} | **First seen:** {date} | **Last seen:** {date}

### Root Cause
{Deep analysis of why this error occurs, with file:line references}

### Fix
{What changed and why — specific files and logic}

### Related Patterns
{Other locations with the same vulnerability, if any, and whether they were addressed}

### Test Plan
- [x] Reproducing test added at {path}
- [x] Fix verified (test passes)
- [x] Full suite passes
- [x] Type check clean
- [x] Lint clean
- [x] Simplify pass completed
- [x] Code review pass completed
```

### Diagnostic PR (when a fix is not feasible)

If Claude cannot produce a working fix after 3 attempts, or the root cause is outside the codebase (infrastructure, third-party library, data), it still opens a PR that:

- Adds better error handling / logging at the failure point
- Documents the root cause analysis in the PR body
- Adds the `needs-human` label alongside `sentry-fix` and `automated`

This surfaces the issue for human attention without silently dropping it.

## Workflow File (`.github/workflows/sentry-harness.yml`)

Sketch (exact text defined during implementation):

```yaml
name: Sentry Error Harness

on:
  schedule:
    - cron: '0 17 * * *'   # Noon EST
    - cron: '0 22 * * *'   # 5pm EST
  workflow_dispatch:

jobs:
  score-errors:
    runs-on: ubuntu-latest
    outputs:
      errors: ${{ steps.score.outputs.errors }}
      count: ${{ steps.score.outputs.count }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - id: score
        run: bun .github/scripts/sentry-harness.ts
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
          SENTRY_PROJECT: ${{ secrets.SENTRY_PROJECT }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  fix-error:
    needs: score-errors
    if: needs.score-errors.outputs.count > 0
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: read
      id-token: write
    strategy:
      fail-fast: false
      max-parallel: 1
      matrix:
        error: ${{ fromJson(needs.score-errors.outputs.errors) }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          plugin_marketplaces: 'https://github.com/anthropics/claude-code.git'
          plugins: 'code-review@claude-code-plugins'
          prompt: |
            {full harness prompt — see Fix Pipeline section}
```

### Secrets

| Secret | Status | Purpose |
|--------|--------|---------|
| `CLAUDE_CODE_OAUTH_TOKEN` | Already configured | Claude subscription auth |
| `SENTRY_AUTH_TOKEN` | **To add** | Read Sentry issues via API |
| `SENTRY_ORG` | **To add** | Sentry org slug |
| `SENTRY_PROJECT` | **To add** | Sentry project slug |

## Failure Modes

| Situation | Behavior |
|-----------|----------|
| Sentry API unreachable | Score job fails with a clear error; fix job is skipped; next run retries. |
| No eligible errors | `count: 0` short-circuits the fix job. Workflow ends green, no noise. |
| Claude cannot produce a working fix | After 3 iteration attempts, opens a diagnostic PR with `needs-human` label. |
| Fix breaks tests or typecheck | Caught at validate step; Claude iterates up to 3 times, then falls back to diagnostic PR. |
| Duplicate fix between runs | PR dedup filter (open `sentry-fix/SENTRY-{id}` branches) prevents double work. |
| Error already fixed between scoring and fixing | Claude reports no change needed; no PR opened. |
| Matrix job crashes | `fail-fast: false` ensures other errors still get attempted. |
| Unreadable stack trace (bad source maps) | Diagnostic PR noting the source map gap. |

## Prerequisites

Before the harness can run, the user must:

1. **Create a Sentry project** at sentry.io (if not already created).
2. **Set `NEXT_PUBLIC_SENTRY_DSN`** in the local `.env` file so errors from `bun dev` reach Sentry.
3. **Create a Sentry auth token** with `project:read` and `event:read` scopes.
4. **Add GitHub Secrets**: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`.
5. **Verify Sentry wiring** — trigger a deliberate error in local dev, confirm it appears in the Sentry dashboard.
6. **Add `sentry-fix`, `automated`, `needs-human` labels** to the GitHub repo (optional; workflow can create them on first use).

## Testing Strategy

- **Orchestrator script** — unit tests for scoring math (stable inputs, known outputs), JSON shape, dedup filter. Vitest.
- **Workflow** — manual dispatch against a known Sentry project with seeded errors; verify PRs open as expected.
- **Fix pipeline** — validated end-to-end by running the workflow against a staged Sentry error (e.g., a deliberately introduced null-ref bug in a feature branch) and confirming a clean PR is produced.

## File Structure Summary

New files created by this design:

```
.github/
  workflows/
    sentry-harness.yml          # GitHub Actions workflow
  scripts/
    sentry-harness.ts           # Orchestrator: Sentry API + scoring + dedup
    sentry-harness.test.ts      # Unit tests for scoring + dedup
```

No changes required to existing source code. Sentry integration files already exist; only environment variables change.

## Open Questions / Tunable Knobs

The following are calibrated to the current design but can be revisited after running the harness for a few weeks:

- Scoring weights (currently 0.6 frequency / 0.4 recency).
- Max errors per run (currently 5).
- Cron cadence (currently 2x/day).
- Recency decay half-life (currently 24 hours).
- Iteration budget before diagnostic fallback (currently 3).

## Success Criteria

- A cron run produces 0–5 PRs, each with a meaningful root cause analysis and passing CI.
- At least 70% of produced PRs are merge-ready without human modifications (measured after 2 weeks of operation).
- No duplicate PRs across runs.
- No workflow runs fail due to orchestrator bugs (Sentry API failures are expected and acceptable).
