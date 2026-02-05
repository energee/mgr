# Recipe/Batch/Brew Log Cohesion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Tie recipes, batches, and brew logs together with recipe variant split templates, batch additions tracking, cost projections, a guided "Start Brew Day" flow, and cross-entity visibility improvements.

**Architecture:** New database tables (`recipe_variants`, `recipe_variant_hops`, `recipe_variant_adjuncts`, `recipe_variant_fruits`, `recipe_variant_spices`, `batch_additions`) + cost views + entity config updates + domain components + a multi-step "Start Brew Day" dialog. Follows existing entity config + universal component patterns.

**Tech Stack:** PostgreSQL migrations, TypeScript entity configs, React components (shadcn/ui), React Query, Zod validation, Supabase client.

**Design Doc:** `docs/plans/2026-02-05-recipe-batch-brewlog-cohesion.md`

---

## Phase 1: Database Schema

### Task 1: Create recipe_variants and variant addition tables

**Files:**
- Create: `supabase/migrations/00082_recipe_variants.sql`

**Step 1: Write the migration**

```sql
-- Recipe Variants (Split Templates)
-- Planned cold-side variations for a recipe.
-- Each variant represents a distinct beer that can be produced from one brew.

-- =============================================================================
-- recipe_variants: parent table for variant definitions
-- =============================================================================

CREATE TABLE recipe_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  position INT NOT NULL DEFAULT 0,
  planned_volume_bbl DECIMAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE recipe_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage recipe_variants"
  ON recipe_variants FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_recipe_variants_recipe ON recipe_variants(recipe_id);

COMMENT ON TABLE recipe_variants IS 'Planned cold-side variations for a recipe (split templates)';

-- =============================================================================
-- recipe_variant_hops: dry hop additions per variant
-- =============================================================================

CREATE TABLE recipe_variant_hops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_variant_id UUID NOT NULL REFERENCES recipe_variants(id) ON DELETE CASCADE,
  hop_id UUID NOT NULL REFERENCES hops(id),
  weight_oz DECIMAL NOT NULL CHECK (weight_oz > 0),
  timing TEXT NOT NULL DEFAULT 'dry_hop',
  days INT,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE recipe_variant_hops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage recipe_variant_hops"
  ON recipe_variant_hops FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_recipe_variant_hops_variant ON recipe_variant_hops(recipe_variant_id);

COMMENT ON TABLE recipe_variant_hops IS 'Hop additions planned for a recipe variant (typically dry hops)';

-- =============================================================================
-- recipe_variant_adjuncts: cold-side adjuncts per variant
-- =============================================================================

CREATE TABLE recipe_variant_adjuncts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_variant_id UUID NOT NULL REFERENCES recipe_variants(id) ON DELETE CASCADE,
  adjunct_id UUID NOT NULL REFERENCES adjuncts(id),
  amount DECIMAL NOT NULL CHECK (amount > 0),
  unit TEXT NOT NULL,
  timing TEXT,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE recipe_variant_adjuncts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage recipe_variant_adjuncts"
  ON recipe_variant_adjuncts FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_recipe_variant_adjuncts_variant ON recipe_variant_adjuncts(recipe_variant_id);

COMMENT ON TABLE recipe_variant_adjuncts IS 'Adjunct additions planned for a recipe variant';

-- =============================================================================
-- recipe_variant_fruits: cold-side fruit additions per variant
-- =============================================================================

CREATE TABLE recipe_variant_fruits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_variant_id UUID NOT NULL REFERENCES recipe_variants(id) ON DELETE CASCADE,
  fruit_id UUID NOT NULL REFERENCES fruits(id),
  amount DECIMAL NOT NULL CHECK (amount > 0),
  unit TEXT NOT NULL,
  timing TEXT,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE recipe_variant_fruits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage recipe_variant_fruits"
  ON recipe_variant_fruits FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_recipe_variant_fruits_variant ON recipe_variant_fruits(recipe_variant_id);

COMMENT ON TABLE recipe_variant_fruits IS 'Fruit additions planned for a recipe variant';

-- =============================================================================
-- recipe_variant_spices: cold-side spice additions per variant
-- =============================================================================

CREATE TABLE recipe_variant_spices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_variant_id UUID NOT NULL REFERENCES recipe_variants(id) ON DELETE CASCADE,
  spice_id UUID NOT NULL REFERENCES spices(id),
  amount DECIMAL NOT NULL CHECK (amount > 0),
  unit TEXT NOT NULL,
  timing TEXT,
  boil_time_min INT,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE recipe_variant_spices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage recipe_variant_spices"
  ON recipe_variant_spices FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_recipe_variant_spices_variant ON recipe_variant_spices(recipe_variant_id);

COMMENT ON TABLE recipe_variant_spices IS 'Spice additions planned for a recipe variant';

-- =============================================================================
-- Schema Registry entries
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, key_fields, relationships) VALUES
  ('recipe_variants', 'Planned cold-side variations (split templates) for a recipe', 'production',
   '["name", "planned_volume_bbl", "position"]'::jsonb,
   '["recipes(recipe_id)"]'::jsonb),
  ('recipe_variant_hops', 'Hop additions (typically dry hops) planned for a recipe variant', 'production',
   '["weight_oz", "timing", "days"]'::jsonb,
   '["recipe_variants(recipe_variant_id)", "hops(hop_id)"]'::jsonb),
  ('recipe_variant_adjuncts', 'Adjunct additions planned for a recipe variant', 'production',
   '["amount", "unit", "timing"]'::jsonb,
   '["recipe_variants(recipe_variant_id)", "adjuncts(adjunct_id)"]'::jsonb),
  ('recipe_variant_fruits', 'Fruit additions planned for a recipe variant', 'production',
   '["amount", "unit", "timing"]'::jsonb,
   '["recipe_variants(recipe_variant_id)", "fruits(fruit_id)"]'::jsonb),
  ('recipe_variant_spices', 'Spice additions planned for a recipe variant', 'production',
   '["amount", "unit", "timing"]'::jsonb,
   '["recipe_variants(recipe_variant_id)", "spices(spice_id)"]'::jsonb);
```

