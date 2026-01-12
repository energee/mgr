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
| use_default_additions | BOOLEAN | Use brewery default water/additive additions |
| is_active | BOOLEAN | Active flag |
| **Meta** | | |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

### Schedule JSONB Schemas

**mash_schedule** array:
```json
[{
  "step_type": "infusion|temperature|decoction",
  "temperature_f": 152,
  "duration_min": 60,
  "water_ratio": 1.25,
  "position": 1
}]
```

**fermentation_schedule** array:
```json
[{
  "stage": "primary|secondary|diacetyl_rest|cold_crash|conditioning",
  "temperature_f": 68,
  "duration_days": 14,
  "position": 1
}]
```

---

## Recipe Ingredient Junction Tables

Ingredients are stored in junction tables rather than JSONB arrays. This enables:
- Queries like "all recipes using Citra hops"
- Database-level referential integrity
- Proper indexing for ingredient searches

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
| addition_cost | DECIMAL(10,2) | Total additive cost |
| total_cogs | DECIMAL(10,2) | Sum of all ingredient costs |
| cogs_per_bbl | DECIMAL(10,2) | Total COGS / batch_size_bbl (or volume_bbl) |
| total_grain_lbs | DECIMAL(10,1) | Total grain weight for reference |
| total_hop_oz | DECIMAL(10,1) | Total hop weight for reference |

**Calculation notes:**
- Malt cost: `weight_lbs * malts.cost_per_lb`
- Hop cost: Converts oz to lbs (`weight_oz / 16.0 * hops.cost_per_lb`)
- Adjunct cost: `amount_lbs * adjuncts.cost_per_lb`
- Addition cost: `amount * additives.cost_per_unit` (units must match)
- COGS per BBL: Uses `batch_size_bbl` if available, otherwise `volume_bbl`. Returns NULL if both are zero/null.
- All costs default to 0 if ingredient has no cost data

**Design note:**
This view provides detailed cost breakdown. `recipes_with_estimates.est_cogs` is a placeholder that could be updated to use this view's `total_cogs` in the future. Currently kept separate because:
- `recipes_with_estimates` focuses on brewing metrics (OG, FG, ABV, IBU, SRM)
- This view focuses on cost analysis with detailed breakdowns

---

## `recipe_collaborators`

Users who collaborated on a recipe.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| recipe_id | UUID | FK to recipes |
| user_id | UUID | FK to auth.users |
| created_at | TIMESTAMPTZ | Created timestamp |

---

## `recipe_additions`

Water chemistry and other additive additions. Can be recipe-specific or brewery defaults.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| recipe_id | UUID | FK to recipes (NULL for defaults) |
| additive_id | UUID | FK to additives |
| position | INTEGER | Sort order |
| amount | DECIMAL(8,4) | Amount |
| unit | TEXT | Unit: g, oz, tsp, tbsp, ml, tablets |
| timing | TEXT | Timing: mash, sparge, boil, whirlpool, fermentation, packaging |
| target | TEXT | Target (for water salts): mash, sparge, kettle |
| is_default | BOOLEAN | Is this a brewery default addition? |
| created_at | TIMESTAMPTZ | Created timestamp |

When `recipe_id` is NULL and `is_default` is TRUE, this is a brewery default addition.
When `recipe_id` is set, this is a recipe-specific addition.
Recipes with `use_default_additions = TRUE` use the defaults; otherwise use recipe-specific additions.

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
| status | TEXT | Status: planned, fermenting, conditioning, packaging, completed, cancelled |
| **Planning** | | |
| planned_start_date | DATE | Planned fermentation start date (for scheduling) |
| **Volumes** | | |
| volume_gallons | DECIMAL(6,2) | Volume in fermenter ⚠️ See note below |
| **Fermentation Results** | | |
| actual_fg | DECIMAL(4,3) | Actual final gravity |
| actual_abv | DECIMAL(3,1) | Actual ABV |
| actual_og | DECIMAL(4,3) | Actual original gravity ⚠️ See note below |
| **Equipment** | | |
| fermenter | TEXT | Fermenter identifier |
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
| log_type | TEXT | Type: status_change, measurement, note, addition |
| data | JSONB | Event data |
| created_at | TIMESTAMPTZ | Created timestamp |
| created_by | UUID | FK to auth.users |

---

## `vessels`

Brewing vessels (fermenters, brite tanks, kettles, etc.).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Vessel name/identifier |
| vessel_type | TEXT | Type: fermenter, brite, kettle, mash_tun, hlt, unitank, foeder, barrel |
| capacity_bbl | DECIMAL(8,2) | Capacity in barrels |
| location_id | UUID | FK to locations |
| status | TEXT | Status: dirty, caustic_cleaned, ready_for_use, in_use, maintenance |
| notes | TEXT | Notes |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Current batch**: Derived from `vessel_transfers` via `vessels_with_current_batch` view (see below). No stored `current_batch_id` field - single source of truth is the transfer log.

---

## `vessel_transfers`

