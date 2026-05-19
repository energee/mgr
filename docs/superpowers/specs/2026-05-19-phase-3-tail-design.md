# Phase 3 Tail — `coreRegistry` + deprecated-field removal

**Date:** 2026-05-19
**Branch:** `refactor/phase-3-tail`, stacked on `refactor/phase-3-entity-split` (PR #320)
**Status:** Design approved

## Problem

Phase 3 split every `EntityConfig` into a server-safe `EntityCore` and a
React-only `EntityPresentation`. Two rollout steps were deliberately deferred
from PR #320 so it could stay a verified behavior-preserving refactor:

1. The AI chat route still reads `src/app/api/chat/entity-map.ts` — a 412-LOC
   hand-maintained map that duplicates entity metadata the 39 `core.ts` files
   now already export server-safely. The map has **diverged** from the configs.
2. `EntityPresentation` still declares four deprecated fields
   (`detailSections`, `formFields`, `createFields`, `editFields`) that no
   converted entity uses.

This is the Phase 3 tail: delete the map, build a registry from the cores, and
drop the dead fields. It also clears the way for Phase 4's config-driven
generic AI tools.

## Step 1 — `coreRegistry`, delete `entity-map.ts`

### Current state

- `entity-map.ts` exports `CHAT_ENTITY_MAP: Map<string, EntityConfig>`, built
  from 38 hand-written minimal entries. Consumed by `route.ts`
  (`fetchEntityContext`) and `tools.ts` (`searchEntity`, `getEntityDetail`).
- Each entry carries a strict **subset** of what `core.ts` already exports:
  `name`, `table`, `viewTable`, `displayName`, `displayNamePlural`,
  `searchableFields`, `defaultSort`, `detailHeader`, `keyFields`.
- `entityService.list` / `getById` accept `EntityConfig<T>`.
  `EntityConfig = EntityCore & EntityPresentation`, so `EntityCore` is a
  strict supertype.

### Divergence (the behavior change)

| Direction | Entities | Effect |
|-----------|----------|--------|
| In cores, missing from map | `container`, `selling_format`, `yeast_pitch_event` | Chat search **gains** these 3 — pure coverage gain. |
| In map, not real entities | `package_type`, `keg_type` | Chat search **loses** these 2. They are reference tables (`package_types`/`keg_types`) with no entity config and no settings UI, referenced only by one report. **Decision: drop them.** The AI can still surface keg type names via `getKegInventory`. |

### Changes

1. **`resolveServerCore<T>(core: EntityCoreInput<T>): EntityCore<T>` in
   `src/types/entity.ts`** — a server-safe helper that fills the one default
   `EntityCore` actually requires: `displayNamePlural` (`${displayName}s`).
   `EntityCore.searchableFields` and `defaultSort` are both optional and pass
   through unchanged; defaulting `searchableFields` to `["name"]` would
   *introduce* a behavior change for join-row entities (`order_item`,
   `session_line_item`, `po_line_item`) that lack a `name` column and that
   `entity-map.ts` also left undefined. `createEntityConfig` keeps its own
   presentation-side defaults (`searchableFields` → `["name"]`, name-column
   `defaultSort` heuristic) for the React-side path:
   `{ ...resolveServerCore(core), searchableFields: …, defaultSort: …,
   relations, ...presentationFields }`.

2. **`src/entities/cores.ts`** (new, server-safe, React-free) — imports the 39
   `<name>/core.ts` modules directly (never `<name>/index.ts`, which pulls
   React presentation) and exports
   `coreRegistry: Map<string, EntityCore>`, each entry passed through
   `resolveServerCore`.

3. **Widen `entityService.list` and `getById`** — change the `entity` param
   type from `EntityConfig<T>` to `EntityCore<T>`. Safe supertype widening:
   every existing caller passes an `EntityConfig`, which still satisfies
   `EntityCore`. Only these two read methods are widened (the ones chat uses).

4. **Add explicit `defaultSort` to 8 cores** — see "defaultSort" below.

5. **`route.ts` + `tools.ts`** — replace the `CHAT_ENTITY_MAP` import with
   `coreRegistry`. The `searchEntity` tool's hard-coded entity-name list in its
   `description` is **derived** from `coreRegistry.keys()` instead of
   hand-listed, so it can never drift again. In `route.ts`, also remove the two
   now-unresolvable rows from `ENTITY_TYPE_TO_REGISTRY` (`"keg type"`,
   `"package type"`) and fix the doc comment that references the deleted map.

6. **Delete `src/app/api/chat/entity-map.ts`** (412 LOC).

### `defaultSort` — make 8 cores explicit

`createEntityConfig` derives the name-sort `defaultSort` default by inspecting
`listColumns` (a presentation field). The server registry has no `listColumns`,
so `resolveServerCore` can honor only an **explicit** `core.defaultSort`. Eight
cores omit `defaultSort` and would regress in chat versus what `entity-map.ts`
set. Fix: add the explicit `defaultSort` to those 8 `core.ts` files, matching
the values the map used.

| Core | `defaultSort` to add |
|------|----------------------|
| `brand`, `keg_owner`, `sales_channel`, `water_profile`, `yeast_strain` | `{ column: "name", direction: "asc" }` |
| `order_item`, `po_line_item`, `session_line_item` | `{ column: "created_at", direction: "desc" }` |

For the 5 name-sorted cores this only makes explicit what the `listColumns`
heuristic already produced — **zero app-behavior change**. For the 3
`created_at` cores it restores a sort the map author chose deliberately.
`createEntityConfig`'s heuristic stays in place (still used by `container` /
`selling_format`, which are new to chat and have no behavior baseline).

