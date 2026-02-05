# Recipe, Batch & Brew Log Cohesion Design

## Problem

Recipes, batches, and brew logs are structurally connected but the UX is fragmented. Moving between them requires too many manual steps, cross-entity visibility is poor, and the common workflow of brewing a recipe and splitting into multiple batches with cold-side variations is not well supported.

## Key Insights from Discovery

- **The batch is the product identity** — splits from one brew often become entirely different beers with different names
- **Recipes are hot-side blueprints** — they define the brew day spec, but cold-side diverges per batch
- **Split brews are common** — one brew regularly produces 2+ batches with different dry hops, adjuncts, or yeast
- **Cost projection matters at every level** — recipe-level for planning, variant-level for per-product COGS, batch-level for actuals vs plan
- **Vessel assignment triggers fermentation** — no batch enters "fermenting" without a vessel; assignment is the physical trigger

## Design: Hybrid — Recipe Split Templates + Batch Identity

Recipes get an optional "split template" — planned cold-side variations with ingredient detail for cost projection. Batches track actual cold-side additions and link back to their planned variant for plan vs actual comparison.

---

## 1. Data Model Changes

### 1.1 Recipe Variants (Split Templates)

New table for planned cold-side variations:

```sql
recipe_variants (
  id UUID PRIMARY KEY,
  recipe_id UUID REFERENCES recipes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,              -- the beer name, e.g. "Mosaic Dreams"
  description TEXT,                -- what makes this variant different
  position INT NOT NULL DEFAULT 0, -- ordering
  planned_volume_bbl DECIMAL,      -- expected volume for this split
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
)
```

Each variant gets cold-side addition tables:

```sql
recipe_variant_hops (
  id UUID PRIMARY KEY,
  recipe_variant_id UUID REFERENCES recipe_variants(id) ON DELETE CASCADE,
  hop_id UUID REFERENCES hops(id),
  weight_oz DECIMAL NOT NULL,
  timing TEXT DEFAULT 'dry_hop',   -- dry_hop, secondary, etc.
  days INT,                        -- days into fermentation
  position INT NOT NULL DEFAULT 0
)

recipe_variant_adjuncts (
  id UUID PRIMARY KEY,
  recipe_variant_id UUID REFERENCES recipe_variants(id) ON DELETE CASCADE,
  adjunct_id UUID REFERENCES adjuncts(id),
  amount DECIMAL NOT NULL,
  unit TEXT NOT NULL,
  timing TEXT,
  position INT NOT NULL DEFAULT 0
)

-- Same pattern for: recipe_variant_fruits, recipe_variant_spices
```

### 1.2 Batch Linkage

Add to `batches` table:

```sql
ALTER TABLE batches ADD COLUMN recipe_variant_id UUID
  REFERENCES recipe_variants(id) ON SET NULL;
```

Nullable — not every batch comes from a planned split.

### 1.3 Batch Actual Additions

New polymorphic table for what actually went into the batch (cold-side):

```sql
batch_additions (
  id UUID PRIMARY KEY,
  batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
  addition_type TEXT NOT NULL,     -- hop, adjunct, fruit, spice, yeast, other
  catalog_id UUID,                 -- FK to relevant catalog table
  catalog_table TEXT,              -- "hops", "adjuncts", etc.
  name TEXT NOT NULL,              -- display name (denormalized)
  amount DECIMAL NOT NULL,
  unit TEXT NOT NULL,
  timing TEXT,                     -- dry_hop, secondary, packaging, etc.
  days INT,                        -- days into fermentation
  date_added DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
)
```

Single polymorphic table since batch additions are more ad-hoc than recipe specs.

---

## 2. Cost Projection Model

### 2.1 Recipe Variant Costs (New View)

```
recipe_variants_with_costs
  - All recipe_variant fields
  - hot_side_cost_per_bbl: total recipe hot-side COGS / recipe volume_bbl
  - variant_addition_cost: sum of planned cold-side addition costs
  - est_total_cost: (hot_side_cost_per_bbl * planned_volume_bbl) + variant_addition_cost
  - est_cost_per_bbl: est_total_cost / planned_volume_bbl
```

