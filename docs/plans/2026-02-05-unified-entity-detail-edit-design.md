# Unified Entity Detail/Edit Design

## Problem

The current entity pattern separates view (EntityDetail) and edit (EntityForm) into distinct pages with different layouts. This causes:

1. **Context loss** — navigating to `/edit` loses tabs, relations, scroll position
2. **Too many clicks** — simple field changes require a full page round-trip
3. **Mode mismatch** — edit form layout differs from detail view, making it hard to mentally map between them

## Solution

Merge EntityDetail and EntityForm into a single component with an in-place edit toggle. Same layout in both modes. No navigation. Fields swap between display values and form inputs.

## Interaction Model: Full-Page Edit Toggle

An "Edit" button in the header (or press `E`) toggles the entire detail page between view and edit mode in-place. This was chosen over:

- **Click-to-edit fields** — breaks cross-field Zod validation (`.refine()`), complicates optimistic locking, awkward for complex field types (relations, units, dates)
- **Per-section editing** — Zod refinements can cross section boundaries, partial saves risk inconsistent state, adds config complexity without fully solving context loss

Full-page toggle preserves all existing validation, locking, and conditional field logic without architectural rework.

## Unified Config

Replace separate `detailSections` + `formFields` with a single `sections` array:

```typescript
// Before: two separate definitions
detailSections: [
  { id: "overview", title: "Overview", fields: [
    { field: "batch_number", label: "Batch Number" },
    { field: "name", label: "Name" },
  ]}
],
formFields: [
  { name: "batch_number", label: "Batch Number", type: "text", colSpan: 6 },
  { name: "name", label: "Name", type: "text", colSpan: 6 },
],

// After: single unified definition
sections: [
  { id: "overview", title: "Overview", fields: [
    { name: "batch_number", label: "Batch Number",
      type: "text", colSpan: 6,
      editable: false },
    { name: "name", label: "Name",
      type: "text", colSpan: 6 },
    { name: "recipe_id", label: "Recipe",
      type: "relation", colSpan: 6,
      relation: { entity: "recipe", displayField: "name" },
      render: (value, record) => record.recipe_name },
  ]}
]
```

Each field carries everything for both modes:

- **Display props:** `render`, `valueDisplay` — how to show the value read-only
- **Edit props:** `type`, `required`, `showWhen`, `relation`, `options`, `description` — how to render the input
- **Mode control:** `editable: false` (always read-only), `editable: "create-only"` (editable on new, locked on edit), default is editable

The `colSpan` serves double duty — controlling grid layout in both modes so the visual structure is identical.

## Edit Mode Mechanics

### Entering Edit Mode

- Header gets an edit button (lucide-animated icon) or press `E`
- Sets `editing: true` in component state — no URL change, no navigation
- react-hook-form initializes from the already-fetched record (no loading spinner)

### Visual Treatment

- Editable field values gain a subtle input border/background
- Non-editable fields (computed, locked) stay as plain text — no dead disabled inputs
- Sticky bottom bar slides up with Save and Cancel buttons
- Status badge and state machine actions remain functional during editing

### Saving

- `Cmd+Enter` or Save button submits via react-hook-form
- Zod validation runs on the full form (cross-field `.refine()` works as-is)
- Optimistic locking checks the `version` field same as today
- On success: `editing` flips to false, cache invalidates, toast confirms
- On validation error: errors appear inline under relevant fields
- On conflict: existing conflict dialog appears

### Cancelling

- `Escape` or Cancel button resets form to original values, flips `editing` to false
- If form is dirty, show confirmation: "Discard unsaved changes?"

### Create Mode

`/[entity]/new` still uses a dedicated page, but renders the same unified component with `editing: true` by default and no record loaded. Layout is identical to the detail page.

## Component Architecture

### Three Layers

**Data layer:**
```
Record fetch (existing useQuery for viewTable)
  -> Form initialization (react-hook-form, only active when editing)
    -> Render tree
```

Form state only exists while actively editing — no overhead during normal browsing.