**Step 2: Apply the migration**

Run: `supabase db push` or apply via Supabase MCP `apply_migration`

**Step 3: Commit**

```bash
git add supabase/migrations/00082_recipe_variants.sql
git commit -m "feat: add recipe_variants and variant addition tables"
```

---

### Task 2: Create batch_additions table and add recipe_variant_id to batches

**Files:**
- Create: `supabase/migrations/00083_batch_additions.sql`

**Step 1: Write the migration**

```sql
-- Batch Additions & Variant Linkage
-- Tracks actual cold-side additions to batches and links batches to planned recipe variants.

-- =============================================================================
-- batch_additions: actual cold-side additions recorded on a batch
-- =============================================================================

CREATE TABLE batch_additions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  addition_type TEXT NOT NULL CHECK (addition_type IN ('hop', 'adjunct', 'fruit', 'spice', 'yeast', 'other')),
  catalog_id UUID,
  catalog_table TEXT,
  name TEXT NOT NULL,
  amount DECIMAL NOT NULL CHECK (amount > 0),
  unit TEXT NOT NULL,
  timing TEXT,
  days INT,
  date_added DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE batch_additions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage batch_additions"
  ON batch_additions FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_batch_additions_batch ON batch_additions(batch_id);

COMMENT ON TABLE batch_additions IS 'Actual cold-side additions recorded on a batch (dry hops, fruit, adjuncts, etc.)';

-- =============================================================================
-- Add recipe_variant_id to batches
-- =============================================================================

ALTER TABLE batches ADD COLUMN recipe_variant_id UUID
  REFERENCES recipe_variants(id) ON DELETE SET NULL;

CREATE INDEX idx_batches_recipe_variant ON batches(recipe_variant_id);

COMMENT ON COLUMN batches.recipe_variant_id IS 'Links batch to planned recipe variant for plan vs actual comparison';

-- =============================================================================
-- Schema Registry
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, key_fields, relationships) VALUES
  ('batch_additions', 'Actual cold-side additions recorded on a batch', 'production',
   '["addition_type", "name", "amount", "unit", "timing", "date_added"]'::jsonb,
   '["batches(batch_id)"]'::jsonb);
```

**Step 2: Apply the migration**

**Step 3: Commit**

```bash
git add supabase/migrations/00083_batch_additions.sql
git commit -m "feat: add batch_additions table and recipe_variant_id to batches"
```

---

### Task 3: Create cost projection views

**Files:**
- Create: `supabase/migrations/00084_variant_cost_views.sql`

**Step 1: Write the migration**

This migration creates:
1. `recipe_variants_with_costs` — per-variant estimated COGS
2. `batch_additions_with_costs` — actual cold-side costs per batch

