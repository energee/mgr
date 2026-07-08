# mgr — brewery management (Next.js + Supabase + TypeScript)

## Commands
- `bun run lint` / `bun run typecheck` / `bun run test` (vitest — never `bun test`) — all three before any commit
- Migrations: `supabase/migrations/00XXX_description.sql`, always `db push --include-all`

## Expert agents — consult before working in their areas
| Touching | Use agent |
|---|---|
| `src/entities/`, entity registry, new entities, `src/services/` orchestration, entity API routes (`api/{batches,orders,customers,recipes,users}`) | `entity-architect` |
| `src/lib/supabase/`, `query-keys.ts`, migrations, RLS, auth/portal routes (incl. `api/auth`, `update-password`) | `data-layer-expert` |
| `src/domain/` calculations (units, BOM, TTB, yeast, water) | `brewing-domain-expert` |
| `src/integrations/` (Square, QuickBooks, Slack, email, MongoDB), integration/settings API routes (`src/app/api/{square,slack,email,integrations,settings/api-key}/`) | `integrations-expert` |
| `src/components/` | `ui-systems-expert` |
| Writing/repairing tests, pre-refactor coverage | `test-surgeon` |
| Reviewing any refactor/dedup diff (read-only gate) | `refactor-reviewer` |
| Anything else under `src/app/api/` (`dev`, `health`; `chat` deferred to `ai-features-expert`) | no expert owner |

Domain source of truth: `docs/knowledge/brewing-domain.md`, `docs/knowledge/entity-model.md` — update those, not agent files, when domain rules change.

## Opus 4.8 tuning
- Minor choices (naming, defaults, equivalent approaches): pick one and note it — don't ask. Ask only for scope changes or destructive actions.
- When work fans out across independent files/tests, dispatch the expert agents in parallel rather than iterating serially.

## Conventions
- Commit prefixes feat/fix/chore/docs/refactor/perf/ci; NEVER Co-Authored-By lines
- Query keys only via `src/lib/query-keys.ts`
- One entity = one directory `src/entities/<name>/` (`core.ts` + `presentation.tsx` + `index.ts`), registered in `src/entities/index.ts`
- knip/depcheck flag false positives (entity registry, `z.infer`) — verify before deleting
- Search: `mgrep` to locate code by meaning; literal `grep`/`rg` only for exact-string ref-counting
