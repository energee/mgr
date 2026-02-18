# Water Additions Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the non-functional `use_default_additions` toggle with named, reusable water addition profiles.

**Architecture:** New `water_addition_profiles` table stores named profile metadata. Existing `recipe_additions` table gains a `profile_id` FK to hold profile items alongside recipe-specific additions. Recipe entity gets a `water_addition_profile_id` FK dropdown. Lightweight entity under Settings domain for CRUD.

**Tech Stack:** Supabase (Postgres), Next.js, React Query, Zod, entity config system

**Design doc:** `docs/plans/2026-02-18-water-additions-redesign-design.md`

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/00096_water_addition_profiles.sql`

**Step 1: Write the migration**

```sql
-- Water Addition Profiles
-- Named, reusable sets of water salt/acid additions (e.g., "Hoppy IPA Salts").
-- Profile items stored in recipe_additions with profile_id FK.

-- =============================================================================
-- 1. CREATE water_addition_profiles TABLE
-- =============================================================================

CREATE TABLE water_addition_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE water_addition_profiles IS 'Named, reusable sets of water salt/acid additions for recipes';
COMMENT ON COLUMN water_addition_profiles.name IS 'Profile name, e.g. Hoppy IPA Salts';
COMMENT ON COLUMN water_addition_profiles.is_active IS 'Inactive profiles hidden from dropdowns';

-- RLS
ALTER TABLE water_addition_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read water addition profiles"
  ON water_addition_profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert water addition profiles"
  ON water_addition_profiles FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update water addition profiles"
  ON water_addition_profiles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete water addition profiles"
  ON water_addition_profiles FOR DELETE TO authenticated USING (true);

-- Updated_at trigger
CREATE TRIGGER set_water_addition_profiles_updated_at
  BEFORE UPDATE ON water_addition_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 2. MODIFY recipe_additions: add profile_id FK
-- =============================================================================

ALTER TABLE recipe_additions
  ADD COLUMN profile_id UUID REFERENCES water_addition_profiles(id) ON DELETE CASCADE;

CREATE INDEX idx_recipe_additions_profile
  ON recipe_additions(profile_id) WHERE profile_id IS NOT NULL;

-- =============================================================================
-- 3. CLEAN UP orphaned rows and dead columns
-- =============================================================================

-- Delete any orphaned rows (recipe_id IS NULL, is_default = true) — no code uses these
DELETE FROM recipe_additions WHERE recipe_id IS NULL;

-- Add mutual exclusivity constraint
ALTER TABLE recipe_additions
  ADD CONSTRAINT recipe_additions_owner_check
  CHECK (
    (recipe_id IS NOT NULL AND profile_id IS NULL) OR
    (recipe_id IS NULL AND profile_id IS NOT NULL)
  );

-- Drop dead column
ALTER TABLE recipe_additions DROP COLUMN IF EXISTS is_default;

-- =============================================================================
-- 4. MODIFY recipes: replace use_default_additions with water_addition_profile_id
-- =============================================================================

ALTER TABLE recipes
  ADD COLUMN water_addition_profile_id UUID
    REFERENCES water_addition_profiles(id) ON DELETE SET NULL;

ALTER TABLE recipes DROP COLUMN IF EXISTS use_default_additions;

-- =============================================================================
-- 5. UPDATE recipes_with_estimates VIEW
-- =============================================================================
-- The view explicitly lists r.use_default_additions — replace with new column.
-- Full view recreation required (CREATE OR REPLACE).

