# Water Chemistry Auto-Calculator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-calculate salt additions from target ppm values and a source water profile, integrated into the addition profile editor with a read-only recipe summary.

**Architecture:** Target ppm columns + source water FK added to `water_addition_profiles`. Profile editor gets a target ppm section that live-calculates salt additions via the existing `calculateAdditions()` engine. Recipe detail page shows a read-only source/target/resulting summary. A mapping utility bridges `SaltAdditions` objects to `additives` catalog rows.

**Tech Stack:** TypeScript, React, Supabase (Postgres), Tanstack Query, Zod, shadcn/ui components

---

### Task 1: Database Migration

Add target ppm columns and source water FK to `water_addition_profiles`.

**Files:**
- Create: `supabase/migrations/00097_water_chemistry_targets.sql`

**Step 1: Write the migration**

```sql
-- Water Chemistry Targets
-- Adds target mineral ppm values and source water profile reference
-- to water_addition_profiles for auto-calculating salt additions.

ALTER TABLE water_addition_profiles
  ADD COLUMN water_profile_id UUID REFERENCES water_profiles(id) ON DELETE SET NULL,
  ADD COLUMN target_calcium_ppm DECIMAL(6,1),
  ADD COLUMN target_magnesium_ppm DECIMAL(6,1),
  ADD COLUMN target_sodium_ppm DECIMAL(6,1),
  ADD COLUMN target_sulfate_ppm DECIMAL(6,1),
  ADD COLUMN target_chloride_ppm DECIMAL(6,1),
  ADD COLUMN target_bicarbonate_ppm DECIMAL(6,1),
  ADD COLUMN target_ph DECIMAL(3,1);

COMMENT ON COLUMN water_addition_profiles.water_profile_id IS 'Source water profile for auto-calculation baseline';
COMMENT ON COLUMN water_addition_profiles.target_calcium_ppm IS 'Target calcium in ppm';
COMMENT ON COLUMN water_addition_profiles.target_magnesium_ppm IS 'Target magnesium in ppm';
COMMENT ON COLUMN water_addition_profiles.target_sodium_ppm IS 'Target sodium in ppm';
COMMENT ON COLUMN water_addition_profiles.target_sulfate_ppm IS 'Target sulfate in ppm';
COMMENT ON COLUMN water_addition_profiles.target_chloride_ppm IS 'Target chloride in ppm';
COMMENT ON COLUMN water_addition_profiles.target_bicarbonate_ppm IS 'Target bicarbonate in ppm';
COMMENT ON COLUMN water_addition_profiles.target_ph IS 'Target mash pH';

CREATE INDEX idx_water_addition_profiles_water_profile
  ON water_addition_profiles(water_profile_id)
  WHERE water_profile_id IS NOT NULL;

-- Update schema registry
UPDATE _schema_registry
SET relationships = relationships || '[{"table": "water_profiles", "type": "belongsTo", "fk": "water_profile_id"}]'::jsonb
WHERE table_name = 'water_addition_profiles';
```

**Step 2: Apply the migration**

Run: `supabase migration apply` (via MCP tool `apply_migration` with project_id `phwjrfdtebftetctkhdr`)

**Step 3: Regenerate TypeScript types**

Run: `generate_typescript_types` via MCP tool, then copy the output to `src/types/supabase.ts`. Verify `water_addition_profiles` Row type now includes `water_profile_id`, `target_calcium_ppm`, etc.

**Step 4: Commit**

```bash
git add supabase/migrations/00097_water_chemistry_targets.sql src/types/supabase.ts
git commit -m "feat: add water chemistry target columns to addition profiles"
```

---

### Task 2: Update Zod Schema and Entity Config

Add the new fields to the validation schema and entity config so the universal detail page can save them.

**Files:**
- Modify: `src/lib/schemas/water-addition-profile.ts`
- Modify: `src/entities/water-addition-profile.tsx`

**Step 1: Update the Zod schema**

In `src/lib/schemas/water-addition-profile.ts`, add the target fields:

```typescript
import { z } from "zod";

export const waterAdditionProfileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  water_profile_id: z.string().uuid().nullable().optional(),
  target_calcium_ppm: z.coerce.number().min(0).nullable().optional(),
  target_magnesium_ppm: z.coerce.number().min(0).nullable().optional(),
  target_sodium_ppm: z.coerce.number().min(0).nullable().optional(),
  target_sulfate_ppm: z.coerce.number().min(0).nullable().optional(),
  target_chloride_ppm: z.coerce.number().min(0).nullable().optional(),
  target_bicarbonate_ppm: z.coerce.number().min(0).nullable().optional(),
  target_ph: z.coerce.number().min(0).max(14).nullable().optional(),
});

export type WaterAdditionProfileFormValues = z.infer<typeof waterAdditionProfileSchema>;
```

**Step 2: Update the entity config**

In `src/entities/water-addition-profile.tsx`, add a new "Water Chemistry Targets" section between "Overview" and "Additions":

```typescript
{
  id: "targets",
  title: "Water Chemistry Targets",
  fields: [
    {
      name: "water_profile_id",
      label: "Source Water Profile",
      type: "relation",
      relation: {
        entity: "water_profile",
        displayField: "name",
      },
      colSpan: 12,
      description: "Baseline water chemistry for auto-calculation",
    },
    { name: "target_calcium_ppm", label: "Ca²⁺", type: "number", placeholder: "0", colSpan: 2 },
    { name: "target_magnesium_ppm", label: "Mg²⁺", type: "number", placeholder: "0", colSpan: 2 },
    { name: "target_sodium_ppm", label: "Na⁺", type: "number", placeholder: "0", colSpan: 2 },
    { name: "target_sulfate_ppm", label: "SO₄²⁻", type: "number", placeholder: "0", colSpan: 2 },
    { name: "target_chloride_ppm", label: "Cl⁻", type: "number", placeholder: "0", colSpan: 1 },
    { name: "target_bicarbonate_ppm", label: "HCO₃⁻", type: "number", placeholder: "0", colSpan: 2 },
    { name: "target_ph", label: "pH", type: "number", placeholder: "7.0", colSpan: 1 },
  ],
},
```

Also add the target fields to `formFields` array (same field definitions) and update `formSchema`.

**Step 3: Run typecheck**

Run: `bun typecheck`
Expected: No new errors from these changes (pre-existing brew_logs/QBO errors only)

**Step 4: Commit**

```bash
git add src/lib/schemas/water-addition-profile.ts src/entities/water-addition-profile.tsx
git commit -m "feat: add water chemistry target fields to addition profile entity"
```

---

### Task 3: Salt-to-Additive Mapping Utility

Create a mapping layer that converts `SaltAdditions` objects from the calculator to `recipe_additions` rows linked to the `additives` catalog.

**Files:**
- Modify: `src/lib/water-chemistry.ts` (add mapping constants and function)
- Modify: `src/lib/__tests__/water-chemistry.test.ts` (add tests)

**Step 1: Write failing tests**

Add to `src/lib/__tests__/water-chemistry.test.ts`:

