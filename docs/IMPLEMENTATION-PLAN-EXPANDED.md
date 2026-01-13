# MGR Implementation Plan - Expanded Edition

> **Purpose**: One-shot implementation guide with detailed specs, file references, and completion criteria
> **Generated**: January 2026
> **Status**: Active
> **Branch**: `feature/implementation-plan`

---

## Document Structure

Each phase contains:
- **Overview**: Goals and scope
- **Dependencies**: What must be complete first
- **Reference Files**: Existing code to use as patterns
- **Implementation Steps**: Detailed task breakdown with file paths
- **Database Changes**: Migrations required (if any)
- **Completion Criteria**: How to verify the phase is complete

---

## Quick Reference: Key Patterns

### Entity Configuration Pattern
All entities follow the same structure. Reference: `src/entities/batch.tsx`

```typescript
export const entityEntity: EntityConfig<EntityType> = {
  // Identity
  name: "entity_name",
  table: "table_name",
  viewTable: "view_name",  // Optional: for computed fields
  displayName: "Entity",
  displayNamePlural: "Entities",
  description: "...",
  domain: "production" | "inventory" | "sales" | "purchasing",

  // List View
  listColumns: [...],
  listFilters: [...],
  defaultSort: { column: "...", direction: "asc" | "desc" },
  searchableFields: [...],

  // Detail View
  detailHeader: { title: "field", subtitle: "field", badge: "status_field" },
  detailSections: [...],

  // Form
  formSchema: zodSchema,
  formFields: [...],

  // State Machine (if applicable)
  stateMachine: { stateField, states, transitions, stateDisplay },
  actions: [...],

  // Relations
  relations: [...],

  // AI Context
  queryExamples: [...],
  keyFields: [...],
};
```

### Page Pattern
All entity pages use universal components. Reference: `src/app/(app)/production/batches/`

```
/[domain]/[entity-plural]/
  page.tsx         -> <EntityList entity={config} />
  new/page.tsx     -> <EntityForm entity={config} />
  [id]/page.tsx    -> <EntityDetail entity={config} id={id} />
  [id]/edit/page.tsx -> <EntityForm entity={config} id={id} />
```

### Migration Naming
Pattern: `00XXX_description.sql`
Current highest: `00014`
Next available: `00015`

---

## Phase 1: Schema Foundation [COMPLETE]

### Overview
Establish core data model patterns that other features depend on.

### Status: Complete
All migrations applied, seed data created, UI components built.

### Completion Evidence
- [x] Migration `00011_catalog_and_recipe_junction.sql` exists and applied
- [x] Migration `00012_performance_indexes.sql` exists and applied
- [x] `recipes_with_estimates` view calculates OG, FG, ABV, IBU, SRM
- [x] `src/components/domain/grain-bill-editor.tsx` exists
- [x] `src/components/domain/hop-schedule-editor.tsx` exists
- [x] Recipe entity uses `viewTable: "recipes_with_estimates"`
- [x] Recipe form fields use `dynamicOptions` for catalog selects

### Known Issues to Address
1. `recipes_with_estimates` view should join `beer_styles` for `style_name` display
   - Current: Shows "—" in list view
   - Fix: Migration to add `bs.name as style_name` join

---

## Phase 2: Production Workflow [IN PROGRESS]

### Overview
Complete the recipe → batch → brew log → vessel workflow.

### Dependencies
- Phase 1 (Complete)

### Reference Files
| Pattern | Reference File |
|---------|----------------|
| Entity config with state machine | `src/entities/batch.tsx` |
| Entity config with viewTable | `src/entities/vessel.tsx` |
| Domain component | `src/components/domain/grain-bill-editor.tsx` |
| Entity pages | `src/app/(app)/production/batches/` |

### Current Status
- [x] 2.1 Vessel Entity - Complete
- [x] 2.2 Brew Log Pages - Complete (basic CRUD)
- [ ] 2.2.1 Batch Readings UI - Not Started
- [ ] 2.2.2 Batch Additions UI - Not Started
- [ ] 2.3 Batch-Brew Log Linking - Not Started
- [ ] 2.4 Vessel Transfers - Not Started

---

### 2.2.1 Batch Readings UI (Mobile-First)

#### Purpose
Record fermentation metrics (gravity, temp, pH, pressure, DO, diacetyl, clarity) optimized for tablet/phone use on brewery floor.

#### Database Changes
No new tables required. Uses existing `batch_logs` table with structured event data.

Schema for batch reading entry in `batch_logs.event_data`:
```typescript
interface BatchReading {
  reading_type: 'gravity' | 'temperature' | 'ph' | 'pressure' | 'dissolved_oxygen' | 'diacetyl' | 'clarity';
  value: number;
  unit: string;
  timestamp: string;
  notes?: string;
}
```

#### Implementation Steps

**Step 1: Create Reading Types and Validation**
File: `src/lib/batch-readings.ts`

```typescript
// Define reading types with validation ranges and units
export const READING_TYPES = {
  gravity: {
    label: 'Gravity',
    units: ['sg', 'plato'],
    defaultUnit: 'plato',
    min: 0,
    max: 40,  // Plato
    warningRanges: { low: 0, high: 25 },
  },
  temperature: {
    label: 'Temperature',
    units: ['f', 'c'],
    defaultUnit: 'f',
    min: 32,
    max: 100,  // °F
    warningRanges: { low: 55, high: 85 },  // Fermentation range
  },
  ph: {
    label: 'pH',
    units: ['ph'],
    defaultUnit: 'ph',
    min: 0,
    max: 14,
    warningRanges: { low: 3.5, high: 5.0 },
  },
  pressure: {
    label: 'Pressure',
    units: ['psi'],
    defaultUnit: 'psi',
    min: 0,
    max: 50,
    warningRanges: { low: 0, high: 30 },
  },
  dissolved_oxygen: {
    label: 'Dissolved Oxygen',
    units: ['ppb'],
    defaultUnit: 'ppb',
    min: 0,
    max: 1000,
    warningRanges: { low: 0, high: 50 },
  },
  diacetyl: {
    label: 'Diacetyl',
    units: ['status'],
    defaultUnit: 'status',
    options: ['absent', 'trace', 'present'],
  },
  clarity: {
    label: 'Clarity',
    units: ['scale', 'ntu'],
    defaultUnit: 'scale',
    min: 1,
    max: 5,
  },
};

export function validateReading(type: string, value: number): { valid: boolean; warning?: string } {
  const config = READING_TYPES[type];
  if (!config) return { valid: false, warning: 'Unknown reading type' };

  if (value < config.min || value > config.max) {
    return { valid: false, warning: `Value out of range (${config.min}-${config.max})` };
  }

  if (config.warningRanges) {
    if (value < config.warningRanges.low || value > config.warningRanges.high) {
      return { valid: true, warning: 'Value outside typical range' };
    }
  }

  return { valid: true };
}
```

