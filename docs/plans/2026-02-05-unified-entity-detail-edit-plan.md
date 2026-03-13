# Unified Entity Detail/Edit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace separate EntityDetail + EntityForm with a unified component that supports in-place edit toggle, eliminating the `/edit` route and context loss.

**Architecture:** Build a new `EntityDetailUnified` component that reads from a unified `sections` config on `EntityConfig`. Extract `FieldDisplay` and `FieldInput` into shared components. Migrate entities incrementally from `detailSections` + `formFields` to unified `sections`.

**Tech Stack:** React 19, TypeScript, react-hook-form, zod, TanStack Query, shadcn/ui, lucide-animated, Supabase

**Design doc:** `docs/plans/2026-02-05-unified-entity-detail-edit-design.md`

---

## Task 1: Define Unified Types

**Files:**
- Modify: `src/types/entity.ts`

**Context:** The current `EntityConfig` has separate `detailSections` (view) and `formFields` (edit). We need a unified `sections` config that describes both modes in one definition. Both old and new config shapes must coexist during migration.

**Step 1: Add UnifiedFieldDef type**

Add after the existing `EntityFieldDef<T>` interface (after line 345):

```typescript
// =============================================================================
// Unified Detail/Edit Types
// =============================================================================

/**
 * Unified field definition for the combined detail/edit view.
 * Each field knows how to render in both display (view) and input (edit) mode.
 * Merges the concepts of EntityFieldDisplay (view) and EntityFieldDef (edit).
 */
export interface UnifiedFieldDef<T = Record<string, unknown>> {
  /** Field key (maps to record property) */
  name: keyof T & string;

  /** Display label */
  label: string;

  // -- Layout (shared) --

  /** Grid column span (1-12). Controls layout in both view and edit modes. */
  colSpan?: number;

  /** Span full width (alternative to colSpan: 12) */
  fullWidth?: boolean;

  // -- Display mode props --

  /** Custom render function for view mode */
  render?: (value: unknown, data: T) => ReactNode;

  /** Format type for automatic formatting in view mode */
  format?: "date" | "datetime" | "currency" | "number" | "percentage" | "json" | "unit";

  // -- Edit mode props --

  /** Input type for edit mode. If omitted, field is display-only. */
  type?: "text" | "textarea" | "number" | "select" | "multiselect" | "combobox"
    | "date" | "datetime" | "checkbox" | "switch" | "json" | "relation" | "unit";

  /** Placeholder text (edit mode) */
  placeholder?: string;

  /** Help text shown below the input (edit mode) */
  description?: string;

  /** Whether field is required (edit mode) */
  required?: boolean;

  /** Whether field is disabled (edit mode) */
  disabled?: boolean;

  /** Static options for select/multiselect/combobox */
  options?: { value: string; label: string }[];

  /** Dynamic options from database table */
  dynamicOptions?: {
    table: string;
    valueField: string;
    labelField: string;
    filter?: Record<string, unknown>;
    orderBy?: string;
  };

  /** Related entity configuration (for relation type fields and FK display) */
  relation?: {
    entity: string;
    displayField: string;
  };

  /** Default value for create mode */
  defaultValue?: unknown;

  /** Conditional visibility based on current form values */
  showWhen?: (values: Partial<T>) => boolean;

  /** Unit type for unit fields/formatting */
  unitType?: "volume" | "weight" | "temperature" | "gravity" | "retail_volume";

  /** Allow inline unit switching */
  allowUnitSwitch?: boolean;

  // -- Mode control --

  /**
   * Controls whether this field is editable.
   * - true (default): editable in both create and edit modes
   * - false: always display-only (e.g., computed fields, timestamps)
   * - "create-only": editable in create mode, display-only in edit mode
   */
  editable?: boolean | "create-only";
}
```

**Step 2: Add UnifiedSectionDef type**

Add right after `UnifiedFieldDef`:

```typescript
/**
 * Unified section definition for the combined detail/edit view.
 * Each section can contain either unified fields or a custom component.
 */
export interface UnifiedSectionDef<T = Record<string, unknown>> {
  /** Section identifier */
  id: string;

  /** Section title */
  title: string;

  /** Unified fields for this section */
  fields?: UnifiedFieldDef<T>[];

  /**
   * Custom component for view mode (or both modes if editComponent is not set).
   * Receives { data, editing, form } props.
   */
  component?: ComponentType<{
    data: T;
    editing?: boolean;
    form?: unknown; // UseFormReturn - typed as unknown to avoid import
  }>;

  /**
   * Custom component for edit mode (overrides component when editing).
   * Use this when view and edit have fundamentally different UIs.
   */
  editComponent?: ComponentType<{
    data: T;
    editing?: boolean;
    form?: unknown;
  }>;

  /** Whether this section is collapsible */
  collapsible?: boolean;

  /** Default collapsed state */
  defaultCollapsed?: boolean;

  /** Tab name if using tabbed layout */
  tab?: string;
}
```

**Step 3: Add `sections` to EntityConfig**

Add a new section to `EntityConfig` between the Detail View and Form sections (after line 81):

```typescript
  // ---------------------------------------------------------------------------
  // Unified Detail/Edit View Configuration (replaces detailSections + formFields)
  // ---------------------------------------------------------------------------

  /** Unified sections for combined detail/edit view. Takes precedence over detailSections + formFields. */
  sections?: UnifiedSectionDef<T>[];
```

**Step 4: Verify build**

Run: `bun tsc --noEmit`
Expected: No type errors (sections is optional, backward compatible)

**Step 5: Lint**

Run: `bun lint`
Expected: Clean

**Step 6: Commit**

```bash
git add src/types/entity.ts
git commit -m "feat: add unified section/field types to EntityConfig"
```

---

## Task 2: Extract FieldDisplay Component

**Files:**
- Create: `src/components/universal/field-display.tsx`
- Modify: `src/components/universal/entity-detail.tsx` (import from new file)

**Context:** The current `entity-detail.tsx` renders field values inside its `SectionCard` component (around lines 460-525). We need to extract the display logic into a reusable `FieldDisplay` component that the unified component can also use.

**Step 1: Create FieldDisplay component**

Create `src/components/universal/field-display.tsx`. This component renders a single field value in view mode. It handles:
- Text values (plain display)
- Formatted values (date, datetime, currency, number, percentage, unit)
- Relation values (FK display via pre-fetched relation map)
- Custom render functions
- State/value display labels
- JSON values (formatted)

Look at `entity-detail.tsx` SectionCard (lines ~460-525) for the current field rendering logic. The `FieldDisplay` component should replicate that logic, accepting props:

```typescript
interface FieldDisplayProps {
  field: UnifiedFieldDef<any>;
  value: unknown;
  record: Record<string, unknown>;
  entity: EntityConfig<any>;
  relationDisplayValues?: Record<string, string>;
}
```

Key rendering rules to extract from SectionCard:
- If `field.render` exists, call it: `field.render(value, record)`
- If field matches `entity.stateMachine?.stateField`, use `getStateLabel()`
- If `field.format === "date"`, format with date formatter
- If `field.format === "unit"`, format with unit display
- If `field.relation` and `relationDisplayValues` has the value, show the display name
- Boolean values: "Yes" / "No"
- Null/undefined: show "—"
- Default: `String(value)`

The 2-column grid layout stays in the parent. FieldDisplay just renders the label + value for one field.

**Step 2: Update EntityDetail to import FieldDisplay**

In `entity-detail.tsx`, update SectionCard to use the new `FieldDisplay` component instead of inline rendering. This ensures the old component still works identically.

**Step 3: Verify build**

Run: `bun tsc --noEmit`
Expected: No type errors

**Step 4: Verify the app renders correctly**

Run: `bun dev` and manually check a detail page (e.g., `/settings/locations/[any-id]`)
Expected: Looks identical to before

**Step 5: Commit**

```bash
git add src/components/universal/field-display.tsx src/components/universal/entity-detail.tsx
git commit -m "refactor: extract FieldDisplay from EntityDetail"
```

---

## Task 3: Extract FieldInput Component

**Files:**
- Create: `src/components/universal/field-input.tsx`
- Modify: `src/components/universal/entity-form.tsx` (import from new file)

**Context:** The current `entity-form.tsx` renders form inputs via `renderFieldInput()` (lines ~566-751) and `FormField` (lines ~518-563). Extract these into a reusable component.

**Step 1: Create FieldInput component**

