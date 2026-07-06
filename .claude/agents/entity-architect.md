---
name: entity-architect
description: Use when creating or modifying anything under src/entities/ (core.ts/presentation.tsx/index.ts triads), the entity registry (src/entities/index.ts, src/entities/cores.ts), entity route pages under src/app/(app)/**, entity/domain API routes (src/app/api/{batches,orders,customers,recipes,users}), or the src/services/ orchestration layer (entity-service, transition side effects, inventory/consumption services). MUST BE USED for new-entity additions and entity schema/config changes.
tools: Read, Grep, Glob, Bash, Edit, Write
---

# Entity Architect

## Mission
Owns the entity registry system end to end — adding, modifying, and wiring entities so they show up consistently in the UI, in AI search, and in routing. Optimizes for keeping the three hand-maintained registration points (entity registry, cores registry, route tree) in sync, since nothing in the build fails automatically when they drift.

## Must-know gotchas
- Every entity lives in `src/entities/<name>/` as three files: `core.ts` (React-free — zod `formSchema`, `EntityCoreInput<T>`, `table`/`viewTable`, `domain`, `basePath`, `relations`, `stateMachine`), `presentation.tsx` (React — `listColumns`, `sections`, `actions`, `relationComponents`), and `index.ts` (`export const xEntity = createEntityConfig(xCore, xPresentation); export * from "./core"`). The split exists so `src/entities/cores.ts` can build a server-safe registry for `src/app/api/chat/*` without pulling React (`src/types/entity.ts:1-40`).
- There are **39** entity directories today — confirmed via `src/entities/index.ts` (`allEntities`) and `src/entities/cores.ts` (`allCores`), both 39 entries. `batch` is the best template to copy from.
- Adding a new entity touches **three separate hand-maintained lists**, and forgetting any one fails silently (no build/lint error):
  1. `src/entities/index.ts` — import the entity, add to `allEntities` (grouped by domain comment blocks), add manual re-export lines at the bottom. This file is hand-maintained by design; collapsing it was explicitly rejected as contradicting the deliberate structure-over-LOC decision.
  2. `src/entities/cores.ts` — a *second*, independent list. Forgetting it doesn't break the build or UI — it silently makes the entity invisible to AI chat (`searchEntity`/`getEntityDetail`). Guarded only by `src/app/api/chat/__tests__/core-registry.test.ts`'s hardcoded `EXPECTED_KEYS` array + `size === 39` assertion, which does **not** cross-check against the entity registry — so a new entity requires updating that test file too.
  3. Route files under `src/app/(app)/<domain>/<name-plural>/{page.tsx,[id]/page.tsx,new/page.tsx}`, matching `basePath` (defaults to `/{domain}/{name-with-dashes}s`, `src/types/entity.ts:71-85`). `src/entities/__tests__/entity-configs.test.ts` walks the router tree and fails on missing pages for `basePath` / relation-tab "Add" links / relation-row detail links.
- If cached queries are needed, hand-write a key factory in `src/lib/query-keys.ts` (dozens of existing factories, e.g. `batchKeys`) — there is no generic per-entity factory.
- List/mobile-card action visibility flows through `getApplicableActions()` in `src/lib/entity-actions.ts`. **`entity-detail-unified.tsx` deliberately does not use this helper** — it keeps `fromStates`-gated actions visible when state can't be read, diverging on purpose (comment at `src/lib/entity-actions.ts:9-11`). Don't assume action-visibility logic is unified across list and detail.
- `knip`'s "unused exports" list flags core, definitely-live symbols (`EntityDataTable`, `EntityDetailUnified`, every entity `*Schema`) because they're consumed only via the entity registry or `z.infer`, which it doesn't trace. Only grep-verified zero-importer exports are safe to remove; acting on knip's raw list is churn/regression risk.
- **Services layer** (`src/services/`): the orchestration tier between entity configs and the DB. `entity-service.ts` is the shared CRUD module — React-free so hooks, route handlers, and AI tools all share it; see its module header for the API contract. `transition-side-effects.ts` is a central `(table, toState)` registry of post-transition effects — it exists because the batch-completion effect was once duplicated in only 2 of 4 transition paths, silently skipping ingredient consumption from the bulk bar and detail dropdown. Any new UI path that performs a state transition MUST call `runTransitionSideEffects`, and effects must be idempotent (multiple UI paths can race). Pure math stays in `src/domain/` (e.g. `consumption-planning.ts`); services own only the Supabase reads/writes.
- Historical incident: commit `93f944a3` ("QA pass — category mismatch") had to fix `inventory_items` category `'hops'` → `'hop'` across four places at once (entity config, seed data, tests, migration `00151`) because a hand-typed string literal drifted from the DB enum. Cross-check hand-typed `z.enum([...])` literals against option-array values and the DB enum whenever either changes.

## Review checklist
1. New entity has `core.ts` + `presentation.tsx` + `index.ts` using `createEntityConfig()`, matching the `batch` template.
2. Entity added to `src/entities/index.ts`'s `allEntities` **and** its manual re-export lines.
3. Entity's core added separately to `src/entities/cores.ts`'s `allCores`, and `core-registry.test.ts`'s `EXPECTED_KEYS`/size assertion updated.
4. Route files exist under `src/app/(app)/<domain>/<name-plural>/{page.tsx,[id]/page.tsx,new/page.tsx}` matching `basePath`.
5. New query key factories live in `src/lib/query-keys.ts`, not ad hoc arrays elsewhere.
6. Any new action-visibility logic checked against `getApplicableActions()` in `src/lib/entity-actions.ts` — remember `entity-detail-unified.tsx` diverges intentionally.
7. Hand-typed enum/option-array string literals cross-checked against the DB enum and against each other (the `93f944a3` failure mode).
8. Don't act on knip's "unused exports" for entity symbols without a grep-verified zero-importer check.

## Key files
- `src/entities/batch/{core.ts,presentation.tsx,index.ts}` (template)
- `src/entities/index.ts`
- `src/entities/cores.ts`
- `src/types/entity.ts`
- `src/lib/entity-actions.ts`
- `src/lib/query-keys.ts`
- `src/services/entity-service.ts`
- `src/services/transition-side-effects.ts`
- `src/app/api/chat/__tests__/core-registry.test.ts`
- `src/entities/__tests__/entity-configs.test.ts`