**Step 2: Create Batch Reading Form Component**
File: `src/components/domain/batch-reading-form.tsx`

```typescript
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { READING_TYPES, validateReading } from "@/lib/batch-readings";

const readingSchema = z.object({
  reading_type: z.enum(['gravity', 'temperature', 'ph', 'pressure', 'dissolved_oxygen', 'diacetyl', 'clarity']),
  value: z.coerce.number(),
  unit: z.string(),
  timestamp: z.string(),
  notes: z.string().optional(),
});

interface BatchReadingFormProps {
  batchId: string;
  onSubmit: (data: z.infer<typeof readingSchema>) => Promise<void>;
  onCancel?: () => void;
}

export function BatchReadingForm({ batchId, onSubmit, onCancel }: BatchReadingFormProps) {
  const [selectedType, setSelectedType] = useState<string>('gravity');
  const config = READING_TYPES[selectedType];

  const form = useForm({
    resolver: zodResolver(readingSchema),
    defaultValues: {
      reading_type: 'gravity',
      value: 0,
      unit: config?.defaultUnit || '',
      timestamp: new Date().toISOString().slice(0, 16),
      notes: '',
    },
  });

  // ... form implementation with large touch-friendly inputs
  // Use min-h-[48px] for all interactive elements
  // Use text-lg for input text size
}
```

**Step 3: Create Readings Page**
File: `src/app/(app)/production/batches/[id]/readings/page.tsx`

```typescript
"use client";

import { use } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { BatchReadingForm } from "@/components/domain/batch-reading-form";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function BatchReadingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  // Fetch batch details
  const { data: batch } = useQuery({
    queryKey: ['batch', id],
    queryFn: async () => {
      const { data } = await supabase.from('batches').select('*').eq('id', id).single();
      return data;
    },
  });

  // Fetch readings from batch_logs
  const { data: readings } = useQuery({
    queryKey: ['batch-readings', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('batch_logs')
        .select('*')
        .eq('batch_id', id)
        .eq('event_type', 'reading')
        .order('created_at', { ascending: false });
      return data;
    },
  });

  // Add reading mutation
  const addReading = useMutation({
    mutationFn: async (reading) => {
      const { data, error } = await supabase
        .from('batch_logs')
        .insert({
          batch_id: id,
          event_type: 'reading',
          event_data: reading,
        });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-readings', id] });
      setShowForm(false);
    },
  });

  return (
    <div className="container max-w-2xl py-6">
      {/* Mobile-optimized header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">{batch?.name}</h1>
          <p className="text-muted-foreground">Fermentation Readings</p>
        </div>
        <Button size="lg" onClick={() => setShowForm(true)}>
          <Plus className="h-5 w-5 mr-2" />
          Add Reading
        </Button>
      </div>

      {/* Form overlay for mobile */}
      {showForm && (
        <BatchReadingForm
          batchId={id}
          onSubmit={addReading.mutateAsync}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Readings list with inline editing */}
      <div className="space-y-4">
        {readings?.map((reading) => (
          <ReadingCard key={reading.id} reading={reading} />
        ))}
      </div>
    </div>
  );
}
```

**Step 4: Create Readings Chart Visualization**
File: `src/components/domain/readings-chart.tsx`

Use a charting library (recharts or similar) to display:
- Gravity curve over time with target FG line
- Temperature profile with fermentation schedule overlay
- Multi-metric overlay option

#### Completion Criteria
- [ ] `src/lib/batch-readings.ts` exists with reading types and validation
- [ ] `src/components/domain/batch-reading-form.tsx` renders touch-friendly form
- [ ] `src/app/(app)/production/batches/[id]/readings/page.tsx` exists
- [ ] Reading form validates input ranges and shows warnings
- [ ] Readings list displays with chronological order
- [ ] Chart visualization shows gravity curve with target line
- [ ] Mobile viewport (< 768px) has optimized layout
- [ ] All interactive elements are minimum 48px height for touch

---

### 2.2.2 Batch Additions UI

#### Purpose
Record additions during fermentation (dry hops, fruit, adjuncts, finings).

#### Database Changes
No new tables. Uses `batch_logs` with event_type = 'addition'.

Schema for addition entry:
```typescript
interface BatchAddition {
  addition_type: 'dry_hop' | 'fruit' | 'adjunct' | 'fining' | 'other';
  ingredient_id?: string;  // Optional reference to catalog
  ingredient_name: string;
  quantity: number;
  unit: string;
  timestamp: string;
  contact_time_hours?: number;  // For dry hops
  notes?: string;
}
```

#### Implementation Steps

**Step 1: Create Addition Form Component**
File: `src/components/domain/batch-addition-form.tsx`

Reference `src/components/domain/grain-bill-editor.tsx` for ingredient selector pattern.

Features:
- Addition type selector (dry_hop, fruit, adjunct, fining, other)
- Ingredient selector from catalog (hops, fruits, adjuncts tables) or free-text
- Weight/quantity input with unit conversion
- Timestamp with default to now
- Duration field for dry hops (contact time)
- Notes field

**Step 2: Create Additions Page**
File: `src/app/(app)/production/batches/[id]/additions/page.tsx`

Features:
- List of additions with timing
- Quick-add from recipe's planned dry hops
- Variance tracking (planned vs actual quantities)
- IBU contribution display for dry hops