CREATE OR REPLACE VIEW recipes_with_estimates
WITH (security_invoker = true)
AS
WITH grain_totals AS (
    SELECT rm.recipe_id,
        sum(rm.weight_lbs) AS total_grain_lbs,
        sum(rm.weight_lbs * COALESCE(rm.ppg::numeric, m.potential_ppg, 36::numeric)) AS total_points,
        sum(rm.weight_lbs * COALESCE(rm.color_lov, m.color_lovibond, 2::numeric)) AS mcu_sum
    FROM recipe_malts rm
        JOIN malts m ON m.id = rm.malt_id
    GROUP BY rm.recipe_id
), hop_ibu AS (
    SELECT rh.recipe_id,
        sum(rh.weight_oz * COALESCE(rh.alpha_acid, h.alpha_acid_typical, 10::numeric) *
            CASE rh.timing
                WHEN 'boil' THEN
                    CASE
                        WHEN COALESCE(rh.boil_time_min, 60) >= 60 THEN 0.27
                        WHEN COALESCE(rh.boil_time_min, 60) >= 45 THEN 0.24
                        WHEN COALESCE(rh.boil_time_min, 60) >= 30 THEN 0.20
                        WHEN COALESCE(rh.boil_time_min, 60) >= 15 THEN 0.14
                        WHEN COALESCE(rh.boil_time_min, 60) >= 10 THEN 0.10
                        WHEN COALESCE(rh.boil_time_min, 60) >= 5 THEN 0.05
                        ELSE 0.02
                    END
                WHEN 'first_wort' THEN 0.10
                WHEN 'whirlpool' THEN 0.05
                WHEN 'mash' THEN 0.08
                ELSE 0::numeric
            END) AS weighted_ibu_factor
    FROM recipe_hops rh
        JOIN hops h ON h.id = rh.hop_id
    GROUP BY rh.recipe_id
), batch_counts AS (
    SELECT recipe_id, count(*)::int AS batch_count
    FROM batches
    WHERE recipe_id IS NOT NULL
    GROUP BY recipe_id
)
SELECT r.id,
    r.name,
    r.style,
    r.description,
    r.target_og,
    r.target_fg,
    r.target_abv,
    r.target_ibu,
    r.target_srm,
    r.batch_size_gallons,
    r.boil_time_min,
    r.mash_temp_f,
    r.ingredients,
    r.instructions,
    r.notes,
    r.is_active,
    r.created_at,
    r.updated_at,
    r.brand_id,
    r.style_id,
    r.yeast_id,
    r.water_profile_id,
    r.created_by,
    r.volume_bbl,
    r.batch_size_bbl,
    r.preboil_volume_bbl,
    r.target_ko_volume_bbl,
    r.mash_water_volume_gal,
    r.sparge_water_volume_gal,
    r.fermentation_days,
    r.conditioning_days,
    r.whirlpool_time_min,
    r.whirlpool_temp_f,
    r.whirlpool_rest_min,
    r.target_mash_ph,
    r.mash_efficiency,
    r.water_to_grain_ratio,
    r.target_ko_temp_f,
    r.target_attenuation,
    r.target_pitching_rate,
    r.yeast_nutrient_amount_g,
    r.mash_schedule,
    r.fermentation_schedule,
    r.brew_day_notes,
    r.tasting_notes,
    r.development_notes,
    r.water_addition_profile_id,
    r.is_template,
    r.status,
    bs.name AS style_name,
    CASE
        WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN round(1 + gt.total_points * COALESCE(r.mash_efficiency, 75) / 100 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000, 3)
        ELSE NULL::numeric
    END AS est_og,
    CASE
        WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN round(1 + gt.total_points * COALESCE(r.mash_efficiency, 75) / 100 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000 * (1 - COALESCE(r.target_attenuation, y.attenuation_typical, 75) / 100), 3)
        ELSE NULL::numeric
    END AS est_fg,
    CASE
        WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN round(gt.total_points * COALESCE(r.mash_efficiency, 75) / 100 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000 * COALESCE(r.target_attenuation, y.attenuation_typical, 75) / 100 * 131.25, 1)
        ELSE NULL::numeric
    END AS est_abv,
    CASE
        WHEN hi.weighted_ibu_factor IS NOT NULL AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN round(hi.weighted_ibu_factor * 74.89 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31))
        ELSE NULL::numeric
    END AS est_ibu,
    CASE
        WHEN gt.mcu_sum IS NOT NULL AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN round(1.4922 * power(gt.mcu_sum / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31), 0.6859), 1)
        ELSE NULL::numeric
    END AS est_srm,
    NULL::numeric AS est_cogs,
    COALESCE(bc.batch_count, 0) AS batch_count,
    r.pricing_tier_id
