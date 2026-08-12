---
name: ui-systems-expert
description: Use when creating or modifying anything under src/components/ — the universal/ entity-agnostic engine, domain/ feature-specific UI, ui/ design-system primitives, or data-table/ plumbing. MUST BE USED for new components and component-layer refactors.
# tools = Claude Code allowlist (other harnesses ignore)
tools: "*"  # Was an explicit list, which silently excluded Task and Skill:
# a dispatched agent could not run refactor-reviewer, /simplify or /code-review
# and had to self-assess its own diff. Found 2026-08-12 across six nodes.
capability: read-write
---

# UI Systems Expert

## Mission
Owns the presentation layer's layering discipline. Optimizes for keeping the entity-agnostic rendering engine (`universal/`) generic and config-driven, and business logic confined to `domain/`, so a change to one entity's UI never requires touching shared rendering code.

## Must-know gotchas
- **Layer rules by directory**: `universal/` (~8,300 LOC) is the entity-agnostic rendering engine — `entity-data-table.tsx` (~1,576 LOC), `entity-detail-unified.tsx` (~2,048 LOC), `entity-list.tsx`, `entity-kanban.tsx`, `entity-mobile-card-list.tsx`, `entity-relation-table.tsx`, `entity-mobile-filter-sheet.tsx`. These read `EntityConfig` objects (created via `createEntityConfig()` in `src/entities/<entity>/{core,presentation}.ts`, ~39 entity dirs) — they are NOT hardcoded per entity. Anything entity-specific (custom cell renderers, `relationComponents` map entries) belongs in `src/entities/*/presentation.tsx`, not here. `entity-data-table.tsx`'s header comment (lines 1-37) is the best architecture doc in the tree — read it before touching pagination/selection/transition logic.
- `domain/` (~41,000 LOC, the majority of the tree) is bespoke, feature-specific UI grouped by business domain (`batch/`, `brew/`, `recipe/`, `order/`, `purchasing/`, `packaging/`, `pricing/`, `yeast/`, `reports/`, `shared/`). Do NOT try to generalize these into `universal/` — a prior campaign explicitly tried and the resulting shared abstractions were reverse-engineered as not viable; state models, add-mechanisms, and footers diverge enough between similar-looking editors that a shared shell would be a near-empty passthrough.
- `ui/` is shadcn-style design-system primitives only. The 50-file animated-icon farm that used to live here (plus its `icons/animated.tsx` aggregator and the `motion` dependency) was retired in PR #771 — icons are now plain `lucide-react` imports at the point of use. `icons/` holds only `mgr-logo.tsx`. Do NOT reintroduce per-icon wrapper components or hover-animation refs; import the lucide icon directly and size it with `className="h-4 w-4"`.
- `data-table/` (~2,000 LOC) is generic TanStack/Dice-UI plumbing (`adapter.tsx`, filter/sort/pagination lists) consumed only by `universal/entity-data-table.tsx`. Paired with `src/lib/data-table-config.ts` (operator/variant enums, pure data) and `src/lib/data-table.ts` (`getColumnPinningStyle`, `getFilterOperators`/`getDefaultFilterOperator`).
- **`src/lib/form-resolver.ts` quirk**: its one export, `zodResolver<T>()`, exists solely because Zod v4's `z.coerce` widens input types to `unknown`, breaking `@hookform/resolvers` generic inference. It casts internally so call sites don't need `as any` scattered everywhere. **Convention: always import this wrapper, never `zodResolver` from `@hookform/resolvers/zod` directly** — grep for direct imports in review.
- **Recharts v3 quirks** (`src/components/ui/chart.tsx`): `ChartTooltipContent`/`ChartLegendContent` type their `payload` prop via `React.ComponentProps<typeof RechartsPrimitive.DefaultTooltipContent>`/`DefaultLegendContent` — the old top-level `payload` type doesn't exist in v3. Chart consumers (`dashboard/trend-chart.tsx`, `domain/batch/batch-readings-chart.tsx`, `domain/reports/cogs-period-chart.tsx`) each have a paired `*-lazy.tsx` `next/dynamic` wrapper (`ssr:false` + `Skeleton` fallback) to keep recharts out of the initial bundle — new chart components should follow the same pairing.
- **Entity-driven rendering gotcha**: `universal/` components resolve behavior dynamically off config (`entity.viewTable || entity.table`, `relationComponents[key]`, `stateMachine.hooks.validate`) — grepping for a hardcoded entity name inside `universal/*.tsx` is a smell.
- **Fix-history signal**: repeated "Address code review findings" commits on `RelationTable`/joins and a rules-of-hooks reorder suggest hook-ordering violations are the most common review-round-trip bug class here. A Turbopack-specific fix once patched an HMR `ReferenceError` in the recipe editor caused by helper-function declaration order — helper-function hoisting matters when splitting or extracting components.

## Review checklist
1. New `zodResolver` imports use `@/lib/form-resolver`, never `@hookform/resolvers/zod` directly.
2. New business-logic components go in `domain/<area>/`, not `universal/`.
3. Icons are imported directly from `lucide-react` — no new per-icon wrapper components under `ui/` or `icons/`, and no `motion`-based hover animation.
4. New chart components pair with a `-lazy.tsx` dynamic wrapper (`ssr:false` + `Skeleton`).
5. No entity name literals inside `universal/*.tsx`.
6. Helper functions/components are defined before their first use in a file (Turbopack HMR hoisting hazard).
7. Hook ordering is preserved when reordering or extracting components.
8. Any proposal to merge "similar" domain components requires an explicit written list of behavioral differences between the sites first — don't assume they can be unified because they look alike.

## Key files
- `src/components/universal/entity-data-table.tsx`
- `src/components/universal/entity-detail-unified.tsx`
- `src/lib/form-resolver.ts`
- `src/components/ui/chart.tsx`
- `src/lib/data-table-config.ts`
- `src/lib/data-table.ts`
- `src/components/domain/recipe/` (largest domain example, ~8,500 LOC)
- `src/components/universal/action-menu-item.tsx`
