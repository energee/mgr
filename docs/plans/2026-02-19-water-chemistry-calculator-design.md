# Water Chemistry Auto-Calculator Design

## Goal

Auto-calculate salt additions from target ppm values and a source water profile, integrated into the water addition profile editor with a read-only summary on recipe pages.

## Architecture

Target ppm values and a source water profile FK are stored on the `water_addition_profiles` table. The existing `src/lib/water-chemistry.ts` calculation engine computes salt additions from the source→target delta. The profile editor auto-fills additions live as targets are typed. Recipes show a read-only source/target/resulting summary scaled to batch volume.

## Schema Changes

Add columns to `water_addition_profiles`:

```sql
ALTER TABLE water_addition_profiles
  ADD COLUMN water_profile_id UUID REFERENCES water_profiles(id) ON DELETE SET NULL,
  ADD COLUMN target_calcium_ppm DECIMAL(6,1),
  ADD COLUMN target_magnesium_ppm DECIMAL(6,1),
  ADD COLUMN target_sodium_ppm DECIMAL(6,1),
  ADD COLUMN target_sulfate_ppm DECIMAL(6,1),
  ADD COLUMN target_chloride_ppm DECIMAL(6,1),
  ADD COLUMN target_bicarbonate_ppm DECIMAL(6,1),
  ADD COLUMN target_ph DECIMAL(3,1);
```

All nullable. No targets = manual-only mode (backward compatible). No changes to `recipe_additions`, `additives`, or `recipes` tables.

## Addition Profile Editor

### New Section: Water Chemistry Targets

Above the existing additions table:

- **Source water profile** — relation dropdown fetching from `water_profiles`
- **Target ppm fields** — compact row of 7 fields (Ca²⁺, Mg²⁺, Na⁺, SO₄²⁻, Cl⁻, HCO₃⁻, pH), same layout as the water profile mineral fields

### Auto-Calculation Flow

1. User picks a source water profile and enters target ppm values
2. Calculator runs `calculateAdditions(source, target, 1)` at 1 gal unit rate
3. Results map to `additives` catalog rows via a salt-name→additive-id lookup
4. Non-overridden additions in the table auto-populate with calculated amounts
5. Changing a target recalculates non-overridden salts only
6. A "Resulting Profile" summary shows final water chemistry (source + contributions)

### Manual Overrides

- User can edit any salt amount — that row becomes "overridden"
- Override tracking is client-side: a `Set<string>` of overridden `additive_id` values
- Overridden rows get a visual indicator (subtle styling difference)
- Per-row "reset" button clears override, reverts to calculated value
- On page reload, overrides are auto-detected by comparing stored amount vs calculated amount

### Saving

Same pattern as today: delete all profile additions, re-insert updated rows. Target ppm values and source water FK are saved on the profile record itself.

## Recipe Detail Summary

Enhances the existing "Water Treatment" section in `RecipeAdditionsDisplay`. When the linked addition profile has targets set:

### Water Chemistry Summary (read-only)

- Compact table: Source | Target | Resulting per mineral
- Source = recipe's `water_profile_id` mineral values
- Target = addition profile's `target_*_ppm` values
- Resulting = source + salt contributions, scaled to recipe volume (`mash_water_volume_gal + sparge_water_volume_gal`)
- Color coding: green within ~10% of target, yellow if further off
- SO₄:Cl ratio with character label (e.g., "Balanced", "Hoppy")

### Volume Scaling

- Profile stores additions at 1 gal rate
- Recipe page multiplies by total water volume for actual amounts
- Salt table shows scaled gram amounts

Falls back to current behavior (additions table only) when recipe has no source profile or addition profile has no targets.

## Calculation Engine

Uses existing `src/lib/water-chemistry.ts` functions — no changes to core math:

- `calculateAdditions(source, target, volumeGal)` — greedy solver
- `calculateResultingProfile(source, additions, volumeGal)` — apply additions
- `SALT_CONTRIBUTIONS` — ion rates per g/gal
- `calculateSulfateChlorideRatio()` / `getRatioDescription()` — ratio display

### Mapping Layer

New utility that maps `SaltAdditions` fields to `additives` catalog entries:

```typescript
const SALT_ADDITIVE_MAP: Record<keyof SaltAdditions, string> = {
  gypsum_g: "Gypsum",
  calcium_chloride_g: "Calcium Chloride",
  epsom_salt_g: "Epsom Salt",
  baking_soda_g: "Baking Soda",
  chalk_g: "Chalk",
  table_salt_g: "Table Salt",
  magnesium_chloride_g: "Magnesium Chloride",
};
```

Resolves additive IDs from catalog at runtime. Produces `recipe_additions` rows with correct `additive_id`, amount, unit (`g`), timing (`mash`), target (`mash`).

## What Does NOT Change

- `recipe_additions` table schema
- `additives` table schema
- `recipes` table schema
- Core calculation functions in `water-chemistry.ts`
- Recipe additions page (clarifiers/nutrients editor)
- Existing addition profile behavior when no targets are set