```typescript
import {
  // ... existing imports ...
  SALT_ADDITIVE_MAP,
  mapSaltAdditionsToItems,
  type SaltAdditions,
} from "../water-chemistry";

describe("SALT_ADDITIVE_MAP", () => {
  it("maps all SaltAdditions keys to additive names", () => {
    const saltKeys: (keyof SaltAdditions)[] = [
      "gypsum_g", "calcium_chloride_g", "epsom_salt_g",
      "baking_soda_g", "chalk_g", "table_salt_g", "magnesium_chloride_g",
    ];
    for (const key of saltKeys) {
      expect(SALT_ADDITIVE_MAP[key]).toBeDefined();
      expect(typeof SALT_ADDITIVE_MAP[key]).toBe("string");
    }
  });
});

describe("mapSaltAdditionsToItems", () => {
  const mockCatalog = [
    { id: "gypsum-id", name: "Gypsum", type: "water_salt" },
    { id: "cacl2-id", name: "Calcium Chloride", type: "water_salt" },
    { id: "epsom-id", name: "Epsom Salt", type: "water_salt" },
    { id: "bsoda-id", name: "Baking Soda", type: "water_salt" },
    { id: "chalk-id", name: "Chalk", type: "water_salt" },
    { id: "tsalt-id", name: "Table Salt", type: "water_salt" },
    { id: "mgcl2-id", name: "Magnesium Chloride", type: "water_salt" },
  ];

  it("returns items for non-zero additions only", () => {
    const additions: SaltAdditions = {
      gypsum_g: 2.5, calcium_chloride_g: 1.0, epsom_salt_g: 0,
      baking_soda_g: 0, chalk_g: 0, table_salt_g: 0, magnesium_chloride_g: 0,
    };
    const items = mapSaltAdditionsToItems(additions, mockCatalog);
    expect(items).toHaveLength(2);
    expect(items[0].additive_id).toBe("gypsum-id");
    expect(items[0].amount).toBe(2.5);
    expect(items[0].unit).toBe("g");
    expect(items[1].additive_id).toBe("cacl2-id");
  });

  it("returns empty array when all additions are zero", () => {
    const additions: SaltAdditions = {
      gypsum_g: 0, calcium_chloride_g: 0, epsom_salt_g: 0,
      baking_soda_g: 0, chalk_g: 0, table_salt_g: 0, magnesium_chloride_g: 0,
    };
    expect(mapSaltAdditionsToItems(additions, mockCatalog)).toHaveLength(0);
  });

  it("skips salts not found in catalog", () => {
    const additions: SaltAdditions = {
      gypsum_g: 1, calcium_chloride_g: 0, epsom_salt_g: 0,
      baking_soda_g: 0, chalk_g: 0, table_salt_g: 0, magnesium_chloride_g: 0,
    };
    const items = mapSaltAdditionsToItems(additions, []);
    expect(items).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun vitest run src/lib/__tests__/water-chemistry.test.ts`
Expected: FAIL — `SALT_ADDITIVE_MAP` and `mapSaltAdditionsToItems` not exported

**Step 3: Implement the mapping**

Add to `src/lib/water-chemistry.ts`:

```typescript
// =============================================================================
// Salt-to-Additive Mapping
// =============================================================================

/** Maps SaltAdditions field names to additive catalog names */
export const SALT_ADDITIVE_MAP: Record<keyof SaltAdditions, string> = {
  gypsum_g: "Gypsum",
  calcium_chloride_g: "Calcium Chloride",
  epsom_salt_g: "Epsom Salt",
  baking_soda_g: "Baking Soda",
  chalk_g: "Chalk",
  table_salt_g: "Table Salt",
  magnesium_chloride_g: "Magnesium Chloride",
};

/** Convert SaltAdditions to recipe_additions-compatible items */
export function mapSaltAdditionsToItems(
  additions: SaltAdditions,
  catalog: { id: string; name: string }[]
): { additive_id: string; amount: number; unit: string; timing: string; target: string }[] {
  const items: { additive_id: string; amount: number; unit: string; timing: string; target: string }[] = [];

  for (const [field, additiveName] of Object.entries(SALT_ADDITIVE_MAP)) {
    const grams = additions[field as keyof SaltAdditions];
    if (grams <= 0) continue;

    const catalogEntry = catalog.find(
      (a) => a.name.toLowerCase() === additiveName.toLowerCase()
    );
    if (!catalogEntry) continue;

    items.push({
      additive_id: catalogEntry.id,
      amount: grams,
      unit: "g",
      timing: "mash",
      target: "mash",
    });
  }

  return items;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun vitest run src/lib/__tests__/water-chemistry.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/lib/water-chemistry.ts src/lib/__tests__/water-chemistry.test.ts
git commit -m "feat: add salt-to-additive mapping utility"
```

---

### Task 4: Auto-Calculate in Profile Additions Editor

Integrate the calculator into `ProfileAdditionsEditor` so it auto-fills salt additions when the profile has a source water profile and target ppms set.

**Files:**
- Modify: `src/components/domain/profile-additions-editor.tsx`

**Step 1: Update ProfileAdditionsEditorProps**

The component receives `data` from the entity detail page. After Task 2, the entity record will include the new target fields. Update the `data` type and add calculator logic:

```typescript
interface ProfileAdditionsEditorProps {
  data: {
    id: string | null;
    water_profile_id?: string | null;
    target_calcium_ppm?: number | null;
    target_magnesium_ppm?: number | null;
    target_sodium_ppm?: number | null;
    target_sulfate_ppm?: number | null;
    target_chloride_ppm?: number | null;
    target_bicarbonate_ppm?: number | null;
    target_ph?: number | null;
  };
}
```

**Step 2: Add source water profile query**