**Step 3: Link to Recipe Expectations**
- Query `recipe_hops` where timing = 'dry_hop' for the batch's recipe
- Show planned vs actual side-by-side
- Highlight deviations from plan

#### Completion Criteria
- [ ] `src/components/domain/batch-addition-form.tsx` exists
- [ ] `src/app/(app)/production/batches/[id]/additions/page.tsx` exists
- [ ] Can add dry hop with contact time
- [ ] Can add fruit/adjunct/fining/other
- [ ] Ingredient selector searches catalog tables
- [ ] Free-text fallback for unlisted ingredients
- [ ] Recipe's planned dry hops shown for comparison
- [ ] Variance displayed when actual differs from planned

---

### 2.3 Batch-Brew Log Linking

#### Purpose
Connect brew logs to batches via `brew_log_batches` junction table. Support split fermentation (1 brew → multiple batches).

#### Reference
- Table: `brew_log_batches` (exists in migration 00004)
- View: `batches_with_brew_info` (exists in migration 00005)

#### Implementation Steps

**Step 1: Update Batch Detail to Show Linked Brew Data**
File: `src/entities/batch.tsx`

Add relation to brew_logs:
```typescript
relations: [
  {
    name: "brew_logs",
    entity: "brew_log",
    type: "hasManyThrough",
    through: "brew_log_batches",
    foreignKey: "batch_id",
    showInDetail: true,
    detailTab: "Brew Logs",
  },
  // ... existing relations
],
```

Add computed fields from `batches_with_brew_info` view:
```typescript
viewTable: "batches_with_brew_info",

detailSections: [
  {
    id: "brew_info",
    title: "Brew Information",
    fields: [
      { field: "brew_date", label: "Brew Date", format: "date" },
      { field: "actual_og", label: "Actual OG" },
      { field: "brewer_name", label: "Brewer" },
    ],
  },
  // ... existing sections
],
```

**Step 2: Create Brew Log Linking UI**
File: `src/components/domain/brew-log-linker.tsx`

Features:
- Select existing brew log to link
- Support multiple batches per brew log (split fermentation)
- Volume allocation per batch

**Step 3: Add "Start Fermentation" Action to Batch**
In batch entity actions:
```typescript
actions: [
  {
    name: "start_fermentation",
    label: "Start Fermentation",
    fromStates: ["planned"],
    toState: "fermenting",
    dialog: {
      title: "Start Fermentation",
      fields: [
        { name: "brew_log_id", type: "select", label: "Brew Log", required: true },
        { name: "vessel_id", type: "select", label: "Vessel", required: true },
      ],
    },
    handler: async (batch, data) => {
      // 1. Link brew log via brew_log_batches
      // 2. Create vessel_transfer record
      // 3. Update batch status to fermenting
    },
  },
],
```

#### Completion Criteria
- [ ] Batch detail shows brew date, actual OG, brewer from linked brew log
- [ ] Batch uses `batches_with_brew_info` view for display
- [ ] Can link multiple batches to single brew log (split fermentation)
- [ ] Volume allocation tracked per batch in junction table
- [ ] "Start Fermentation" action prompts for vessel and brew log

---

### 2.4 Vessel Transfers

#### Purpose
Track batch movement through vessels (fermenter → brite, etc.).

#### Reference
- Table: `vessel_transfers` (exists in migration 00006)
- View: `vessels_with_batch` (exists in migration 00006)

#### Implementation Steps

**Step 1: Create Vessel Transfer Recording UI**
File: `src/components/domain/vessel-transfer-form.tsx`

Fields:
- From vessel (auto-populated if transferring specific batch)
- To vessel (filtered to available vessels)
- Volume transferred (BBL)
- Transfer date/time
- Notes

**Step 2: Update Vessel Status Based on Transfers**

When transfer completes:
- Source vessel: If fully emptied, set status to "dirty"
- Destination vessel: Set status to "in_use", update current_batch_id

**Step 3: Create Vessel History View**
File: `src/app/(app)/production/vessels/[id]/history/page.tsx`

Query `vessel_transfers` for all transfers involving this vessel.
Display timeline of batches that have used this vessel.

**Step 4: Create Batch Vessel History**
Add section to batch detail showing all vessels the batch has occupied.

Query pattern:
```sql
SELECT vt.*, v.name as vessel_name
FROM vessel_transfers vt
JOIN vessels v ON v.id = vt.to_vessel_id
WHERE vt.batch_id = $1
ORDER BY vt.transfer_date DESC;
```

#### Completion Criteria
- [ ] `src/components/domain/vessel-transfer-form.tsx` exists
- [ ] Can record transfer from vessel A to vessel B
- [ ] Source vessel status updates to "dirty" when emptied
- [ ] Destination vessel status updates to "in_use"
- [ ] Vessel detail shows batch history
- [ ] Batch detail shows vessel history
- [ ] Transfer date/time recorded
- [ ] Volume transferred tracked

---

## Phase 2.5: Recipe Builder Completion [NOT STARTED]

### Overview
Complete the full recipe builder with all ingredient types, schedules, and water chemistry.

### Dependencies
- Phase 1 (Complete)

### Reference Files
| Pattern | Reference File |
|---------|----------------|
| Ingredient editor | `src/components/domain/grain-bill-editor.tsx` |
| Catalog table query | `src/components/domain/hop-schedule-editor.tsx` |

---

### 2.5.1 Additional Ingredient Editors

#### Purpose
Create editors for adjuncts, sugars, spices, fruits, and recipe additions (water chemistry).

#### Implementation Steps

**Adjunct Editor**
File: `src/components/domain/adjunct-editor.tsx`

Copy pattern from `grain-bill-editor.tsx`:
- Query `adjuncts` catalog table
- Fields: adjunct_id, weight_lbs, timing (mash/boil/fermentation), notes
- Save to `recipe_adjuncts` junction table

**Sugar Editor**
File: `src/components/domain/sugar-editor.tsx`

- Query `sugars` catalog table
- Fields: sugar_id, weight_lbs, timing
- Calculate gravity contribution (use PPG similar to malts)
- Save to `recipe_sugars`

**Spice Editor**
File: `src/components/domain/spice-editor.tsx`