FROM recipes r
    LEFT JOIN beer_styles bs ON bs.id = r.style_id
    LEFT JOIN grain_totals gt ON gt.recipe_id = r.id
    LEFT JOIN hop_ibu hi ON hi.recipe_id = r.id
    LEFT JOIN yeasts y ON y.id = r.yeast_id
    LEFT JOIN batch_counts bc ON bc.recipe_id = r.id;

-- =============================================================================
-- 6. INSERT default_water_profile_id INTO system_settings
-- =============================================================================

INSERT INTO system_settings (key, value, description, category) VALUES
  ('default_water_profile_id', 'null', 'Default source water profile UUID for new recipes', 'production')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 7. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples)
VALUES
  ('water_addition_profiles', 'Named, reusable sets of water salt/acid additions for recipes', 'system',
   '[{"table": "recipe_additions", "type": "hasMany", "fk": "profile_id"}, {"table": "recipes", "type": "hasMany", "fk": "water_addition_profile_id"}]'::jsonb,
   '["id", "name", "is_active"]'::jsonb,
   '["Show all water addition profiles", "What water salts does the Hoppy IPA profile use?"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;
```

**Step 2: Apply migration to Supabase**

Apply via the Supabase MCP `apply_migration` tool. Project ID from `list_projects`.

**Step 3: Regenerate TypeScript types**

Run: `pnpm supabase gen types typescript --project-id <PROJECT_ID> > src/types/supabase.ts`

Or use the Supabase MCP `generate_typescript_types` tool and write the output to `src/types/supabase.ts`.

**Step 4: Commit**

```
git add supabase/migrations/00096_water_addition_profiles.sql src/types/supabase.ts
git commit -m "feat: add water_addition_profiles table and schema changes"
```

---

### Task 2: Query Keys

**Files:**
- Modify: `src/lib/query-keys.ts`

**Step 1: Add waterAdditionProfileKeys factory**

Add after the existing `catalogKeys` section:

```typescript
export const waterAdditionProfileKeys = {
  all: () => ["water_addition_profiles"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters
      ? ([...waterAdditionProfileKeys.all(), "list", filters] as const)
      : ([...waterAdditionProfileKeys.all(), "list"] as const),
  detail: (id: string) =>
    [...waterAdditionProfileKeys.all(), "detail", id] as const,
  items: (profileId: string) =>
    [...waterAdditionProfileKeys.all(), "items", profileId] as const,
};
```

**Step 2: Verify**

Run: `pnpm typecheck`

**Step 3: Commit**

```
git add src/lib/query-keys.ts
git commit -m "feat: add waterAdditionProfileKeys query key factory"
```

---

### Task 3: Zod Schema Update

**Files:**
- Modify: `src/lib/schemas/recipe.ts`

**Step 1: Replace `use_default_additions` with `water_addition_profile_id`**

In the recipe schema object, find:
```typescript
use_default_additions: z.boolean().default(true),
```

Replace with:
```typescript
water_addition_profile_id: z.string().uuid().nullable().optional(),
```

**Step 2: Create water addition profile Zod schema**

Add a new file: `src/lib/schemas/water-addition-profile.ts`

```typescript
/**
 * Water Addition Profile Zod Schema
 *
 * Validation for named water salt/acid addition profiles.
 */

import { z } from "zod";

export const waterAdditionProfileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
});

export type WaterAdditionProfileFormValues = z.infer<typeof waterAdditionProfileSchema>;
```

**Step 3: Verify**

Run: `pnpm typecheck`

**Step 4: Commit**

```
git add src/lib/schemas/recipe.ts src/lib/schemas/water-addition-profile.ts
git commit -m "feat: update recipe schema, add water addition profile schema"
```

---

### Task 4: Water Addition Profile Entity Config

**Files:**
- Create: `src/entities/water-addition-profile.tsx`

**Step 1: Write entity config**

Reference `src/entities/yeast-strain.tsx` for the pattern. This is a lightweight Settings entity.

```typescript
/**
 * Water Addition Profile Entity Configuration
 *
 * Named, reusable sets of water salt/acid additions (e.g., "Hoppy IPA Salts").
 * Managed under Settings domain. Profile items are stored in recipe_additions
 * with profile_id FK.
 */

