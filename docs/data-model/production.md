# Production Domain

## `brands`

Manufactured products (beers, ciders, wines, etc.). A brand represents a finished product that may be produced from one or more recipes.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Brand name (unique per brewery) |
| style_id | UUID | FK to [beer_styles](./catalog.md#beer_styles) |
| description | TEXT | Brand description |
| abv | DECIMAL(3,1) | ABV (0-30) |
| variant | TEXT | Machine name/slug (lowercase, dashes) |
| hops | JSONB | Display hops for marketing (not recipe) |
| untappd_url | TEXT | Untappd profile URL |
| untappd_rating | DECIMAL(3,2) | Untappd rating (0-5, auto-fetched) |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**hops schema:**
```json
[
  { "hop_id": "uuid", "name": "Citra" },
  { "hop_id": "uuid", "name": "Mosaic" }
]
```

---

## `water_profiles`

Reusable water profiles (source water chemistry). Single source of truth for all water chemistry data.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Profile name (e.g., "Burton", "Pilsen", "House Water") |
| calcium_ppm | DECIMAL(6,1) | Calcium (Ca) ppm |
| magnesium_ppm | DECIMAL(6,1) | Magnesium (Mg) ppm |
| sodium_ppm | DECIMAL(6,1) | Sodium (Na) ppm |
| sulfate_ppm | DECIMAL(6,1) | Sulfate (SO4) ppm |
| chloride_ppm | DECIMAL(6,1) | Chloride (Cl) ppm |
| bicarbonate_ppm | DECIMAL(6,1) | Bicarbonate (HCO3) ppm |
| ph | DECIMAL(3,1) | Source water pH |
| description | TEXT | Notes about this profile |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Default profile**: The brewery's default water profile is set via `settings.default_water_profile_id`. Recipes without a specific `water_profile_id` use this default.

---

## `recipes`

Brewing recipes with all parameters. Ingredients are stored in junction tables for queryability and referential integrity.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Recipe name |
| brand_id | UUID | FK to [brands](#brands) (optional) |
| style_id | UUID | FK to [beer_styles](./catalog.md#beer_styles) |
| yeast_id | UUID | FK to [yeasts](./catalog.md#yeasts) |
| water_profile_id | UUID | FK to [water_profiles](#water_profiles) |
| created_by | UUID | FK to auth.users |
| **Volumes** | | |
| volume_bbl | DECIMAL(8,2) | Recipe volume in BBL |
| batch_size_bbl | DECIMAL(8,2) | Target batch size in BBL |
| preboil_volume_bbl | DECIMAL(8,2) | Pre-boil volume |
| target_ko_volume_bbl | DECIMAL(8,2) | Target knock-out volume |
| mash_water_volume_gal | DECIMAL(8,2) | Mash water volume |
| sparge_water_volume_gal | DECIMAL(8,2) | Sparge water volume |
| **Times** | | |
| boil_time_min | INTEGER | Boil duration in minutes |
| fermentation_days | INTEGER | Primary fermentation days |
| conditioning_days | INTEGER | Conditioning days |
| **Whirlpool** | | |
| whirlpool_time_min | INTEGER | Whirlpool duration |
| whirlpool_temp_f | INTEGER | Whirlpool temperature |
| whirlpool_rest_min | INTEGER | Rest time after whirlpool |
| **Mash** | | |
| mash_temp_f | INTEGER | Single infusion mash temp |
| target_mash_ph | DECIMAL(3,1) | Target mash pH |
| mash_efficiency | DECIMAL(4,1) | Expected efficiency % |
| water_to_grain_ratio | DECIMAL(3,1) | Water:grain ratio (qt/lb) |
| **Knock-out** | | |
| target_ko_temp_f | INTEGER | Target knock-out temp |
| **Yeast** | | |
| target_attenuation | DECIMAL(4,1) | Target attenuation % |
| target_pitching_rate | DECIMAL(3,1) | Pitching rate (M cells/mL/°P) |
| yeast_nutrient_amount_g | DECIMAL(6,2) | Yeast nutrient amount |
| **Schedules (JSONB)** | | |
| mash_schedule | JSONB | Mash step schedule |
| fermentation_schedule | JSONB | Fermentation stage schedule |
| **Notes** | | |
| brew_day_notes | TEXT | Brew day instructions |
| tasting_notes | TEXT | Tasting notes |
| development_notes | TEXT | Recipe development notes |
| **Flags** | | |
| is_active | BOOLEAN | Active flag |
| **Profiles** | | |
| target_water_profile_id | UUID | FK to [water_profiles](#water_profiles), ON DELETE SET NULL |
| water_addition_profile_id | UUID | FK to [water_addition_profiles](#water_addition_profiles), ON DELETE SET NULL |
| **Meta** | | |
| version | INTEGER | Optimistic-lock version; incremented once per aggregate editor save |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

### Atomic editor writes

`save_recipe_aggregate_atomic(recipe_id, expected_version, recipe_patch,
sections)` is the write boundary for the main recipe editor. It locks the
recipe, rejects stale versions, and commits the parent patch plus any supplied
`recipe_malts`, `recipe_hops`, `recipe_adjuncts`, `recipe_sugars`,
`recipe_spices`, and `recipe_fruits` replacements in one transaction. A section
omitted from `sections` is unchanged; a supplied empty array clears it. The
function runs with invoker rights, so normal recipe RLS remains authoritative.

### Schedule JSONB Schemas

**mash_schedule** array:
```json
[{
  "id": "step_1234567890_abcde",
  "step_type": "infusion|decoction|rest|mashout|acid_rest|protein_rest",
  "name": "Single Infusion",
  "temp_f": 152,
  "duration_min": 60,
  "notes": "Optional notes"
}]
```

**fermentation_schedule** array:
```json
[{
  "id": "stage_1234567890_abcde",
  "stage": "primary|secondary|diacetyl|lagering|conditioning|dry_hop|cold_crash",
  "name": "Primary Fermentation",
  "temp_f": 68,
  "duration_days": 14,
  "notes": "Optional notes"
}]
```

---

## Recipe Ingredient Junction Tables

Ingredients are stored in junction tables rather than JSONB arrays. This enables:
- Queries like "all recipes using Citra hops"
- Database-level referential integrity
- Proper indexing for ingredient searches

Every junction amount column (`weight_lbs` / `weight_oz` / `amount`) carries a
`CHECK (... > 0)` constraint since migration 00298.

### `recipe_malts`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| recipe_id | UUID | FK to recipes |
| malt_id | UUID | FK to malts |
| weight_lbs | DECIMAL(10,4) | Weight in pounds |
| color_lov | DECIMAL(4,1) | Color (snapshot from catalog) |
| ppg | INTEGER | Points per gallon (snapshot) |
| position | INTEGER | Sort order in grain bill |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |

### `recipe_hops`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| recipe_id | UUID | FK to recipes |
| hop_id | UUID | FK to hops |
| weight_oz | DECIMAL(10,4) | Weight in ounces |
| alpha_acid | DECIMAL(4,2) | Alpha acid % (snapshot) |
| timing | TEXT | Timing: mash, first_wort, boil, whirlpool, dry_hop |
| boil_time_min | INTEGER | Boil time (for boil additions) |
| position | INTEGER | Sort order |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |

### `recipe_adjuncts`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| recipe_id | UUID | FK to recipes |
| adjunct_id | UUID | FK to adjuncts |
| weight_lbs | DECIMAL(10,4) | Weight in pounds |
| timing | TEXT | Timing: mash, boil, fermentation |
| position | INTEGER | Sort order |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |

### `recipe_sugars`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| recipe_id | UUID | FK to recipes |
| sugar_id | UUID | FK to sugars |
| weight_lbs | DECIMAL(10,4) | Weight in pounds |
| timing | TEXT | Timing: boil, fermentation, packaging |
| position | INTEGER | Sort order |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |

### `recipe_spices`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| recipe_id | UUID | FK to recipes |
| spice_id | UUID | FK to spices |
| amount | DECIMAL(10,4) | Amount |
| unit | TEXT | Unit: oz, g, tsp, tbsp, each |
| timing | TEXT | Timing: boil, whirlpool, fermentation, secondary |
| boil_time_min | INTEGER | Boil time (for boil additions) |
| position | INTEGER | Sort order |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |

### `recipe_fruits`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| recipe_id | UUID | FK to recipes |
| fruit_id | UUID | FK to fruits |
| amount | DECIMAL(10,4) | Amount |
| unit | TEXT | Unit: lbs, oz, gal, l, can |
| timing | TEXT | Timing: boil_end, primary, secondary, packaging |
| position | INTEGER | Sort order |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |

---

## `recipes_with_estimates` (View)

Calculated view that computes recipe estimates on read. Use this view instead of the base `recipes` table when estimates are needed.

| Column | Type | Description |
|--------|------|-------------|
| *(all recipes columns)* | | Base recipe data |
| est_og | DECIMAL(4,3) | Estimated OG (from grain bill + efficiency) |
| est_fg | DECIMAL(4,3) | Estimated FG (from OG + attenuation) |
| est_abv | DECIMAL(3,1) | Estimated ABV (from OG and FG) |
| est_ibu | INTEGER | Estimated IBU (from hop additions + timing) |
| est_srm | INTEGER | Estimated color (from grain bill) |
| est_cogs | DECIMAL(10,2) | Estimated COGS (sum of ingredient costs) |

**Calculation formulas:**

```sql
-- OG: Points from grain / volume
est_og = 1 + (SUM(malt.weight_lbs * malt.ppg) * efficiency / volume_gal) / 1000

-- FG: OG adjusted by attenuation
est_fg = 1 + (est_og - 1) * (1 - attenuation / 100)

-- ABV: Standard formula
est_abv = (est_og - est_fg) * 131.25

-- IBU: Tinseth formula per hop addition
est_ibu = SUM(hop.weight_oz * hop.alpha_acid * utilization / volume_gal * 74.89)

-- SRM: Morey equation
est_srm = 1.4922 * (SUM(malt.weight_lbs * malt.color_lov / volume_gal) ^ 0.6859)

-- COGS: Sum of all ingredient costs
est_cogs = SUM(ingredient costs from all junction tables)
```

**Performance notes:**
- Simple aggregations with indexed JOINs - milliseconds for typical queries
- Application layer (React Query) provides additional caching
- If needed, can convert to materialized view with refresh triggers

---

## `recipes_with_cogs` (View)

Detailed recipe cost breakdown by ingredient category. Use this view when you need cost analysis with per-category breakdowns. For simple total COGS, use `recipes_with_estimates.est_cogs`.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Recipe ID |
| name | TEXT | Recipe name |
| brand_id | UUID | FK to brands |
| volume_bbl | DECIMAL(5,2) | Recipe volume in barrels |
| batch_size_bbl | DECIMAL(5,2) | Target batch size in barrels |
| malt_cost | DECIMAL(10,2) | Total malt/grain cost |
| hop_cost | DECIMAL(10,2) | Total hop cost |
| yeast_cost | DECIMAL(10,2) | Yeast cost (from yeasts.cost_per_unit) |
| adjunct_cost | DECIMAL(10,2) | Total adjunct cost |
| total_cogs | DECIMAL(10,2) | Sum of all ingredient costs |
| cogs_per_bbl | DECIMAL(10,2) | Total COGS / batch_size_bbl (or volume_bbl) |
| total_grain_lbs | DECIMAL(10,1) | Total grain weight for reference |
| total_hop_oz | DECIMAL(10,1) | Total hop weight for reference |

**Calculation notes:**
- Malt cost: `weight_lbs * malts.cost_per_lb`
- Hop cost: Converts oz to lbs (`weight_oz / 16.0 * hops.cost_per_lb`)
- Adjunct cost: `amount_lbs * adjuncts.cost_per_lb`
- Addition cost: removed in 00297 (`additives.cost_per_unit` dropped — was never populated and had no consumers)
- COGS per BBL: Uses `batch_size_bbl` if available, otherwise `volume_bbl`. Returns NULL if both are zero/null.
- All costs default to 0 if ingredient has no cost data

**Design note:**
This view provides detailed cost breakdown. `recipes_with_estimates.est_cogs` is a placeholder that could be updated to use this view's `total_cogs` in the future. Currently kept separate because:
- `recipes_with_estimates` focuses on brewing metrics (OG, FG, ABV, IBU, SRM)
- This view focuses on cost analysis with detailed breakdowns

---

## `batch_additions_with_costs` (View)

Batch additions with estimated costs from catalog prices. Performs polymorphic cost lookup based on `catalog_table`.

| Column | Type | Description |
|--------|------|-------------|
| *(all batch_additions columns)* | | Base addition data |
| estimated_cost | DECIMAL | `amount × unit_cost` from catalog |

**Cost lookup:**
- hops: `cost_per_lb / 16.0` (converts to per-oz)
- adjuncts: `cost_per_lb`
- fruits: `cost_per_lb`
- spices: always 0 since 00297 (`spices.cost_per_unit` dropped — was never populated)
- Returns 0 when no catalog link or no cost data

---

## `recipe_additions`

Additive additions attached to recipes: water salts, acids, clarifiers, nutrients, etc. Water chemistry rows use additive types `water_salt` and `acid`; every other additive type is managed by the separate additions editor.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| recipe_id | UUID | FK to recipes |
| additive_id | UUID | FK to additives |
| position | INTEGER | Sort order |
| amount | DECIMAL(8,4) | Amount |
| unit | TEXT | Unit: g, oz, tsp, tbsp, ml, tablets |
| timing | TEXT | Timing: mash, sparge, boil, whirlpool, fermentation, packaging |
| target | TEXT | Target (for water salts): mash, sparge, kettle |
| created_at | TIMESTAMPTZ | Created timestamp |

**Usage patterns:**
- **Water chemistry:** additives whose catalog type is `water_salt` or `acid`
- **Other additions:** clarifiers, nutrients, enzymes, antifoam, and other catalog types
- `replace_recipe_additions_atomic` locks `recipes`, checks its optimistic-lock version, validates the requested category from `additives.type`, and replaces only that category in one transaction. `NULL` items omit the category; `[]` clears it.
- The replacement predicate always requires the target `recipe_id`, so legacy ownerless rows and any profile-owned rows in historical databases are outside its mutation boundary.

Water salt additions can be auto-calculated from the recipe's source and target water profiles, then applied via the "Apply to Recipe" button on the recipe detail page.

**Historical note:** `water_addition_profiles`, `recipe_additions.profile_id`, and `recipes.water_addition_profile_id` were removed from the deployed schema and their migration was removed during migration renumbering. Source and target water chemistry continue to use `water_profiles` through `recipes.water_profile_id` and `recipes.target_water_profile_id`.

---

## Brew-to-Batch Workflow

This section clarifies the relationship between brew logs (hot-side) and batches (cold-side).

### Order of Operations

```
1. PLANNING PHASE
   └── Create batch(es) with status=planned, planned_start_date, recipe_id
       (Batches exist BEFORE brewing - they represent scheduled fermentation slots)

2. BREW DAY
   └── Create brew_log with status=draft
   └── Record events as brewing progresses (→ status=in_progress)
   └── Complete knockout (→ status=completed)

3. WORT ALLOCATION
   └── Link brew_log to batch(es) via brew_log_batches
       • Specify volume_bbl allocated to each batch
       • One brew can feed multiple batches (split/parti-gyle)
       • Multiple brews can feed one batch (blend - rare)
   └── Batch transitions: planned → fermenting

4. FERMENTATION
   └── Batch progresses through fermentation states
   └── Yeast pitched to BATCH (not brew_log)
   └── Readings recorded against BATCH
```

### Volume Flow

| Stage | Source | Destination |
|-------|--------|-------------|
| Knockout | brew_log events (ko_end.volume_bbl) | Total wort produced |
| Allocation | brew_log_batches.volume_bbl | Volume assigned per batch |
| Fermentation | batch via vessel_transfers | Volume tracked through vessels |
| Packaging | finished_goods.volume_bbl | Final packaged volume |

**Key principle:** `brew_log_batches.volume_bbl` is the handoff point. The sum of all `brew_log_batches` for a brew should equal the total knockout volume.

### Common Scenarios

| Scenario | Brews | Batches | brew_log_batches entries |
|----------|-------|---------|-------------------------|
| Standard | 1 | 1 | 1 (full volume) |
| Split fermentation | 1 | 2+ | 2+ (split volume) |
| Parti-gyle | 1 | 2+ | 2+ (first/second runnings) |
| Double batch | 2 | 1 | 2 (combined into one batch) |

### What Lives Where

| Data | Location | Rationale |
|------|----------|-----------|
| Brew date | brew_logs.brew_date | Hot-side event |
| OG | Derived from brew_log events | Hot-side measurement |
| Yeast pitch | pitch_usage → batches | Cold-side operation |
| FG | batches.actual_fg | Cold-side measurement |
| ABV | batches.actual_abv | Calculated from OG/FG |

### Validation Rules (per DEC-HP-003)

| Rule | Enforcement | Description |
|------|-------------|-------------|
| Volume reconciliation | Application warning | SUM(brew_log_batches.volume_bbl) should match knockout volume ±5% |
| Batch requires brew | Application | Batch cannot transition `planned → fermenting` without brew_log_batches link |
| Volume positive | Database | `brew_log_batches.volume_bbl > 0` |
| No unlink after fermenting | Application | Cannot delete brew_log_batches if batch.status != 'planned' |

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Planned batch never brewed | Stays `planned`; user can cancel or reschedule |
| Test brew / dump | brew_log completes with no batch links; flagged as "unallocated" |
| Volume mismatch >5% | Warning shown; user must acknowledge before saving |
| Add brew to fermenting batch | Allowed (blend scenario); batch volume recalculated |

---

## `batches`

Production batches (cold-side: fermentation through packaging). Hot-side data comes from linked `brew_logs` via `brew_log_batches`.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| recipe_id | UUID | FK to [recipes](#recipes) |
| batch_number | TEXT | Unique batch identifier |
| name | TEXT | Batch name |
| status | TEXT | Status: planned, fermenting, conditioning, packaging, completed, cancelled, archived |
| **Planning** | | |
| planned_start_date | DATE | Planned fermentation start date (for scheduling) |
| **Volumes** | | |
| volume_bbl | DECIMAL(8,2) | Target/actual volume in barrels |
| estimated_volume_bbl | DECIMAL(8,2) | Estimated volume from recipe |
| **Fermentation Results** | | |
| actual_fg | DECIMAL(4,3) | Final gravity (derived from readings) |
| actual_abv | DECIMAL(3,1) | ABV (calculated from OG/FG) |
| **Notes** | | |
| notes | TEXT | Batch notes |
| **Meta** | | |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Derived fields** (via `batches_with_brew_info` view):
- `brew_date` - actual brew date from linked brew_log(s)
- `actual_og` - from linked brew_log events (weighted average if multiple brews)
- `volume_from_brews_bbl` - total wort volume from linked brews
- `brew_count` - number of contributing brews
- `current_vessel_id` - UUID of the vessel currently holding this batch
- `current_vessel_name` - name of the current vessel
- `current_vessel_type` - type of the current vessel (fermenter, brite, unitank, etc.)

**Planned vs Actual:**
- `planned_start_date` - when we plan to start fermentation (for scheduling)
- `brew_date` (derived) - when the brew actually happened

**⚠️ Specification Conflict - Stored vs. Derived Fields:**

The following fields are documented as stored columns above, but [MGR-SPECIFICATION.md](../MGR-SPECIFICATION.md) proposes deriving them instead:

- **`batches.volume_gallons`** (DEC-RED-004): Specification proposes removing this stored field and deriving volume from `brew_log_batches.volume_bbl` minus `finished_goods` allocations
- **`batches.actual_og`** (DEC-RED-002): Specification proposes removing this stored field and deriving OG from linked `brew_logs.events` data

**Current implementation:** These fields exist as stored columns in the schema.

**Decision needed:** Choose whether to:
1. Keep stored fields (requires updating specification to mark DEC-RED-002 and DEC-RED-004 as rejected)
2. Implement derived approach (requires schema migration to remove columns and create views)

**See also:** [brew-logs.md](./brew-logs.md) for the decoupled hot-side data model.

---

## `batch_logs`

Audit log for batch events and measurements.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| batch_id | UUID | FK to batches |
| log_type | TEXT | Type: status_change, measurement, note (CHECK-enforced since 00298; only `measurement` is written today) |
| data | JSONB | Event data |
| created_at | TIMESTAMPTZ | Created timestamp |
| created_by | UUID | FK to auth.users |

MongoDB test imports use stable `mongodb_sync_mappings` ownership records and
`reconcile_mongodb_batch_reading_aggregate()`. Reconciliation changes only the
temperature/pH rows owned by that source test document; manually entered
measurements for the same batch are preserved. The aggregate update and stale
source-row cleanup commit or roll back together.

---

## `vessels`

Brewing vessels (fermenters, brite tanks, kettles, etc.).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Vessel name/identifier |
| vessel_type | TEXT | Type: fermenter, brite, kettle, mash_tun, hlt, unitank, foeder, barrel, brink |
| capacity_bbl | DECIMAL(8,2) | Capacity in barrels |
| location_id | UUID | FK to locations |
| current_batch_id | UUID | FK to batches - automatically maintained by trigger |
| status | TEXT | Status: dirty, caustic_cleaned, ready_for_use, in_use, maintenance |
| notes | TEXT | Notes |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Current batch**: The `current_batch_id` field is automatically maintained by the `handle_vessel_transfer()` trigger (migration 00023). When a vessel transfer is created, the trigger updates the destination vessel's `current_batch_id` and clears the source vessel's. The `vessels_with_current_batch` view provides additional batch details for display.

---

## `vessel_transfers`

Track batch movements between vessels.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| batch_id | UUID | FK to batches |
| from_vessel_id | UUID | FK to vessels (NULL if from kettle) |
| to_vessel_id | UUID | FK to vessels |
| volume_bbl | DECIMAL(8,2) | Volume transferred (CHECK > 0 since 00298) |
| transferred_at | TIMESTAMPTZ | Transfer timestamp |
| transferred_by | UUID | FK to auth.users |
| notes | TEXT | Notes (explain loss if any) |
| created_at | TIMESTAMPTZ | Created timestamp |

---

## `vessels_with_current_batch` (View)

Derives current batch for each vessel from the transfer log. Use this view instead of base `vessels` table when you need current batch info.

| Column | Type | Description |
|--------|------|-------------|
| *(all vessels columns)* | | Base vessel data |
| current_batch_id | UUID | Currently contained batch (derived) |
| current_batch_number | TEXT | Batch number (from batches table) |
| volume_in_vessel_bbl | DECIMAL(8,2) | Volume currently in vessel |

**Derivation logic:**
```sql
-- Current batch = latest transfer TO this vessel with no subsequent transfer OUT
CREATE VIEW vessels_with_current_batch AS
SELECT
  v.*,
  latest.batch_id as current_batch_id,
  b.batch_number as current_batch_number,
  latest.volume_bbl as volume_in_vessel_bbl
FROM vessels v
LEFT JOIN LATERAL (
  SELECT vt.batch_id, vt.volume_bbl
  FROM vessel_transfers vt
  WHERE vt.to_vessel_id = v.id
  AND NOT EXISTS (
    SELECT 1 FROM vessel_transfers vt2
    WHERE vt2.from_vessel_id = v.id
    AND vt2.batch_id = vt.batch_id
    AND vt2.transferred_at > vt.transferred_at
  )
  ORDER BY vt.transferred_at DESC
  LIMIT 1
) latest ON true
LEFT JOIN batches b ON b.id = latest.batch_id;
```

**Rationale**: Single source of truth (transfer log), no sync issues between stored field and actual transfers.

### Performance Considerations

**Required indexes:**
```sql
-- Critical for LATERAL subquery performance
CREATE INDEX idx_vessel_transfers_to_vessel ON vessel_transfers(to_vessel_id, transferred_at DESC);
CREATE INDEX idx_vessel_transfers_from_vessel ON vessel_transfers(from_vessel_id, batch_id, transferred_at);
```

**Performance characteristics:**
- Query time: ~5-10ms for typical brewery (10-50 vessels, <1000 transfers)
- LATERAL with NOT EXISTS is efficient with proper indexes
- No need to materialize for typical use cases

**If performance becomes an issue:**
```sql
-- Option 1: Materialized view with refresh trigger
CREATE MATERIALIZED VIEW vessels_with_current_batch_mat AS
SELECT ... -- same query
WITH DATA;

CREATE UNIQUE INDEX ON vessels_with_current_batch_mat(id);

-- Refresh on transfer INSERT/UPDATE
CREATE OR REPLACE FUNCTION refresh_vessel_current_batch()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY vessels_with_current_batch_mat;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
```

### Application Query Patterns

**Get all vessels with current batch (dashboard):**
```typescript
const { data: vessels } = await supabase
  .from('vessels_with_current_batch')
  .select('*, current_batch:batches(id, batch_number, status)')
  .order('name');
```

**Get single vessel with current batch:**
```typescript
const { data: vessel } = await supabase
  .from('vessels_with_current_batch')
  .select('*')
  .eq('id', vesselId)
  .single();
```

**Find empty vessels (for scheduling):**
```typescript
const { data: emptyVessels } = await supabase
  .from('vessels_with_current_batch')
  .select('*')
  .is('current_batch_id', null)
  .eq('status', 'ready_for_use');
```

### Handling In-Flight Transfers

The view shows **current state** based on completed transfers. For transfers in progress:

| Transfer Status | Vessel Shows |
|-----------------|--------------|
| planned | Still shows previous batch (transfer not started) |
| in_progress | Source shows batch (hasn't left yet), destination shows previous |
| completed | Source shows empty/new batch, destination shows transferred batch |

**To include planned transfers in availability calculations:**
```sql
-- Vessels that will be available soon (transfer out is planned)
SELECT v.* FROM vessels v
WHERE EXISTS (
  SELECT 1 FROM vessel_transfers vt
  WHERE vt.from_vessel_id = v.id
  AND vt.status = 'planned'
);
```

---

## `batch_readings`

Fermentation readings and measurements over time.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| batch_id | UUID | FK to batches |
| vessel_id | UUID | FK to vessels |
| recorded_at | TIMESTAMPTZ | Reading timestamp |
| recorded_by | UUID | FK to auth.users |
| measurements | JSONB | Measurement data (see schema below) |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |

**measurements schema:**
```json
[
  { "type": "temperature", "value": 66, "unit": "F" },
  { "type": "gravity", "value": 1.015, "unit": "SG" },
  { "type": "ph", "value": 4.2 },
  { "type": "pressure", "value": 12, "unit": "PSI" },
  { "type": "do", "value": 20, "unit": "ppb" },
  { "type": "diacetyl", "level": "low", "notes": "slight butter" },
  { "type": "clarity", "level": "hazy" },
  { "type": "taste", "notes": "clean fermentation" }
]
```

---

## `batch_additions`

Actual cold-side additions recorded on a batch (dry hops, fruit, adjuncts, spices, etc.). Replaces the previous JSON-based approach in `batch_logs`.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| batch_id | UUID | FK to batches |
| addition_type | TEXT | Type: hop, adjunct, fruit, spice, yeast, other |
| catalog_id | UUID | FK to catalog item (polymorphic, see catalog_table) |
| catalog_table | TEXT | Which catalog table: hops, adjuncts, fruits, spices |
| name | TEXT | Ingredient name (denormalized for display) |
| amount | DECIMAL | Amount (must be > 0) |
| unit | TEXT | Unit (oz, lbs, g, etc.) |
| timing | TEXT | Timing context (e.g., "dry_hop") |
| days | INT | Contact time in days |
| date_added | DATE | When physically added |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |

**Polymorphic catalog reference:** `catalog_table` + `catalog_id` together form a polymorphic FK to the relevant catalog table (hops, adjuncts, fruits, or spices). When `catalog_id` is NULL, the addition was entered manually without a catalog reference.

---

## `batch_sources`

Source batches for blends (many-to-many).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| batch_id | UUID | FK to batches (the blend) |
| source_batch_id | UUID | FK to batches (the source) |
| volume_bbl | DECIMAL(8,2) | Volume contributed |
| created_at | TIMESTAMPTZ | Created timestamp |

---

## Yeast Management (Pitch Events Model)

Yeast tracking uses a pitch events model where `yeast_pitches` represent yeast sources (purchases or harvests stored in brink vessels) and `yeast_pitch_events` record immutable deductions from those sources into batches. This enables:
- Partial weight-based deductions from a single source to multiple batches
- Quantity remaining calculated via views, never stored as mutable balances
- Viability decay estimation with lab measurement overrides
- Cost spreading across all batches in a lineage
- Harvest and repitch tracking across generations

### Workflow

```
Purchase Yeast (Gen 0, source_type: purchase)
    ↓
yeast_pitch (in Brink B-001, strain: WLP001, quantity: 10 lbs)
    ↓
├── Record Cell Count: 95% viability
├── Pitch Event: 2 lbs → Batch #101
├── Pitch Event: 2 lbs → Batch #102
├── Record Cell Count: 75% viability
└── Remaining 6 lbs → viability too low → DISCARD

Harvest from Batch #101 (Gen 1, source_type: harvest)
    ↓
yeast_pitch (in Brink B-002, strain: WLP001, parent: B-001, quantity: 8 lbs)
    ↓
└── Continue pitching...
```

---

## `yeast_pitches`

Yeast sources — purchases or harvests stored in brink vessels. Tracks lineage, viability, and total quantity. Partial deductions tracked via `yeast_pitch_events`.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| strain_id | UUID | FK to yeasts |
| source_type | TEXT | Source: purchase, harvest |
| parent_pitch_id | UUID | FK to yeast_pitches (lineage — NULL for purchases) |
| generation | INTEGER | Generation (0 = purchased, 1+ = harvested) |
| status | TEXT | Status: in_stock, depleted, discarded |
| quantity_lbs | DECIMAL(10,2) | Total weight in pounds; cannot be reduced below committed pitch events |
| cell_count_thousand | DECIMAL(14,2) | Total cell count in thousands |
| cell_density_thousand | DECIMAL(14,2) | Thousand cells per pound |
| initial_viability | DECIMAL(5,2) | Viability at harvest/purchase (0-100) |
| volume_ml | DECIMAL(10,2) | Volume in mL (for liquid purchases) |
| vessel_id | UUID | FK to vessels (the brink this lives in) |
| location_id | UUID | FK to locations |
| cost | DECIMAL(10,2) | Purchase cost |
| cost_per_batch | DECIMAL(10,2) | Calculated cost spread |
| received_date | DATE | Date received (purchases) |
| harvest_date | DATE | Date harvested |
| use_by_date | DATE | Expiration date |
| notes | TEXT | Notes |
| created_by | UUID | FK to auth.users |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Calculated fields** (via `yeast_pitches_with_remaining` view):
- `quantity_remaining_lbs = quantity_lbs - SUM(events.quantity_lbs)`
- `estimated_viability` = linear decay from initial_viability based on age and yeast form
- `days_old` = days since harvest or received date

**Viability decay formula:**
```
viability = initial_viability - (days_old × decay_rate)
where decay_rate = 0.5 for dry yeast, 2.0 for liquid yeast
```

---

## `yeast_pitch_events`

Immutable event log recording each yeast deduction from a source into a batch. Quantity remaining on the source is calculated as total minus sum of events.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key and stable idempotency key for the atomic pitch command |
| pitch_id | UUID | FK to yeast_pitches (source) |
| batch_id | UUID | FK to batches (target) |
| quantity_lbs | DECIMAL(10,2) | Positive weight pitched |
| cells_pitched_thousand | DECIMAL(14,2) | Cells pitched in thousands |
| viability_at_pitch | DECIMAL(5,2) | Measured/estimated viability at pitch time (0–100) |
| pitched_at | TIMESTAMPTZ | When pitched |
| notes | TEXT | Notes |
| created_by | UUID | FK to auth.users |
| created_at | TIMESTAMPTZ | Created timestamp |

**Indexes:** `pitch_id`, `batch_id`

**Write invariants (migration `00260_atomic_yeast_pitch.sql`):**

- `pitch_yeast_atomic` is the application command. It locks the source,
  recomputes committed usage, rejects overdraw, inserts the event, and updates
  depleted status in one transaction.
- The event `id` is the caller's stable request UUID. Identical retries return
  `kind = duplicate`; the same UUID with different input is rejected.
- Direct inserts pass through the same locking balance guard, so callers cannot
  bypass the invariant through table DML.
- Events are immutable: updates and deletes are rejected. Corrections require a
  separately designed compensating-event workflow.
- Source `quantity_lbs` cannot be lowered below the sum of committed events.
- When the last available quantity is pitched, source status changes atomically
  from `in_stock` to `depleted`; partial sources remain `in_stock`.

---

## `yeast_pitches_with_remaining` (View)

Enriched yeast pitch view with strain info, vessel details, calculated quantity remaining, viability decay, and age. Replaces the old `yeast_pitches_with_details` view.

| Column | Type | Description |
|--------|------|-------------|
| *(all yeast_pitches columns)* | | Base pitch data |
| strain_name | TEXT | Yeast strain name |
| strain_manufacturer | TEXT | Manufacturer |
| strain_code | TEXT | Product code |
| strain_type | TEXT | Yeast type (ale, lager, etc.) |
| strain_form | TEXT | Form (liquid, dry) |
| strain_attenuation | DECIMAL | Typical attenuation |
| vessel_name | TEXT | Brink vessel name |
| vessel_vessel_type | TEXT | Vessel type |
| location_name | TEXT | Location name |
| quantity_remaining_lbs | DECIMAL | `quantity_lbs - SUM(events.quantity_lbs)`; database guards keep this non-negative |
| batches_pitched | INTEGER | Count of distinct batches from events |
| days_old | INTEGER | Days since harvest or received date |
| estimated_viability | DECIMAL(5,2) | Viability after decay |
| viability_status | TEXT | excellent (≥90), good (≥75), marginal (≥50), low (≥25), inactive (<25) |

---

## `batch_yeast_summary` (View)

All yeast pitched into a batch with strain details, generation, quantity, and cell counts. Used on batch detail pages.

| Column | Type | Description |
|--------|------|-------------|
| batch_id | UUID | Batch ID |
| event_id | UUID | Pitch event ID |
| pitch_id | UUID | Source pitch ID |
| quantity_lbs | DECIMAL | Weight pitched |
| cells_pitched_thousand | DECIMAL | Cells pitched in thousands |
| viability_at_pitch | DECIMAL | Viability at pitch |
| pitched_at | TIMESTAMPTZ | When pitched |
| notes | TEXT | Notes |
| strain_id | UUID | Yeast strain ID |
| generation | INTEGER | Generation number |
| source_type | TEXT | Purchase or harvest |
| strain_name | TEXT | Strain name |
| strain_manufacturer | TEXT | Manufacturer |
| strain_code | TEXT | Product code |
| strain_type | TEXT | Yeast type |
| strain_form | TEXT | Yeast form |

---

## `yeast_lineage_summary` (View)

Recursive lineage view for cost spreading and generation tracking.

| Column | Type | Description |
|--------|------|-------------|
| root_id | UUID | Root purchase pitch ID |
| strain_name | TEXT | Yeast strain name |
| original_cost | DECIMAL | Purchase cost |
| total_pitches_in_lineage | INTEGER | Total pitches in lineage tree |
| batches_used | INTEGER | Distinct batches pitched from this lineage |
| cost_per_batch | DECIMAL | `original_cost / batches_used` |
| max_generations | INTEGER | Maximum generation reached |

---

## Yeast Cost Spreading

Yeast costs are spread equally across all batches in a lineage via the `yeast_lineage_summary` view:

```
cost_per_batch = original_purchase_cost / COUNT(batches_in_lineage)
```

This is recalculated dynamically by the view when queried. The `yeast_lineage_summary` uses a recursive CTE to walk the `parent_pitch_id` chain from each root purchase and counts distinct batches from `yeast_pitch_events`.

---

## Yeast Brinks UI

The brinks management dashboard (`/production/yeast-pitches/brinks`) provides an at-a-glance overview of all brink vessels and their active yeast pitches.

### Components

| Component | Path | Description |
|-----------|------|-------------|
| `YeastBrinksOverview` | `src/components/domain/yeast-brinks-overview.tsx` | Card grid showing brink vessels with active pitch info |
| `YeastViabilityChart` | `src/components/domain/yeast-viability-chart.tsx` | Recharts line chart of viability decay over time |

### Brinks Overview

- Queries vessels with `vessel_type = 'brink'`
- For each brink, shows active pitches (`status IN ('in_stock', 'in_use')`) from `yeast_pitches_with_remaining`
- Card displays: strain name, remaining quantity (lbs), current viability with color-coded status badge, days until 75% threshold, generation count
- Empty brinks shown as dimmed cards with "Empty" label
- Cards link to the yeast pitch detail page

### Viability Tracking

Viability is calculated client-side using `calculateViabilityDecay()` from `src/lib/yeast-calculations.ts`:

- **Liquid yeast**: 2% decay per day (`0.98^daysOld`)
- **Dry yeast**: 0.5% decay per day (`0.995^daysOld`)

Status thresholds:
| Status | Viability | Badge Color |
|--------|-----------|-------------|
| Excellent | >= 90% | Green |
| Good | >= 75% | Blue |
| Marginal | >= 50% | Yellow |
| Low | >= 25% | Orange |
| Inactive | < 25% | Red |

The viability decay chart on the pitch detail page shows:
- Projected viability over 90 days (or until < 10%)
- Reference lines at 75% (good), 50% (marginal), 25% (low) thresholds
- Vertical "Today" marker
- Pitch event markers (diamond shapes) when yeast was used

### Cost Spreading Display

The pitch detail page includes a cost spreading summary card that:
- Queries `yeast_lineage_summary` view for the pitch's lineage root
- Shows total cost, number of batches, and cost per batch
- Lists individual batch usage with allocated cost in a table

---

## State Machine: Batch

Batches represent cold-side only. Hot-side (brewing) is tracked in `brew_logs`.

```
planned -> fermenting -> conditioning -> packaging -> completed
    |           |              |             |
    v           v              v             v
cancelled   cancelled     cancelled      (locked)
```

| Transition | Trigger |
|------------|---------|
| planned -> fermenting | Suggested after Transfer (to fermenter) or Pitch Yeast action |
| fermenting -> conditioning | Suggested after Transfer (to brite tank) action |
| conditioning -> packaging | Packaging begins (direct action) |
| packaging -> completed | All packaging done (direct action) |

**Action-driven transitions:** State changes for planned→fermenting and fermenting→conditioning are suggested via toast notifications after Transfer or Pitch Yeast actions, rather than triggered by dedicated buttons. The user confirms or defers the state change.

**See also:** [brew-logs.md](./brew-logs.md) for brew log state machine (draft → in_progress → completed).

---

## State Machine: Vessel

```
                    ┌─────────────────────────────────────┐
                    │                                     │
                    v                                     │
dirty ──> caustic_cleaned ──> ready_for_use ──> in_use ──┘
  ^                                               │
  │                                               │
  └───────────────────────────────────────────────┘

Any state can transition to maintenance, which returns to dirty.
```

| Transition | Trigger | Cleaning Type |
|------------|---------|---------------|
| dirty → caustic_cleaned | Caustic CIP complete | caustic, cip |
| caustic_cleaned → ready_for_use | Sanitize/acid rinse complete | sanitize, acid |
| ready_for_use → in_use | Batch transferred in | — |
| in_use → dirty | Batch transferred out / emptied | — |
| any → maintenance | Equipment issue | — |
| maintenance → dirty | Maintenance complete | — |

**Notes:**
- `caustic_cleaned` is an intermediate state after caustic wash but before sanitizing
- `ready_for_use` means fully cleaned and sanitized, ready for beer
- Some breweries skip `caustic_cleaned` and go `dirty` → `ready_for_use` directly

---

## Production Planning

Views and functions for backward production planning from order due dates.

### `calculate_units_per_bbl()` (Function)

Calculates yield (units or cases) per BBL from package dimensions. Works for any package type.

```sql
calculate_units_per_bbl(p_volume_oz DECIMAL, p_units_per_case INTEGER) RETURNS DECIMAL
```

| Parameter | Description |
|-----------|-------------|
| p_volume_oz | Package volume in ounces |
| p_units_per_case | Units per case (NULL for kegs) |

**Calculation:**
- 1 BBL = 3968 oz (31 gallons × 128 oz/gallon)
- Cans/bottles: `(3968 / volume_oz) / units_per_case` = cases per BBL
- Kegs: `3968 / volume_oz` = kegs per BBL

**Examples:**
| Package | volume_oz | units_per_case | Result |
|---------|-----------|----------------|--------|
| 16oz can (24-pack) | 16 | 24 | 10.33 cases/BBL |
| 12oz can (24-pack) | 12 | 24 | 13.78 cases/BBL |
| Half barrel | 1984 | 1 | 2 kegs/BBL |
| Sixth barrel | 661 | 1 | 6 sixtels/BBL |

---

### Yield Override

Selling formats can have yield overrides configured to account for packaging losses or non-standard yields. See [packaging.md](./packaging.md) for container and selling format schema details.

---

### `order_demand_by_product` (View)

Aggregates order demand by brand, selling format, and week.

| Column | Type | Description |
|--------|------|-------------|
| brand_id | UUID | FK to brands |
| selling_format_id | UUID | FK to selling_formats |
| demand_week | DATE | Week start date (Monday) |
| total_quantity | INTEGER | Sum of order item quantities |
| order_count | INTEGER | Number of orders |
| earliest_due_date | DATE | Earliest order due date in bucket |
| latest_due_date | DATE | Latest order due date in bucket |
| order_ids | UUID[] | Array of contributing order IDs |
| order_statuses | TEXT[] | Array of order statuses |

**Filters:**
- Excludes `fulfilled` and `cancelled` orders
- Requires `brand_id`, `selling_format_id`, and due date to be set

---

### `finished_goods_supply_by_product` (View)

Aggregates available finished goods inventory by brand and selling format.

| Column | Type | Description |
|--------|------|-------------|
| brand_id | UUID | FK to brands |
| selling_format_id | UUID | FK to selling_formats |
| total_quantity | INTEGER | Total inventory quantity |
| available_quantity | INTEGER | Available (unallocated) quantity |
| allocated_quantity | INTEGER | Already allocated to orders |
| reserved_quantity | INTEGER | Reserved for other purposes |

---

### `batches_in_production_by_brand` (View)

Active batches with estimated packaging-ready dates.

| Column | Type | Description |
|--------|------|-------------|
| brand_id | UUID | FK to brands (via recipe) |
| batch_id | UUID | FK to batches |
| batch_number | TEXT | Batch identifier |
| batch_name | TEXT | Batch name |
| status | TEXT | Batch status |
| planned_start_date | DATE | Planned fermentation start |
| volume_bbl | DECIMAL | Batch volume |
| recipe_id | UUID | FK to recipes |
| recipe_name | TEXT | Recipe name |
| fermentation_days | INTEGER | From recipe |
| conditioning_days | INTEGER | From recipe |
| estimated_ready_date | DATE | Calculated packaging-ready date |

**estimated_ready_date calculation:**
```sql
planned_start_date + fermentation_days + conditioning_days
```

**Filters:**
- Only batches with status `planned`, `fermenting`, or `conditioning`
- Only recipes with `brand_id` set

---

### `calculate_production_shortfalls()` (Function)

Returns production shortfalls with recommended brew start dates.

```sql
calculate_production_shortfalls(
  p_include_drafts BOOLEAN DEFAULT true,
  p_horizon_weeks INTEGER DEFAULT 8
) RETURNS TABLE (...)
```

**Parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| p_include_drafts | true | Include draft orders in demand |
| p_horizon_weeks | 8 | Planning horizon in weeks |

**Returns:**

| Column | Type | Description |
|--------|------|-------------|
| brand_id | UUID | FK to brands |
| brand_name | TEXT | Brand name |
| selling_format_id | UUID | FK to selling_formats |
| selling_format_name | TEXT | Selling format name |
| demand_week | DATE | Week start date |
| demand_quantity | INTEGER | Total demand |
| available_quantity | INTEGER | Available inventory |
| in_production_bbl | NUMERIC | BBL in production |
| in_production_units | INTEGER | Estimated units from production |
| shortfall_quantity | INTEGER | Demand - available - in_production |
| recommended_brew_start | DATE | When to start brewing |
| lead_time_days | INTEGER | Total lead time |
| recipe_id | UUID | Preferred recipe ID |
| recipe_name | TEXT | Preferred recipe name |
| is_urgent | BOOLEAN | True if brew should start within 7 days |

**Lead time calculation:**
```
lead_time = fermentation_days + conditioning_days + packaging_buffer (2 days)
recommended_brew_start = demand_week - lead_time
```

**Preferred recipe selection:**
- Most recently updated active recipe for the brand

---

## Indexes

Performance indexes for production domain tables:

```sql
-- Recipe queries and filtering
CREATE INDEX idx_recipes_brand ON recipes(brand_id);
CREATE INDEX idx_recipes_style ON recipes(style_id);
CREATE INDEX idx_recipes_yeast ON recipes(yeast_id);
CREATE INDEX idx_recipes_water_profile ON recipes(water_profile_id);

-- Recipe ingredient lookups
CREATE INDEX idx_recipe_malts_recipe ON recipe_malts(recipe_id);
CREATE INDEX idx_recipe_malts_malt ON recipe_malts(malt_id);
CREATE INDEX idx_recipe_hops_recipe ON recipe_hops(recipe_id);
CREATE INDEX idx_recipe_hops_hop ON recipe_hops(hop_id);
CREATE INDEX idx_recipe_adjuncts_recipe ON recipe_adjuncts(recipe_id);
CREATE INDEX idx_recipe_adjuncts_adjunct ON recipe_adjuncts(adjunct_id);
CREATE INDEX idx_recipe_sugars_recipe ON recipe_sugars(recipe_id);
CREATE INDEX idx_recipe_sugars_sugar ON recipe_sugars(sugar_id);
CREATE INDEX idx_recipe_spices_recipe ON recipe_spices(recipe_id);
CREATE INDEX idx_recipe_spices_spice ON recipe_spices(spice_id);
CREATE INDEX idx_recipe_fruits_recipe ON recipe_fruits(recipe_id);
CREATE INDEX idx_recipe_fruits_fruit ON recipe_fruits(fruit_id);

-- Batch operations (critical for dashboard and scheduling)
CREATE INDEX idx_batches_status_recipe ON batches(status, recipe_id);
CREATE INDEX idx_batches_planned_start ON batches(planned_start_date) WHERE status = 'planned';
CREATE INDEX idx_batches_batch_number ON batches(batch_number);

-- Batch readings (time-series queries)
CREATE INDEX idx_batch_readings_batch_date ON batch_readings(batch_id, recorded_at DESC);

-- Brew log to batch linking
CREATE INDEX idx_brew_log_batches_batch ON brew_log_batches(batch_id);
CREATE INDEX idx_brew_log_batches_brew ON brew_log_batches(brew_log_id);

-- Yeast management (pitch events model)
CREATE INDEX idx_yeast_pitches_vessel ON yeast_pitches(vessel_id);
CREATE INDEX idx_yeast_pitches_parent ON yeast_pitches(parent_pitch_id, generation);
CREATE INDEX idx_yeast_pitch_events_pitch ON yeast_pitch_events(pitch_id);
CREATE INDEX idx_yeast_pitch_events_batch ON yeast_pitch_events(batch_id);

-- Vessel operations
CREATE INDEX idx_vessels_status ON vessels(status, type);
CREATE INDEX idx_vessel_transfers_source ON vessel_transfers(source_vessel_id, transfer_date);
CREATE INDEX idx_vessel_transfers_dest ON vessel_transfers(destination_vessel_id, transfer_date);

-- Production planning
CREATE INDEX idx_order_items_brand_format ON order_items(brand_id, selling_format_id)
  WHERE brand_id IS NOT NULL AND selling_format_id IS NOT NULL;
CREATE INDEX idx_orders_planning ON orders(status, scheduled_date, requested_date)
  WHERE status NOT IN ('fulfilled', 'cancelled');
CREATE INDEX idx_batches_planning ON batches(status, recipe_id)
  WHERE status IN ('planned', 'fermenting', 'conditioning');
CREATE INDEX idx_recipes_brand_active ON recipes(brand_id, updated_at DESC)
  WHERE brand_id IS NOT NULL AND is_active = true;

-- Batch additions
CREATE INDEX idx_batch_additions_batch ON batch_additions(batch_id);
```

## Report RPC Functions

### `project_finished_goods(p_horizon_weeks)` — REMOVED

Created by `00139_cogs_and_projection_rpcs.sql`, never applied to live, and dropped from the migration chain by `00289_drop_orphaned_projection_rpcs.sql` (#697). It had no callers: the reports UI projects finished goods in TypeScript (`src/domain/reports/summaries.ts`). Body preserved in git history and in `docs/plans/2026-03-05-cogs-projections-plan.md`.

---

## Dashboard RPC Functions

### `get_production_trends(p_days integer DEFAULT 30)`

Returns daily-aggregated production metrics for dashboard trend charts. Returns `2 * p_days` rows (current + comparison period) so the frontend can compute period-over-period deltas from a single query. `p_days` is clamped to max 365.

| Column | Type | Description |
|--------|------|-------------|
| date | DATE | Calendar date |
| batches_started | INTEGER | Batches with `planned_start_date` on this day |
| volume_bbl | NUMERIC | Total volume for scheduled batches |
| batches_completed | INTEGER | Batches in `completed` status (approximated via `updated_at`) |

```sql
SELECT * FROM get_production_trends(30);  -- last 30 days + 30-day comparison
```

**Known limitations:** `batches_started` uses `planned_start_date` (no `actual_start_date` column). `batches_completed` uses `updated_at` as an approximation — editing a completed batch shifts its completion date.

---

## Retired tables

Dropped by `00294_drop_dead_schema_objects.sql` (schema audit 2026-08-21) after
ref-counts confirmed zero application reads or writes:

- `recipe_variants`, `recipe_variant_hops`, `recipe_variant_adjuncts`,
  `recipe_variant_fruits`, `recipe_variant_spices` and the
  `recipe_variants_with_costs` view (00083–00087) — the split-template UI was
  never built, so nothing could ever insert a variant. `batches.recipe_variant_id`
  was dropped with them.
- `recipe_collaborators` (00011) — never referenced outside generated types.
- `vessel_cleanings` + `recent_vessel_cleanings` view + `cleaning_type` enum
  (00006) — no write path ever existed; the table could only be empty.