Create `src/components/universal/field-input.tsx`. Extract:
- `renderFieldInput()` function (handles all input types: text, textarea, number, select, relation, switch, date, datetime, unit, etc.)
- `FormField` wrapper component (handles label, grid layout, error display, description)

The component should accept:

```typescript
interface FieldInputProps {
  field: UnifiedFieldDef<any>;
  form: UseFormReturn<any>;
  optionsMap?: Record<string, { value: string; label: string }[]>;
}
```

This wraps the label, input, error message, and description in the same layout as the current `FormField`.

**Step 2: Also extract `useDynamicOptions` hook**

Create `src/hooks/use-dynamic-options.ts` (or `src/components/universal/use-dynamic-options.ts`) to hold the `useDynamicOptions` hook currently in `entity-form.tsx` (lines ~52-152). This hook is needed by both EntityForm (legacy) and the unified component.

**Step 3: Update EntityForm to import from new files**

Update `entity-form.tsx` to import `FieldInput` and `useDynamicOptions` from their new locations. Verify the form still works identically.

**Step 4: Verify build**

Run: `bun tsc --noEmit`
Expected: No type errors

**Step 5: Verify forms work**

Run: `bun dev` and test creating/editing an entity (e.g., `/settings/locations/new`)
Expected: Form renders and submits identically

**Step 6: Commit**

```bash
git add src/components/universal/field-input.tsx src/components/universal/entity-form.tsx src/hooks/use-dynamic-options.ts
git commit -m "refactor: extract FieldInput and useDynamicOptions from EntityForm"
```

---

## Task 4: Create UnifiedField Component

**Files:**
- Create: `src/components/universal/unified-field.tsx`

**Context:** Simple wrapper that delegates to FieldDisplay or FieldInput based on editing state and field editability.

**Step 1: Create the component**

```typescript
"use client";

import { FieldDisplay } from "./field-display";
import { FieldInput } from "./field-input";
import type { UnifiedFieldDef, EntityConfig } from "@/types/entity";
import type { UseFormReturn } from "react-hook-form";

interface UnifiedFieldProps {
  field: UnifiedFieldDef<any>;
  editing: boolean;
  isCreateMode: boolean;
  form?: UseFormReturn<any>;
  record: Record<string, unknown>;
  entity: EntityConfig<any>;
  relationDisplayValues?: Record<string, string>;
  optionsMap?: Record<string, { value: string; label: string }[]>;
}

export function UnifiedField({
  field,
  editing,
  isCreateMode,
  form,
  record,
  entity,
  relationDisplayValues,
  optionsMap,
}: UnifiedFieldProps) {
  // Determine if this field should show as an input right now
  const isEditable = (() => {
    if (!editing) return false;
    if (field.editable === false) return false;
    if (field.editable === "create-only" && !isCreateMode) return false;
    if (!field.type) return false; // No input type defined = display only
    return true;
  })();

  if (isEditable && form) {
    return <FieldInput field={field} form={form} optionsMap={optionsMap} />;
  }

  return (
    <FieldDisplay
      field={field}
      value={record[field.name]}
      record={record}
      entity={entity}
      relationDisplayValues={relationDisplayValues}
    />
  );
}
```

**Step 2: Verify build**

Run: `bun tsc --noEmit`

**Step 3: Commit**

```bash
git add src/components/universal/unified-field.tsx
git commit -m "feat: add UnifiedField component"
```

---

## Task 5: Create EditFooter Component

**Files:**
- Create: `src/components/universal/edit-footer.tsx`

**Context:** A sticky footer bar that appears when in edit mode, showing Save and Cancel buttons with form state.

**Step 1: Create the component**

```typescript
"use client";

import { Button } from "@/components/ui/button";
import type { UseFormReturn } from "react-hook-form";

interface EditFooterProps {
  form: UseFormReturn<any>;
  onSave: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function EditFooter({ form, onSave, onCancel, isSubmitting }: EditFooterProps) {
  const isDirty = form.formState.isDirty;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container flex items-center justify-end gap-3 py-3">
        {isDirty && (
          <span className="text-sm text-muted-foreground mr-auto">
            Unsaved changes
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onSave}
          disabled={isSubmitting || !isDirty}
        >
          {isSubmitting ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
```

**Step 2: Verify build**