Track batch movements between vessels.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| batch_id | UUID | FK to batches |
| from_vessel_id | UUID | FK to vessels (NULL if from kettle) |
| to_vessel_id | UUID | FK to vessels |
| volume_bbl | DECIMAL(8,2) | Volume transferred |
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

## `vessel_cleanings`

Cleaning history for vessels. Each record represents a cleaning event.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| vessel_id | UUID | FK to vessels |
| cleaning_type | TEXT | Type: cip, caustic, acid, sanitize, manual, rinse |
| from_status | TEXT | Vessel status before cleaning |
| to_status | TEXT | Vessel status after cleaning |
| cleaned_at | TIMESTAMPTZ | When cleaning occurred |
| cleaned_by | UUID | FK to auth.users |
| duration_min | INTEGER | Cleaning duration in minutes |
| chemicals_used | JSONB | Chemicals/concentrations used |
| notes | TEXT | Notes about this cleaning |
| created_at | TIMESTAMPTZ | Created timestamp |

**chemicals_used schema:**
```json
[
  { "chemical": "Caustic", "concentration_percent": 2.0, "temp_f": 180 },
  { "chemical": "PAA", "concentration_ppm": 200 }
]
```

**Cleaning workflow:**
1. Vessel in `dirty` or `in_use` status
2. Start cleaning → record `vessel_cleaning` with type
3. Complete cleaning → update vessel status to `caustic_cleaned` or `ready_for_use`

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

Post-brewday additions (dry hops, fruit, yeast, etc.).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| batch_id | UUID | FK to batches |
| addition_type | TEXT | Type: dry_hop, fruit, sugar, yeast, adjunct, other |
| catalog_type | TEXT | Catalog type: hop, fruit, sugar, yeast, adjunct |
| catalog_id | UUID | FK to catalog item |
| inventory_lot_id | UUID | FK to inventory_lots (optional) |
| amount | DECIMAL(10,4) | Amount |
| unit | TEXT | Unit |
| vessel_id | UUID | FK to vessels |
| added_at | TIMESTAMPTZ | When added |
| added_by | UUID | FK to auth.users |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |

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

## Yeast Management (Brinks Model)

Yeast tracking uses a brinks-based model where physical containers ("brinks") hold yeast that can be pitched to multiple batches. This enables:
- Accurate tracking of yeast weight remaining in each container
- Viability testing over time
- Cost spreading across all batches in a lineage
- Harvest and repitch tracking across generations

### Workflow

```
Purchase Yeast (Gen 0)
    ↓
Brink B-001 (strain: WLP001, weight: 10 lbs)
    ↓
├── Viability reading: 95% (day before brew)
├── Pitch 2 lbs → Batch #101
├── Pitch 2 lbs → Batch #102
├── Viability reading: 75%
└── Remaining 6 lbs → viability too low → DUMP

Harvest from Batch #101 (Gen 1)
    ↓
Brink B-002 (strain: WLP001, parent: B-001, weight: 8 lbs)
    ↓
└── Continue pitching...
```

---

## `yeast_brinks`

Physical yeast containers with lineage tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| brink_identifier | TEXT | Physical label (e.g., "B-001") - unique |
| strain_id | UUID | FK to yeasts |
| source_batch_id | UUID | FK to batches (NULL if purchased) |
| harvested_at | TIMESTAMPTZ | Harvest timestamp (NULL if purchased) |
| initial_weight_lbs | DECIMAL(8,2) | Initial weight in pounds |
| initial_viability_percent | DECIMAL(5,2) | Viability at harvest/purchase (default: 95 harvested, 98 purchased) |
| generation | INTEGER | Generation (0 = purchased, 1+ = harvested) |
| parent_brink_id | UUID | FK to yeast_brinks (lineage) |
| status | TEXT | Status: active, depleted, dumped |
| cost_cents | INTEGER | Purchase cost in cents (gen 0 only) |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Calculated fields** (via view or application):
- `current_weight_lbs = initial_weight_lbs - SUM(yeast_pitches.weight_lbs)`
- `current_viability` = see two-tier calculation below

**Viability decay formula** (Zainasheff, per DEC-GAP-004):
```
viability = baseline_viability × (0.79 ^ months_elapsed)
```

**Two-tier calculation:**
1. **If readings exist**: Use most recent `brink_viability_readings.viability_percent`, decay from `measured_at`
2. **If no readings**: Use `initial_viability_percent`, decay from `harvested_at` (or `created_at` for purchased)

---

## `brink_viability_readings`

Viability measurements for yeast brinks over time.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| brink_id | UUID | FK to yeast_brinks |
| measured_at | TIMESTAMPTZ | Measurement timestamp |
| viability_percent | DECIMAL(5,2) | Viability percentage (0-100) |
| cell_count_billion | DECIMAL(12,2) | Cell count in billions (optional) |
| method | TEXT | Method: hemocytometer, cell_counter, estimated |
| measured_by | UUID | FK to auth.users |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |

---

## `yeast_pitches`

