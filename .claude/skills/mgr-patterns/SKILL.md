---
name: mgr-patterns
description: Coding patterns for the mgr brewery-management repository (Next.js + Supabase + TypeScript). Use when adding entities, writing migrations, editing query keys, or following commit/test conventions in this repo.
version: 1.1.0
---

# mgr Patterns

A brewery-management app: Next.js (App Router, Turbopack), Supabase (Postgres + RLS),
TypeScript, TanStack Query, Vitest + Playwright, Bun as the package manager.

Canonical rules live in **`AGENTS.md`** and **`docs/agents/`**. This skill is a short
operational summary — if anything conflicts, `AGENTS.md` wins.

## Commit Conventions

- Prefix every commit: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`, `ci:`.
- Optional scope for cross-cutting work: `feat(bom):`, `chore(ci):`.
- Subjects are descriptive sentences, not terse fragments.
- **Never** add `Co-Authored-By` lines.

## Code Architecture

```
src/
├── app/                  # Next.js App Router
│   ├── (app)/            # Authenticated app routes
│   ├── api/              # API route handlers
│   └── portal/           # Customer-facing order portal
├── entities/             # One directory per entity
│   ├── <name>/
│   │   ├── core.ts       # Schema, types, state machine, data shape
│   │   ├── presentation.tsx  # Columns, form UI, display config
│   │   └── index.ts      # Public export / register
│   ├── index.ts          # Central registry
│   └── cores.ts          # Core-only exports where needed
├── components/
│   ├── universal/        # Entity-agnostic engine
│   ├── domain/           # Feature-specific UI
│   ├── ui/               # Design-system primitives
│   └── data-table/       # Table plumbing
├── domain/               # Pure brewery business logic
├── integrations/         # Square, QuickBooks, Slack, email, MongoDB
├── services/             # Entity orchestration over domain + Supabase
├── lib/                  # Infrastructure (no brewery domain knowledge)
│   ├── query-keys.ts     # Centralized TanStack Query keys — only source of keys
│   └── supabase/         # Clients, helpers
└── types/
    ├── supabase.ts       # Generated — never hand-edit
    └── entity.ts         # EntityConfig / StateMachineConfig types
```

Entities are **config-driven**: declare behavior in `src/entities/<name>/`, render via
`universal/` components. See `docs/agents/patterns.md` and `docs/knowledge/entity-model.md`.

## Workflows

### Adding a New Entity

1. Create `src/entities/<name>/` with `core.ts`, `presentation.tsx`, and `index.ts`.
2. Module-level comment on the entity purpose and state machine.
3. Derive row types from generated Supabase types where possible.
4. Register in `src/entities/index.ts`.
5. Add query keys only in `src/lib/query-keys.ts` — never hardcode keys at call sites.
6. Update entity config tests if invariants are covered there.

### Database Migration

1. Add `supabase/migrations/00XXX_description.sql` — zero-padded 5-digit sequential prefix.
   Pick next number with `ls supabase/migrations/ | tail` (highest `00XXX` + 1). Timestamp
   `*_remote_applied.sql` files are sync artifacts — do not imitate them for new work.
2. Apply with project scripts (`scripts/db-push.sh` / `bun db:migrate` as documented in AGENTS.md).
3. Regenerate types when the schema changes.
4. Migrations only on the correct worktree/branch — **never on `main`**.
5. After enum/constraint changes, expect stale PostgREST cache.

### Verification Before Commit

Prefer the Makefile gate:

| Command | When |
|---|---|
| `make check-fast` | While editing (lint + typecheck) |
| `make check` | **Required before every commit** |
| `make check-all` | Before PR / merge (adds E2E) |

Equivalents: `bun run lint`, typecheck (`tsc --noEmit`), `bun run test` (Vitest).  
**Never** use bare `bun test` for the project suite — that is Bun's own runner.

Re-run typecheck after rebases or simplification passes.

## Testing Patterns

- **Vitest** for units (`bun run test`), **Playwright** for e2e.
- Unit tests in `__tests__/` next to code.
- E2e specs in top-level `e2e/*.spec.ts` by user workflow.

## Tooling Conventions

- Package manager: **Bun**. Run `bun install` after creating a worktree.
- Worktrees may live under harness dirs (e.g. `.claude/worktrees/`) — always verify `pwd` and branch.
- Progress log: add `docs/progress/YYYY-MM-DD-slug.md` (one bullet); never edit `PROGRESS.md` on a branch (CI generates it on main).
