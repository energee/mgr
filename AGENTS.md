# Agent Instructions

> **MGR** — brewery management system. Next.js App Router + Supabase/Postgres + AI integration. AI-first, minimalist design philosophy.
> Read this file first, then load topic docs below as the work demands.

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
| [`docs/agents/dispatching-agents.md`](docs/agents/dispatching-agents.md) | Deciding when to spawn subagents and how to brief them |
| [`PROGRESS.md`](PROGRESS.md) | **Session start** — current state, next steps |
| [`DECISIONS.md`](DECISIONS.md) | Before non-trivial design choices |
| [`docs/agents/session-handoff.md`](docs/agents/session-handoff.md) | Session end — handoff template |
| [`docs/agents/clean-state-checklist.md`](docs/agents/clean-state-checklist.md) | Session end — verification checklist |
| [`docs/agents/evaluator-rubric.md`](docs/agents/evaluator-rubric.md) | Self-grading at session end and in code review |
| [`docs/agents/observability.md`](docs/agents/observability.md) | Sentry use, runtime traces, agent task traces |
| [`docs/agents/quality.md`](docs/agents/quality.md) | Codebase health snapshot (A–D grades per domain/layer) |
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
- Current highest: `00155` → next available: `00156`
- Follow [`db-security.md`](docs/agents/db-security.md) for every new view, function, and policy.
- After applying: verify success before continuing with dependent code changes.

## AI integration

MGR is built for AI assistance. Entry points:

- **Database functions**: `analyze_recipe_style_compliance`, `get_recipe_summary`, `suggest_recipe_improvements`, `analyze_batch_performance`, `get_ai_schema_context`.
- **TypeScript utilities**: `src/lib/ai/` (`analyzeStyleCompliance`, `getRecipeSuggestions`).
- **Full reference**: [`docs/spec/ai-integration.md`](docs/spec/ai-integration.md).

## Process rules

### Before fixing any bug
1. State the root cause.
2. Explain why you believe it.
3. List two alternative approaches, ranked by likelihood.
4. Wait for confirmation before writing code.

If the first fix fails: **stop and re-analyze**, don't iterate the same patch. See [`debugging.md`](docs/agents/debugging.md).

### When making changes
1. Check [`docs/spec/decisions.md`](docs/spec/decisions.md) for relevant DEC entries.
2. Follow the entity / page pattern; use universal components first.
3. Update [`docs/data-model/`](docs/data-model/) when changing schema.
4. Add `_schema_registry` entries in the migration for new tables.
5. Document new architecture decisions in `docs/spec/decisions.md` or `docs/spec/architecture.md`.

### When making commits
1. Run `make check` and fix any errors introduced.
2. Never add `Co-Authored-By` lines.

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