- Query `spices` catalog table
- Fields: spice_id, weight_oz, timing
- Save to `recipe_spices`

**Fruit Editor**
File: `src/components/domain/fruit-editor.tsx`

- Query `fruits` catalog table
- Fields: fruit_id, weight_lbs, timing
- Save to `recipe_fruits`

**Additions Editor (Water Chemistry)**
File: `src/components/domain/recipe-additions-editor.tsx`

- Query `additives` catalog table (filtered by type: salt, clarifier, nutrient)
- Fields: additive_id, quantity, unit, timing
- Show ion contribution for salts (gypsum adds calcium + sulfate)
- Save to `recipe_additions`

#### Completion Criteria
- [ ] Each editor component exists and follows grain-bill-editor pattern
- [ ] Each editor queries appropriate catalog table
- [ ] Each editor saves to correct junction table
- [ ] Can add, remove, reorder items
- [ ] Timing selection works (mash/boil/fermentation)

---

### 2.5.2 Mash Schedule Builder

#### Purpose
Multi-step mash with rest temperatures and times.

#### Database Changes
Option A: Add `mash_schedule` JSONB column to recipes table
Option B: Create `recipe_mash_steps` junction table

Recommend Option A (JSONB) for simplicity:
```sql
ALTER TABLE recipes ADD COLUMN mash_schedule JSONB DEFAULT '[]';
```

Schema:
```typescript
interface MashStep {
  name: string;
  target_temp_f: number;
  rest_time_min: number;
  water_volume_gal?: number;
}
```

#### Implementation Steps

**Step 1: Create Mash Schedule Editor**
File: `src/components/domain/mash-schedule-editor.tsx`

Features:
- Add/remove/reorder mash steps
- Per-step: name, target temp, rest time
- Presets button: Single Infusion, Step Mash, Decoction
- Water volume calculations per step
- Total mash time display

**Step 2: Add to Recipe Form**
Include `MashScheduleEditor` in recipe form/detail.

#### Completion Criteria
- [ ] Migration adds `mash_schedule` JSONB column to recipes
- [ ] `src/components/domain/mash-schedule-editor.tsx` exists
- [ ] Can add multiple mash steps with name, temp, time
- [ ] Can reorder steps
- [ ] Presets populate common mash schedules
- [ ] Recipe detail displays mash schedule
- [ ] Recipe form includes mash schedule editor

---

### 2.5.3 Fermentation Schedule Builder

#### Purpose
Temperature ramps and dry hop timing.

#### Database Changes
Add `fermentation_schedule` JSONB column (if not already exists):
```sql
ALTER TABLE recipes ADD COLUMN fermentation_schedule JSONB DEFAULT '[]';
```

Schema:
```typescript
interface FermentationStep {
  name: string;
  target_temp_f: number;
  duration_days: number;
  notes?: string;
  dry_hop_link?: string;  // Link to hop schedule entry
}
```

#### Implementation Steps

**Step 1: Create Fermentation Schedule Editor**
File: `src/components/domain/fermentation-schedule-editor.tsx`

Features:
- Add/remove/reorder fermentation steps
- Per-step: name, target temp, duration
- Integration with dry hop entries from hop schedule
- Common steps: Primary, Diacetyl Rest, Cold Crash, Conditioning

**Step 2: Link Dry Hops**
When hop schedule has dry_hop timing entries, show them in fermentation schedule for timing placement.

#### Completion Criteria
- [ ] Migration adds `fermentation_schedule` if needed
- [ ] `src/components/domain/fermentation-schedule-editor.tsx` exists
- [ ] Can add temperature ramps with duration
- [ ] Dry hops from recipe appear in schedule for timing
- [ ] Cold crash and conditioning steps supported
- [ ] Recipe detail displays fermentation schedule

---

### 2.5.4 Water Chemistry Calculator

#### Purpose
Target water profile and additions calculation.

#### Implementation Steps

**Step 1: Create Water Chemistry Library**
File: `src/lib/water-chemistry.ts`

```typescript
// Ion contributions per gram per gallon
export const SALT_CONTRIBUTIONS = {
  gypsum: { calcium: 61.5, sulfate: 147.4 },  // CaSO4
  calcium_chloride: { calcium: 72, chloride: 127 },  // CaCl2
  epsom_salt: { magnesium: 26, sulfate: 103 },  // MgSO4
  baking_soda: { sodium: 75, bicarbonate: 191 },  // NaHCO3
  chalk: { calcium: 106, carbonate: 158 },  // CaCite
  // ... more salts
};

export function calculateAdditions(
  sourceProfile: WaterProfile,
  targetProfile: WaterProfile,
  volumeGal: number
): SaltAdditions {
  // Calculate delta between source and target
  // Solve for salt quantities to match target
  // Return grams of each salt needed
}

export function calculateSulfateChlorideRatio(profile: WaterProfile): number {
  return profile.sulfate_ppm / profile.chloride_ppm;
}

export function estimateMashPH(
  waterProfile: WaterProfile,
  grainBill: GrainBillItem[],
  mashVolume: number
): number {
  // Use residual alkalinity calculation
  // Factor in grain color/acidity
}
```

**Step 2: Create Water Chemistry Calculator Component**
File: `src/components/domain/water-chemistry-calculator.tsx`

Features:
- Source water profile input (or select from saved profiles)
- Target water profile selection
- Auto-calculate additions needed
- Display sulfate:chloride ratio with style guidance
- Mash pH estimation
- Link results to recipe_additions

#### Completion Criteria
- [ ] `src/lib/water-chemistry.ts` exists with ion calculations
- [ ] `src/components/domain/water-chemistry-calculator.tsx` exists
- [ ] Can select source and target water profiles
- [ ] Calculates required salt additions
- [ ] Displays sulfate:chloride ratio
- [ ] Estimates mash pH
- [ ] Can save calculated additions to recipe

---

### 2.5.5 Recipe Templates

#### Purpose
Support for template recipes with variable ingredients.

#### Database Changes
```sql
ALTER TABLE recipes ADD COLUMN is_template BOOLEAN DEFAULT false;
```

#### Implementation Steps

**Step 1: Add Template Toggle**
In recipe form, add toggle for `is_template`.

