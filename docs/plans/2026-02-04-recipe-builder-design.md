# Recipe Builder Redesign

## Overview

Replace the generic `EntityDetail` recipe page with a purpose-built `RecipeBuilder` — an always-editable, auto-saving builder with a sticky sidebar showing live-computed vitals, costs, and summaries.

The current recipe detail page uses `EntityDetail` which renders 12+ sections as sequential cards in a single column. Editing requires navigating to a separate `/edit` page. This is insufficient for recipes, which are the most complex entity in the system.

## Design Principles

- **Data model is the UI** — every editable field maps 1:1 to a column or junction table row. No client-only derived state. The AI can operate on the same tables and get the same results.
- **Views for reads, tables for writes** — the sidebar reads from `recipes_with_estimates` and `recipes_with_cogs` views. Editors write to `recipes` and junction tables.
- **Reuse existing editors** — `GrainBillEditor`, `HopScheduleEditor`, `YeastSelector`, `MashScheduleEditor`, `FermentationScheduleEditor`, `WaterChemistryCalculator` are already built. The builder composes them.

## Layout

Two-column CSS grid: `grid-cols-1 lg:grid-cols-3 gap-6`

**Left panel (lg:col-span-2):** Collapsible accordion sections stacked vertically. Recipe Basics is always open at top. Each collapsed section shows a compact summary string.

**Right panel (lg:col-span-1):** Sticky sidebar (`sticky top-20 max-h-[calc(100vh-5rem)] overflow-y-auto`) with read-only computed summaries. Updates reactively via React Query cache invalidation.

**Mobile:** Single column, sidebar stacks below editors.

## Data Model Mapping

| Builder Section | Write Target | Read Source |
|---|---|---|
| Recipe Basics | `recipes` (name, brand_id, style_id, volume_bbl, batch_size_bbl, boil_time_min, status, is_template, is_active) | `recipes_with_estimates` |
| Grain Bill | `recipe_malts` | `recipe_malts` + malts catalog |
| Hops | `recipe_hops` | `recipe_hops` + hops catalog |
| Yeast | `recipe_yeasts` + `recipes` (target_attenuation, target_pitching_rate) | `recipe_yeasts` + yeasts catalog |
| Other Ingredients | `recipe_adjuncts`, `recipe_sugars`, `recipe_spices`, `recipe_fruits` | respective junction tables + catalogs |
| Water Chemistry | `recipes` (water_profile_id, mash_water_volume_gal, sparge_water_volume_gal, use_default_additions) + `recipe_additions` | `water_profiles` + `recipe_additions` + `additives` catalog |
| Mash | `recipes` (mash_schedule JSONB, mash_temp_f, target_mash_ph, mash_efficiency, water_to_grain_ratio) | `recipes` |
| Boil, Whirlpool & Knock-Out | `recipes` (boil_time_min, whirlpool_time_min, whirlpool_temp_f, whirlpool_rest_min, target_ko_temp_f, target_ko_volume_bbl) | `recipes` |
| Fermentation | `recipes` (fermentation_schedule JSONB, fermentation_days, conditioning_days) | `recipes` |
| Notes | `recipes` (brew_day_notes, tasting_notes, development_notes) | `recipes` |

**Sidebar reads only (no writes):**
- `recipes_with_estimates` → OG, FG, ABV, IBU, SRM, style_name
- `recipes_with_cogs` → malt_cost, hop_cost, yeast_cost, adjunct_cost, addition_cost, total_cogs, cogs_per_bbl

## Left Panel Sections

### 1. Recipe Basics (always open, not collapsible)
**Summary subtitle:** `"22 BBL · 10 min boil · India Pale Ale"`

Fields: name (text), brand_id (select), style_id (select), volume_bbl (unit), batch_size_bbl (unit), boil_time_min (number), status (select), is_template (switch), is_active (switch).

### 2. Grain Bill (collapsible)
**Collapsed:** `"5 malts · 1,745 lbs · $1,359.02"`

Reuses existing `GrainBillEditor`. Wired to `useJunctionTable("recipe_malts")`.

### 3. Hops (collapsible)
**Collapsed:** `"4 hops · WP: 2 lb/bbl · DH: 3 lb/bbl · $1,713.80"`

Reuses existing `HopScheduleEditor`. Wired to `useJunctionTable("recipe_hops")`.

### 4. Yeast (collapsible)
**Collapsed:** `"London Tropics · 75% att"`

Reuses existing `YeastSelector`. Junction table for `recipe_yeasts`. Also shows `target_attenuation` and `target_pitching_rate` fields which save via `useRecipeAutoSave`.