Record of yeast pitched from brinks to batches.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| brink_id | UUID | FK to yeast_brinks |
| batch_id | UUID | FK to batches |
| pitched_at | TIMESTAMPTZ | Pitch timestamp |
| weight_lbs | DECIMAL(8,4) | Weight removed from brink |
| viability_at_pitch | DECIMAL(5,2) | Viability snapshot at pitch time |
| pitch_rate | DECIMAL(5,3) | Actual pitch rate (M cells/mL/°P) |
| pitched_by | UUID | FK to auth.users |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |

---

## `yeast_brinks_with_status` (View)

Calculated view showing current brink status with two-tier viability calculation (per DEC-GAP-004).

| Column | Type | Description |
|--------|------|-------------|
| *(all yeast_brinks columns)* | | Base brink data |
| current_weight_lbs | DECIMAL | Remaining weight |
| latest_viability | DECIMAL | Most recent viability reading (NULL if none) |
| latest_reading_date | TIMESTAMPTZ | When last measured (NULL if none) |
| estimated_viability | DECIMAL | **Two-tier calculation**: decay from reading if available, otherwise from initial |
| viability_source | TEXT | 'reading' or 'initial' - indicates which tier was used |
| pitch_count | INTEGER | Number of pitches from this brink |

```sql
CREATE VIEW yeast_brinks_with_status AS
SELECT
  yb.*,
  yb.initial_weight_lbs - COALESCE(SUM(yp.weight_lbs), 0) as current_weight_lbs,
  latest.viability_percent as latest_viability,
  latest.measured_at as latest_reading_date,
  -- Two-tier viability: prefer reading decay, fallback to initial decay
  COALESCE(
    -- Tier 1: Decay from most recent reading
    latest.viability_percent * POWER(0.79,
      EXTRACT(EPOCH FROM (NOW() - latest.measured_at)) / (30.44 * 24 * 60 * 60)
    ),
    -- Tier 2: Decay from initial viability at harvest/purchase
    yb.initial_viability_percent * POWER(0.79,
      EXTRACT(EPOCH FROM (NOW() - COALESCE(yb.harvested_at, yb.created_at))) / (30.44 * 24 * 60 * 60)
    )
  ) as estimated_viability,
  CASE WHEN latest.viability_percent IS NOT NULL THEN 'reading' ELSE 'initial' END as viability_source,
  COUNT(yp.id) as pitch_count
FROM yeast_brinks yb
LEFT JOIN yeast_pitches yp ON yp.brink_id = yb.id
LEFT JOIN LATERAL (
  SELECT viability_percent, measured_at
  FROM brink_viability_readings bvr
  WHERE bvr.brink_id = yb.id
  ORDER BY measured_at DESC
  LIMIT 1
) latest ON true
GROUP BY yb.id, latest.viability_percent, latest.measured_at;
```

---

## Yeast Cost Spreading

Per DEC-GAP-003, yeast costs are spread equally across all batches in a lineage:

```
cost_per_batch = original_purchase_cost / COUNT(batches_in_lineage)
```

This is recalculated when new batches are added to the lineage. Query:

```sql
-- Get cost per batch for a lineage
WITH RECURSIVE lineage AS (
  SELECT id, parent_brink_id, cost_cents, generation
  FROM yeast_brinks WHERE id = :root_brink_id
  UNION ALL
  SELECT yb.id, yb.parent_brink_id, yb.cost_cents, yb.generation
  FROM yeast_brinks yb
  JOIN lineage l ON yb.parent_brink_id = l.id
),
batches_in_lineage AS (
  SELECT DISTINCT yp.batch_id
  FROM yeast_pitches yp
  WHERE yp.brink_id IN (SELECT id FROM lineage)
)
SELECT
  (SELECT cost_cents FROM lineage WHERE generation = 0) / COUNT(*) as cost_per_batch_cents
FROM batches_in_lineage;
```

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
| planned -> fermenting | Wort transferred from brew to fermenter (link via brew_log_batches) |
| fermenting -> conditioning | Transfer to brite/conditioning |
| conditioning -> packaging | Packaging begins |
| packaging -> completed | All packaging done |

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

-- Yeast management (brinks model)
CREATE INDEX idx_yeast_brinks_status ON yeast_brinks(status, yeast_id);
CREATE INDEX idx_yeast_brinks_parent ON yeast_brinks(parent_brink_id);
CREATE INDEX idx_brink_viability_brink_date ON brink_viability_readings(yeast_brink_id, reading_date DESC);
CREATE INDEX idx_yeast_pitches_batch ON yeast_pitches(batch_id);
CREATE INDEX idx_yeast_pitches_brink ON yeast_pitches(yeast_brink_id);
CREATE INDEX idx_yeast_pitches_parent ON yeast_pitches(parent_pitch_id, generation);

-- Vessel operations
CREATE INDEX idx_vessels_status ON vessels(status, type);
CREATE INDEX idx_vessel_transfers_source ON vessel_transfers(source_vessel_id, transfer_date);
CREATE INDEX idx_vessel_transfers_dest ON vessel_transfers(destination_vessel_id, transfer_date);
```
