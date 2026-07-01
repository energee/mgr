# Dedup & Shared-Logic Extraction Backlog

**Directive (2026-06-30):** Do NOT remove features. Simplify logic, remove duplication, and extract logic that can be reused/shared across the existing kept features. Loop until complete.

**Branch/worktree:** `worktree-simplify` (`.claude/worktrees/simplify`)
**Baseline:** typecheck clean · 1528 tests / 87 files passing.
**Cadence:** one extraction per iteration → migrate call sites → `bun lint && bun run typecheck && bun run test` green → commit. Check the box when done.

Legend: 🟢 low risk · 🟡 med · 🔴 high. LOC = rough net reduction.

## Seed backlog (from the 24-agent audit — verified duplication)

- [ ] **B1 · `LineItemsGrid` extraction** 🟡 (~830) — 5 editors reimplement the same editable-row grid (add-row, qty/unit inputs, per-row delete, footer totals): `order/order-items-editor.tsx` (946), `inventory/transfer-lines-editor.tsx` (598), `purchasing/po-line-items-editor.tsx` (552), `batch/additions-editor.tsx` (441), `packaging/session-line-items-editor.tsx` (393). Extract `components/universal/line-items-grid.tsx` (rows + add + delete + totals chrome; domain cells as render props). Each domain keeps only its columns.
- [ ] **B2 · `SortableRowsEditor` + reuse `CatalogPicker`** 🟡 (~700) — 4 recipe editors repeat the same ~20-line Sortable shell: `grain-bill-editor` (414), `hop-schedule-editor` (467), `mash-schedule-editor` (398), `fermentation-schedule-editor` (424). grain-bill & hop also re-roll a Command/Popover picker that `recipe/catalog-picker.tsx` (86) already provides. Extract a generic sortable-rows shell; each editor collapses to a column/cell config.
- [ ] **B3 · Read-only recipe displays reuse the editors** 🟡 (~316) — `recipe-schedule-display` (175) + `recipe-additions-display` (691) re-render tables the schedule/additions editors already render. Fold into a `readOnly` prop on the editors; share the additions row renderer.
- [ ] **B4 · Remove dead abstraction types** 🟢 (~115) — `types/entity.ts`: `EntityFieldDef` (~72), `EntityDialogConfig` + `dialogs?`/`action.dialog` (~29), `stateMachine.hooks.validate` (~14). Zero consumers (grep-verified).
- [ ] **B5 · Collapse deprecated `fetchOptions` dual-path** 🟢 (~45) — migrate the 2 call sites (`batch`, `enum-value`) to `dynamicOptions`, delete the deprecated field + its branch in `use-dynamic-options.ts`.
- [ ] **B6 · `prefill-store` zustand → native sessionStorage** 🟢 (~57) — `contexts/prefill-store.ts` is a write-once/read-once handoff; replace 77-line store with ~15-20 lines.
- [ ] **B7 · `enums.ts` dead helpers** 🟢 (~282) — remove 13 unused DB-enum helper fns; keep `ENUM_TYPES` + `EnumType` (used by `use-brew-enums`).
- [ ] **B8 · Zero-importer export sweep** 🟢 (~260) — grep-verified dead exports in `query-keys.ts`, `domain/units.ts` (retail set), `use-unit-preferences.ts`, `lib/constants.ts`, `services/types.ts` aliases, `domain/batch-schedule.ts` consts, `lib/parsers.ts`, `lib/api/index.ts` re-exports. Keep everything with a live importer.
- [ ] **B9 · `compose-refs.ts` → radix `composeRefs`** 🟢 — dead `composeRefs` export; `useComposedRefs` used only by dnd UI shells. Swap to radix helper or delete dead export.
- [ ] **B10 · Split + prune engine mono-files** 🟡 (~490) — `entity-detail-unified.tsx` (2261) + `entity-data-table.tsx` (1630): extract mobile-card / action-menu pieces, prune dead variant flags. Split-for-maintainability + dead-branch trim.
- [ ] **B11 · Per-entity `index.ts` boilerplate** ⚪ OPTIONAL (~635) — 39 files of `createEntityConfig(...)` + `export *`. Central assembly would cut it, BUT contradicts the deliberate Phase-3 "structure over LOC" decision. User's call — do not do unless confirmed.

## Sweep additions (from the duplication+blueprint workflow — appended on completion)

_(pending)_

## Completion criteria
All non-optional boxes checked; final `bun lint && bun run typecheck && bun run test` green; summary of LOC saved.