Inside the component, fetch the source water profile when `data.water_profile_id` is set:

```typescript
import { entityKeys } from "@/lib/query-keys";
import {
  calculateAdditions,
  calculateResultingProfile,
  calculateSulfateChlorideRatio,
  getRatioDescription,
  mapSaltAdditionsToItems,
  type WaterProfile,
  type SaltAdditions,
} from "@/lib/water-chemistry";

// Inside component:
const { data: sourceProfile } = useQuery({
  queryKey: entityKeys.detail("water_profiles", data.water_profile_id!),
  queryFn: async () => {
    const { data: row, error } = await supabase
      .from("water_profiles")
      .select("calcium_ppm, magnesium_ppm, sodium_ppm, sulfate_ppm, chloride_ppm, bicarbonate_ppm, ph")
      .eq("id", data.water_profile_id!)
      .single();
    if (error) throw error;
    return row as WaterProfile & { ph: number | null };
  },
  enabled: !!data.water_profile_id,
});
```

**Step 3: Add auto-calculation logic**

Use `useMemo` to compute suggested additions when source profile and targets exist:

```typescript
const targetProfile = useMemo((): WaterProfile | null => {
  if (
    data.target_calcium_ppm == null &&
    data.target_sulfate_ppm == null &&
    data.target_chloride_ppm == null
  ) return null;

  return {
    calcium_ppm: data.target_calcium_ppm ?? 0,
    magnesium_ppm: data.target_magnesium_ppm ?? 0,
    sodium_ppm: data.target_sodium_ppm ?? 0,
    sulfate_ppm: data.target_sulfate_ppm ?? 0,
    chloride_ppm: data.target_chloride_ppm ?? 0,
    bicarbonate_ppm: data.target_bicarbonate_ppm ?? 0,
  };
}, [data]);

const calculatedAdditions = useMemo((): SaltAdditions | null => {
  if (!sourceProfile || !targetProfile) return null;
  return calculateAdditions(sourceProfile, targetProfile, 1); // 1 gal unit rate
}, [sourceProfile, targetProfile]);

const resultingProfile = useMemo((): WaterProfile | null => {
  if (!sourceProfile || !calculatedAdditions) return null;
  return calculateResultingProfile(sourceProfile, calculatedAdditions, 1);
}, [sourceProfile, calculatedAdditions]);
```

**Step 4: Add override tracking**

Track which additives the user has manually overridden:

```typescript
const [overriddenIds, setOverriddenIds] = useState<Set<string>>(new Set());

// Detect overrides on load by comparing saved amounts vs calculated
useEffect(() => {
  if (!calculatedAdditions || !savedItems || !filteredCatalog.length) return;
  const calcItems = mapSaltAdditionsToItems(calculatedAdditions, filteredCatalog);
  const overrides = new Set<string>();
  for (const saved of savedItems) {
    const calc = calcItems.find((c) => c.additive_id === saved.additive_id);
    if (calc && Math.abs(calc.amount - saved.amount) > 0.01) {
      overrides.add(saved.additive_id);
    }
  }
  setOverriddenIds(overrides);
}, [calculatedAdditions, savedItems, filteredCatalog]);
```

**Step 5: Auto-populate non-overridden items when calculated additions change**

When `calculatedAdditions` changes (because source/target changed), update non-overridden items in `localItems`:

```typescript
// Watch for calculation changes and update non-overridden items
const [prevCalcAdditions, setPrevCalcAdditions] = useState(calculatedAdditions);
if (calculatedAdditions !== prevCalcAdditions) {
  setPrevCalcAdditions(calculatedAdditions);
  if (calculatedAdditions && filteredCatalog.length > 0) {
    const calcItems = mapSaltAdditionsToItems(calculatedAdditions, filteredCatalog);
    setLocalItems((prev) => {
      // Start with overridden items (keep their values)
      const overridden = prev.filter((item) => overriddenIds.has(item.additive_id));
      // Add/update calculated items that aren't overridden
      const result = [...overridden];
      for (const calcItem of calcItems) {
        if (!overriddenIds.has(calcItem.additive_id)) {
          const existing = prev.find((p) => p.additive_id === calcItem.additive_id);
          result.push({
            additive_id: calcItem.additive_id,
            amount: calcItem.amount,
            unit: calcItem.unit,
            timing: existing?.timing ?? calcItem.timing,
            target: existing?.target ?? calcItem.target,
            position: result.length,
            additive: filteredCatalog.find((a) => a.id === calcItem.additive_id),
          });
        }
      }
      return result;
    });
    setHasChanges(true);
  }
}
```