### 5. Other Ingredients (collapsible)
**Collapsed:** `"2 adjuncts · 1 sugar"` or `"No other ingredients"`

Combines four junction tables: `recipe_adjuncts`, `recipe_sugars`, `recipe_spices`, `recipe_fruits`. Sub-headers within the section for each type that has entries, with "Add" buttons for each.

### 6. Water Chemistry (collapsible)
**Collapsed:** `"pH 5.41 · SO₄:Cl 1:1.87 · Malty"`

Adapts existing `WaterChemistryCalculator`. Includes:
- `water_profile_id` select with Default/New toggle
- Source profile ion display (Ca²⁺, Mg²⁺, Na⁺, SO₄²⁻, Cl⁻, HCO₃⁻, pH)
- Water volumes with unit toggle: `mash_water_volume_gal`, `sparge_water_volume_gal`, computed total
- `recipe_additions` table for salts, minerals, acid additions
- `use_default_additions` toggle

### 7. Mash (collapsible)
**Collapsed:** `"1 step · 152°F · 60 min total"`

Reuses existing `MashScheduleEditor` for the `mash_schedule` JSONB. Also shows `mash_temp_f`, `target_mash_ph`, `mash_efficiency`, `water_to_grain_ratio` fields.

### 8. Boil, Whirlpool & Knock-Out (collapsible)
**Collapsed:** `"60 min boil · 20 min WP @ 180°F · KO 65°F"`

Fields: `boil_time_min`, `whirlpool_time_min`, `whirlpool_temp_f`, `whirlpool_rest_min`, `target_ko_temp_f`, `target_ko_volume_bbl`.

### 9. Fermentation (collapsible)
**Collapsed:** `"1 stage · 68°F · 14 days total"`

Reuses existing `FermentationScheduleEditor` for the `fermentation_schedule` JSONB. Also shows `fermentation_days` (auto-calculated from schedule), `conditioning_days`.

### 10. Notes (collapsible, collapsed by default)
**Collapsed:** `"3 notes"` or `"No notes"`

Textareas: `brew_day_notes`, `tasting_notes`, `development_notes`.

## Sticky Sidebar Sections

### Vitals Bar (always visible)
```
[SRM swatch] 6.7% ABV    OG 16.1°P    FG 4.3°P    IBU 40
```
SRM color rendered as a small colored square. OG/FG shown in Plato (converted from SG). From `recipes_with_estimates`.

### Water Chemistry Snapshot
```
pH 5.41    SO₄:Cl 1:1.87                          [Malty]
Ca 77   Mg 6   Na 46   SO₄ 63   Cl 118   HCO₃ 63
```
"Malty" / "Balanced" / "Hoppy" descriptor from SO₄:Cl ratio. From joined water profile data.

### Ingredients Summary (collapsible, expanded by default)
Read-only ingredient list grouped by type: grain bill, hops, yeast. Clicking an ingredient scrolls the left panel to that section.

### Cost Breakdown (collapsible, collapsed by default)
Per-category costs from `recipes_with_cogs`. Shows per-BBL cost in the section header.

### Mash Summary (collapsible)
Compact schedule from `recipes.mash_schedule` JSONB.

### Fermentation Summary (collapsible)
Temperature profile and duration totals from `recipes.fermentation_schedule` JSONB.

### Dry Hops
Filtered from `recipe_hops` where `timing = 'dry_hop'`. Convenience duplication — brewers check this constantly.

## Auto-Save Strategy

### Path 1: Recipe Fields — Debounced (1.5s)

All columns on the `recipes` table save via a single `useRecipeAutoSave` hook.

- Field changes accumulate in a `useRef<Partial<RecipeRow>>`
- After 1.5s of inactivity, a `useMutation` fires a partial UPDATE
- On success, invalidate `recipeKeys.detail(id)` and `recipeKeys.cogs(id)`
- JSONB fields (`mash_schedule`, `fermentation_schedule`) go through the same path

Status indicator in the header: idle → "Unsaved changes" → "Saving..." → "Saved" (fades) → "Save failed" (red, retry).

### Path 2: Junction Tables — Immediate

Each add/delete/update on `recipe_malts`, `recipe_hops`, etc. saves immediately via `useJunctionTable` hook.

- Operations are atomic (INSERT/UPDATE/DELETE on single rows)
- No debounce — malt added = malt saved
- On success, invalidate junction table cache + `recipeKeys.cogs(id)` + `recipeKeys.detail(id)` (estimates change when ingredients change)