Run: `bun tsc --noEmit`

**Step 3: Commit**

```bash
git add src/components/universal/edit-footer.tsx
git commit -m "feat: add EditFooter component for unified detail/edit"
```

---

## Task 6: Build EntityDetailUnified - View Mode

**Files:**
- Create: `src/components/universal/entity-detail-unified.tsx`

**Context:** This is the core new component. Start with view-mode-only that works identically to the current EntityDetail when reading from `sections` config. Edit mode is added in Task 7.

**Step 1: Create the component skeleton**

The component should handle:
- Data fetching from `viewTable` or `table` (same as current EntityDetail)
- Header rendering (title, subtitle, badge, actions dropdown)
- Tab organization (default "Details" tab + custom tabs + relation tabs)
- Section rendering using `UnifiedField` for field-based sections
- Custom component rendering for component-based sections (passing `{ data, editing: false }`)
- Relation tables on their own tabs
- State machine transitions in actions dropdown
- `onAction` callback for page-level custom action handling
- Keyboard shortcuts (`E` to enter edit mode, `Backspace` to go back)
- Error boundary wrapping

**Important patterns to carry over from `entity-detail.tsx`:**

1. **Data fetching** (lines 67-79):
   - `fetchTable = entity.viewTable || entity.table`
   - Query key: `entityKeys.detail(fetchTable, id)`
   - Uses supabase `.from(fetchTable).select("*").eq("id", id).single()`

2. **State transitions** (lines 82-105):
   - Mutation that updates the state field
   - Invalidates detail + list queries for both viewTable and base table

3. **Section organization** (lines 132-151):
   - Sections grouped by `tab` property
   - Default sections (no tab) go in the "Details" tab
   - Each unique tab name gets its own tab

4. **Relation tabs** (lines ~528-686):
   - Each relation with `detailTab` gets a tab
   - Conditional fetching based on active tab
   - Pagination limited to `relationLimit` (default 50)

5. **useRelationDisplayValues hook** (lines 405-457):
   - Fetches display names for FK fields with `relation` config
   - Used to show "Hazy IPA" instead of UUID in view mode

6. **Custom component rendering** (lines ~473-484):
   - If `section.component` exists, render it with `{ data }` props
   - Currently components only receive `{ data: T }`
   - In unified version, also pass `{ editing, form }`

Use `entity.sections` if present, otherwise fall back to converting `entity.detailSections` to unified format on the fly (compatibility layer for unmigrated entities).

**Step 2: Export the component**

Export as `EntityDetailUnified` and also as a wrapped version with error boundary: `EntityDetailUnifiedWithErrorBoundary`.

**Step 3: Verify build**

Run: `bun tsc --noEmit`

**Step 4: Verify with pilot entity**

Temporarily update the location detail page to use `EntityDetailUnified` and verify it renders identically to the current page.

Run: `bun dev`, navigate to a location detail page
Expected: Same layout, same data, same actions