### 2.2 Brew-Level Cost Summary (New View)

```
recipe_brew_cost_summary
  - recipe_id
  - total_hot_side_cost: grain + boil hops + water + energy
  - total_cold_side_cost: sum across all variants
  - total_brew_cost: hot + cold
  - cost_by_variant[]: breakdown per variant
```

### 2.3 Batch Actual Cost (New View)

```
batch_actual_cost
  - batch_id
  - recipe_variant_id (if linked)
  - planned_cost_per_bbl (from recipe variant)
  - actual_hot_side_cost (from brew log, pro-rated by volume allocation)
  - actual_cold_side_cost (from batch_additions, using catalog prices)
  - actual_total_cost
  - actual_cost_per_bbl
  - variance_pct: (actual - planned) / planned
```

---

## 3. UX Flow: "Start Brew Day"

### 3.1 Trigger Points

- From recipe detail: "Start Brew Day" button
- From batch list: "New Brew" action
- From brew log list: "New Brew Log" (enhanced)

### 3.2 Guided Flow (from Recipe)

**Step 1: Confirm Recipe & Date**
- Pre-filled: recipe name, today's date
- Select brewer
- Shows recipe summary: volume, estimated OG, grain bill highlights

**Step 2: Configure Splits**
- If recipe has variants: pre-populated with variant names and planned volumes
- User can adjust volumes, add/remove splits on the fly
- If no variants: defaults to single batch with "Add Split" option
- Each split shows: name, planned volume, cold-side additions summary
- Optional vessel picker per split (filtered to available vessels of appropriate size)
- Shows vessel availability inline: name, capacity, current status

**Step 3: Review & Create**
- Summary of what will be created:
  - 1 Brew Log (draft status, linked to recipe)
  - N Batches (planned status, each linked to brew log via brew_log_batches, each linked to recipe_variant_id)
  - Optional vessel pre-assignments
- Confirm → creates everything in one transaction
- Redirects to brew log detail page

### 3.3 Vessel Assignment & Status Transitions

**Pre-assignment (optional):** During Step 2, pick target vessels per split.

**At brew log completion:** Before brew log can transition to `completed`:
- System checks: do all batches have vessel assignments?
- Missing → prompt to assign
- Pre-assigned → confirm or change
- Confirming triggers (in transaction):
  1. `vessel_transfer` records created per batch
  2. Batch statuses transition `planned` → `fermenting`
  3. Vessel statuses update

**The rule:** No batch enters `fermenting` without a vessel assignment. The vessel assignment is the trigger.

---

## 4. Cross-Entity Visibility

### 4.1 Recipe Detail Page (Enhanced)

Add:
- **Variants section** — cards showing each planned variant with cold-side additions and projected cost/bbl
- **Production History tab** — all batches from this recipe, grouped by brew date: batch name, variant, actual OG vs estimated, actual cost vs projected, status
- **Performance summary** — aggregate stats: N batches brewed, avg OG variance, avg cost variance

### 4.2 Batch Detail Page (Enhanced)

Add:
- **Recipe context panel** — collapsible, shows recipe spec and planned variant vs actual
- **Cold-side additions section** — structured list from batch_additions with plan vs actual comparison when linked to variant
- **Cost breakdown** — planned vs actual: hot-side (pro-rated from brew) + cold-side (from batch additions)
- **Unified timeline** — combines brew day events (from brew log) + batch milestones (vessel transfers, additions, readings, status changes)

### 4.3 Brew Log Detail Page (Enhanced)

Add:
- **Recipe reference** — inline summary of recipe being brewed, with link
- **Split overview** — visual showing volume splits, vessel assignments, batch names, current status
- **Hot-side cost summary** — total ingredients used vs recipe estimate

---

## 5. Recipes Without Variants

For simple 1:1 brews (one recipe → one batch, no splits):
- No variants need to be defined
- "Start Brew Day" flow defaults to a single batch
- batch_additions table still used for any cold-side additions
- No recipe_variant_id on the batch — it references the recipe directly via recipe_id
- Cost comparison works against the base recipe estimates

Variants are purely additive — they enhance the recipe for split scenarios without complicating the simple case.