import type { EntityConfig } from "@/types/entity";
import { waterAdditionProfileSchema } from "@/lib/schemas/water-addition-profile";
import type { Database } from "@/types/supabase";
import { ProfileAdditionsEditor } from "@/components/domain/profile-additions-editor";

type WaterAdditionProfile =
  Database["public"]["Tables"]["water_addition_profiles"]["Row"];

export const waterAdditionProfileEntity: EntityConfig<WaterAdditionProfile> = {
  name: "water_addition_profile",
  table: "water_addition_profiles",
  displayName: "Water Addition Profile",
  displayNamePlural: "Water Addition Profiles",
  description:
    "Named, reusable sets of water salt/acid additions for recipes",
  domain: "system",

  // List View
  listColumns: [
    { accessorKey: "name", header: "Name", sortable: true },
    {
      accessorKey: "description",
      header: "Description",
      sortable: false,
      render: (value) => (value ? String(value) : "—"),
    },
    {
      accessorKey: "is_active",
      header: "Active",
      sortable: true,
      render: (value) => (value ? "Yes" : "No"),
    },
  ],

  listFilters: [
    { field: "is_active", type: "boolean", label: "Active" },
  ],

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name", "description"],

  // Detail View
  detailHeader: { title: "name" },

  sections: [
    {
      id: "overview",
      title: "Profile Info",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          placeholder: "e.g., Hoppy IPA Salts",
          required: true,
          colSpan: 6,
        },
        {
          name: "is_active",
          label: "Active",
          type: "switch",
          description:
            "Inactive profiles hidden from recipe dropdowns",
          defaultValue: true,
          colSpan: 6,
        },
        {
          name: "description",
          label: "Description",
          type: "textarea",
          placeholder:
            "Describe when to use this profile...",
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
    {
      id: "additions",
      title: "Salt & Acid Additions",
      component: ProfileAdditionsEditor,
    },
  ],

  formSchema: waterAdditionProfileSchema,

  actions: [
    {
      name: "delete",
      label: "Delete Profile",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard",
    },
  ],

  keyFields: ["name", "is_active"],
};
```

**Step 2: Register in entity index**

Modify `src/entities/index.ts`:

Add import:
```typescript
import { waterAdditionProfileEntity } from "./water-addition-profile";
```

Add registration in the "Settings domain" section:
```typescript
registerEntity(waterAdditionProfileEntity);
```

Add re-export:
```typescript
export { waterAdditionProfileEntity } from "./water-addition-profile";
export type { WaterAdditionProfileFormValues } from "@/lib/schemas/water-addition-profile";
```

**Step 3: Verify**

Run: `pnpm typecheck` (will fail until ProfileAdditionsEditor exists — that's expected, continue to next task)

**Step 4: Commit**

```
git add src/entities/water-addition-profile.tsx src/entities/index.ts
git commit -m "feat: add water addition profile entity config and registry"
```

---

### Task 5: Profile Additions Editor Component

**Files:**
- Create: `src/components/domain/profile-additions-editor.tsx`

**Step 1: Write the component**

This adapts the existing `AdditionsEditor` pattern but:
- Filters the additive catalog to `water_salt` and `acid` types only
- Fetches/saves items with `profile_id` instead of `recipe_id`
- Used as a custom section component on the entity detail page

Reference: `src/components/domain/additions-editor.tsx` for the catalog fetching, `AdditionItem` type, and table rendering patterns.

```typescript
"use client";

/**
 * ProfileAdditionsEditor - Manages salt/acid items within a water addition profile.
 *
 * Custom section component for the water_addition_profile entity detail view.
 * Fetches profile items from recipe_additions (where profile_id = this profile),
 * filtered to water_salt and acid additive types only.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useCatalog } from "@/hooks/use-catalog";
import { waterAdditionProfileKeys } from "@/lib/query-keys";
import { catalogKeys } from "@/lib/query-keys";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Check, ChevronsUpDown, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

// Water chemistry additive types only
const WATER_CHEMISTRY_TYPES = ["water_salt", "acid"];

const TIMING_OPTIONS = [
  { value: "mash", label: "Mash" },
  { value: "sparge", label: "Sparge" },
  { value: "boil", label: "Boil" },
] as const;

const TARGET_OPTIONS = [
  { value: "mash", label: "Mash Water" },
  { value: "sparge", label: "Sparge Water" },
  { value: "kettle", label: "Kettle" },
] as const;

const UNIT_OPTIONS = [
  { value: "g", label: "grams" },
  { value: "oz", label: "oz" },
  { value: "tsp", label: "tsp" },
  { value: "tbsp", label: "tbsp" },
  { value: "ml", label: "mL" },
  { value: "tablets", label: "tablets" },
] as const;

interface AdditiveCatalogItem {
  id: string;
  name: string;
  type: string;
  description: string | null;
  typical_amount: number | null;
  typical_unit: string | null;
}

interface ProfileItem {
  id?: string;
  additive_id: string;
  amount: number;
  unit: string;
  timing: string;
  target?: string;
  position: number;
  additive?: AdditiveCatalogItem;
}

interface ProfileAdditionsEditorProps {
  data: { id: string | null };
  editing?: boolean;
}

export function ProfileAdditionsEditor({ data }: ProfileAdditionsEditorProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const profileId = data.id;
  const [addOpen, setAddOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [localItems, setLocalItems] = useState<ProfileItem[] | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch profile items
  const { data: serverItems, isLoading } = useQuery({
    queryKey: waterAdditionProfileKeys.items(profileId!),
    enabled: !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_additions")
        .select(`
          id, additive_id, amount, unit, timing, target, position,
          additives:additives (id, name, type, description, typical_amount, typical_unit)
        `)
        .eq("profile_id", profileId!)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data || []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        additive_id: row.additive_id as string,
        amount: row.amount as number,
        unit: row.unit as string,
        timing: row.timing as string,
        target: (row.target as string) || undefined,
        position: row.position as number,
        additive: row.additives as AdditiveCatalogItem,
      }));
    },
  });

  const items = localItems ?? serverItems ?? [];

  // Fetch additives catalog — water_salt and acid only
  const { data: fullCatalog = [] } = useCatalog<AdditiveCatalogItem>(
    catalogKeys.additives(),
    "additives",
    "id, name, type, description, typical_amount, typical_unit",
    ["type", "name"]
  );

  const waterChemistryCatalog = useMemo(
    () => fullCatalog.filter((a) => WATER_CHEMISTRY_TYPES.includes(a.type)),
    [fullCatalog]
  );

  // Group by type for command palette
  const catalogByType = useMemo(() => {
    const groups: Record<string, AdditiveCatalogItem[]> = {};
    for (const item of waterChemistryCatalog) {
      const type = item.type;
      if (!groups[type]) groups[type] = [];
      groups[type].push(item);
    }
    return groups;
  }, [waterChemistryCatalog]);

  // Exclude already-added
  const addedIds = useMemo(() => new Set(items.map((i) => i.additive_id)), [items]);

  const handleAdd = useCallback(
    (additive: AdditiveCatalogItem) => {
      if (addedIds.has(additive.id)) {
        setAddOpen(false);
        return;
      }
      const newItem: ProfileItem = {
        additive_id: additive.id,
        amount: additive.typical_amount || 0,
        unit: additive.typical_unit || "g",
        timing: "mash",
        target: "mash",
        position: items.length,
        additive,
      };
      setLocalItems([...items, newItem]);
      setHasChanges(true);
      setAddOpen(false);
      setSearchValue("");
    },
    [items, addedIds]
  );

  const handleUpdate = useCallback(
    (index: number, field: keyof ProfileItem, value: unknown) => {
      const updated = [...items];
      updated[index] = { ...updated[index], [field]: value };
      setLocalItems(updated);
      setHasChanges(true);
    },
    [items]
  );

  const handleRemove = useCallback(
    (index: number) => {
      const updated = items.filter((_, i) => i !== index);
      updated.forEach((item, i) => { item.position = i; });
      setLocalItems(updated);
      setHasChanges(true);
    },
    [items]
  );

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      // Delete existing profile items
      const { error: deleteError } = await supabase
        .from("recipe_additions")
        .delete()
        .eq("profile_id", profileId!);
      if (deleteError) throw deleteError;

      if (items.length > 0) {
        const insertData = items.map((item, index) => ({
          profile_id: profileId,
          additive_id: item.additive_id,
          amount: item.amount,
          unit: item.unit,
          timing: item.timing,
          target: item.target || null,
          position: index,
        }));

        const { error: insertError } = await supabase
          .from("recipe_additions")
          .insert(insertData);
        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: waterAdditionProfileKeys.items(profileId!),
      });
      setLocalItems(null);
      setHasChanges(false);
      toast.success("Profile additions saved");
    },
    onError: (error) => {
      toast.error("Failed to save: " + error.message);
    },
  });

  if (!profileId) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        Save the profile first, then add salt and acid additions.
      </p>
    );
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-4">Loading...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add Salt / Acid
              <ChevronsUpDown className="h-3 w-3 ml-1 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <Command>
              <CommandInput
                placeholder="Search additives..."
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList>
                <CommandEmpty>No additives found.</CommandEmpty>
                {Object.entries(catalogByType).map(([type, additivesInType]) => (
                  <CommandGroup
                    key={type}
                    heading={type === "water_salt" ? "Water Salts" : "Acids"}
                  >
                    {additivesInType
                      .filter((a) => !addedIds.has(a.id))
                      .map((additive) => (
                        <CommandItem
                          key={additive.id}
                          value={additive.name}
                          onSelect={() => handleAdd(additive)}
                        >
                          <Check
                            className={`mr-2 h-4 w-4 ${
                              addedIds.has(additive.id) ? "opacity-100" : "opacity-0"
                            }`}
                          />
                          {additive.name}
                          {additive.description && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {additive.description}
                            </span>
                          )}
                        </CommandItem>
                      ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {hasChanges && (
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save Additions
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No additions yet. Add water salts or acids above.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Additive</TableHead>
              <TableHead className="w-24">Amount</TableHead>
              <TableHead className="w-24">Unit</TableHead>
              <TableHead className="w-28">Timing</TableHead>
              <TableHead className="w-28">Target</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => (
              <TableRow key={item.additive_id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {item.additive?.name || "Unknown"}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {item.additive?.type === "water_salt"
                        ? "Salt"
                        : "Acid"}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={item.amount}
                    onChange={(e) =>
                      handleUpdate(index, "amount", parseFloat(e.target.value) || 0)
                    }
                    className="w-20 h-8"
                    step="0.1"
                    min="0"
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={item.unit}
                    onValueChange={(v) => handleUpdate(index, "unit", v)}
                  >
                    <SelectTrigger className="w-20 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNIT_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select
                    value={item.timing}
                    onValueChange={(v) => handleUpdate(index, "timing", v)}
                  >
                    <SelectTrigger className="w-24 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMING_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select
                    value={item.target || "mash"}
                    onValueChange={(v) => handleUpdate(index, "target", v)}
                  >
                    <SelectTrigger className="w-28 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TARGET_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(index)}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

**Step 2: Verify**

Run: `pnpm typecheck`

**Step 3: Commit**

```
git add src/components/domain/profile-additions-editor.tsx
git commit -m "feat: add ProfileAdditionsEditor component for water addition profiles"
```

---

### Task 6: Settings Pages for Water Addition Profiles

**Files:**
- Create: `src/app/(app)/settings/water-addition-profiles/page.tsx`
- Create: `src/app/(app)/settings/water-addition-profiles/new/page.tsx`
- Create: `src/app/(app)/settings/water-addition-profiles/[id]/page.tsx`

**Step 1: Write pages**

Follow the exact pattern from `src/app/(app)/settings/yeasts/` pages.

**List page** (`settings/water-addition-profiles/page.tsx`):
```typescript
"use client";

/**
 * Water Addition Profiles Settings Page
 *
 * Manage reusable water salt/acid addition profiles.
 */

import { EntityList } from "@/components/universal/entity-list";
import { waterAdditionProfileEntity } from "@/entities/water-addition-profile";

export default function WaterAdditionProfilesPage() {
  return (
    <EntityList
      entity={waterAdditionProfileEntity}
      basePath="/settings/water-addition-profiles"
    />
  );
}
```

**New page** (`settings/water-addition-profiles/new/page.tsx`):
```typescript
"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { waterAdditionProfileEntity } from "@/entities/water-addition-profile";

export default function NewWaterAdditionProfilePage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={waterAdditionProfileEntity}
      basePath="/settings/water-addition-profiles"
    />
  );
}
```

**Detail page** (`settings/water-addition-profiles/[id]/page.tsx`):
```typescript
"use client";

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { waterAdditionProfileEntity } from "@/entities/water-addition-profile";