**Layout layer:**
```
<EntityDetailHeader>          <- title, subtitle, badge, Edit button, Actions
<Tabs>
  <DetailsTab>
    <SectionCard>             <- one per section in config
      <FieldGrid>             <- 12-column grid
        <UnifiedField />      <- renders view or edit per field
      </FieldGrid>
    </SectionCard>
    -- or --
    <SectionCard>
      <section.component />   <- custom domain component, gets `editing` prop
    </SectionCard>
  </DetailsTab>
  <CustomTabs />              <- additional config-driven tabs
  <RelationTabs />            <- related entity tables
</Tabs>
<EditFooter>                  <- sticky Save/Cancel, visible only when editing
```

**Field layer:**
```typescript
function UnifiedField({ field, editing, form, record }) {
  if (!editing || field.editable === false) {
    return <FieldDisplay field={field} value={record[field.name]} />;
  }
  return <FieldInput field={field} form={form} />;
}
```

`FieldDisplay` and `FieldInput` are extracted from existing EntityDetail and EntityForm renderers.

## Field Type Rendering

| Field Type | View Mode | Edit Mode |
|-----------|-----------|-----------|
| text, number, textarea | Plain text | Standard input |
| relation | Resolved name (optionally linked) | Combobox with search |
| select | Display label from options | Select dropdown |
| date/datetime | Formatted date string | DatePicker popover |
| switch/checkbox | Text label or disabled toggle | Live toggle |
| unit | Formatted value with unit ("5.2 gal") | Number input + unit selector |
| computed (viewTable only) | Plain text | Plain text (not in form) |

Non-editable fields show no input chrome in edit mode — they remain plain text.

## Custom Domain Components

Section components receive an expanded props signature:

```typescript
interface SectionComponentProps {
  record: Record;
  editing: boolean;
  form?: UseFormReturn;
}
```

### Three Adoption Tiers

**Tier 1 — Ignore editing (works immediately):**
Components that don't check `editing` continue as read-only displays. Every existing component falls here with zero changes.

**Tier 2 — Toggle between view and edit components:**
```typescript
{ id: "grain-bill", title: "Grain Bill",
  component: GrainBillDisplay,
  editComponent: GrainBillEditor }
```

**Tier 3 — Fully adaptive:**
New or refactored components handle both modes internally by checking `editing`.

Migration between tiers is incremental — no component needs to change on day one.

## Route Changes

**Removed:** `/[entity]/[id]/edit/page.tsx` — detail page handles editing

**Unchanged:**
- `/[entity]/page.tsx` — list page
- `/[entity]/[id]/page.tsx` — detail page (now handles both view and edit)
- `/[entity]/new/page.tsx` — create page (unified component, `editing: true`)
- Sub-pages (`/[id]/grain-bill`, `/[id]/readings`, etc.)

Page-level code is identical to today — pages wrap the unified component with `onAction` handlers for custom dialogs.

## Migration Path

### Phase 1: Build alongside existing components

Create the unified component. Import extracted `FieldDisplay` and `FieldInput`. Both old and new components coexist.

### Phase 2: Extend config type

```typescript
interface EntityConfig<T> {
  // Legacy (still works)
  detailSections?: DetailSection[];
  formFields?: FormField[];

  // New unified (takes precedence when present)
  sections?: UnifiedSection[];
}
```

### Phase 3: Migrate entities one at a time

Start with a simple entity (no custom components, no complex state machine). Convert config to unified `sections`. Update page to use unified component. Delete `/edit` page. Test. Repeat.

### Phase 4: Clean up

Remove `detailSections` and `formFields` from config type. Remove old EntityDetail and EntityForm. Remove `/edit` route directories.

## What Doesn't Change

- List pages
- Sub-page editors (grain bill, readings, hop schedule, additions)
- State machine transitions and actions
- Zod validation schemas
- Query key patterns and cache invalidation
- Optimistic locking strategy
- Relation tabs

## Design Notes

- Icons: use lucide-animated throughout
- Edit mode visual state should be subtle — input borders and backgrounds, not a dramatic mode shift
- Relation tabs remain browsable during editing (biggest UX win)
- State transitions can happen while editing other fields