**Step 6: Mark manual edits as overrides**

Update `handleFieldChange` to track overrides when amount is manually changed:

```typescript
const handleFieldChange = useCallback(
  (index: number, field: keyof ProfileAdditionItem, value: string | number) => {
    setLocalItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
    // Track manual amount overrides
    if (field === "amount") {
      const item = localItems[index];
      if (item) {
        setOverriddenIds((prev) => new Set(prev).add(item.additive_id));
      }
    }
    setHasChanges(true);
  },
  [localItems]
);
```

**Step 7: Add reset-to-calculated button per row**

In the table row, when an item is overridden and `calculatedAdditions` exists, show a small reset button:

```tsx
{overriddenIds.has(item.additive_id) && calculatedAdditions && (
  <Button
    type="button"
    variant="ghost"
    size="sm"
    onClick={() => {
      const calcItems = mapSaltAdditionsToItems(calculatedAdditions, filteredCatalog);
      const calcItem = calcItems.find((c) => c.additive_id === item.additive_id);
      if (calcItem) {
        handleFieldChange(index, "amount", calcItem.amount);
        setOverriddenIds((prev) => {
          const next = new Set(prev);
          next.delete(item.additive_id);
          return next;
        });
      }
    }}
    className="h-6 w-6 p-0 text-muted-foreground"
    title="Reset to calculated value"
  >
    <RotateCcw className="h-3 w-3" />
  </Button>
)}
```

Import `RotateCcw` from lucide-react.

**Step 8: Add visual indicator for overridden rows**

Add a subtle visual indicator to overridden amount cells:

```tsx
<Input
  type="number"
  // ... existing props ...
  className={cn(
    "w-20 text-right ml-auto",
    overriddenIds.has(item.additive_id) && "ring-1 ring-amber-400/50"
  )}
/>
```

Import `cn` from `@/lib/utils`.

**Step 9: Add resulting profile summary**

Below the table, when `resultingProfile` and `sourceProfile` exist, show a compact summary:

```tsx
{resultingProfile && sourceProfile && targetProfile && (
  <div className="border rounded-md p-4 space-y-2">
    <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      Resulting Water Profile (per gallon)
    </h4>
    <div className="grid grid-cols-7 gap-2 text-sm">
      {(["calcium_ppm", "magnesium_ppm", "sodium_ppm", "sulfate_ppm", "chloride_ppm", "bicarbonate_ppm"] as const).map((ion) => {
        const label = { calcium_ppm: "Ca²⁺", magnesium_ppm: "Mg²⁺", sodium_ppm: "Na⁺", sulfate_ppm: "SO₄²⁻", chloride_ppm: "Cl⁻", bicarbonate_ppm: "HCO₃⁻" }[ion];
        const result = resultingProfile[ion];
        const target = targetProfile[ion];
        const withinRange = target > 0 && Math.abs(result - target) / target <= 0.1;
        return (
          <div key={ion} className="text-center">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={cn("font-mono", withinRange ? "text-green-600" : "text-amber-600")}>
              {Math.round(result)}
            </div>
          </div>
        );
      })}
      <div className="text-center">
        <div className="text-xs text-muted-foreground">SO₄:Cl</div>
        <div className="font-mono">
          {calculateSulfateChlorideRatio(resultingProfile.sulfate_ppm, resultingProfile.chloride_ppm)}
        </div>
        <div className="text-xs text-muted-foreground">
          {getRatioDescription(calculateSulfateChlorideRatio(resultingProfile.sulfate_ppm, resultingProfile.chloride_ppm)).label}
        </div>
      </div>
    </div>
  </div>
)}
```

**Step 10: Run typecheck and lint**

Run: `bun typecheck && bun lint`
Expected: No new errors

**Step 11: Commit**

```bash
git add src/components/domain/profile-additions-editor.tsx
git commit -m "feat: auto-calculate salt additions from target ppm in profile editor"
```

---

### Task 5: Recipe Detail Water Chemistry Summary