Revert the page change (we'll do the permanent switch in Task 8).

**Step 5: Commit**

```bash
git add src/components/universal/entity-detail-unified.tsx
git commit -m "feat: add EntityDetailUnified component (view mode)"
```

---

## Task 7: Add Edit Mode to EntityDetailUnified

**Files:**
- Modify: `src/components/universal/entity-detail-unified.tsx`

**Context:** Add the edit toggle, form state management, save/cancel mechanics, optimistic locking, keyboard shortcuts, and dirty form guard to the unified component.

**Step 1: Add edit state and form initialization**

Add to the component:
- `const [editing, setEditing] = useState(false)`
- When `editing` becomes true, initialize react-hook-form with:
  - `zodResolver(entity.formSchema)` for validation
  - Default values from the fetched record (same logic as EntityForm lines 209-239)
  - Store loaded version in `loadedVersionRef` for optimistic locking
- When `editing` becomes false, reset/discard the form

Key initialization logic to replicate from `entity-form.tsx` (lines 209-264):
- Boolean fields default to `false`
- Number/relation/unit fields default to `null`
- Text fields default to `""`
- Merge defaults from field configs
- Load existing record values on top

**Step 2: Add save handler**

Replicate the submit logic from `entity-form.tsx` (lines 307-404):
- Validate via react-hook-form (Zod)
- Convert empty strings to null for optional fields
- For edit mode: use `updateWithOptimisticLock` if version field exists, standard update otherwise
- Invalidate queries on success (entityKeys.detail, entityKeys.all for both viewTable and table)
- Show toast on success
- Set `editing` to false on success
- Show conflict dialog on version mismatch

Note: Import `updateWithOptimisticLock` from wherever EntityForm currently imports it (check entity-form.tsx imports).

**Step 3: Add cancel handler with dirty form guard**

- If form is dirty, show a confirmation dialog: "You have unsaved changes. Discard?"
- If confirmed or not dirty, set `editing` to false and reset form

**Step 4: Add keyboard shortcuts**

- `E` - Toggle into edit mode (only when not already editing, and not typing in an input)
- `Cmd+Enter` / `Ctrl+Enter` - Save (when editing)
- `Escape` - Cancel edit (when editing, with dirty guard)
- `Backspace` - Go back (when NOT editing)

Replicate the keyboard handler pattern from `entity-detail.tsx` (lines 176-199) and `entity-form.tsx` (uses `useSubmitShortcut` hook).

**Step 5: Add Edit button to header**

Add a pencil/edit icon button next to the actions dropdown. Use lucide-animated for the icon. The button is hidden when `entity.sections` is not defined (legacy mode) or when already editing.

When editing, the Edit button changes to show "Editing" state or disappears (since the EditFooter provides the save/cancel).

**Step 6: Wire up EditFooter**

Render the `EditFooter` component when `editing` is true. Pass the form, save handler, cancel handler, and submitting state.

**Step 7: Update section rendering for edit mode**

When rendering sections in edit mode:
- For field-based sections: render `UnifiedField` with `editing={true}` and `form`
- For component-based sections: pass `{ data, editing: true, form }` to the component
- If `section.editComponent` is defined and `editing` is true, render that instead of `section.component`

**Step 8: Wire up useDynamicOptions**

Call `useDynamicOptions` with the editable fields from `entity.sections` when editing. Only include fields that have `type: "relation"` or `dynamicOptions`. This provides the options map for select/relation fields in edit mode.

To avoid fetching options when not editing, conditionally enable the queries:
```typescript
const editableFields = editing ? getEditableFieldsFromSections(entity.sections) : [];
const { optionsMap } = useDynamicOptions(editableFields);
```

**Step 9: Handle create mode**

Add an `isCreateMode` prop (or derive from `!id`). When in create mode:
- Don't fetch any record
- Start in editing mode by default
- Cannot toggle out of editing mode
- Submit does INSERT instead of UPDATE
- After insert, redirect to detail page: `router.push(\`\${basePath}/\${newId}\`)`

**Step 10: Verify build**

Run: `bun tsc --noEmit`

**Step 11: Commit**

```bash
git add src/components/universal/entity-detail-unified.tsx
git commit -m "feat: add edit mode to EntityDetailUnified"
```

---

## Task 8: Pilot Migration - Location Entity

**Files:**
- Modify: `src/entities/location.tsx` - Add unified `sections`
- Modify: `src/app/(app)/settings/locations/[id]/page.tsx` - Use unified component
- Delete: `src/app/(app)/settings/locations/[id]/edit/page.tsx`

**Context:** Location is a simple entity with no state machine, no custom components, and no viewTable. Ideal first migration.

**Step 1: Add unified sections to location config**

In `src/entities/location.tsx`, add the `sections` property to `locationEntity`. Merge the information from `detailSections` (lines 117-130) and `formFields` (lines 137-176):

```typescript
sections: [
  {
    id: "overview",
    title: "Location Details",
    fields: [
      {
        name: "name",
        label: "Name",
        type: "text",
        placeholder: "e.g., Main Brewery, Downtown Taproom",
        required: true,
        colSpan: 6,
      },
      {
        name: "location_type",
        label: "Type",
        type: "select",
        options: valuesAsOptions(locationTypeDisplayConfig),
        dynamicOptions: {
          table: "enum_values",
          valueField: "value",
          labelField: "label",
          filter: { enum_type: "location_type" },
          orderBy: "sort_order",
        },
        required: true,
        colSpan: 6,
      },
      {
        name: "is_primary",
        label: "Primary Location",
        type: "switch",
        description: "Default location for new vessels and inventory",
        colSpan: 6,
      },
      {
        name: "is_active",
        label: "Active",
        type: "switch",
        description: "Inactive locations won't appear in dropdown menus",
        defaultValue: true,
        colSpan: 6,
      },
      {
        name: "created_at",
        label: "Created",
        format: "datetime",
        editable: false,
        colSpan: 6,
      },
      {
        name: "updated_at",
        label: "Last Updated",
        format: "datetime",
        editable: false,
        colSpan: 6,
      },
    ],
  },
],
```

Note: `created_at` and `updated_at` were in detailSections but not in formFields. They get `editable: false`.

Keep `detailSections` and `formFields` in place for now (they're still used by legacy components and the `/new` page until that's updated).

**Step 2: Update detail page**

In `src/app/(app)/settings/locations/[id]/page.tsx`, import and use `EntityDetailUnified` instead of `EntityDetail`:

```typescript
import { EntityDetailUnified } from "@/components/universal/entity-detail-unified";
import { locationEntity } from "@/entities/location";

export default function LocationDetailPage({ params }) {
  const { id } = use(params);
  return <EntityDetailUnified entity={locationEntity} id={id} basePath="/settings/locations" />;
}
```

**Step 3: Delete the edit page**

Delete the file: `src/app/(app)/settings/locations/[id]/edit/page.tsx`

**Step 4: Update the create page**

In `src/app/(app)/settings/locations/new/page.tsx`, update to use `EntityDetailUnified` in create mode:

```typescript
import { EntityDetailUnified } from "@/components/universal/entity-detail-unified";
import { locationEntity } from "@/entities/location";

export default function NewLocationPage() {
  const [defaultValues] = useState(() => {
    const { prefillData } = usePrefillStore.getState().consume();
    return prefillData ?? undefined;
  });

  return (
    <EntityDetailUnified
      entity={locationEntity}
      basePath="/settings/locations"
      defaultValues={defaultValues}
    />
  );
}
```

**Step 5: Verify build**

Run: `bun tsc --noEmit`

**Step 6: Test manually**

Run: `bun dev`

Test checklist:
- [ ] Navigate to `/settings/locations` - list renders normally
- [ ] Click a location - detail view renders with all fields
- [ ] Press `E` or click Edit - fields become editable in-place
- [ ] Modify a field, press `Escape` - dirty form guard asks to discard
- [ ] Modify a field, press `Cmd+Enter` - saves and returns to view mode
- [ ] Click Cancel with no changes - exits edit mode immediately
- [ ] Navigate to `/settings/locations/new` - create form renders
- [ ] Fill in fields and save - creates location and redirects to detail
- [ ] Relation tabs still work (if any)
- [ ] Back button / Backspace works in view mode

**Step 7: Lint**

Run: `bun lint`
Fix any lint errors.

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: migrate location entity to unified detail/edit"
```

---

## Task 9: Migrate Simple Settings Entities

**Files to modify (entity configs + detail pages + delete edit pages):**

These entities have no state machine, no custom components, and simple field-based sections. Follow the exact same pattern as Task 8 for each:

1. `src/entities/brand.tsx` + `src/app/(app)/settings/brands/`
2. `src/entities/beer-style.tsx` + `src/app/(app)/settings/beer-styles/`
3. `src/entities/keg-type.tsx` + `src/app/(app)/settings/keg-types/`
4. `src/entities/sales-channel.tsx` + `src/app/(app)/settings/sales-channels/`
5. `src/entities/package-type.tsx` + `src/app/(app)/settings/formats/`
6. `src/entities/pricing-tier.tsx` + `src/app/(app)/settings/pricing/tiers/`
7. `src/entities/enum-value.tsx` + `src/app/(app)/settings/status-options/`
8. `src/entities/yeast-strain.tsx` + `src/app/(app)/settings/yeasts/`
9. `src/entities/supplier.tsx` + `src/app/(app)/purchasing/suppliers/`
10. `src/entities/customer.tsx` + `src/app/(app)/sales/customers/`

**Migration pattern per entity:**

1. Read the entity config's `detailSections` and `formFields`
2. Merge into unified `sections`:
   - Form fields become the base (they have `type`, `required`, `colSpan`, etc.)
   - Detail-only fields get `editable: false`
   - Detail fields with custom `render` get the `render` prop carried over
   - Detail fields with `format` get the `format` prop carried over
   - Detail fields with `relation` get the `relation` prop carried over (for FK display)
3. Add `sections` to the entity config (keep `detailSections` and `formFields` for now)
4. Update `[id]/page.tsx` to use `EntityDetailUnified`
5. Delete `[id]/edit/page.tsx`
6. Update `new/page.tsx` to use `EntityDetailUnified` (if it exists for this entity)

**Step 1: Migrate each entity following the pattern**

Work through all 10 entities listed above.

**Step 2: Verify build**

Run: `bun tsc --noEmit`

**Step 3: Test manually**

Spot check 2-3 migrated entities in the browser to ensure view and edit work correctly.

**Step 4: Lint**

Run: `bun lint`

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: migrate simple entities to unified detail/edit"
```

---

## Task 10: Migrate Entities with Custom Components

**Context:** These entities have `component` in their `detailSections`. The custom components will receive the new `{ data, editing, form }` prop signature, but since they don't use `editing` or `form` yet, they'll work as Tier 1 (ignore editing).

**Entities to migrate:**

1. `src/entities/batch.tsx` + `src/app/(app)/production/batches/`
   - Custom components: `BatchQuickLinks`, `BatchBrewInfo`, `BatchInsights`, `BatchBlendHistory`, `BatchCancellationInfo`, `createRevisionHistoryDisplay`
   - Has state machine, onAction handler, custom dialogs
   - Has viewTable: `batches_with_brew_info`

2. `src/entities/vessel.tsx` + `src/app/(app)/production/vessels/`
   - Custom component: `VesselCurrentBatch`
   - Has state machine
   - Has viewTable: `vessels_with_batch`

3. `src/entities/recipe.tsx` + `src/app/(app)/production/recipes/`
   - Custom components: `RecipeAnalysis`, `MashScheduleDisplay`, `FermentationScheduleDisplay`, `RecipeAdditionsDisplay`, `createRevisionHistoryDisplay`
   - Has custom onAction handler (clone, delete)

4. `src/entities/order.tsx` + `src/app/(app)/sales/orders/`
   - Custom components: `OrderQuickLinks`, `createRevisionHistoryDisplay`

5. `src/entities/purchase-order.tsx` + `src/app/(app)/purchasing/pos/`
   - Has custom onAction handler (calculate_landed_cost)

6. `src/entities/yeast-pitch.tsx` + `src/app/(app)/production/yeast-pitches/`
   - Has custom onAction handler (harvest)

**Migration pattern for entities with custom components:**

Same as Task 9, but additionally:
- Sections with `component` keep their `component` prop in the unified `sections`
- The component type broadens from `ComponentType<{ data: T }>` to `ComponentType<{ data: T; editing?: boolean; form?: unknown }>` but existing components just ignore the extra props
- Sections with custom components and no `fields` are display-only in both modes (they don't become editable)
- If a component has a matching editor variant (e.g., `MashScheduleDisplay` / `MashScheduleEditor`), set `editComponent` to the editor variant

**Migration pattern for pages with `onAction`:**

The page-level code stays nearly identical. The only change is importing `EntityDetailUnified` instead of `EntityDetail`:

```typescript
// Before:
import { EntityDetail } from "@/components/universal/entity-detail";

// After:
import { EntityDetailUnified } from "@/components/universal/entity-detail-unified";
```

The `onAction` callback pattern works identically.

**Step 1: Migrate each entity following the pattern**

Work through all 6 entities listed above.

**Step 2: Verify build**

Run: `bun tsc --noEmit`

**Step 3: Test manually**

Test each migrated entity in the browser:
- View mode: all sections render correctly, custom components display properly
- Edit mode: editable fields become inputs, custom component sections stay read-only
- State transitions: work from the actions dropdown
- Custom dialogs: open and function correctly (batch start_fermentation, recipe clone, etc.)

**Step 4: Lint**

Run: `bun lint`

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: migrate entities with custom components to unified detail/edit"
```

---

## Task 11: Migrate Remaining Entities

**Entities to migrate:**

Inventory:
1. `inventory-item.tsx` + `src/app/(app)/inventory/items/`
2. `inventory-lot.tsx` + `src/app/(app)/inventory/lots/`
3. `bin.tsx` + `src/app/(app)/inventory/bins/`
4. `keg-inventory.tsx` + `src/app/(app)/inventory/kegs/`
5. `keg-owner.tsx` + `src/app/(app)/inventory/kegs/owners/`
6. `location-transfer.tsx` + `src/app/(app)/inventory/transfers/`

Production:
7. `brew-log.tsx` + `src/app/(app)/production/brew-logs/`
8. `packaging-session.tsx` + `src/app/(app)/production/packaging/`
9. `vessel-transfer.ts` + `src/app/(app)/production/vessel-transfers/`

Sales:
10. `pick-list.tsx` + `src/app/(app)/sales/pick-lists/`

**Follow the same migration pattern as Tasks 9-10.**

Some of these entities may not have edit pages (e.g., allocations are read-only). For those, just add `sections` config and update the detail page. No edit page to delete.

**Step 1-4: Migrate, build, test, lint (same as previous tasks)**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: migrate remaining entities to unified detail/edit"
```

---

## Task 12: Cleanup

**Files:**
- Modify: `src/types/entity.ts` - Mark old fields as deprecated
- Delete: Any remaining orphaned `/edit/page.tsx` files
- Modify: `CLAUDE.md` - Update page pattern documentation

**Step 1: Mark legacy fields as deprecated**

In `src/types/entity.ts`, add `@deprecated` JSDoc to `detailSections`, `formFields`, `createFields`, and `editFields`:

```typescript
  /** @deprecated Use `sections` instead. Will be removed in a future update. */
  detailSections?: EntitySectionDef<T>[];

  /** @deprecated Use `sections` instead. Kept for backward compatibility. */
  formFields: EntityFieldDef<T>[];
```

Note: Don't remove them yet. Some entity configs may still reference them, and the legacy EntityDetail/EntityForm components still exist for any edge cases.

**Step 2: Update CLAUDE.md**

Update the "Page Pattern" section to reflect the new pattern:

```markdown
### Page Pattern
All entity pages use universal components:

\`\`\`
/[domain]/[entity-plural]/
  page.tsx         -> <EntityList entity={config} />
  new/page.tsx     -> <EntityDetailUnified entity={config} />  (create mode)
  [id]/page.tsx    -> <EntityDetailUnified entity={config} id={id} />  (view + inline edit)
\`\`\`
```

Also update the "Entity Configuration" section to show `sections` instead of separate `detailSections` + `formFields`.

**Step 3: Verify no broken imports**

Run: `bun tsc --noEmit`

Ensure no file still imports from a deleted edit page directory.

**Step 4: Lint**

Run: `bun lint`

**Step 5: Final manual test**

Quick smoke test across domains:
- Production: Batch detail (view + edit + state transition)
- Inventory: Item detail (view + edit)
- Sales: Order detail (view + edit)
- Settings: Location detail (view + edit)
- Create: New batch (create mode)

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: mark legacy entity config fields as deprecated, update docs"
```

---

## Migration Reference: Field Merging Rules

When converting an entity from `detailSections` + `formFields` to unified `sections`:

| Detail field | Form field | Result in unified `sections` |
|---|---|---|
| Has `field` + `label` | Has matching `name` | Merge: use form field as base, add `render`/`format` from detail |
| Has `field` + `label` | No match | Add with `editable: false` (display-only field, e.g., computed, timestamps) |
| No match | Has `name` | Add to appropriate section with `type` and edit props |
| Has `relation` | Has `relation` | Both kept: detail `relation` for FK display, form `relation` for dropdown fetch |
| Has `format` | Has `type` | Both kept: `format` for view rendering, `type` for edit input |
| N/A | Has `showWhen` | Kept: conditional visibility in edit mode, always visible in view mode |

## Entity Count Summary

| Category | Count | Migration Task |
|---|---|---|
| Simple settings entities | 10 | Task 9 |
| Entities with custom components | 6 | Task 10 |
| Remaining entities | 10 | Task 11 |
| Pilot (location) | 1 | Task 8 |
| **Total** | **27 entities with edit pages** | |

Note: Some entities (allocations, deliveries, finished-goods, keg-transactions, user-profiles) may not have edit pages. These only need `sections` config added and detail page updated - no edit page to delete.
