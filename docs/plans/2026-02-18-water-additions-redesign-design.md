# Water Additions Redesign — Design Document

Date: 2026-02-18
Branch: `bugs`

## Problem

The `use_default_additions` toggle on recipes does nothing — no code reads or writes to it. The `is_default` column on `recipe_additions` and the `recipe_id IS NULL` pattern for brewery defaults are completely dead. There is no way to create, save, or reuse water salt/acid addition sets across recipes.

## Design Decisions

1. **Water profile = source water; addition profile = salt treatment.** Independent concepts. Same tap water, different salt additions per style.
2. **Named addition profiles** — Reusable sets like "Hoppy IPA Salts" with specific salt/mineral amounts, managed as a lightweight entity under Settings domain.
3. **Water chemistry only** — Profiles contain only water salts and acids. Clarifiers, nutrients, enzymes stay as recipe-specific additions.
4. **No duplication** — Reuse `recipe_additions` table for both profile items and recipe-specific additions via a new `profile_id` FK.
5. **Default water profile in system_settings** — Brewery-wide default source water. No default addition profile needed (additions vary by style).

## Data Model

### New Table: `water_addition_profiles`

```sql
CREATE TABLE water_addition_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Lightweight metadata table for named addition profiles.

### Modified Table: `recipe_additions`

```sql
-- Add profile FK
ALTER TABLE recipe_additions
  ADD COLUMN profile_id UUID REFERENCES water_addition_profiles(id) ON DELETE CASCADE;

-- Mutual exclusivity: item belongs to a recipe OR a profile, not both
ALTER TABLE recipe_additions
  ADD CONSTRAINT recipe_additions_owner_check
  CHECK (
    (recipe_id IS NOT NULL AND profile_id IS NULL) OR
    (recipe_id IS NULL AND profile_id IS NOT NULL)
  );

-- Drop dead columns
ALTER TABLE recipe_additions DROP COLUMN is_default;

-- Index for profile lookups
CREATE INDEX idx_recipe_additions_profile
  ON recipe_additions(profile_id) WHERE profile_id IS NOT NULL;
```

Row semantics:
- `profile_id = X, recipe_id = NULL` → item belongs to an addition profile (water salts/acids)
- `recipe_id = X, profile_id = NULL` → recipe-specific addition (clarifiers, nutrients, etc.)

### Modified Table: `recipes`

```sql
-- Replace use_default_additions with profile FK
ALTER TABLE recipes
  ADD COLUMN water_addition_profile_id UUID
    REFERENCES water_addition_profiles(id) ON DELETE SET NULL;

ALTER TABLE recipes DROP COLUMN use_default_additions;
```

### System Settings

```sql
INSERT INTO system_settings (key, value, description, category) VALUES
  ('default_water_profile_id', 'null', 'Default source water profile UUID', 'production')
ON CONFLICT (key) DO NOTHING;
```

## Entity Configuration

### New: `water_addition_profile` entity

- **Domain**: system (Settings)
- **Table**: `water_addition_profiles`
- **List columns**: name, description, is_active
- **Detail view**: Name/description fields + custom `ProfileAdditionsEditor` component for managing salt/acid items
- **Form schema**: name (required), description (optional), is_active (default true)
- **Pages**: `/settings/water-addition-profiles/`, `/settings/water-addition-profiles/new`, `/settings/water-addition-profiles/[id]`

### Modified: `recipe` entity

- **Remove**: `use_default_additions` switch field from Fermentation section
- **Add**: `water_addition_profile_id` relation field (dropdown selecting from `water_addition_profiles`)
- **Additions section**: Split display into:
  - Water treatment: read-only display of linked profile's items (with link to profile)
  - Other additions: recipe-specific non-water additions (existing behavior, filtered)

## Components

### New: `ProfileAdditionsEditor`

Adapts the existing `AdditionsEditor` component, filtered to `water_salt` and `acid` additive types only. Used on the water addition profile detail page.

### Modified: `RecipeAdditionsDisplay`

Split into two visual sections:
1. **Water Treatment** — If recipe has `water_addition_profile_id`, show profile items (read-only with link to profile). If none, show "No water treatment profile selected."
2. **Other Additions** — Recipe-specific non-water additions (clarifiers, nutrients, etc.). Existing edit flow unchanged.

### Modified: Settings pages

Add a "Water" section to settings navigation containing:
- Water Profiles (existing table, needs entity config + pages — currently has no management UI)
- Water Addition Profiles (new entity)

Add `default_water_profile_id` setting to brewery settings page.

## Migration Details

Migration: `00096_water_addition_profiles.sql`

Steps:
1. Create `water_addition_profiles` table with RLS, updated_at trigger, schema registry
2. Add `profile_id` column to `recipe_additions`
3. Clean up orphaned rows (`recipe_id IS NULL`) before adding constraint
4. Add mutual exclusivity constraint
5. Drop `is_default` column from `recipe_additions`
6. Add `water_addition_profile_id` column to `recipes`
7. Drop `use_default_additions` column from `recipes`
8. Update `recipes_with_estimates` view if it references dropped column
9. Insert `default_water_profile_id` into `system_settings`
10. Update schema registry entries

## Documentation Updates

- `docs/data-model/production.md` — Update recipes table (new FK, dropped column), update recipe_additions table (new FK, dropped column, new constraint)
- `docs/data-model/catalog.md` — Add water_addition_profiles table documentation
- `docs/spec/decisions.md` — New decision: DEC-WATER-001 documenting this redesign

## Out of Scope

- Water profile entity config and management pages (table exists but has no entity config today — separate task)
- Water chemistry calculator integration with addition profiles
- Auto-calculating additions from source→target profile
- Batch-level water chemistry overrides
