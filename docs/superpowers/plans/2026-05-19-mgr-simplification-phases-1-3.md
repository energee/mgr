# MGR Simplification — Implementation Plans, Phases 1–3

**Date:** 2026-05-19
**Spec:** `docs/superpowers/specs/2026-05-19-mgr-simplification-and-multi-org-design.md`
**Status:** Draft — awaiting user review

This document turns the roadmap spec into actionable task lists. Phase 0 is already
complete on `refactor/simplify-phase-0-1`. Each phase below is independently
shippable; do not start a phase until its decisions (spec §9) are resolved.

---

## Phase 1 — Shared data-access helpers

**Foundation already landed:** `src/lib/supabase/query-helpers.ts` (`unwrap()`),
applied to `src/hooks/use-catalog.ts`.

### Tasks

1. **Roll out `unwrap()` to hooks.** ~9 files in `src/hooks/` use
   `if (error) throw error`. Convert each `const { data, error } = await X; if
   (error) throw error; return data;` to `return unwrap(X);`. One PR for all hooks.
   - Acceptance: `bun run typecheck` + `bun run test` green; `grep -rc "if (error)
     throw error" src/hooks` returns 0.
2. **Roll out `unwrap()` to domain components, by domain.** One PR per domain
   directory (`batch` ~12, `order` ~8, `packaging` ~6, `recipe` ~5, `brew` ~5,
   `yeast` ~4, `inventory` ~4, `purchasing` ~3). Small PRs keep review tractable.
   - Acceptance per PR: typecheck + test green; no `if (error) throw error` left in
     that directory.
3. **Roll out `unwrap()` to API routes.** `src/app/api/**`. Routes also use the
   pattern; convert and verify each route still returns the same shape.
4. **Add a `maybe()` variant** if call sites that tolerate a missing row appear
   (returns `null` instead of throwing on PGRST116). Add only when first needed.
5. **Merge `format.ts` / `utils.ts` formatting overlap.** `utils.ts` exports a
   generic `formatValue()` that overlaps `format.ts`. Audit every `formatValue`
   call site; if all are reproducible with the `format.ts` functions, migrate and
   delete `formatValue`. **Requires a behavior diff per call site** — `formatValue`
   may format dates/currency differently.
6. **Inline single-use hooks.** `use-as-ref.ts`, `use-callback-ref.ts` each have
   one caller. Inline and delete. Low value (~40 LOC) — bundle into another PR.

### Notes

- The `unwrap()` rollout is mechanical and verified by the test suite, but it is
  **broad** (~100+ files). Land it as ~10 small PRs (one per directory), never one
  giant PR.
- Estimated reduction: 700–1,500 LOC.

---

## Phase 2 — Reports consolidation

Targets: `reports/cogs` (1,552), `reports/ttb` (794), `reports/projections` (746),
`reports/inventory-valuation` (732 LOC).

### Tasks

1. **Create `src/components/reports/` shell components:**
   - `ReportHeader` — back button + title + description.
   - `ReportSummaryCard` — metric card with built-in `Skeleton` loading state.
   - `DateRangeFilter` — two `DatePicker`s; pairs with `useDateRange()`.
   - `QueryResult<T>` — wraps the `isLoading ? Skeleton : !data ? Empty : children`
     conditional repeated 50+ times.
   - `useDateRange()` hook — date range state + query-key fragment.
   - Acceptance: components have unit tests; typecheck + test green.
2. **Migrate `cogs` to the shell.** Replace inline header/cards/filters/conditionals
   with the shell components. Acceptance: page renders identically (manual check +
   any existing report tests); LOC down ~25%.
3. **Migrate `ttb`, `projections`, `inventory-valuation`** to the shell — one PR
   each.
4. **Move aggregation into SQL (decision-gated — spec §9.2).** For each approved
   aggregation, add a Supabase view or RPC:
   - `cogs_by_period` — period grouping + malt/hops/yeast/adjunct categorization.
   - `cogs_by_sku` — proportional cost allocation across finished goods.
   - `batch_costing` — per-batch ingredient cost aggregation.
   - Each: new migration `supabase/migrations/00XXX_*.sql` (next number on the
     branch), applied + verified **in the worktree only**. The SQL result must
     match the current client calculation exactly — write a test comparing old
     client output vs new RPC output before deleting the client code.
