# Agent Instructions

> **MGR** — brewery management system. Next.js App Router + Supabase/Postgres + AI integration. AI-first, minimalist design philosophy.
> Read this file first, then load topic docs below as the work demands.

This is the single source of truth for agent instructions, shared by every harness (Claude Code, Grok, Codex, and anything else that reads `AGENTS.md`). Harness entry files (`CLAUDE.md`, etc.) only import this file — put project rules here, never in harness-only wrappers.

## First run

```bash
make setup    # bun install + environment checks (one time, or whenever deps change)
make dev      # start Next.js dev server
```

If `make` is unavailable, fall back to `bun install && bun run dev`.

## Verification gate (Definition of Done)

Layered: static → unit → E2E. **No layer advances until the previous one is green.**

| Command | Layer | When |
|---|---|---|
| `make check-fast` | 1 | While editing — lint + typecheck only |
| `make check` | 1+2 | **Required before every commit** — adds vitest + build |
| `make check-all` | 1+2+3 | Before PR / merge — adds Playwright E2E |
| `make verify-feature ID=F003` | per-feature | At any time (per [`docs/feature_list.json`](docs/feature_list.json)) |
| `make check-db` | DB rules | Already part of `make check`; runs the SQL security checks alone |

Run `make help` to list every target.

## Work-in-progress rule

**WIP = 1 per branch.** At most one feature in [`docs/feature_list.json`](docs/feature_list.json) may have `state: "in_progress"` per git branch. Multiple worktrees can each have one in-flight feature. Before starting work:

1. Read [`PROGRESS.md`](PROGRESS.md) for branch state.
2. If a feature is already `in_progress` on this branch and isn't yours, stop and ask.
3. Mark your feature `in_progress` *before* writing code.
4. Mark it `passing` only after `make verify-feature ID=Fxxx` exits 0.

## Load topic docs as needed

Agent-facing quick-references (must-follow rules, code examples):

| Topic | Load when |
|---|---|
| [`docs/agents/patterns.md`](docs/agents/patterns.md) | Working with entities, forms, or pages |
| [`docs/agents/query-keys.md`](docs/agents/query-keys.md) | Adding any `useQuery` |
| [`docs/agents/db-security.md`](docs/agents/db-security.md) | Writing SQL migrations |
| [`docs/agents/ui-rules.md`](docs/agents/ui-rules.md) | Building or reviewing UI components |
| [`docs/agents/debugging.md`](docs/agents/debugging.md) | Investigating any bug |
| [`docs/agents/process.md`](docs/agents/process.md) | Bug RGR, feature two-phase, worktrees, docs gate, guardrails |
| [`docs/agents/dispatching-agents.md`](docs/agents/dispatching-agents.md) | Deciding when to spawn subagents and how to brief them |
| [`PROGRESS.md`](PROGRESS.md) | **Session start** — current state, next steps (generated on main) |
| [`DECISIONS.md`](DECISIONS.md) | Before non-trivial design choices |
| [`docs/agents/session-handoff.md`](docs/agents/session-handoff.md) | Session end — handoff template |
| [`docs/agents/clean-state-checklist.md`](docs/agents/clean-state-checklist.md) | Session end — verification checklist |
| [`docs/agents/evaluator-rubric.md`](docs/agents/evaluator-rubric.md) | Self-grading at session end and in code review |
| [`docs/agents/observability.md`](docs/agents/observability.md) | Sentry use, runtime traces, agent task traces |
| [`docs/agents/quality.md`](docs/agents/quality.md) | Codebase health snapshot (A–D grades per domain/layer) |
| [`docs/agents/autoharness.md`](docs/agents/autoharness.md) | Running the automated `src/lib` refactor screening loop |
| [`docs/agents/improvement-loop.md`](docs/agents/improvement-loop.md) | How the automated loops compose; model-tier policy |
| [`docs/feature_list.json`](docs/feature_list.json) | Feature tracker (state + verification per feature) |

Full reference (deep architecture, decisions, data model):

| Doc | What it has |
|---|---|
| [`docs/spec/README.md`](docs/spec/README.md) | Spec index |
| [`docs/spec/architecture.md`](docs/spec/architecture.md) | Tech stack, design patterns, DEC-* rules in full |
| [`docs/spec/decisions.md`](docs/spec/decisions.md) | Schema decision history (DEC-*) |
| [`docs/spec/workflows.md`](docs/spec/workflows.md) | State machines, allocations |
| [`docs/spec/ai-integration.md`](docs/spec/ai-integration.md) | AI patterns, queries, brewing science |
| [`docs/data-model/`](docs/data-model/) | Per-table schema docs |

