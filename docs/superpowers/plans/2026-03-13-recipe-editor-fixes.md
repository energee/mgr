# Recipe Editor Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 17 issues identified during recipe editor review — type safety, UX polish, accessibility, validation, and missing guidance.

**Architecture:** All changes are within the recipe editor component tree (`src/components/domain/recipe-editor/`). No database migrations needed. Changes are additive — no breaking refactors to existing patterns.

**Tech Stack:** TypeScript, React, react-hook-form, Tanstack Query, Zod, Tailwind CSS, sonner (toast)

---

## Chunk 1: Type Safety & Code Quality (Tasks 1-4)

### Task 1: Fix unsafe type casting on schedule arrays

The `mash_schedule` and `fermentation_schedule` fields are typed as `unknown[]` in `RecipeData` but cast to `MashStep[]` / `FermentationStage[]` in sections without validation.

**Files:**
- Modify: `src/components/domain/recipe-editor/recipe-editor-context.tsx:67-68`
- Modify: `src/components/domain/recipe-editor/mash-section.tsx:42,169`
- Modify: `src/components/domain/recipe-editor/fermentation-section.tsx:40,137`

- [ ] **Step 1: Add proper types to RecipeData**

In `recipe-editor-context.tsx`, add imports:
```typescript
import type { MashStep } from "@/components/domain/mash-schedule-editor";
import type { FermentationStage } from "@/components/domain/fermentation-schedule-editor";
```

In `RecipeData` type, replace:
```typescript
mash_schedule?: unknown[] | null;
fermentation_schedule?: unknown[] | null;
```
With:
```typescript
mash_schedule?: MashStep[] | null;
fermentation_schedule?: FermentationStage[] | null;
```

- [ ] **Step 2: Remove downstream casts**

In `mash-section.tsx:42`:
```typescript
// FROM: mash_schedule: (recipe.mash_schedule as MashStep[] | null) ?? null,
// TO:   mash_schedule: recipe.mash_schedule ?? null,
```

In `mash-section.tsx:169`:
```typescript
// FROM: steps={(mashSchedule ?? []) as MashStep[]}
// TO:   steps={mashSchedule ?? []}
```

In `fermentation-section.tsx:40`:
```typescript
// FROM: fermentation_schedule: (recipe.fermentation_schedule as FermentationStage[] | null) ?? null,
// TO:   fermentation_schedule: recipe.fermentation_schedule ?? null,
```

In `fermentation-section.tsx:137`:
```typescript
// FROM: stages={(fermSchedule ?? []) as FermentationStage[]}
// TO:   stages={fermSchedule ?? []}
```

- [ ] **Step 3: Run typecheck**
- [ ] **Step 4: Commit** — `fix: replace unsafe schedule type casts with proper types in recipe editor context`

---

### Task 2: Fix unreadable callback types in fermentables-section

**Files:**
- Modify: `src/components/domain/recipe-editor/fermentables-section.tsx:88-100`

- [ ] **Step 1: Add direct type imports and simplify callbacks**

Add imports:
```typescript
import type { GrainBillItem } from "@/components/domain/grain-bill-editor";
import type { HopScheduleItem } from "@/components/domain/hop-schedule-editor";
```

Replace `handleGrainChange` (lines 88-93):
```typescript
const handleGrainChange = useCallback(
  (items: GrainBillItem[]) => { setGrainItems(items); },
  [setGrainItems]
);
```

Replace `handleHopChange` (lines 95-100):
```typescript
const handleHopChange = useCallback(
  (items: HopScheduleItem[]) => { setHopItems(items); },
  [setHopItems]
);
```

- [ ] **Step 2: Run typecheck**
- [ ] **Step 3: Commit** — `fix: replace unreadable nested type extraction with direct type imports`

---

### Task 3: Consolidate excessive useEffect syncing

**Files:**
- Modify: `src/components/domain/recipe-editor/recipe-basics-section.tsx:87-115`
- Modify: `src/components/domain/recipe-editor/water-chemistry-section.tsx:82-96`
- Modify: `src/components/domain/recipe-editor/fermentables-section.tsx:79-85`

- [ ] **Step 1: In recipe-basics-section, replace 2 useEffects with single form.watch subscription**