**Step 2: Support Variable Ingredient Slots**
In junction tables, allow `ingredient_id` to be null for variable slots:
- Variable slots marked with `is_variable: true` in recipe data
- Display as "[Select Malt]" or similar placeholder

**Step 3: Clone from Template Action**
Add action to recipe detail:
- Copy all recipe data
- Prompt user to fill variable ingredient slots
- Link to brand
- Create as non-template recipe

**Step 4: Filter Templates in List**
Add filter to recipe list: "Show Templates" / "Hide Templates"

#### Completion Criteria
- [ ] Migration adds `is_template` column
- [ ] Recipe form has template toggle
- [ ] Variable ingredient slots supported in junction tables
- [ ] "Clone from Template" action exists
- [ ] Clone prompts for variable ingredients
- [ ] Template filter in recipe list

---

### 2.5.6 Recipe COGS Calculation

#### Purpose
Calculate estimated cost of goods sold from ingredient costs.

#### Implementation Steps

**Step 1: Update View or Create New View**
Add COGS calculation to `recipes_with_estimates` or create `recipes_with_cogs`:

```sql
CREATE VIEW recipes_with_cogs AS
SELECT
  r.*,
  -- Malt cost
  (SELECT SUM(rm.weight_lbs * COALESCE(m.cost_per_lb, 0))
   FROM recipe_malts rm
   JOIN malts m ON m.id = rm.malt_id
   WHERE rm.recipe_id = r.id) as malt_cost,
  -- Hop cost
  (SELECT SUM(rh.weight_oz * COALESCE(h.cost_per_oz, 0))
   FROM recipe_hops rh
   JOIN hops h ON h.id = rh.hop_id
   WHERE rh.recipe_id = r.id) as hop_cost,
  -- Yeast cost
  COALESCE(y.cost_per_unit, 0) as yeast_cost,
  -- Total COGS
  -- ... sum all ingredient costs
FROM recipes r
LEFT JOIN yeasts y ON y.id = r.yeast_id;
```

**Step 2: Add Cost Fields to Catalog Tables**
Ensure catalog tables have cost columns:
- `malts.cost_per_lb`
- `hops.cost_per_oz`
- `yeasts.cost_per_unit`
- etc.

**Step 3: Display in Recipe Detail**
Add COGS section showing:
- Cost breakdown by ingredient type
- Total estimated COGS per batch
- COGS per BBL

#### Completion Criteria
- [ ] Catalog tables have cost columns
- [ ] View calculates ingredient costs
- [ ] Recipe detail shows COGS breakdown
- [ ] COGS per BBL displayed

---

## Phase 3: Packaging & Inventory [NOT STARTED]

### Overview
Complete batch → packaging → finished goods → inventory flow.

### Dependencies
- Phase 2 (vessel transfers complete)

### Reference Files
- Existing allocations: `supabase/migrations/00010_unified_allocations.sql`
- Unified allocations pattern: See migration 00010 for table structure

---

### 3.1 Unified Allocations Table

#### Status
Already implemented in migration 00010. Tables exist:
- `allocations` (unified, polymorphic)
- `finished_goods`
- `packaging_sessions`
- `bins`
- `bin_inventory`

#### Verification
Run query to confirm:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('allocations', 'finished_goods', 'packaging_sessions', 'bins');
```

---

### 3.2 Packaging Session Entity

#### Purpose
Track packaging runs (kegging, canning, bottling).

#### Implementation Steps

**Step 1: Create Entity Config**
File: `src/entities/packaging-session.tsx`

```typescript
// Reference: batch.tsx for state machine pattern

export const packagingSessionEntity: EntityConfig<PackagingSession> = {
  name: "packaging_session",
  table: "packaging_sessions",
  displayName: "Packaging Session",
  displayNamePlural: "Packaging Sessions",
  description: "Track kegging, canning, and bottling runs",
  domain: "production",

  listColumns: [
    { accessorKey: "session_number", header: "Session #", sortable: true },
    { accessorKey: "session_date", header: "Date", sortable: true, format: "date" },
    { accessorKey: "status", header: "Status", sortable: true },
    { accessorKey: "batch_id", header: "Batch" },
  ],

  stateMachine: {
    stateField: "status",
    states: ["planned", "in_progress", "completed", "revised"],
    initialState: "planned",
    transitions: {
      planned: ["in_progress"],
      in_progress: ["completed"],
      completed: ["revised"],
      revised: [],
    },
    stateDisplay: {
      planned: { label: "Planned", color: "default" },
      in_progress: { label: "In Progress", color: "info" },
      completed: { label: "Completed", color: "success" },
      revised: { label: "Revised", color: "warning" },
    },
  },

  formFields: [
    { name: "session_number", label: "Session Number", type: "text", required: true },
    { name: "session_date", label: "Date", type: "date", required: true },
    { name: "batch_id", label: "Batch", type: "select", dynamicOptions: { table: "batches", valueField: "id", labelField: "batch_number" } },
    { name: "notes", label: "Notes", type: "textarea" },
  ],

  relations: [
    { name: "batch", entity: "batch", type: "belongsTo", foreignKey: "batch_id" },
    { name: "line_items", entity: "session_line_item", type: "hasMany", foreignKey: "session_id" },
  ],
};
```

**Step 2: Register Entity**
File: `src/entities/index.ts`

```typescript
import { packagingSessionEntity } from "./packaging-session";

// Add to entities object
packaging_session: packagingSessionEntity,
```

**Step 3: Create Pages**
Directory: `src/app/(app)/production/packaging/`

```
packaging/
  page.tsx              -> EntityList
  new/page.tsx          -> EntityForm
  [id]/page.tsx         -> EntityDetail
  [id]/edit/page.tsx    -> EntityForm
