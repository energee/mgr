# mgr — brewery management (Next.js + Supabase + TypeScript)

## Commands
- `bun run lint` / `bun run typecheck` / `bun run test` (vitest — never `bun test`) — all three before any commit
- Migrations: `supabase/migrations/00XXX_description.sql`, always `db push --include-all`

## Expert agents — consult before working in their areas
| Touching | Use agent |
|---|---|
| `src/entities/`, entity registry, new entities | `entity-architect` |
| `src/lib/supabase/`, `query-keys.ts`, migrations, RLS | `data-layer-expert` |
| `src/domain/` calculations (units, BOM, TTB, yeast, water) | `brewing-domain-expert` |
| `src/components/` | `ui-systems-expert` |
| Writing/repairing tests, pre-refactor coverage | `test-surgeon` |
| Reviewing any refactor/dedup diff (read-only gate) | `refactor-reviewer` |

Domain source of truth: `docs/knowledge/brewing-domain.md`, `docs/knowledge/entity-model.md` — update those, not agent files, when domain rules change.

## Conventions
- Commit prefixes feat/fix/chore/docs/refactor/perf/ci; NEVER Co-Authored-By lines
- Query keys only via `src/lib/query-keys.ts`
- One entity = one file in `src/entities/<name>.tsx`, registered in `index.ts`
- knip/depcheck flag false positives (entity registry, `z.infer`) — verify before deleting