5. **Delete the now-dead client aggregation code** once the RPC is verified.

### Notes

- Shell extraction is low-risk (presentational). SQL migration is medium-risk —
  correctness of the ported calculation is the whole game.
- Estimated reduction: 950–1,600 LOC.

---

## Phase 3 — Entity config core/presentation split (INVESTIGATION + DESIGN)

This is the keystone. The goal is to split each `EntityConfig` so the data half is
importable server-side, then collapse boilerplate with a `createEntityConfig()`
helper.

### 3.1 Current shape

`EntityConfig<T>` (`src/types/entity.ts`, 858 LOC) mixes two concerns:

- **Pure data** (serializable, no React): `name`, `table`, `viewTable`,
  `displayName`, `displayNamePlural`, `description`, `domain`, `formSchema` (zod),
  `defaultSort`, `searchableFields`, `stateMachine`, `relations`, `queryExamples`,
  `keyFields`, `valueDisplay`.
- **Presentation** (imports `ReactNode` / `ComponentType`): `listColumns` (cells
  have `render`), `listFilters`, `quickFilters`, `detailHeader`, `sections`
  (`section.component` is a `ComponentType`), `actions`, `dialogs`, `kanbanConfig`.

Because the data and presentation halves live in one `.tsx` file that imports
React, the whole config is client-only. `src/app/api/chat/entity-map.ts` (412 LOC)
exists solely to re-declare the data half for server use — and it deliberately
stubs `formSchema: z.object({})`.

### 3.2 Proposed split

```
src/entities/<name>/
  core.ts          // EntityCore — pure data, no React import. Server + client.
  presentation.tsx // EntityPresentation — React. Client only.
  index.ts         // re-exports the assembled EntityConfig for existing callers
```

- `EntityCore` = the "pure data" field set above. `core.ts` imports only `zod` and
  types — safe for the chat route, API routes, and edge functions.
- `EntityPresentation` = the React field set. Unchanged behavior.
- `EntityConfig` becomes `EntityCore & EntityPresentation`, assembled in `index.ts`,
  so the existing config-consumer surface does not change.
- `entity-map.ts` is deleted; a `coreRegistry` built from the `core.ts` files
  replaces it. The chat route imports real `formSchema`s.

### 3.3 `createEntityConfig()` boilerplate collapse

The survey found ~73% of the 40 configs is repeated boilerplate. A
`createEntityConfig()` helper supplies defaults derived from `formSchema` + the
generated `Database` types:

- `listColumns` — default one column per `formSchema` field; override per entity.
- `sections` — default a single "Details" section of all fields; override to add
  custom/component sections.
- `searchableFields`, `defaultSort` — sensible defaults; override as needed.

Entities keep only what differs from the defaults.

### 3.4 Migration plan (decision-gated — spec §9.3)

1. Define `EntityCore` / `EntityPresentation` in `src/types/entity.ts`; make
   `EntityConfig = EntityCore & EntityPresentation`. No behavior change yet.
2. **Pilot:** convert `location`, `bin`, `supplier` (simple entities) to the
   `core.ts` / `presentation.tsx` / `index.ts` layout. Verify typecheck + test +
   the entity rendering manually.
3. Build the `coreRegistry`; point the chat route at it; delete `entity-map.ts`.
   Verify chat search/detail tools still work.
4. Introduce `createEntityConfig()`; re-express the 3 pilot entities through it.
5. Roll out the remaining 37 entities — one PR per ~5 entities, verifying each.
6. Remove the deprecated `EntityConfig` fields (`detailSections`, `formFields`,
   `createFields`, `editFields`) once no entity uses them.

### 3.5 Risks

- Touches all 40 entities + `entity-detail-unified.tsx` + `entity-data-table.tsx`.
  Contained by: type-level split first (no behavior change), then a 3-entity pilot.
- `formSchema` must be genuinely React-free. A few schemas may reference
  client-only helpers — audit during the pilot.
- Estimated reduction: 4,000–6,000 LOC (including the 412-LOC `entity-map.ts`).

### 3.6 Open questions for the user

- Per-entity directory (`src/entities/<name>/`) vs a flatter
  `<name>.core.ts` / `<name>.tsx` pair. Directory is cleaner; the flat form is a
  smaller diff. (Recommendation: directory.)
- Whether to remove the deprecated `EntityConfig` fields now or after Phase 3.