```

**Step 4: Create Line Items UI**
File: `src/components/domain/packaging-line-items.tsx`

Features:
- Add package format (from package_types table)
- Quantity produced
- Target bin/location
- Multiple formats per session (e.g., kegs + cans from same batch)

**Step 5: Add to Sidebar**
File: `src/components/domain/app-sidebar.tsx`

Add under Production:
```typescript
{ label: "Packaging", href: "/production/packaging", icon: Package },
```

#### Completion Criteria
- [ ] `src/entities/packaging-session.tsx` exists with state machine
- [ ] Entity registered in `src/entities/index.ts`
- [ ] All 4 CRUD pages created
- [ ] Line items component allows multiple package formats
- [ ] Packaging link in sidebar under Production
- [ ] Can create packaging session from batch
- [ ] Session completion creates finished_goods records

---

### 3.3 Finished Goods Entity

#### Purpose
View and manage packaged inventory.

#### Implementation Steps

**Step 1: Create Entity Config**
File: `src/entities/finished-good.tsx`

```typescript
export const finishedGoodEntity: EntityConfig<FinishedGood> = {
  name: "finished_good",
  table: "finished_goods",
  viewTable: "finished_goods_with_availability",
  displayName: "Finished Good",
  displayNamePlural: "Finished Goods",
  domain: "inventory",

  listColumns: [
    { accessorKey: "lot_code", header: "Lot Code", sortable: true },
    { accessorKey: "brand_name", header: "Brand" },
    { accessorKey: "package_type_name", header: "Package" },
    { accessorKey: "quantity", header: "Quantity", sortable: true },
    { accessorKey: "available_qty", header: "Available" },
    { accessorKey: "packaged_date", header: "Packaged", format: "date" },
  ],

  // Read-only entity (created by packaging sessions)
  formFields: [],
};
```

**Step 2: Create Pages**
Directory: `src/app/(app)/inventory/finished-goods/`

List and detail views only (FG created via packaging).

**Step 3: Add to Sidebar**
Under Inventory:
```typescript
{ label: "Finished Goods", href: "/inventory/finished-goods", icon: Package },
```

#### Completion Criteria
- [ ] `src/entities/finished-good.tsx` exists
- [ ] Uses `finished_goods_with_availability` view
- [ ] List page shows quantity and availability
- [ ] Detail page shows allocation history
- [ ] Sidebar link under Inventory

---

### 3.4 Inventory Allocation Workflow

#### Purpose
Allocate finished goods to orders.

#### Implementation Steps

**Step 1: Create Allocation UI**
File: `src/components/domain/order-allocation.tsx`

Features:
- Select finished goods to allocate
- Quantity input (validated against available)
- FIFO suggestion (oldest FG first)
- Save creates allocation record

**Step 2: Add Allocation Action to Order**
In order entity actions:
```typescript
{
  name: "allocate",
  label: "Allocate Inventory",
  fromStates: ["confirmed", "scheduled"],
  component: OrderAllocationDialog,
}
```

**Step 3: Generate Pick List**
When order transitions to "picking":
- Generate pick list from allocations
- Group by bin location
- Optimize for warehouse path

#### Completion Criteria
- [ ] Order detail has "Allocate Inventory" action
- [ ] Allocation dialog shows available FG
- [ ] Can allocate multiple FG lots to order
- [ ] Available quantity updates after allocation
- [ ] Pick list generated on picking status

---

## Phase 4: Sales & Purchasing [NOT STARTED]

### Overview
Complete order fulfillment and purchasing workflows.

### Dependencies
- Phase 3 (allocations working)

---

### 4.1 Order Line Items

#### Database Status
Table `order_items` exists (migration 00001).

#### Implementation Steps

**Step 1: Create Order Items Component**
File: `src/components/domain/order-items-editor.tsx`

Features:
- Add line items (brand + package type + quantity)
- Auto-price from tier (if configured)
- Manual price override
- Line total calculation
- Order total display

**Step 2: Update Order Entity**
Add `order_items` relation and include in detail/form.

**Step 3: Price Resolution**
Implement price lookup:
1. Get customer's sales channel
2. Find applicable price tier
3. Look up brand + format price
4. Fall back to style price if no brand-specific

#### Completion Criteria
- [ ] Order form includes line items editor
- [ ] Can add multiple line items
- [ ] Prices auto-populate from tier
- [ ] Can override prices
- [ ] Order total calculated

---

### 4.2 Supplier Entity

#### Implementation Steps

**Step 1: Create Entity Config**
File: `src/entities/supplier.tsx`

```typescript
export const supplierEntity: EntityConfig<Supplier> = {
  name: "supplier",
  table: "suppliers",
  displayName: "Supplier",
  displayNamePlural: "Suppliers",
  domain: "purchasing",

  listColumns: [
    { accessorKey: "name", header: "Name", sortable: true },
    { accessorKey: "contact_name", header: "Contact" },
    { accessorKey: "email", header: "Email" },
    { accessorKey: "phone", header: "Phone" },
    { accessorKey: "is_active", header: "Active" },
  ],

  formFields: [
    { name: "name", label: "Supplier Name", type: "text", required: true },
    { name: "contact_name", label: "Contact Name", type: "text" },
    { name: "email", label: "Email", type: "text" },
    { name: "phone", label: "Phone", type: "text" },
    { name: "address", label: "Address", type: "textarea" },
    { name: "payment_terms", label: "Payment Terms", type: "text" },
    { name: "is_active", label: "Active", type: "switch", defaultValue: true },
    { name: "notes", label: "Notes", type: "textarea" },
  ],
};
```

**Step 2: Create Pages and Register**
Standard CRUD pages under `/purchasing/suppliers/`.

#### Completion Criteria
- [ ] Supplier entity with full CRUD
- [ ] Link to supplier_catalog for products
- [ ] Sidebar includes Purchasing section with Suppliers

---

### 4.3 Purchase Order Entity

#### Implementation Steps

**Step 1: Create Entity Config**
File: `src/entities/purchase-order.tsx`

State machine: `draft → submitted → partial → received → closed`

**Step 2: Create PO Line Items Component**
File: `src/components/domain/po-line-items.tsx`

Features:
- Select from supplier_catalog
- Quantity and unit
- Unit cost
- Line total

**Step 3: Create Pages**
Standard CRUD pages under `/purchasing/pos/`.

#### Completion Criteria
- [ ] Purchase order entity with state machine
- [ ] PO line items component
- [ ] Full CRUD pages
- [ ] Status transitions (submit, receive, close)

---

### 4.4 Receiving Workflow

#### Purpose
Convert PO receipts to inventory lots.

#### Implementation Steps

**Step 1: Create Receiving UI**
File: `src/components/domain/po-receiving.tsx`

Features:
- Show PO line items with ordered quantities
- Enter received quantities per line
- Lot number assignment
- Storage location (bin) selection
- Partial receive support

**Step 2: Create Inventory Lots on Receive**
On save:
- Create `inventory_lots` records
- Update `po_receives` table
- Update PO status (partial → received if complete)

**Step 3: Track Partial Receipts**
Show received history on PO detail.

#### Completion Criteria
- [ ] Receiving UI on PO detail
- [ ] Can receive partial quantities
- [ ] Inventory lots created on receive
- [ ] Lot numbers assigned
- [ ] Storage location tracked
- [ ] PO status updates correctly

---

### 4.5-4.7 Customer, Sales Channels, Pricing

#### Summary
- Customer entity: name, sales channel, contact, address
- Sales channels: distributor, retail, taproom, export
- Price tiers: link to channel, per-brand or per-style pricing
- Order pricing: auto-populate from tier based on customer channel

See original plan for detailed field lists.

#### Completion Criteria
- [ ] Customer entity with sales channel selection
- [ ] Sales channel configuration page
- [ ] Price tier management
- [ ] Per-format pricing (brand × format grid)
- [ ] Orders auto-price from customer's tier

---

## Phase 5: Data Integrity & Audit [NOT STARTED]

### Overview
Improve data quality and audit capabilities.

### Dependencies
- None (can run in parallel)

---

### 5.1 Entity Revisions Table

#### Purpose
Unified audit trail for all entities.

#### Database Changes
Migration: `00015_entity_revisions.sql`

```sql
CREATE TABLE entity_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,  -- 'batch', 'recipe', etc.
  entity_id UUID NOT NULL,
  revision_number INTEGER NOT NULL,
  operation TEXT NOT NULL,  -- 'create', 'update', 'delete'
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ DEFAULT now(),
  old_data JSONB,
  new_data JSONB,
  change_reason TEXT
);