export default function WaterAdditionProfileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={waterAdditionProfileEntity}
      id={id}
      basePath="/settings/water-addition-profiles"
    />
  );
}
```

**Step 2: Add to settings navigation**

Modify `src/app/(app)/settings/layout.tsx`:

Add a new group after "Catalogs" (or within Catalogs — fits naturally):

In the `settingsNav` array, add to the "Catalogs" group:
```typescript
{ label: "Water Profiles", href: "/settings/water-addition-profiles" },
```

Add it after "Yeast Strains" in the Catalogs items array.

**Step 3: Verify**

Run: `pnpm typecheck`

**Step 4: Commit**

```
git add src/app/\(app\)/settings/water-addition-profiles/ src/app/\(app\)/settings/layout.tsx
git commit -m "feat: add water addition profile settings pages and navigation"
```

---

### Task 7: Update Recipe Entity Config

**Files:**
- Modify: `src/entities/recipe.tsx`

**Step 1: Replace `use_default_additions` with `water_addition_profile_id`**

In the unified `sections` array, find the Fermentation section (id: "fermentation"). Locate the field:

```typescript
{
  name: "use_default_additions",
  label: "Use Default Water Additions",
  type: "switch",
  defaultValue: true,
  colSpan: 6,
},
```

Replace with:

```typescript
{
  name: "water_addition_profile_id",
  label: "Water Addition Profile",
  type: "relation",
  relation: {
    entity: "water_addition_profile",
    displayField: "name",
  },
  placeholder: "Select addition profile...",
  colSpan: 6,
},
```

**Step 2: Do the same in the legacy `formFields` array**

Find the same `use_default_additions` field in `formFields` and replace with the same relation field definition.

**Step 3: Verify**

Run: `pnpm typecheck`

**Step 4: Commit**

```
git add src/entities/recipe.tsx
git commit -m "feat: replace use_default_additions with water_addition_profile_id on recipe"
```

---

### Task 8: Update Recipe Additions Display

**Files:**
- Modify: `src/components/domain/recipe-additions-display.tsx`

**Step 1: Split display into water treatment and other additions**

The component currently shows all recipe additions. Update it to:

1. Accept the recipe's `water_addition_profile_id` from `data`
2. If a profile is linked, fetch and display the profile's water chemistry items (read-only, with link to profile page)
3. Show recipe-specific non-water additions below (clarifiers, nutrients, etc.)

Key changes:
- Add a query for profile items when `data.water_addition_profile_id` is set
- Filter recipe-specific additions to exclude water_salt and acid types (those come from the profile)
- Add a visual section header for "Water Treatment" showing the linked profile name + items
- Keep existing "Other Additions" section for recipe-specific items

**Step 2: Verify**

Run: `pnpm typecheck`

**Step 3: Commit**

```
git add src/components/domain/recipe-additions-display.tsx
git commit -m "feat: split recipe additions display into water treatment and other additions"
```

---

### Task 9: Update Recipe Additions Page

**Files:**
- Modify: `src/app/(app)/production/recipes/[id]/additions/page.tsx`

**Step 1: Remove `use_default_additions` reference**

In the recipe query (line 40), change:
```typescript
.select("id, name, use_default_additions")
```
to:
```typescript
.select("id, name, water_addition_profile_id")
```

**Step 2: Filter out water chemistry additions**

The additions editor should only show non-water additions (clarifiers, nutrients, etc.) since water chemistry now comes from profiles. After fetching recipe additions, filter them:

```typescript
// Filter to non-water-chemistry additions only
const nonWaterAdditions = additions.filter(
  (a) => !["water_salt", "acid"].includes(a.additives?.type || "")
);
```

Use the filtered list as the initial state and in the save mutation.

**Step 3: Update page title/description**

Change the page header from "Manage Additions" to something clearer like "Recipe Additions" with a note that water chemistry is managed via profiles.

**Step 4: Verify**

Run: `pnpm typecheck`

**Step 5: Commit**

```
git add src/app/\(app\)/production/recipes/\[id\]/additions/page.tsx
git commit -m "feat: filter water chemistry from recipe additions page"
```

---

### Task 10: Documentation Updates

**Files:**
- Modify: `docs/data-model/production.md`
- Modify: `docs/data-model/catalog.md`
- Modify: `docs/spec/decisions.md`

**Step 1: Update production.md**

In the `recipes` table section:
- Remove `use_default_additions` row
- Add `water_addition_profile_id | UUID | FK to water_addition_profiles (optional)`

In the `recipe_additions` table section:
- Remove `is_default` row
- Add `profile_id | UUID | FK to water_addition_profiles (NULL for recipe items)`
- Update the description to explain the dual-purpose pattern (profile items vs recipe items)

**Step 2: Update catalog.md**

Add a new section for `water_addition_profiles` table with the column table.

**Step 3: Update decisions.md**

Add a new decision:

```markdown
### DEC-WATER-001: Water Addition Profiles (Status: Implemented)