Keep `watchedStyleId` and `watchedBrandId` for Select `value` props. Replace lines 87-115 with:

```typescript
const watchedStyleId = form.watch("style_id");
const watchedBrandId = form.watch("brand_id");

useEffect(() => {
  const subscription = form.watch((values) => {
    const styleName = values.style_id
      ? styleOptions.find((o) => o.value === values.style_id)?.label ?? null
      : null;
    updateRecipe({
      name: values.name ?? recipe.name,
      batch_size_bbl: values.batch_size_bbl,
      boil_time_min: values.boil_time_min,
      style_id: values.style_id,
      style_name: styleName,
      brand_id: values.brand_id,
      volume_bbl: values.volume_bbl,
    });
  });
  return () => subscription.unsubscribe();
}, [form, updateRecipe, styleOptions, recipe.name]);
```

Remove `watchedName`, `watchedBatchSize`, `watchedBoilTime`, `watchedVolumeBbl`, `styleName` memo, and both useEffects.

- [ ] **Step 2: In water-chemistry-section, replace useEffect with form.watch subscription**

Keep individual watches used in JSX. Replace useEffect (lines 88-96) with:

```typescript
useEffect(() => {
  const subscription = form.watch((values) => {
    updateRecipe({
      water_profile_id: values.water_profile_id,
      target_water_profile_id: values.target_water_profile_id,
      mash_water_volume_gal: values.mash_water_volume_gal,
      sparge_water_volume_gal: values.sparge_water_volume_gal,
      preboil_volume_bbl: values.preboil_volume_bbl,
    });
  });
  return () => subscription.unsubscribe();
}, [form, updateRecipe]);
```

- [ ] **Step 3: In fermentables-section, replace useEffect with form.watch subscription**

Replace lines 79-85 with:
```typescript
useEffect(() => {
  const subscription = form.watch((values) => {
    updateRecipe({
      yeast_id: values.yeast_id,
      target_attenuation: values.target_attenuation,
      target_pitching_rate: values.target_pitching_rate,
    });
  });
  return () => subscription.unsubscribe();
}, [form, updateRecipe]);
```

Keep `watchedYeast` for the Select value prop.

- [ ] **Step 4: Run typecheck and tests**
- [ ] **Step 5: Commit** — `fix: consolidate per-field useEffect syncing into single form.watch subscription`

---

### Task 4: Extract hop utilization constants

**Files:**
- Modify: `src/components/domain/recipe-editor/recipe-estimate-calc.ts:126-133`

- [ ] **Step 1: Add exported constants object after line 81**

```typescript
export const HOP_UTILIZATION_FACTORS = {
  whirlpool: 0.05,
  mash: 0.08,
  dry_hop: 0,
} as const;
```

- [ ] **Step 2: Use constants in getHopUtilizationFactor switch cases**

```typescript
case "whirlpool": return HOP_UTILIZATION_FACTORS.whirlpool;
case "mash": return HOP_UTILIZATION_FACTORS.mash;
default: return HOP_UTILIZATION_FACTORS.dry_hop;
```

- [ ] **Step 3: Run existing tests** — all 26 should pass (no behavior change)
- [ ] **Step 4: Commit** — `refactor: extract hop utilization constants to configurable object`

---

## Chunk 2: UX Polish (Tasks 5-8)

### Task 5: Add accessibility attributes to RecipeSectionCard

**Files:**
- Modify: `src/components/domain/recipe-editor/recipe-section-card.tsx`

- [ ] **Step 1: Add aria attributes**

```typescript
const sectionId = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const contentId = `section-content-${sectionId}`;
```

On button: add `aria-expanded={!collapsed}` and `aria-controls={contentId}`.
On content div: add `id={contentId}`.

- [ ] **Step 2: Run typecheck**
- [ ] **Step 3: Commit** — `fix: add aria-expanded and aria-controls to collapsible section cards`

---

### Task 6: Persist section collapse state in sessionStorage

**Files:**
- Modify: `src/components/domain/recipe-editor/recipe-section-card.tsx`

- [ ] **Step 1: Replace useState with sessionStorage-backed state**