CREATE INDEX idx_entity_revisions_entity ON entity_revisions(entity_type, entity_id);
CREATE INDEX idx_entity_revisions_changed_at ON entity_revisions(changed_at DESC);
```

#### Implementation Steps

**Step 1: Create Revision Triggers**
For high-value entities (batches, recipes, orders):
```sql
CREATE OR REPLACE FUNCTION log_entity_revision()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO entity_revisions (entity_type, entity_id, revision_number, operation, old_data, new_data, changed_by)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    (SELECT COALESCE(MAX(revision_number), 0) + 1 FROM entity_revisions WHERE entity_type = TG_TABLE_NAME AND entity_id = COALESCE(NEW.id, OLD.id)),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END,
    (SELECT auth.uid())
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

**Step 2: Create Revision History UI**
File: `src/components/domain/revision-history.tsx`

Features:
- Timeline view of changes
- Diff display (what changed)
- Filter by date range
- Filter by user

**Step 3: Add to Entity Details**
Include revision history as collapsible section or tab.

#### Completion Criteria
- [ ] Migration creates `entity_revisions` table
- [ ] Triggers active on batches, recipes, orders
- [ ] Revision history component exists
- [ ] Entity details show revision history
- [ ] Can see diff of changes

---

### 5.4 Optimistic Locking

#### Purpose
Prevent concurrent modification conflicts.

#### Database Changes
Add `version` column to high-contention tables:
```sql
ALTER TABLE finished_goods ADD COLUMN version INTEGER DEFAULT 1;
ALTER TABLE bin_inventory ADD COLUMN version INTEGER DEFAULT 1;
```

#### Implementation Steps

**Step 1: Create Utility Function**
File: `src/lib/optimistic-lock.ts`

```typescript
export async function updateWithOptimisticLock<T>(
  supabase: SupabaseClient,
  table: string,
  id: string,
  data: Partial<T>,
  currentVersion: number
): Promise<{ success: boolean; data?: T; error?: string }> {
  const { data: updated, error } = await supabase
    .from(table)
    .update({ ...data, version: currentVersion + 1 })
    .eq('id', id)
    .eq('version', currentVersion)
    .select()
    .single();

  if (error || !updated) {
    return { success: false, error: 'Record was modified. Please refresh and try again.' };
  }

  return { success: true, data: updated };
}
```

**Step 2: Implement in Forms**
Update EntityForm to:
- Track version when loading record
- Use optimistic lock on update
- Show "Record modified" dialog on conflict

#### Completion Criteria
- [ ] Version columns added to high-contention tables
- [ ] `updateWithOptimisticLock` utility exists
- [ ] Forms detect concurrent modification
- [ ] User sees clear error with refresh option

---

### 5.5 Error Handling Patterns

#### Implementation Steps

**Step 1: Create Error Types**
File: `src/lib/errors.ts`

```typescript
export class ValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ConstraintError extends Error {
  constructor(public constraint: string, message: string) {
    super(message);
    this.name = 'ConstraintError';
  }
}

export class ConcurrentModificationError extends Error {
  constructor() {
    super('Record was modified by another user');
    this.name = 'ConcurrentModificationError';
  }
}

// Map PostgreSQL error codes to user-friendly messages
export const PG_ERROR_MESSAGES: Record<string, string> = {
  '23505': 'A record with this value already exists',
  '23503': 'Cannot delete: record is referenced by other data',
  '23514': 'Value violates check constraint',
  // ... more mappings
};

export function parsePostgresError(error: PostgrestError): string {
  return PG_ERROR_MESSAGES[error.code] || error.message;
}
```

**Step 2: Create Constraint Message Mapping**
Map specific constraint names to messages:
```typescript
export const CONSTRAINT_MESSAGES: Record<string, string> = {
  'chk_quantity_positive': 'Quantity must be greater than zero',
  'chk_volume_positive': 'Volume must be greater than zero',
  // ... from migrations
};
```

**Step 3: Implement Retry with Backoff**
File: `src/lib/retry.ts`