Replace the non-functional `use_default_additions` toggle with named, reusable water addition profiles.

- Water profiles = source water chemistry (existing `water_profiles` table)
- Addition profiles = named salt/acid addition sets (new `water_addition_profiles` table)
- Profile items stored in `recipe_additions` with `profile_id` FK (no schema duplication)
- Recipes link to a profile via `water_addition_profile_id` FK
- Non-water additions (clarifiers, nutrients) remain recipe-specific in `recipe_additions`
- Default source water profile configurable in `system_settings`
```

**Step 4: Commit**

```
git add docs/
git commit -m "docs: update data model and decisions for water addition profiles"
```

---

### Task 11: Final Verification

**Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: zero errors

**Step 2: Run lint**

Run: `pnpm lint`
Expected: zero new errors

**Step 3: Run Supabase security advisors**

Use `get_advisors` MCP tool to check for missing RLS or other issues on the new table.

**Step 4: Smoke test checklist**

- [ ] Navigate to `/settings/water-addition-profiles/` — list page loads
- [ ] Create a new profile with name + description
- [ ] Add water salt and acid items to the profile
- [ ] Save additions
- [ ] Navigate to a recipe detail page — `water_addition_profile_id` dropdown appears
- [ ] Select a profile on a recipe, save — profile linked
- [ ] Recipe additions section shows water treatment from profile + other additions separately
- [ ] Edit mode on recipe — profile dropdown works, forms save correctly
- [ ] Create mode on recipe — profile dropdown available

**Step 5: Commit any fixes, then final commit**

```
git add -A
git commit -m "fix: final verification fixes for water addition profiles"
```