```typescript
const storageKey = `recipe-section-${sectionId}`;
const [collapsed, setCollapsed] = useState(() => {
  if (typeof window === "undefined") return defaultCollapsed;
  const stored = sessionStorage.getItem(storageKey);
  return stored !== null ? stored === "true" : defaultCollapsed;
});

useEffect(() => {
  sessionStorage.setItem(storageKey, String(collapsed));
}, [storageKey, collapsed]);
```

Add `useEffect` to imports.

- [ ] **Step 2: Run typecheck**
- [ ] **Step 3: Commit** — `fix: persist section collapse state in sessionStorage`

---

### Task 7: Improve empty state messages with guidance

**Files:**
- Modify: `src/components/domain/recipe-editor/recipe-sidebar.tsx:174-175,227-228`

- [ ] **Step 1: Replace messages**

Grain: `"No grains added yet. Add malts in the Fermentables section to see estimates."`
Hops: `"No hops added yet. Add hops in the Fermentables section to calculate IBU."`

- [ ] **Step 2: Commit** — `fix: add guidance text to empty grain/hop states in sidebar`

---

### Task 8: Use continuous SRM color scale

**Files:**
- Modify: `src/components/domain/recipe-editor/recipe-sidebar.tsx:21-31,143-149`

- [ ] **Step 1: Replace srmToColor with hex-based srmToHex**

```typescript
const SRM_COLORS: [number, string][] = [
  [0, "#FFE699"], [2, "#FFD878"], [4, "#FFCA5A"], [6, "#FFBF42"],
  [8, "#FBB123"], [10, "#F8A600"], [13, "#E58500"], [17, "#CE6B00"],
  [20, "#A85600"], [24, "#8D4C00"], [29, "#6B3A00"], [35, "#4C2900"],
  [40, "#361F00"],
];

function srmToHex(srm: number | null): string {
  if (!srm || srm <= 0) return SRM_COLORS[0][1];
  for (let i = SRM_COLORS.length - 1; i >= 0; i--) {
    if (srm >= SRM_COLORS[i][0]) return SRM_COLORS[i][1];
  }
  return SRM_COLORS[0][1];
}
```

- [ ] **Step 2: Update SRM display to use inline style**

```typescript
<div
  className="h-4 w-4 rounded-full border"
  style={{ backgroundColor: srmToHex(estimates.srm) }}
/>
```

Remove `cn` import if no longer used elsewhere in file.

- [ ] **Step 3: Run typecheck**
- [ ] **Step 4: Commit** — `fix: use continuous SRM hex color scale instead of discrete Tailwind classes`

---

## Chunk 3: Save UX & Error Recovery (Tasks 9-11)

### Task 9: Add Cmd+S keyboard shortcut

**Files:**
- Modify: `src/components/domain/recipe-editor/recipe-editor-page.tsx`

- [ ] **Step 1: Add Cmd+S handler inside RecipeEditorPage**

```typescript
useEffect(() => {
  function handleKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      toast.info("Use the Save button in each section to save changes");
    }
  }
  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}, []);
```

Add `toast` import from sonner. Add `useEffect` to React imports.

- [ ] **Step 2: Run typecheck**
- [ ] **Step 3: Commit** — `fix: add Cmd+S handler that prevents default and hints at section saves`

---

### Task 10: Improve optimistic lock conflict error with auto-reload

**Files:**
- Modify: `src/components/domain/recipe-editor/recipe-editor-context.tsx` — add `refreshRecipe`
- Modify: `src/components/domain/recipe-editor/recipe-editor-page.tsx` — pass `refetch`
- Modify: All 7 section files — update `onError` handlers

- [ ] **Step 1: Add refreshRecipe to context**

Add to `RecipeEditorContextValue`:
```typescript
refreshRecipe: () => void;
```

Add to `RecipeEditorProviderProps`:
```typescript
onRefresh?: () => void;
```

In provider, add:
```typescript
const refreshRecipe = useCallback(() => { onRefresh?.(); }, [onRefresh]);
```

Wire into value memo.

- [ ] **Step 2: Pass refetch from page**

In `recipe-editor-page.tsx`:
```typescript
const { data: recipe, isLoading, error, refetch } = useQuery({ ... });
<RecipeEditorProvider initialRecipe={recipe} onRefresh={refetch}>
```

- [ ] **Step 3: Update onError in all 7 sections**