```sql
-- Cost Projection Views for Recipe Variants and Batch Additions
-- Enables plan vs actual cost comparison at recipe variant and batch level.

-- =============================================================================
-- recipe_variants_with_costs: estimated costs per variant
-- =============================================================================

CREATE VIEW recipe_variants_with_costs
WITH (security_invoker = true)
AS
WITH variant_hop_costs AS (
  SELECT
    rvh.recipe_variant_id,
    SUM((rvh.weight_oz / 16.0) * COALESCE(h.cost_per_lb, 0)) as hop_cost
  FROM recipe_variant_hops rvh
  JOIN hops h ON h.id = rvh.hop_id
  GROUP BY rvh.recipe_variant_id
),
variant_adjunct_costs AS (
  SELECT
    rva.recipe_variant_id,
    SUM(rva.amount * COALESCE(a.cost_per_lb, 0)) as adjunct_cost
  FROM recipe_variant_adjuncts rva
  JOIN adjuncts a ON a.id = rva.adjunct_id
  GROUP BY rva.recipe_variant_id
),
variant_fruit_costs AS (
  SELECT
    rvf.recipe_variant_id,
    SUM(rvf.amount * COALESCE(f.cost_per_lb, 0)) as fruit_cost
  FROM recipe_variant_fruits rvf
  JOIN fruits f ON f.id = rvf.fruit_id
  GROUP BY rvf.recipe_variant_id
),
hot_side AS (
  SELECT
    rc.id as recipe_id,
    rc.volume_bbl,
    rc.batch_size_bbl,
    rc.total_cogs as hot_side_cost,
    CASE
      WHEN COALESCE(rc.batch_size_bbl, rc.volume_bbl, 0) > 0
      THEN rc.total_cogs / COALESCE(rc.batch_size_bbl, rc.volume_bbl)
      ELSE 0
    END as hot_side_cost_per_bbl
  FROM recipes_with_cogs rc
)
SELECT
  rv.id,
  rv.recipe_id,
  rv.name,
  rv.description,
  rv.position,
  rv.planned_volume_bbl,
  rv.created_at,
  rv.updated_at,
  ROUND(COALESCE(hs.hot_side_cost_per_bbl, 0)::numeric, 2) as hot_side_cost_per_bbl,
  ROUND((COALESCE(vhc.hop_cost, 0) + COALESCE(vac.adjunct_cost, 0) + COALESCE(vfc.fruit_cost, 0))::numeric, 2) as variant_addition_cost,
  ROUND((
    COALESCE(hs.hot_side_cost_per_bbl, 0) * COALESCE(rv.planned_volume_bbl, 0)
    + COALESCE(vhc.hop_cost, 0) + COALESCE(vac.adjunct_cost, 0) + COALESCE(vfc.fruit_cost, 0)
  )::numeric, 2) as est_total_cost,
  CASE
    WHEN COALESCE(rv.planned_volume_bbl, 0) > 0
    THEN ROUND((
      COALESCE(hs.hot_side_cost_per_bbl, 0)
      + (COALESCE(vhc.hop_cost, 0) + COALESCE(vac.adjunct_cost, 0) + COALESCE(vfc.fruit_cost, 0))
        / rv.planned_volume_bbl
    )::numeric, 2)
    ELSE NULL
  END as est_cost_per_bbl
FROM recipe_variants rv
LEFT JOIN hot_side hs ON hs.recipe_id = rv.recipe_id
LEFT JOIN variant_hop_costs vhc ON vhc.recipe_variant_id = rv.id
LEFT JOIN variant_adjunct_costs vac ON vac.recipe_variant_id = rv.id
LEFT JOIN variant_fruit_costs vfc ON vfc.recipe_variant_id = rv.id;

COMMENT ON VIEW recipe_variants_with_costs IS 'Recipe variants with hot-side and cold-side cost projections';

-- =============================================================================
-- batch_additions_with_costs: actual addition costs per batch
-- =============================================================================

CREATE VIEW batch_additions_with_costs
WITH (security_invoker = true)
AS
SELECT
  ba.id,
  ba.batch_id,
  ba.addition_type,
  ba.catalog_id,
  ba.catalog_table,
  ba.name,
  ba.amount,
  ba.unit,
  ba.timing,
  ba.days,
  ba.date_added,
  ba.notes,
  ba.created_at,
  -- Cost lookup: join to catalog table based on addition_type
  -- Uses CASE to handle different catalog cost columns
  ROUND((ba.amount * COALESCE(
    CASE ba.catalog_table
      WHEN 'hops' THEN (SELECT cost_per_lb / 16.0 FROM hops WHERE id = ba.catalog_id)
      WHEN 'adjuncts' THEN (SELECT cost_per_lb FROM adjuncts WHERE id = ba.catalog_id)
      WHEN 'fruits' THEN (SELECT cost_per_lb FROM fruits WHERE id = ba.catalog_id)
      WHEN 'spices' THEN (SELECT cost_per_unit FROM spices WHERE id = ba.catalog_id)
      ELSE 0
    END, 0
  ))::numeric, 2) as estimated_cost
FROM batch_additions ba;

COMMENT ON VIEW batch_additions_with_costs IS 'Batch additions with estimated costs from catalog prices';

-- =============================================================================
-- Schema Registry
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, key_fields) VALUES
  ('recipe_variants_with_costs', 'Recipe variants with hot-side and cold-side cost projections', 'production',
   '["hot_side_cost_per_bbl", "variant_addition_cost", "est_total_cost", "est_cost_per_bbl"]'::jsonb),
  ('batch_additions_with_costs', 'Batch additions with estimated costs from catalog prices', 'production',
   '["estimated_cost"]'::jsonb);
```

**Step 2: Apply the migration**