### Behavior delta — `detailHeader` title (benign)

`entity-map.ts` left 5 entities with a titleless `detailHeader`
(`location_transfer`, `pick_list`, `yeast_pitch`, `keg_transaction`,
`vessel_transfer`). Their `core.ts` files all set a real `title`
(`EntityCore.detailHeader.title` is required; PR #320 typechecked). So those 5
**gain** a title line in the chat page-context summary `route.ts` builds — a
strict improvement, noted in the PR description.

### Dropped entities — `package_type` / `keg_type`

These have no entity config and are dropped (decision: see Problem section).
`chat-context.tsx` still emits `"keg type"` / `"package type"` page-context
types from the `/keg-types` and `formats` pages; with the registry rows gone,
`fetchEntityContext` returns `null` and `route.ts` falls back to its generic
"viewing a … page" context line. `chat-context.tsx` is left unchanged — that
generic fallback is correct behavior.

## Step 2 — remove deprecated `EntityPresentation` fields

`detailSections`, `formFields`, `createFields`, `editFields` are declared on
`EntityPresentation` in `src/types/entity.ts`. Verified usage across `src`:

- **Zero** of the 39 `presentation.tsx` files set any of them — all entities
  use the unified `sections` form.
- `createFields` / `editFields` — no consumers anywhere; pure delete.
- `formFields` — only 3 `formFields: []` lines in
  `src/lib/__tests__/entity-helpers.test.ts`.
- `detailSections` — one legacy fallback branch in
  `src/components/universal/entity-detail-unified.tsx` (the
  `entity.detailSections || []` path), now dead because every entity migrated
  to `sections`.

### Changes

1. Delete the four field declarations from `EntityPresentation` in
   `entity.ts`.
2. Remove the legacy `detailSections` fallback branch (and its stale comment)
   in `entity-detail-unified.tsx`.
3. Remove the 3 `formFields: []` lines from `entity-helpers.test.ts`.

## Commit structure

One PR, two commits — Step 1 is behavior-affecting, Step 2 is pure cleanup:

- `refactor: build coreRegistry from entity cores, delete entity-map.ts`
- `refactor: remove deprecated EntityConfig presentation fields`

## Verification

Per-commit gate, matching PR #320's discipline:
`bun run typecheck`, `bun run lint`, `bun run test`, `bun run build` — all green.

Because Step 1 is behavior-affecting, add explicit coverage for the chat read
path. No chat-tools test file exists today, so this is a **net-new** test
(`src/app/api/chat/__tests__/core-registry.test.ts` or similar). It asserts:

- `coreRegistry.size === 39` and a snapshot of its key set — so future core
  additions can't silently change the chat surface.
- `package_type` / `keg_type` are absent; `container` / `selling_format` /
  `yeast_pitch_event` are present.
- Every `coreRegistry` entry carries the fields the chat read path needs
  (`table`, `displayName`, `displayNamePlural`, `searchableFields`).

## Out of scope

- Phase 4 (generic `createEntity`/`updateEntity`/`transitionEntity` tools,
  `buildSearchTool()` factory, write safety / RLS). Step 1 is its prerequisite.
- Promoting `keg_type` / `package_type` to real entities — if they later need
  AI search, give them a proper entity config rather than a map hack.