## Expert agents and skills (all harnesses)

Domain expertise lives in plain markdown under `.claude/agents/*.md` and `.claude/skills/*/SKILL.md` (package layout: one directory per skill with `SKILL.md`). These are ordinary files: a harness with subagents dispatches them by name when supported; a harness without **reads the matching agent file before editing that area, and follows it**. Either way the rules are the same.

| Touching | Agent file |
|---|---|
| `src/entities/`, entity registry, `src/services/` orchestration, entity API routes (`api/{batches,orders,customers,recipes,users}`) | `entity-architect` |
| `src/lib/supabase/`, `query-keys.ts`, migrations, RLS, auth/portal routes (incl. `api/auth`, `update-password`) | `data-layer-expert` |
| `src/domain/` calculations (units, BOM, TTB, yeast, water) | `brewing-domain-expert` |
| `src/integrations/` (Square, QuickBooks, Slack, email, MongoDB) and their API routes | `integrations-expert` |
| `src/components/` | `ui-systems-expert` |
| Writing/repairing tests, pre-refactor coverage | `test-surgeon` |
| Reviewing any refactor/dedup diff (read-only gate) | `refactor-reviewer` |

Each agent file has YAML frontmatter (`name`, `description`, and optionally Claude-only `tools`). Harnesses that don't understand frontmatter keys should ignore them and read the body. Path is under `.claude/` for historical reasons; content is harness-agnostic.

Domain source of truth: [`docs/knowledge/brewing-domain.md`](docs/knowledge/brewing-domain.md), [`docs/knowledge/entity-model.md`](docs/knowledge/entity-model.md) — update those, not the agent files, when domain rules change.

## Tech stack

- **TypeScript** + Next.js App Router (dev: turbopack)
- **Supabase**: Postgres + PostgREST + RLS
- **React Query** (centralized keys), Tailwind, Radix UI
- **Vitest** + Playwright
- **Bun** as package manager and script runner

## Design principles

1. **Primitives over modules** — composable building blocks, not monolithic features
2. **Schema as documentation** — `_schema_registry` is self-describing
3. **One pattern, many uses** — universal components adapt to context
4. **Minimize, don't maximize** — only build what's needed

## Source layout

`src/` top-level directories have distinct, non-overlapping purposes:

| Directory | Holds |
|-----------|-------|
| `src/lib/` | Cross-cutting **infrastructure** — no brewery domain knowledge. Logging, errors, env, query client/keys, formatting, parsers, ids, Supabase/API plumbing, Zod schemas. |
| `src/domain/` | Brewery **business logic** — calculations and rules for batches, brews, yeast, water, allocation, TTB, purchasing, planning. |
| `src/integrations/` | Third-party **service clients** — QuickBooks, Square, Slack, email, MongoDB. |
| `src/services/` | **Entity orchestration** — CRUD/transition services layered over domain logic and Supabase. |

Litmus test for a new file: does it know what a "batch" is? → `src/domain/`. Does it talk to an outside vendor? → `src/integrations/`. Neither? → `src/lib/`.

## Hard constraints (MUST FOLLOW)

1. **MUST** run `make check` before committing.
2. **MUST** prefer TypeScript over JavaScript for new files.
3. **MUST** use `type` aliases — never `interface` (except inside `declare module` for declaration merging).
4. **MUST** use centralized query keys from `src/lib/query-keys.ts` ([`query-keys.md`](docs/agents/query-keys.md)).
5. **MUST** use `EntityDetailUnified` — `EntityDetail` and `EntityForm` were removed; ESLint blocks re-introduction.
6. **MUST** set `security_invoker = true` on every public-schema view.
7. **MUST** enable RLS on every table that has policies.
8. **MUST** set `search_path = public` on every SQL function.
9. **MUST** derive status colors, labels, and state arrays from entity `stateMachine` config (DEC-007).
10. **MUST NOT** join or select from `auth.users` in views.
11. **MUST NOT** use `""` as a Select option value (DEC-008). Use `"_none"` for clear-selection.
12. **MUST NOT** add `Co-Authored-By` lines to commits.
13. **MUST NOT** commit migrations on `main` — only in the correct worktree/branch.
14. **MUST** run tests with `bun run test` (vitest) — `bun test` is Bun's own runner and is not the suite.
15. **MUST** keep one entity per directory: `src/entities/<name>/` (`core.ts` + `presentation.tsx` + `index.ts`), registered in `src/entities/index.ts`.
16. **MUST** prefix commit subjects with `feat`/`fix`/`chore`/`docs`/`refactor`/`perf`/`ci`.
17. **MUST** verify before deleting anything knip/depcheck flags as unused — the entity registry and `z.infer` types produce false positives.
18. **MUST** record session progress as a new file `docs/progress/YYYY-MM-DD-slug.md` (one bullet: `- **date (title).** …`). **MUST NOT** edit or commit `PROGRESS.md` on a branch — it is generated on `main` by CI.
19. **MUST** confirm worktree + branch (`pwd`, `git branch --show-current`) before editing when using worktrees.