Each section destructures `refreshRecipe` from `useRecipeEditor()` and uses:
```typescript
onError: (error) => {
  if (error.message?.includes("version") || error.message?.includes("conflict")) {
    toast.error("Someone else edited this recipe. Reloading...", {
      description: "Your changes were not saved.",
    });
    refreshRecipe();
  } else {
    toast.error(error.message);
  }
},
```

Sections: recipe-basics, fermentables, water-chemistry, mash, whirlpool, knockout, fermentation.

- [ ] **Step 4: Run typecheck**
- [ ] **Step 5: Commit** — `fix: auto-reload recipe on version conflict instead of generic error`

---

### Task 11: Wire isDirty to FermentablesSection card

**Files:**
- Modify: `src/components/domain/recipe-editor/fermentables-section.tsx:141`

- [ ] **Step 1: Add isDirty prop to card**

```typescript
// FROM: <RecipeSectionCard title="Fermentables & Ingredients">
// TO:   <RecipeSectionCard title="Fermentables & Ingredients" isDirty={isDirty}>
```

- [ ] **Step 2: Commit** — `fix: wire isDirty indicator to Fermentables section card`

---

## Chunk 4: Mobile & New Recipe (Tasks 12-13)

### Task 12: Add sticky mobile estimates bar

**Files:**
- Modify: `src/components/domain/recipe-editor/recipe-editor-page.tsx`

- [ ] **Step 1: Add MobileEstimatesBar component**

Add after the header, before the grid, inside the provider:

```typescript
{/* Mobile sticky estimates bar */}
<div className="lg:hidden sticky top-0 z-10 -mx-4 px-4 py-2 bg-background/95 backdrop-blur border-b">
  <MobileEstimatesBar />
</div>
```