### Edge Cases

- **Navigate away:** Flush pending debounce immediately on `beforeunload` and Next.js route change.
- **Rapid edits:** Each debounce reset clears the previous timer. The ref accumulates all changed fields.
- **Concurrent saves:** Junction saves are independent of recipe field saves. No conflicts.

## File Organization

### New Files

```
src/components/domain/
  recipe-builder.tsx                    # Main orchestrator
  recipe-builder-sidebar.tsx            # Sticky sidebar
  recipe-builder-basics.tsx             # Recipe Basics section
  recipe-builder-process.tsx            # Boil, Whirlpool & Knock-Out section
  recipe-builder-notes.tsx              # Notes section
  recipe-builder-other-ingredients.tsx  # Adjuncts, sugars, spices, fruits

src/hooks/
  use-recipe-autosave.ts               # Debounced auto-save for recipes table
  use-junction-table.ts                # Generic CRUD hook for junction tables
```

### Reused (unchanged)

```
src/components/domain/
  grain-bill-editor.tsx
  hop-schedule-editor.tsx
  yeast-selector.tsx
  mash-schedule-editor.tsx
  fermentation-schedule-editor.tsx
  water-chemistry-calculator.tsx        # May need minor prop adaptation
  recipe-clone-dialog.tsx
  recipe-delete-dialog.tsx
```

### Modified

```
src/app/(app)/production/recipes/[id]/page.tsx
  # Simplified to: <RecipeBuilder recipeId={id} preferredVolumeUnit={unit} />

src/app/(app)/production/recipes/[id]/edit/page.tsx
  # Remove or redirect to /[id] — the builder IS the edit experience

src/lib/query-keys.ts
  # Add recipeKeys.junction(recipeId, tableName) factory
```

### Unchanged

```
src/entities/recipe.tsx
  # Stays for EntityList, AI context, queryExamples, keyFields
  # Builder does NOT use it for rendering

src/app/(app)/production/recipes/page.tsx
  # List page still uses EntityList with recipeEntity config
```

## Component Hierarchy

```
RecipeBuilder
├── Header (name, status badge, save indicator, clone/delete actions)
├── Grid (lg:grid-cols-3)
│   ├── Left (lg:col-span-2)
│   │   ├── RecipeBuilderBasics (always open)
│   │   ├── Collapsible: GrainBillEditor
│   │   ├── Collapsible: HopScheduleEditor
│   │   ├── Collapsible: YeastSelector
│   │   ├── Collapsible: RecipeBuilderOtherIngredients
│   │   ├── Collapsible: WaterChemistryCalculator
│   │   ├── Collapsible: MashScheduleEditor + params
│   │   ├── Collapsible: RecipeBuilderProcess
│   │   ├── Collapsible: FermentationScheduleEditor + params
│   │   └── Collapsible: RecipeBuilderNotes
│   └── Right (lg:col-span-1, sticky)
│       └── RecipeBuilderSidebar
│           ├── Vitals Bar
│           ├── Water Chemistry Snapshot
│           ├── Ingredients Summary
│           ├── Cost Breakdown
│           ├── Mash Summary
│           ├── Fermentation Summary
│           └── Dry Hops
```

## Data Flow

```
useQuery(recipes_with_estimates) ──→ RecipeBuilder (local form state)
                                          │
                          ┌────────────────┼────────────────┐
                          ▼                ▼                ▼
                   Left Panel         Sidebar          Save Indicator
                   (editors)       (reads cache)       (mutation status)
                       │
           ┌───────────┼───────────┐
           ▼                       ▼
  useRecipeAutoSave         useJunctionTable
  (recipes table,           (recipe_malts, etc.,
   1.5s debounce)            immediate save)
           │                       │
           └───────────┬───────────┘
                       ▼
             invalidateQueries()
                       │
                       ▼
             Sidebar re-renders
             with fresh view data
```

## AI Compatibility

The builder introduces no new data structures. Every mutation maps to existing tables:

| AI Tool | Builder Equivalent |
|---|---|
| `update_recipe(id, {name, volume_bbl, ...})` | useRecipeAutoSave partial UPDATE |
| `insert into recipe_malts(recipe_id, malt_id, weight_lbs)` | useJunctionTable.add() |
| `update recipe_hops set weight_oz = X where id = Y` | useJunctionTable.update() |
| `delete from recipe_additions where id = X` | useJunctionTable.remove() |

The `recipes_with_estimates` and `recipes_with_cogs` views recalculate automatically. AI and human edits are indistinguishable at the data layer.