Add a read-only water chemistry summary to the recipe additions display.

**Files:**
- Modify: `src/components/domain/recipe-additions-display.tsx`

**Step 1: Fetch addition profile target data**

The component already fetches the profile by ID. Expand the select to include target fields:

```typescript
const { data: profile } = useQuery({
  queryKey: waterAdditionProfileKeys.detail(profileId!),
  queryFn: async () => {
    const { data, error } = await supabase
      .from("water_addition_profiles")
      .select("id, name, water_profile_id, target_calcium_ppm, target_magnesium_ppm, target_sodium_ppm, target_sulfate_ppm, target_chloride_ppm, target_bicarbonate_ppm, target_ph")
      .eq("id", profileId!)
      .single();
    if (error) throw error;
    return data;
  },
  enabled: !!profileId,
});
```

**Step 2: Fetch source water profile**

Add a query for the recipe's source water profile (the `data` prop already includes `water_addition_profile_id` but we need the recipe's own `water_profile_id` too — check the existing `RecipeAdditionsDisplayProps` and see if it's passed):

The `data` prop type is `{ id: string | null; water_addition_profile_id?: string | null }`. We need to extend it to also receive `water_profile_id` and water volumes. Update the interface:

```typescript
interface RecipeAdditionsDisplayProps {
  data: {
    id: string | null;
    water_addition_profile_id?: string | null;
    water_profile_id?: string | null;
    mash_water_volume_gal?: number | null;
    sparge_water_volume_gal?: number | null;
  };
}
```

Then fetch the source water profile:

```typescript
const sourceWaterProfileId = data.water_profile_id;

const { data: sourceWaterProfile } = useQuery({
  queryKey: entityKeys.detail("water_profiles", sourceWaterProfileId!),
  queryFn: async () => {
    const { data: row, error } = await supabase
      .from("water_profiles")
      .select("name, calcium_ppm, magnesium_ppm, sodium_ppm, sulfate_ppm, chloride_ppm, bicarbonate_ppm, ph")
      .eq("id", sourceWaterProfileId!)
      .single();
    if (error) throw error;
    return row;
  },
  enabled: !!sourceWaterProfileId,
});
```

Import `entityKeys` from `@/lib/query-keys`.

**Step 3: Calculate resulting profile**

```typescript
import {
  calculateResultingProfile,
  calculateSulfateChlorideRatio,
  getRatioDescription,
  type WaterProfile,
  type SaltAdditions,
  SALT_CONTRIBUTIONS,
} from "@/lib/water-chemistry";

// Build SaltAdditions from profile items for the calculation
const saltAdditionsFromItems = useMemo((): SaltAdditions | null => {
  if (!profileItems || profileItems.length === 0) return null;
  // ... map profile items back to SaltAdditions using additive names
  // This is the reverse of mapSaltAdditionsToItems
}, [profileItems]);

// Calculate total water volume for scaling
const totalVolumeGal = (data.mash_water_volume_gal ?? 0) + (data.sparge_water_volume_gal ?? 0);

// Calculate resulting profile
const resultingProfile = useMemo((): WaterProfile | null => {
  if (!sourceWaterProfile || !saltAdditionsFromItems || totalVolumeGal <= 0) return null;
  const source: WaterProfile = {
    calcium_ppm: sourceWaterProfile.calcium_ppm ?? 0,
    magnesium_ppm: sourceWaterProfile.magnesium_ppm ?? 0,
    sodium_ppm: sourceWaterProfile.sodium_ppm ?? 0,
    sulfate_ppm: sourceWaterProfile.sulfate_ppm ?? 0,
    chloride_ppm: sourceWaterProfile.chloride_ppm ?? 0,
    bicarbonate_ppm: sourceWaterProfile.bicarbonate_ppm ?? 0,
  };
  return calculateResultingProfile(source, saltAdditionsFromItems, totalVolumeGal);
}, [sourceWaterProfile, saltAdditionsFromItems, totalVolumeGal]);
```

**Step 4: Add WaterChemistrySummary component**

Create a new component within the same file that renders the source/target/resulting comparison:

```tsx
function WaterChemistrySummary({
  source,
  target,
  resulting,
}: {
  source: WaterProfile & { name?: string };
  target: { calcium_ppm: number | null; magnesium_ppm: number | null; sodium_ppm: number | null; sulfate_ppm: number | null; chloride_ppm: number | null; bicarbonate_ppm: number | null };
  resulting: WaterProfile;
}) {
  const ions = [
    { key: "calcium_ppm", label: "Ca²⁺" },
    { key: "magnesium_ppm", label: "Mg²⁺" },
    { key: "sodium_ppm", label: "Na⁺" },
    { key: "sulfate_ppm", label: "SO₄²⁻" },
    { key: "chloride_ppm", label: "Cl⁻" },
    { key: "bicarbonate_ppm", label: "HCO₃⁻" },
  ] as const;

  const ratio = calculateSulfateChlorideRatio(resulting.sulfate_ppm, resulting.chloride_ppm);
  const ratioDesc = getRatioDescription(ratio);

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Water Chemistry
      </h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20" />
            {ions.map((ion) => (
              <TableHead key={ion.key} className="text-center w-16">{ion.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="text-xs text-muted-foreground font-medium">Source</TableCell>
            {ions.map((ion) => (
              <TableCell key={ion.key} className="text-center font-mono text-sm">
                {Math.round(source[ion.key] ?? 0)}
              </TableCell>
            ))}
          </TableRow>
          <TableRow>
            <TableCell className="text-xs text-muted-foreground font-medium">Target</TableCell>
            {ions.map((ion) => (
              <TableCell key={ion.key} className="text-center font-mono text-sm">
                {target[ion.key] != null ? Math.round(target[ion.key]!) : "—"}
              </TableCell>
            ))}
          </TableRow>
          <TableRow>
            <TableCell className="text-xs text-muted-foreground font-medium">Result</TableCell>
            {ions.map((ion) => {
              const result = Math.round(resulting[ion.key]);
              const tgt = target[ion.key];
              const withinRange = tgt != null && tgt > 0 && Math.abs(result - tgt) / tgt <= 0.1;
              return (
                <TableCell
                  key={ion.key}
                  className={cn(
                    "text-center font-mono text-sm font-medium",
                    tgt != null && (withinRange ? "text-green-600" : "text-amber-600")
                  )}
                >
                  {result}
                </TableCell>
              );
            })}
          </TableRow>
        </TableBody>
      </Table>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">SO₄:Cl Ratio:</span>
        <span className="font-mono font-medium">{ratio}</span>
        <Badge variant="outline">{ratioDesc.label}</Badge>
      </div>
    </div>
  );
}
```

Import `cn` from `@/lib/utils`.

**Step 5: Render the summary in WaterTreatmentSection**

In the `WaterTreatmentSection` component, render `WaterChemistrySummary` above the additions table when source profile, targets, and resulting profile are all available. Pass these as props from the parent.

**Step 6: Run typecheck and lint**

Run: `bun typecheck && bun lint`
Expected: No new errors

**Step 7: Commit**

```bash
git add src/components/domain/recipe-additions-display.tsx
git commit -m "feat: add water chemistry summary to recipe additions display"
```

---

### Task 6: Documentation and Final Verification

Update data model docs and verify everything works end-to-end.

**Files:**
- Modify: `docs/data-model/water-addition-profiles.md` (if exists, otherwise skip)

**Step 1: Update data model docs**

If `docs/data-model/` has a file for water_addition_profiles, update it to include the new columns. If not, this step is optional per YAGNI.

**Step 2: Run full verification**

Run: `bun typecheck && bun lint && bun vitest run src/lib/__tests__/water-chemistry.test.ts`
Expected: All pass (pre-existing brew_logs/QBO errors are the only type errors)

**Step 3: Commit any remaining doc changes**

```bash
git add docs/
git commit -m "docs: update data model for water chemistry targets"
```

---

## Task Dependencies

```
Task 1 (Migration) → Task 2 (Schema + Entity) → Task 3 (Mapping Utility)
                                                      ↓
Task 4 (Profile Editor) ← ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
Task 5 (Recipe Summary) ← Task 4
Task 6 (Docs + Verify)  ← Task 5
```

Tasks 1→2→3 are sequential. Task 3 can be done in parallel with Task 2 if the mapping utility doesn't depend on the entity config. Task 4 depends on Tasks 2 and 3. Task 5 depends on Task 4 (needs the same patterns). Task 6 is final.