## Schema registry

`_schema_registry` is the self-documenting metadata table. Query it to learn the schema:

```sql
SELECT table_name, description, domain, relationships
FROM _schema_registry
ORDER BY domain, table_name;
```

Add a `_schema_registry` entry in the migration whenever you create a new table.

## Migrations

- Pattern: `00XXX_description.sql` in `supabase/migrations/`
- Pick the next number: ``ls supabase/migrations/ | tail -1`` shows the highest existing; use highest + 1.
- Follow [`db-security.md`](docs/agents/db-security.md) for every new view, function, and policy.
- Push with `scripts/db-push.sh` (runs `db push --include-all` and regenerates `supabase/live-catalog.snapshot.txt` — commit both).
- After applying: verify success before continuing with dependent code changes.

## AI integration

MGR is built for AI assistance. Entry points:

- **Database functions**: `analyze_recipe_style_compliance`, `get_recipe_summary`, `suggest_recipe_improvements`, `analyze_batch_performance`, `get_ai_schema_context`.
- **TypeScript utilities**: `src/domain/ai/` (`analyzeStyleCompliance`, `getRecipeSuggestions`).
- **Full reference**: [`docs/spec/ai-integration.md`](docs/spec/ai-integration.md).

## Process rules

Full workflows (bug red–green–refactor, feature two-phase plan/execute, worktrees, documentation gate, review, guardrails): **[`docs/agents/process.md`](docs/agents/process.md)**.

### Before fixing any bug
1. State the root cause.
2. Explain why you believe it.
3. List two alternative approaches, ranked by likelihood.
4. Wait for confirmation before writing code.

If the user says **"I'm reporting a bug: …"**, follow the full red–green–refactor process in [`process.md`](docs/agents/process.md) (failing test first).

If the first fix fails: **stop and re-analyze**, don't iterate the same patch. See [`debugging.md`](docs/agents/debugging.md).

### When implementing a feature
If the user says **"I want to implement a new feature: …"**, follow the two-phase plan → approval → execute process in [`process.md`](docs/agents/process.md). Do not write implementation code in Phase 1.

### When making changes
1. Check [`docs/spec/decisions.md`](docs/spec/decisions.md) for relevant DEC entries.
2. Follow the entity / page pattern; use universal components first.
3. Update [`docs/data-model/`](docs/data-model/) when changing schema.
4. Add `_schema_registry` entries in the migration for new tables.
5. Document new architecture decisions in `docs/spec/decisions.md` or `docs/spec/architecture.md`.
6. Update docs/comments for public API, schema, props, routes, or user-facing behavior in the **same** commit ([`process.md`](docs/agents/process.md) documentation gate).

### When making commits
1. Run `make check` and fix any errors introduced.
2. Never add `Co-Authored-By` lines.
3. Add a `docs/progress/YYYY-MM-DD-slug.md` entry when the session lands meaningful work (do not touch `PROGRESS.md` on a branch).

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

1. **File issues for remaining work** — anything that needs follow-up.
2. **Run quality gates** (if code changed) — `make check`, or `make check-all` if cross-component.
3. **Push to remote** — MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status   # MUST show "up to date with origin"
   ```
4. **Clean up** — clear stashes, prune remote branches.
5. **Verify** — all changes committed AND pushed.
6. **Hand off** — provide context for the next session.

**Critical:**
- Work is NOT complete until `git push` succeeds.
- Never stop before pushing; that strands work locally.
- Never say "ready to push when you are" — push it yourself.
- If push fails, resolve and retry until it succeeds.
