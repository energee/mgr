# Expert Agent Team + Targeted LOC Campaign — Design

**Date:** 2026-07-05
**Branch:** `feat/expert-agent-team` (worktree `.claude/worktrees/agent-team`)
**Status:** Approved design, pending implementation plan

## Problem

The mgr codebase (~161k LOC TS/TSX) has recurring areas where a fresh Claude
context makes the same mistakes: entity-registry conventions, Supabase/RLS
quirks, brewing-domain calculation rules, the repo's unusual test idiom.
Each session re-learns these at cost. Separately, duplication remains —
especially in `src/components/` (71.5k LOC, 44% of the app) and across the 36
parallel-structured entity configs — despite the PR #328 dedup campaign.

## Goals

1. A durable team of six project-scoped agents (`.claude/agents/*.md`) that
   encode per-area expertise and are auto-invoked by future sessions.
2. Domain knowledge factored into shared markdown importable later by the
   app's AI chat (`src/domain/ai`) — single source of truth, dev + runtime.
3. A measured, ranked fix backlog (duplication, dead code, LOC reduction).
4. The top 2–3 fixes executed this session using the new agents, validating
   them on real work.

## Non-goals

- Wiring `docs/knowledge/` into the app's chat system prompt (belongs to
  Phase 4 AI work).
- CI duplication gates, codemaps, standing automation loops.
- Full backlog burn-down this session.

## Agent roster

| Agent | Scope | Encodes |
|---|---|---|
| `entity-architect` | `src/entities/` (36 entities), registry `cores.ts`/`index.ts`, routes | One-file-per-entity pattern, entityConfig/form-schema/columns/relationComponents wiring, query-key registration; knip false-positives on registry-consumed exports |
| `data-layer-expert` | `src/lib/supabase/`, `query-keys.ts`, migrations, RLS | Role-based RLS (`user_has_permission()`, no tenancy), migration numbering + `--include-all` push quirks, PostgREST stale cache, live-DB drift status, optimistic locking, pg error codes |
| `brewing-domain-expert` | `src/domain/` | Unit conventions, BOM via `selling_format_materials` (no direct session↔material table, by design), TTB rules, yeast/water-chemistry assumptions; reviews any calculation change |
| `ui-systems-expert` | `src/components/` | universal/data-table/domain layers, zod-v4 `form-resolver` workaround, Recharts v3 quirks, shadcn conventions; leads components dedup |
| `test-surgeon` | test idiom repo-wide | `createRoot`+`act` (no `@testing-library/react`), stubbing `Sortable`/`UnitInput`/data-hooks, mocking `@/lib/supabase/client` env validation, characterization-test-first refactoring |
| `refactor-reviewer` | process gate (read-only tools) | Behavior-preservation review, `bun lint` + `tsc --noEmit` + targeted vitest gates, past failure modes (rebase-reintroduced type errors, knip unreliability, cleanliness-over-LOC) |

Agent definitions live in `.claude/agents/`. Frontmatter `description` is
tuned for auto-matching; `refactor-reviewer` gets read-only tools.

### Shared domain knowledge

`brewing-domain-expert` and `data-layer-expert` carry knowledge the app's AI
chat also needs. That content lives in:

- `docs/knowledge/brewing-domain.md`
- `docs/knowledge/entity-model.md`

Agents reference these files; `src/domain/ai/prompt.ts` can import them at
build time later. Codebase-gotcha agents stay dev-only.

## Phases

**Phase 0 — Ground prep.** Prune stale `.claude/worktrees/agent-*` worktrees
(currently 53 total; sandbox hits `E2BIG` at this scale). Run baselines:
`jscpd` over `src/`, `depcheck`, LOC snapshot. Baselines recorded in the
backlog doc; no tooling committed.

**Phase 1 — Evaluation fan-out.** Six parallel read-only explorer agents
(no worktrees needed). Each studies its area's code, git history
(reverts/fix-commits = encoded mistakes), `docs/plans/` postmortems, and
MEMORY.md. Each returns (a) draft agent-definition content and (b)
duplication/simplification candidates with file paths and rough LOC deltas.

**Phase 2 — Agent team lands.** Write the six agent files +
`docs/knowledge/` docs + a short CLAUDE.md routing table ("touching
`src/entities/` → entity-architect"). One branch → PR.

**Phase 3 — Ranked backlog.** `docs/plans/2026-07-05-agent-team-fix-backlog.md`:
Phase 1 findings + jscpd worst offenders + PR #328 deferred items (B5
`dynamicOptions`, B1/B2 editor coverage), ranked by LOC-saved × risk, with
baseline numbers. Same PR as Phase 2.

**Phase 4 — Top fixes.** Top 2–3 backlog items, each in its own worktree +
branch + PR. Per fix: `test-surgeon` ensures characterization coverage →
behavior-preserving change → `refactor-reviewer` gates the diff →
`bun lint` + `tsc --noEmit` + targeted vitest → PR.

## Error handling

- A fix that can't stay behavior-preserving is demoted to the backlog with a
  note, never forced through.
- If the suite breaks and 3 fix attempts fail, abandon that worktree and
  report (mirrors the repo's bug-fix process).
- Worktree creation requires `bun install` before typecheck/tests.

## Success criteria

- Six agent files exist, auto-match their areas, and were exercised by at
  least one Phase 4 fix.
- Duplication % (jscpd) down vs. baseline after Phase 4.
- Test suite stays green (~1547 tests); `tsc --noEmit` clean on every PR.
- Backlog doc gives future sessions a ranked, costed menu.