**Step 3: Commit**

```bash
git add supabase/migrations/00084_variant_cost_views.sql
git commit -m "feat: add recipe variant cost and batch addition cost views"
```

---

### Task 4: Regenerate TypeScript types

**Step 1: Generate types**

Run: `pnpm supabase gen types typescript --project-id <project-id> > src/types/supabase.ts`

Or use the Supabase MCP `generate_typescript_types` tool and write the output to `src/types/supabase.ts`.

**Step 2: Commit**

```bash
git add src/types/supabase.ts
git commit -m "chore: regenerate Supabase types for variant and addition tables"
```

---

## Phase 2: Query Keys & Entity Config Foundation

### Task 5: Add query key factories for variants and batch additions

**Files:**
- Modify: `src/lib/query-keys.ts`

**Step 1: Add new key factories**

Add to the existing file, following the pattern of `recipeKeys` and `batchKeys`:

```typescript
// After existing recipeKeys definition, add:
export const recipeVariantKeys = {
  all: ["recipe-variants"] as const,
  byRecipe: (recipeId: string) => ["recipe-variants", "by-recipe", recipeId] as const,
  detail: (id: string) => ["recipe-variants", "detail", id] as const,
  withCosts: (recipeId: string) => ["recipe-variants", "with-costs", recipeId] as const,
};

// After existing batchKeys definition, add or update:
export const batchAdditionKeys = {
  all: ["batch-additions"] as const,
  byBatch: (batchId: string) => ["batch-additions", "by-batch", batchId] as const,
  withCosts: (batchId: string) => ["batch-additions", "with-costs", batchId] as const,
};
```

**Step 2: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat: add query key factories for recipe variants and batch additions"
```

---

### Task 6: Add recipe_variant_id to batch entity config and schema

**Files:**
- Modify: `src/lib/schemas/batch.ts` — add `recipe_variant_id` to Zod schema
- Modify: `src/entities/batch.tsx` — add `recipe_variant_id` relation to form and relations

**Step 1: Update Zod schema**

In `src/lib/schemas/batch.ts`, add to the schema object:

```typescript
recipe_variant_id: z.string().uuid().nullable().optional(),
```

**Step 2: Update batch entity config**

In `src/entities/batch.tsx`:

1. Add to `Batch` type:
```typescript
recipe_variant_id: string | null;
```

2. Add to `formFields` (after `recipe_id`):
```typescript
{
  name: "recipe_variant_id",
  label: "Recipe Variant",
  type: "relation",
  relation: {
    entity: "recipe_variant",
    displayField: "name",
  },
  colSpan: 6,
  description: "Planned variant this batch was produced from",
},
```

3. Add to `relations`:
```typescript
{
  name: "recipe_variant",
  entity: "recipe_variant",
  type: "belongsTo",
  foreignKey: "recipe_variant_id",
  showInDetail: false, // Shown via custom component instead
},
```

**Step 3: Commit**

```bash
git add src/lib/schemas/batch.ts src/entities/batch.tsx
git commit -m "feat: add recipe_variant_id to batch entity config"
```

---

## Phase 3: Recipe Variant Editor (Domain Component)

### Task 7: Create the recipe variant editor component

This is the core domain component for managing variants on a recipe. It follows the same pattern as `RecipeIngredientsEditor` — fetches from junction tables, edits locally, saves with delete-all + insert.

**Files:**
- Create: `src/components/domain/recipe-variant-editor.tsx`

**Reference:** `src/components/domain/recipe-ingredients-editor.tsx` for fetch/save pattern, `src/components/domain/hop-schedule-editor.tsx` for inline editing with catalog selectors.

**Step 1: Build the component**

The component should:
- Accept `recipeId: string` and `disabled?: boolean` as props
- Fetch variants from `recipe_variants` for this recipe (ordered by position)
- For each variant, fetch its additions from `recipe_variant_hops`, `recipe_variant_adjuncts`, `recipe_variant_fruits`, `recipe_variant_spices` (joined to catalog tables for display names)
- Display as a list of collapsible cards, each showing:
  - Variant name (editable text input)
  - Description (editable textarea, collapsed by default)
  - Planned volume BBL (editable number input)
  - Cold-side additions table per type (hops, adjuncts, fruits, spices) with:
    - Catalog selector (Popover + Command, same pattern as `HopScheduleEditor`)
    - Amount + unit inputs
    - Timing dropdown (dry_hop, secondary, packaging)
    - Days field (for dry hops)
    - Delete button per row
    - "Add" button per addition type
  - Delete variant button
- "Add Variant" button at the bottom
- Save button (only shown when dirty)
- On save: delete all existing variants + additions for this recipe, insert new ones
- Use `recipeVariantKeys.byRecipe(recipeId)` for query key
- Show cost projections inline if available (from `recipe_variants_with_costs`)

This is a substantial component (~500-700 lines). Follow the patterns in `grain-bill-editor.tsx` and `hop-schedule-editor.tsx` closely.

**Key data types:**

```typescript
interface VariantItem {
  id?: string;
  name: string;
  description: string | null;
  position: number;
  planned_volume_bbl: number | null;
  hops: VariantHopItem[];
  adjuncts: VariantAdjunctItem[];
  fruits: VariantFruitItem[];
  spices: VariantSpiceItem[];
}

