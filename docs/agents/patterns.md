# Patterns: entities, pages, forms

Quick reference for the universal entity / form / page pattern. For full
architecture, see [`docs/spec/architecture.md`](../spec/architecture.md).

## Entity configuration (`src/entities/<name>/`)

Each entity is a directory triad: `core.ts` (schema, types, state machine),
`presentation.tsx` (columns, form/display UI), `index.ts` (export/register).
Universal components render from this config. See also `docs/knowledge/entity-model.md`.

```typescript
export const entityEntity: EntityConfig<EntityType> = {
  // Identity
  name: "entity_name",
  table: "table_name",
  viewTable: "view_name",            // Optional: for computed fields
  displayName: "Entity",
  displayNamePlural: "Entities",
  domain: "production" | "inventory" | "sales" | "purchasing",

  // List view
  listColumns: [...],
  listFilters: [...],
  defaultSort: { column: "...", direction: "asc" | "desc" },
  searchableFields: [...],

  // Detail / edit (unified)
  detailHeader: { title: "field", subtitle: "field", badge: "status_field" },
  sections: [
    { id: "overview", title: "Overview", fields: [
      { name: "field_name", label: "Label", type: "text", colSpan: 6 },
      { name: "computed_field", label: "Computed", editable: false, format: "datetime" },
    ]},
  ],

  formSchema: zodSchema,

  stateMachine: { stateField, states, transitions, stateDisplay },
  actions: [...],
  relations: [...],

  // AI context (read by /api/chat)
  keyFields: [...],
};
```

## Page pattern

All entity pages use universal components:

```
/[domain]/[entity-plural]/
  page.tsx          -> <EntityList entity={config} />
  new/page.tsx      -> <EntityDetailUnified entity={config} />          (create)
  [id]/page.tsx     -> <EntityDetailUnified entity={config} id={id} /> (view + inline edit)
```

**Exceptions:**
- **Brew logs** — no `new/page.tsx`. Created exclusively via "Start Brew Day" on a batch detail page. List page passes `showCreate={false}`.
- **Recipes** — use a custom `RecipeEditorPage` (always-editable two-column layout with sticky sidebar showing live estimates). See `src/components/domain/recipe-editor/`.

## Reference files by pattern

| Pattern | Reference file |
|---|---|
| Entity config with state machine | `src/entities/batch.tsx` |
| Entity config with `viewTable` | `src/entities/vessel.tsx` |
| Domain component (editor) | `src/components/domain/grain-bill-editor.tsx` |
| Entity pages | `src/app/(app)/production/batches/` |
| Catalog selector | `src/components/domain/hop-schedule-editor.tsx` |
| Custom editor page (two-column) | `src/components/domain/recipe-editor/recipe-editor-page.tsx` |
| Section with independent save | `src/components/domain/recipe-editor/recipe-basics-section.tsx` |
| Shared editor context | `src/components/domain/recipe-editor/recipe-editor-context.tsx` |
| Client-side calculations | `src/components/domain/recipe-editor/recipe-estimate-calc.ts` |
| Custom status-based detail view | `src/components/domain/packaging-day-view.tsx` |
| Shared domain hooks | `src/hooks/use-packaging.ts` |
| Batch-initiated dialog | `src/components/domain/packaging-batch-dialog.tsx` |

## Form field types

- `text`, `textarea`, `number` — basic inputs
- `select` — dropdown with static `options` or `dynamicOptions`
- `relation` — dropdown that auto-fetches from related entity table
- `switch`, `checkbox` — boolean toggles
- `date`, `datetime` — date pickers
- `unit` — number input with unit conversion (requires `unitType`)

For foreign-key fields, use `type: "relation"`:

```typescript
{
  name: "location_id",
  label: "Location",
  type: "relation",
  relation: {
    entity: "location",      // Entity name from registry
    displayField: "name",    // Field shown in dropdown
  },
}
```

## Zod cross-field validation

Use `.refine()` for constraints that span multiple fields:

```typescript
export const transferSchema = z.object({
  from_vessel_id: z.string().uuid().nullable(),
  to_vessel_id: z.string().uuid(),
}).refine(
  (data) => !data.from_vessel_id || data.from_vessel_id !== data.to_vessel_id,
  {
    message: "Cannot transfer to the same vessel",
    path: ["to_vessel_id"],
  }
);
```

## Universal components (`src/components/universal/`)

- `EntityList` — renders any entity list from config
- `EntityDetailUnified` — entity detail with in-place edit toggle
- `StatusBadge` — status display from `stateMachine.stateDisplay` config

ESLint blocks `EntityDetail` and `EntityForm` imports — they were removed during the unified-detail-edit migration. If you copy in legacy code, the lint gate will flag it.

## State machines, allocations, calculated fields

These have full reference docs:
- **State machines** — universal pattern, transitions validated client + server. See [`docs/spec/workflows.md`](../spec/workflows.md).
- **Allocations** — all inventory movements via unified `allocations` table. Quantities calculated via views, never stored as mutable balances. See [`docs/spec/workflows.md`](../spec/workflows.md).
- **Calculated fields** — recipe estimates (OG, FG, ABV, IBU, SRM) calculated on read via `recipes_with_estimates` view. Vessel current batch via `vessels_with_current_batch` view. See [`docs/data-model/`](../data-model/).