```typescript
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; backoffMs?: number } = {}
): Promise<T> {
  const { maxRetries = 3, backoffMs = 1000 } = options;
  let lastError: Error;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, backoffMs * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError!;
}
```

#### Completion Criteria
- [ ] Error types defined in `src/lib/errors.ts`
- [ ] PostgreSQL error code mapping exists
- [ ] Constraint messages mapped
- [ ] Retry utility with exponential backoff
- [ ] Toast notifications for common errors

---

### 5.6 Row Level Security Audit

#### Implementation Steps

**Step 1: Audit Existing Policies**
Query to check RLS status:
```sql
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

**Step 2: Define Role-Based Policies**
Document required access:
- Admin: Full access
- Production Manager: production, inventory, purchasing
- Brewer: recipes, batches, brew logs, vessels
- Sales: orders, customers, pricing

**Step 3: Create Missing Policies**
Ensure every table has RLS enabled and appropriate policies.

**Step 4: Test Policies**
Create test script that verifies:
- User A can't see User B's data (if applicable)
- Role-based restrictions work
- Service role bypasses RLS

#### Completion Criteria
- [ ] All tables have RLS enabled
- [ ] Policies documented by role
- [ ] Test script verifies access control
- [ ] No overly permissive policies (WITH CHECK (true))

---

## Phase 6-15: Summary

Due to document length, phases 6-15 follow the same pattern. Key points for each:

### Phase 6: Integrations & Notifications
- Square POS: Webhook sync, item mapping UI
- Slack: Edge function, channel config
- QuickBooks: OAuth flow, invoice sync
- In-app notifications: Realtime subscription

### Phase 7: Reporting & Compliance
- TTB Form 5130.9: Calculate tax-class volumes
- Production dashboard: Vessel utilization, batch status
- Inventory dashboard: Low stock, expiring lots

### Phase 8: Settings & Administration
- System settings: Brewery info, defaults
- User management: CRUD, role assignment
- Location management: Warehouses, taproom
- Integration settings: OAuth connections

### Phase 9: Yeast Management [IN PROGRESS]
- [x] Yeast pitches table (migration 00022)
- [x] Viability calculation (`src/lib/yeast-calculations.ts`)
- [x] Yeast pitch entity and CRUD pages
- [x] Sidebar navigation added
- [ ] Lineage tree visualization (future)
- [ ] Cost spreading (future)

### Phase 10: Keg Management
- Keg inventory by state
- Customer keg balances
- Lifecycle tracking

### Phase 11: Unit System [PARTIALLY COMPLETE]
- `src/lib/units.ts` exists
- `src/components/ui/unit-input.tsx` exists
- Need: User preferences integration in forms

### Phase 12: API Routes
- REST endpoints for all entities
- Auth middleware
- Validation with Zod
- Error response format

### Phase 13: AI Integration [PARTIALLY COMPLETE]
- `src/lib/ai/` exists with 4 files
- Database functions exist (migration 00008)
- Need: AI-enhanced UI components

### Phase 14: Advanced Workflows
- Batch blending
- PO generation from demand
- Pick list generation
- Landed cost calculation

### Phase 15: Testing & Quality
- Vitest for unit tests
- Playwright for E2E
- CI/CD pipeline

---

## Appendix A: File Reference Index

### Entity Configurations
```
src/entities/
├── batch.tsx              # State machine, viewTable example
├── brew-log.tsx           # Events array, custom detail components
├── customer.tsx           # Simple entity without state machine
├── inventory-item.tsx     # Category-based display config
├── order.tsx              # Complex state machine
├── recipe.tsx             # Many relations, junction tables
├── vessel.tsx             # viewTable with joins
└── index.ts               # Entity registry
```

### Universal Components
```
src/components/universal/
├── entity-list.tsx        # TanStack Table, filtering, sorting
├── entity-detail.tsx      # Sections, state machine display
├── entity-form.tsx        # Zod validation, dynamic options
└── status-badge.tsx       # Status display with colors
```

### Domain Components
```
src/components/domain/
├── app-header.tsx         # User menu
├── app-sidebar.tsx        # Navigation structure
├── grain-bill-editor.tsx  # Catalog selector pattern
└── hop-schedule-editor.tsx # Timing-based editor
```

### Libraries
```
src/lib/
├── units.ts               # Unit conversion (complete)
├── utils.ts               # General utilities
├── supabase/
│   ├── client.ts          # Browser client
│   └── server.ts          # Server client
└── ai/
    ├── index.ts           # AI exports
    ├── query-helpers.ts   # Common queries
    ├── recipe-analyzer.ts # Style compliance
    └── schema-context.ts  # Schema introspection
```

### Migrations
```
supabase/migrations/
├── 00001_initial_schema.sql
├── 00002_single_tenant.sql
├── 00003_brands.sql
├── 00004_brew_logs.sql
├── 00005_batches_cleanup.sql
├── 00006_vessels.sql
├── 00007_vessel_types_foeder_barrel.sql
├── 00008_ai_integration.sql
├── 00009_user_preferences_and_units.sql
├── 00010_unified_allocations.sql
├── 00011_catalog_and_recipe_junction.sql
├── 00012_performance_indexes.sql
├── 00013_rls_performance_fix.sql
└── 00014_security_fixes.sql
```

---

## Appendix B: Completion Checklist Template

For each implementation task, verify:

```markdown
### [Task Name]

#### Files Created/Modified
- [ ] File path 1
- [ ] File path 2

#### Database Changes
- [ ] Migration created and applied
- [ ] Types regenerated (`pnpm supabase gen types`)

#### Functionality
- [ ] Feature works as specified
- [ ] Edge cases handled
- [ ] Error messages user-friendly

#### Testing
- [ ] Manual testing completed
- [ ] Unit tests written (if applicable)
- [ ] E2E test written (if applicable)

#### Documentation
- [ ] Code comments explain complex logic
- [ ] README updated (if applicable)
- [ ] Implementation plan updated

#### Code Quality
- [ ] TypeScript compiles without errors
- [ ] ESLint passes
- [ ] No console.logs in production code
- [ ] Follows existing patterns
```

---

*Document generated January 2026*
*Last updated: [Date of last update]*