interface VariantHopItem {
  id?: string;
  hop_id: string;
  hop_name?: string; // joined from catalog
  weight_oz: number;
  timing: string;
  days: number | null;
  position: number;
}

// Similar interfaces for adjuncts, fruits, spices
```

**Save pattern (in useMutation):**

```typescript
// 1. Delete existing variants (cascade deletes additions)
await supabase.from("recipe_variants").delete().eq("recipe_id", recipeId);

// 2. Insert new variants
for (const [index, variant] of variants.entries()) {
  const { data: inserted } = await supabase
    .from("recipe_variants")
    .insert({
      recipe_id: recipeId,
      name: variant.name,
      description: variant.description,
      position: index,
      planned_volume_bbl: variant.planned_volume_bbl,
    })
    .select("id")
    .single();

  // 3. Insert variant additions
  if (variant.hops.length > 0) {
    await supabase.from("recipe_variant_hops").insert(
      variant.hops.map((h, i) => ({
        recipe_variant_id: inserted.id,
        hop_id: h.hop_id,
        weight_oz: h.weight_oz,
        timing: h.timing,
        days: h.days,
        position: i,
      }))
    );
  }
  // ... same for adjuncts, fruits, spices
}
```

**Step 2: Commit**

```bash
git add src/components/domain/recipe-variant-editor.tsx
git commit -m "feat: add recipe variant editor component"
```

---

### Task 8: Add variants section to recipe entity config and detail page

**Files:**
- Modify: `src/entities/recipe.tsx` — add variants detail section
- Modify: `src/entities/recipe.tsx` — add import for RecipeVariantEditor

**Step 1: Add the section**

In `src/entities/recipe.tsx`, import the new component:

```typescript
import { RecipeVariantEditor } from "@/components/domain/recipe-variant-editor";
```

Add to `detailSections` array (after the `additions` section, before `notes`):

```typescript
{
  id: "variants",
  title: "Split Variants",
  component: RecipeVariantEditor,
},
```

Also add a `hasMany` relation:

```typescript
{
  name: "variants",
  entity: "recipe_variant",
  type: "hasMany",
  foreignKey: "recipe_id",
  showInDetail: false, // Shown via custom component
},
```

**Step 2: Commit**

```bash
git add src/entities/recipe.tsx
git commit -m "feat: add variants section to recipe detail page"
```

---

## Phase 4: Batch Additions (Actuals Tracking)

### Task 9: Wire batch-addition-form.tsx to the new batch_additions table

The `BatchAdditionForm` component already exists at `src/components/domain/batch-addition-form.tsx` but has no backing table. Now that `batch_additions` exists, wire it up.

**Files:**
- Modify: `src/components/domain/batch-addition-form.tsx` — update to insert into `batch_additions`

**Step 1: Review the existing form**

Read `src/components/domain/batch-addition-form.tsx` to understand the current `onSubmit` prop pattern. The form likely calls `onSubmit(data)` and the parent handles persistence. Update the parent component (or add a wrapper) that:

1. Takes the form submission data
2. Maps it to `batch_additions` table schema:
   ```typescript
   {
     batch_id: batchId,
     addition_type: data.type, // map from form type to table type
     catalog_id: data.ingredientId || null,
     catalog_table: data.ingredientTable || null, // "hops", "adjuncts", etc.
     name: data.ingredientName,
     amount: data.amount,
     unit: data.unit,
     timing: data.timing || null,
     days: data.contactTime || null,
     date_added: data.timestamp ? new Date(data.timestamp).toISOString().split('T')[0] : null,
     notes: data.notes || null,
   }
   ```
3. Inserts into `batch_additions` via Supabase
4. Invalidates `batchAdditionKeys.byBatch(batchId)`

**Step 2: Commit**

```bash
git add src/components/domain/batch-addition-form.tsx
git commit -m "feat: wire batch addition form to batch_additions table"
```

---

### Task 10: Create batch additions display component

**Files:**
- Create: `src/components/domain/batch-additions-display.tsx`

**Step 1: Build the component**

This component shows on the batch detail page. It:
- Accepts `data` prop (the batch record, standard detail section component pattern)
- Fetches batch additions from `batch_additions_with_costs` view for this batch
- If batch has a `recipe_variant_id`, also fetches the planned variant additions from `recipe_variants_with_costs`
- Displays a table:
  - Columns: Type, Name, Amount, Timing, Date Added, Est. Cost
  - Grouped by addition_type
  - If variant is linked, shows plan vs actual comparison:
    - Planned additions (from variant) shown as greyed-out rows if not yet added
    - Actual additions shown normally
    - Matching additions show checkmark
- Footer: total actual cold-side cost, total planned (if variant linked), variance
- "Add Addition" button opens `BatchAdditionForm` in a dialog

**Query:**
```typescript
const { data: additions } = useQuery({
  queryKey: batchAdditionKeys.withCosts(batchId),
  queryFn: async () => {
    const { data } = await supabase
      .from("batch_additions_with_costs")
      .select("*")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: true });
    return data;
  },
});
```

**Step 2: Commit**

```bash
git add src/components/domain/batch-additions-display.tsx
git commit -m "feat: add batch additions display with plan vs actual comparison"
```

---

### Task 11: Add batch additions section to batch entity config

**Files:**
- Modify: `src/entities/batch.tsx`

**Step 1: Import and add section**

```typescript
import { BatchAdditionsDisplay } from "@/components/domain/batch-additions-display";
```

Add to `detailSections` (after `brew-info`, before `ai-insights`):

```typescript
{
  id: "additions",
  title: "Cold-Side Additions",
  component: BatchAdditionsDisplay,
},
```

**Step 2: Commit**

```bash
git add src/entities/batch.tsx
git commit -m "feat: add cold-side additions section to batch detail"
```

---

## Phase 5: Start Brew Day Flow

### Task 12: Create the "Start Brew Day" multi-step dialog

This is the flagship UX improvement — a guided flow that creates a brew log + N batches in one step.

**Files:**
- Create: `src/components/domain/start-brew-day-dialog.tsx`

**Reference:** Study `src/components/domain/batch-blend-dialog.tsx` or `src/components/domain/batch-cancellation-dialog.tsx` for dialog patterns. Study `src/components/domain/brew-log-linker.tsx` for the brew log + batch linking pattern.

**Step 1: Build the multi-step dialog**

The dialog has three steps. Use local state to track current step and form data.

**Props:**
```typescript
interface StartBrewDayDialogProps {
  recipeId: string;
  recipeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (brewLogId: string) => void;
}
```

**Step 1 UI: Confirm Recipe & Date**
- Recipe name (read-only)
- Brew date (date picker, default: today)
- Brew number (text input, auto-generate suggestion: `BRW-YYYY-NNN`)
- Brewer (relation selector to user_profile)
- Recipe summary: volume, est OG, est IBU (fetched from `recipes_with_estimates`)

**Step 2 UI: Configure Splits**
- Fetch variants from `recipe_variants` for this recipe
- If variants exist: render a card per variant with name, planned_volume_bbl, additions summary
  - User can adjust volume per split
  - User can add/remove splits
  - Each split has an optional vessel picker (fetch from `vessels_with_current_batch` where status is available)
- If no variants: single batch card with recipe name as batch name, full volume
  - "Add Split" button to add more
- Each split card fields:
  - Batch name (text, pre-filled from variant name or recipe name)
  - Batch number (text, auto-generate)
  - Volume BBL (number)
  - Vessel (optional select from available vessels)

**Step 3 UI: Review & Create**
- Summary list:
  - "1 Brew Log: BRW-2024-015 (draft)"
  - "2 Batches:" with names, volumes, vessels
- "Start Brew Day" button
- On confirm, create everything in sequence:
  1. Insert `brew_logs` record
  2. Insert N `batches` records (with `recipe_id`, `recipe_variant_id`)
  3. Insert N `brew_log_batches` junction records (linking brew log to each batch with volume)
  4. If vessels assigned, insert `vessel_transfers` records
- On success: call `onSuccess(brewLogId)` — parent navigates to brew log detail

**Step 2: Commit**

```bash
git add src/components/domain/start-brew-day-dialog.tsx
git commit -m "feat: add Start Brew Day multi-step dialog"
```

---

### Task 13: Add "Start Brew Day" action to recipe entity and detail page

**Files:**
- Modify: `src/entities/recipe.tsx` — add action
- Modify: `src/app/(app)/production/recipes/[id]/page.tsx` — handle action, render dialog

**Step 1: Add action to entity config**

In `src/entities/recipe.tsx`, add to `actions` array:

```typescript
{
  name: "start_brew_day",
  label: "Start Brew Day",
  icon: "play",
  type: "button",
  // Only available for complete recipes
  fromStates: ["complete"],
},
```

**Step 2: Update recipe detail page**

In `src/app/(app)/production/recipes/[id]/page.tsx`:

1. Import `StartBrewDayDialog`
2. Add state: `const [showBrewDay, setShowBrewDay] = useState(false)`
3. In `handleAction`, add case for `"start_brew_day"`:
   ```typescript
   case "start_brew_day":
     setShowBrewDay(true);
     break;
   ```
4. Render dialog:
   ```tsx
   <StartBrewDayDialog
     recipeId={id}
     recipeName={recipeName}
     open={showBrewDay}
     onOpenChange={setShowBrewDay}
     onSuccess={(brewLogId) => {
       setShowBrewDay(false);
       router.push(`/production/brew-logs/${brewLogId}`);
     }}
   />
   ```

**Step 3: Commit**

```bash
git add src/entities/recipe.tsx src/app/(app)/production/recipes/[id]/page.tsx
git commit -m "feat: add Start Brew Day action to recipe detail page"
```

---

### Task 14: Add vessel assignment prompt to brew log completion

**Files:**
- Modify: `src/app/(app)/production/brew-logs/[id]/page.tsx` (or create if it doesn't exist)
- Create: `src/components/domain/brew-log-completion-dialog.tsx`

**Step 1: Create the completion dialog**

When the user clicks "Complete Brew" on a brew log, instead of directly transitioning, show a dialog that:
1. Fetches linked batches from `brew_log_batches` joined to `batches`
2. For each batch, shows:
   - Batch name and number
   - Allocated volume
   - Current vessel assignment (if pre-assigned)
   - Vessel picker (if not assigned) — required before completion
3. "Complete Brew & Start Fermentation" button
4. On confirm:
   - For batches without vessels: create `vessel_transfers` records
   - Transition all linked batches from `planned` → `fermenting`
   - Transition brew log to `completed`

**Step 2: Wire into brew log detail page**

Override the `complete_brew` action handler to open this dialog instead of directly transitioning.

**Step 3: Commit**

```bash
git add src/components/domain/brew-log-completion-dialog.tsx src/app/(app)/production/brew-logs/[id]/page.tsx
git commit -m "feat: add vessel assignment prompt on brew log completion"
```

---

## Phase 6: Cross-Entity Visibility

### Task 15: Add production history section to recipe detail

**Files:**
- Create: `src/components/domain/recipe-production-history.tsx`

**Step 1: Build the component**

Shows all batches produced from this recipe, with performance data.

- Fetches from `batches_with_brew_info` where `recipe_id` matches
- Also fetches from `recipe_variants_with_costs` for planned comparisons
- Displays table:
  - Columns: Brew Date, Batch #, Batch Name, Variant, Status, Actual OG, Est OG, Volume
  - Grouped by brew date (showing brew number as group header)
  - Each row links to batch detail
- Performance summary at top:
  - Total batches brewed
  - Avg OG variance vs estimate
  - Links to each batch

**Step 2: Add to recipe entity config**

In `src/entities/recipe.tsx`, import and add section:

```typescript
import { RecipeProductionHistory } from "@/components/domain/recipe-production-history";
```

Add to `detailSections` (after variants, before notes):

```typescript
{
  id: "production-history",
  title: "Production History",
  component: RecipeProductionHistory,
  collapsible: true,
},
```

**Step 3: Commit**

```bash
git add src/components/domain/recipe-production-history.tsx src/entities/recipe.tsx
git commit -m "feat: add production history section to recipe detail"
```

---

### Task 16: Enhance batch detail with recipe context and cost breakdown

**Files:**
- Create: `src/components/domain/batch-recipe-context.tsx`
- Create: `src/components/domain/batch-cost-breakdown.tsx`

**Step 1: Build recipe context component**

Shows the recipe spec this batch was brewed from, highlighting the planned variant.

- Fetches recipe from `recipes_with_estimates` using batch's `recipe_id`
- If `recipe_variant_id` present, fetches variant from `recipe_variants_with_costs`
- Displays collapsible card:
  - Recipe name (linked), style, est OG/FG/ABV/IBU
  - If variant: "Variant: Mosaic Dreams" with planned cold-side additions list
  - Volume comparison: planned vs actual

**Step 2: Build cost breakdown component**

Shows plan vs actual cost comparison.

- Fetches from `recipes_with_cogs` (hot-side planned)
- Fetches from `recipe_variants_with_costs` (variant planned, if applicable)
- Fetches from `batch_additions_with_costs` (actual cold-side)
- Calculates hot-side actual pro-rata from brew log volume allocation
- Displays two-column comparison:
  - Left: Planned (hot-side per BBL × volume + variant additions)
  - Right: Actual (pro-rated hot-side + actual additions)
  - Bottom: Variance absolute and %

**Step 3: Add to batch entity config**

In `src/entities/batch.tsx`:

```typescript
import { BatchRecipeContext } from "@/components/domain/batch-recipe-context";
import { BatchCostBreakdown } from "@/components/domain/batch-cost-breakdown";
```

Add to `detailSections`:

```typescript
{
  id: "recipe-context",
  title: "Recipe",
  component: BatchRecipeContext,
  collapsible: true,
},
{
  id: "cost-breakdown",
  title: "Cost Breakdown",
  component: BatchCostBreakdown,
  collapsible: true,
},
```

**Step 4: Commit**

```bash
git add src/components/domain/batch-recipe-context.tsx src/components/domain/batch-cost-breakdown.tsx src/entities/batch.tsx
git commit -m "feat: add recipe context and cost breakdown to batch detail"
```

---

### Task 17: Enhance brew log detail with split overview

**Files:**
- Create: `src/components/domain/brew-log-split-overview.tsx`

**Step 1: Build the component**

Replaces or enhances the existing `BrewLogBatches` component with a visual split overview.

- Fetches linked batches from `brew_log_batches` joined to `batches` and `recipe_variants`
- Fetches recipe summary from `recipes_with_estimates`
- Displays:
  - Recipe reference: name (linked), volume, est OG
  - Split visual: horizontal bar showing volume splits with batch names
  - Per-batch cards:
    - Name, batch number, variant name (if applicable)
    - Volume allocated
    - Current vessel (if assigned)
    - Current status badge
    - Link to batch detail

**Step 2: Add to brew log entity config**

In `src/entities/brew-log.tsx`, import and add/replace section:

```typescript
import { BrewLogSplitOverview } from "@/components/domain/brew-log-split-overview";
```

Replace or add alongside the existing `batches` section:

```typescript
{
  id: "split-overview",
  title: "Batch Splits",
  component: BrewLogSplitOverview,
},
```

**Step 3: Commit**

```bash
git add src/components/domain/brew-log-split-overview.tsx src/entities/brew-log.tsx
git commit -m "feat: add split overview to brew log detail"
```

---

## Phase 7: Update Data Model Docs

### Task 18: Update production data model documentation

**Files:**
- Modify: `docs/data-model/production.md`

**Step 1: Add documentation for new tables and views**

Add sections documenting:
- `recipe_variants` table and its purpose
- `recipe_variant_hops`, `recipe_variant_adjuncts`, `recipe_variant_fruits`, `recipe_variant_spices` junction tables
- `batch_additions` table
- `recipe_variants_with_costs` view
- `batch_additions_with_costs` view
- Updated `batches` table (new `recipe_variant_id` column)
- The variant → batch linkage workflow

**Step 2: Update CLAUDE.md migration numbering**

In `CLAUDE.md`, update the migration numbering section:

```
Current highest: `00084`
Next available: `00085`
```

**Step 3: Commit**

```bash
git add docs/data-model/production.md CLAUDE.md
git commit -m "docs: update production data model for variants and batch additions"
```

---

## Phase 8: Lint & Verify

### Task 19: Run lint and fix any issues

**Step 1: Run lint**

Run: `pnpm lint`

**Step 2: Fix any lint errors**

Address any TypeScript or ESLint errors in new/modified files.

**Step 3: Commit fixes if needed**

```bash
git add -A
git commit -m "fix: resolve lint errors from cohesion feature"
```

---

## Dependency Graph

```
Task 1 (recipe_variants tables)
  └─ Task 2 (batch_additions + recipe_variant_id)
      └─ Task 3 (cost views)
          └─ Task 4 (regenerate types)
              ├─ Task 5 (query keys)
              │   ├─ Task 7 (variant editor component)
              │   │   └─ Task 8 (add to recipe config)
              │   ├─ Task 9 (wire batch addition form)
              │   │   └─ Task 10 (batch additions display)
              │   │       └─ Task 11 (add to batch config)
              │   └─ Task 12 (start brew day dialog)
              │       └─ Task 13 (add to recipe page)
              │           └─ Task 14 (brew log completion dialog)
              └─ Task 6 (batch entity config update)
                  └─ Task 15 (recipe production history)
                      └─ Task 16 (batch context + cost)
                          └─ Task 17 (brew log split overview)
                              └─ Task 18 (docs)
                                  └─ Task 19 (lint)
```

Tasks 5-6 can run in parallel after Task 4.
Tasks 7, 9, 12 can run in parallel after Task 5.
Tasks 15, 16, 17 can run in parallel after Task 6.

---

## Notes for Implementer

- **Security:** All new tables have RLS enabled with authenticated-user policies, all views use `security_invoker = true`, per project conventions.
- **Existing component:** `BatchAdditionForm` at `src/components/domain/batch-addition-form.tsx` already exists as a UI form with no backing table. Task 9 wires it to the new `batch_additions` table.
- **Cost views:** The `recipes_with_cogs` view already calculates hot-side COGS. The new `recipe_variants_with_costs` view builds on it for variant-level projections. Unit assumptions match the existing pattern (see migration `00021` comments).
- **Entity registration:** If the project uses `registerEntity()` in a central registry file, new entities (`recipe_variant`) need to be registered there too.
- **Catalog cost columns:** The cost views assume `cost_per_lb` on hops, adjuncts, fruits and `cost_per_unit` on spices. Verify these columns exist in the catalog tables before deploying.
