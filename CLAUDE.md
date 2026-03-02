# MGR - Brewery Management System

TypeScript, Next.js, PostgREST/PostgreSQL. Prefer TypeScript for new files.

## Docs
- `docs/spec/README.md` — spec navigation (decisions, architecture, workflows, AI)
- `docs/data-model/` — schema source of truth

## Reference Files

| Pattern | Reference |
|---------|-----------|
| Entity config (canonical) | `src/entities/batch.tsx` |
| Entity config (viewTable) | `src/entities/vessel.tsx` |
| Domain editor | `src/components/domain/grain-bill-editor.tsx` |
| Entity pages | `src/app/(app)/production/batches/` |
| Recipe editor (custom) | `src/components/domain/recipe-editor/` |

## Rules (MUST FOLLOW)

**Query keys**: All React Query keys must use factories from `src/lib/query-keys.ts` — never hardcoded arrays. Add new factories there first.

**DEC-007**: Never hardcode status colors/labels/state arrays. Derive from entity `stateMachine` config. Use `StatusBadge` with `stateDisplay`.

**DEC-008**: Never use `""` as a Select option value (Radix reserves it). Use `"_none"` for sentinel values.

**DB security** (see `docs/spec/architecture.md`): Views need `security_invoker = true`. Never expose `auth.users`. Enable RLS on all tables with specific policies. Functions need `SECURITY INVOKER` + `SET search_path = public`.

**Allocations**: Inventory quantities from views only, never mutable balances.

**Migrations**: Pattern `00XXX_description.sql` — check `supabase/migrations/` for next number.

**Schema changes**: Update `docs/data-model/` and add `_schema_registry` entries.

**Commits**: Run `pnpm lint` before committing.