Component definition (in same file):
```typescript
function MobileEstimatesBar() {
  const { estimates } = useRecipeEditor();
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex gap-4">
        <span><span className="text-muted-foreground">OG</span>{" "}<span className="font-mono font-medium">{estimates.og?.toFixed(3) ?? "—"}</span></span>
        <span><span className="text-muted-foreground">FG</span>{" "}<span className="font-mono font-medium">{estimates.fg?.toFixed(3) ?? "—"}</span></span>
        <span><span className="text-muted-foreground">ABV</span>{" "}<span className="font-mono font-medium">{estimates.abv !== null ? `${estimates.abv}%` : "—"}</span></span>
        <span><span className="text-muted-foreground">IBU</span>{" "}<span className="font-mono font-medium">{estimates.ibu?.toString() ?? "—"}</span></span>
        <span><span className="text-muted-foreground">SRM</span>{" "}<span className="font-mono font-medium">{estimates.srm?.toString() ?? "—"}</span></span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**
- [ ] **Step 3: Commit** — `fix: add sticky mobile estimates bar for always-visible recipe stats`

---

### Task 13: Simplify new recipe form

**Files:**
- Modify: `src/types/entity.ts` — add `hideOnCreate` to Section type
- Modify: `src/components/universal/entity-detail-unified.tsx` — filter sections
- Modify: `src/entities/recipe.tsx` — mark advanced sections

- [ ] **Step 1: Check if hideOnCreate already exists in entity types**

Search `src/types/entity.ts` for `hideOnCreate`.

- [ ] **Step 2: Add hideOnCreate to Section type if missing**

```typescript
/** Hide this section when creating a new entity */
hideOnCreate?: boolean;
```

- [ ] **Step 3: Filter in EntityDetailUnified**

```typescript
const visibleSections = entity.sections?.filter(
  (s) => !(isCreate && s.hideOnCreate)
) ?? [];
```

- [ ] **Step 4: Mark sections in recipe entity**

Add `hideOnCreate: true` to: estimates, ai-analysis, volumes, mash, boil, fermentation, mash_schedule, fermentation_schedule, additions, revision-history.

Keep on create: overview, notes.

- [ ] **Step 5: Run typecheck**
- [ ] **Step 6: Commit** — `fix: hide advanced sections on new recipe form for simpler creation flow`

---

## Chunk 5: Testing (Task 14)

### Task 14: Add missing estimate calc tests

**Files:**
- Modify: `src/components/domain/recipe-editor/__tests__/recipe-estimate-calc.test.ts`

- [ ] **Step 1: Add gravity-adjusted utilization test**

```typescript
it("adjusts hop utilization based on calculated OG (gravity correction)", () => {
  const highGravityGrains: EstimateGrainItem[] = [
    { weight_lbs: 600, potential_ppg: 37, color_lovibond: 2 },
  ];
  const lowGravityGrains: EstimateGrainItem[] = [
    { weight_lbs: 200, potential_ppg: 37, color_lovibond: 2 },
  ];
  const hops: EstimateHopItem[] = [
    { weight_oz: 16, alpha_acid: 13, timing: "boil", boil_time_min: 60 },
  ];

  const highGravity = calculateEstimates({
    grainItems: highGravityGrains, hopItems: hops, batchSizeBbl: 7, mashEfficiency: 75,
  });
  const lowGravity = calculateEstimates({
    grainItems: lowGravityGrains, hopItems: hops, batchSizeBbl: 7, mashEfficiency: 75,
  });

  const highUtil = getHopUtilizationFactor("boil", 60, highGravity.og);
  const lowUtil = getHopUtilizationFactor("boil", 60, lowGravity.og);
  expect(highUtil).toBeLessThan(lowUtil);
});
```

- [ ] **Step 2: Add first_wort parity test**

```typescript
it("first_wort utilization matches 60-min boil at same gravity", () => {
  const gravity = 1.055;
  expect(getHopUtilizationFactor("first_wort", null, gravity))
    .toBeCloseTo(getHopUtilizationFactor("boil", 60, gravity), 6);
});
```

- [ ] **Step 3: Add rounding precision test**

```typescript
it("applies consistent rounding: OG/FG 3dp, ABV/SRM 1dp, IBU integer", () => {
  const result = calculateEstimates({
    grainItems: [{ weight_lbs: 372, potential_ppg: 37, color_lovibond: 5 }],
    hopItems: [{ weight_oz: 16, alpha_acid: 13, timing: "boil", boil_time_min: 60 }],
    batchSizeBbl: 7, mashEfficiency: 75, targetAttenuation: 75,
  });
  expect(result.og!.toString().split(".")[1]?.length).toBeLessThanOrEqual(3);
  expect(result.fg!.toString().split(".")[1]?.length).toBeLessThanOrEqual(3);
  expect(result.abv!.toString().split(".")[1]?.length).toBeLessThanOrEqual(1);
  expect(result.srm!.toString().split(".")[1]?.length).toBeLessThanOrEqual(1);
  expect(Number.isInteger(result.ibu)).toBe(true);
});
```

- [ ] **Step 4: Run tests** — all should pass
- [ ] **Step 5: Commit** — `test: add gravity-adjusted utilization, first_wort parity, and rounding tests`

---

## Deferred Items

| Issue | Reason |
|-------|--------|
| Status transition validation gates | Requires changes to universal entity state machine system |
| Grain/hop auto-save | Requires changes to GrainBillSection/HopScheduleSection APIs |
| Style compliance indicator in sidebar | Requires wiring AI analysis DB functions to client |
| Recipe scaling | New feature, needs separate brainstorm |

---

## Summary

| Task | Description | Priority |
|------|-------------|----------|
| 1 | Fix unsafe schedule type casts | HIGH |
| 2 | Fix unreadable callback types | HIGH |
| 3 | Consolidate useEffect syncing | HIGH |
| 4 | Extract hop utilization constants | MEDIUM |
| 5 | Add accessibility to section card | LOW |
| 6 | Persist collapse state | LOW |
| 7 | Improve empty state guidance | LOW |
| 8 | Continuous SRM color scale | LOW |
| 9 | Add Cmd+S keyboard shortcut | MEDIUM |
| 10 | Optimistic lock conflict recovery | MEDIUM |
| 11 | Wire isDirty to Fermentables card | MEDIUM |
| 12 | Mobile sticky estimates bar | MEDIUM |
| 13 | Simplify new recipe form | MEDIUM |
| 14 | Add missing estimate calc tests | LOW |

**Parallelism:** Tasks 1-4 are independent. Tasks 5-8 are independent. Tasks 9-11 have dependency on Task 10's context changes. Tasks 12-13 are independent. Task 14 is independent.
