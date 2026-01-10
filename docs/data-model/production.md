# Production Domain

## `brands`

Manufactured products (beers, ciders, wines, etc.). A brand represents a finished product that may be produced from one or more recipes.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Brand name (unique per brewery) |
| style_id | UUID | FK to beer_styles |
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

Reusable water profiles (source water chemistry).

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
| is_default | BOOLEAN | Is this the brewery default profile? |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `recipes`

Brewing recipes with all parameters. Ingredients are stored as JSONB arrays.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Recipe name |
| brand_id | UUID | FK to brands (optional) |
| style_id | UUID | FK to beer_styles |
| yeast_id | UUID | FK to yeasts |
| water_profile_id | UUID | FK to water_profiles |
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
| **Ingredients (JSONB)** | | |
| malts | JSONB | Malt bill array (see schema below) |
| hops | JSONB | Hop additions array |
| adjuncts | JSONB | Adjunct additions array |
| sugars | JSONB | Sugar additions array |
| spices | JSONB | Spice additions array |
| fruits | JSONB | Fruit additions array |
| **Schedules (JSONB)** | | |
| mash_schedule | JSONB | Mash step schedule |
| fermentation_schedule | JSONB | Fermentation stage schedule |
| **Calculated** | | |
| est_og | DECIMAL(4,3) | Estimated OG |
| est_fg | DECIMAL(4,3) | Estimated FG |
| est_abv | DECIMAL(3,1) | Estimated ABV |
| est_ibu | INTEGER | Estimated IBU |
| est_srm | INTEGER | Estimated color |
| est_cogs | DECIMAL(10,2) | Estimated cost of goods |
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

### Ingredient JSONB Schemas

**malts** array:
```json
[{
  "malt_id": "uuid",
  "name": "Pale Malt 2-Row",
  "weight_lbs": 50.0,
  "color_lov": 1.8,
  "ppg": 37,
  "position": 1
}]
```

**hops** array:
```json
[{
  "hop_id": "uuid",
  "name": "Citra",
  "weight_lbs": 0.5,
  "alpha_acid": 12.0,
  "timing": "boil|whirlpool|dry_hop|first_wort",
  "boil_time_min": 60,
  "position": 1
}]
```

**adjuncts** array:
```json
[{
  "adjunct_id": "uuid",
  "name": "Flaked Oats",
  "weight_lbs": 5.0,
  "timing": "mash|boil|fermentation",
  "position": 1
}]
```

**sugars** array:
```json
[{
  "sugar_id": "uuid",
  "name": "Corn Sugar",
  "weight_lbs": 1.0,
  "timing": "boil|fermentation|packaging",
  "position": 1
}]
```

**spices** array:
```json
[{
  "spice_id": "uuid",
  "name": "Coriander",
  "amount": 2.0,
  "unit": "oz|g|tsp|tbsp|each",
  "timing": "boil|whirlpool|fermentation|secondary",
  "boil_time_min": 5,
  "position": 1
}]
```

**fruits** array:
```json
[{
  "fruit_id": "uuid",
  "name": "Mango Puree",
  "amount": 10.0,
  "unit": "lbs|oz|gal|l|can",
  "timing": "boil_end|primary|secondary|packaging",
  "position": 1
}]
```

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

## `batches`

Production batches (cold-side: fermentation through packaging). Hot-side data comes from linked `brew_logs` via `brew_log_batches`.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| recipe_id | UUID | FK to recipes |
| batch_number | TEXT | Unique batch identifier |
| name | TEXT | Batch name |
| status | TEXT | Status: planned, fermenting, conditioning, packaging, completed, cancelled |
| **Planning** | | |
| planned_start_date | DATE | Planned fermentation start date (for scheduling) |
| **Volumes** | | |
| volume_gallons | DECIMAL(6,2) | Volume in fermenter |
| **Fermentation Results** | | |
| actual_fg | DECIMAL(4,3) | Actual final gravity |
| actual_abv | DECIMAL(3,1) | Actual ABV |
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
| current_batch_id | UUID | FK to batches (if in_use) |
| notes | TEXT | Notes |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

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

## `yeast_pitches`

Yeast pitch inventory with lineage tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| yeast_id | UUID | FK to yeasts |
| parent_pitch_id | UUID | FK to yeast_pitches (for harvested) |
| source_batch_id | UUID | FK to batches (if harvested from) |
| generation | INTEGER | Generation (0 = purchased) |
| cell_count_billion | DECIMAL(12,2) | Cell count in billions |
| viability_percent | DECIMAL(5,2) | Viability percentage |
| volume_ml | DECIMAL(10,2) | Volume in mL |
| purchase_cost | DECIMAL(10,2) | Cost (only for gen 0) |
| purchase_date | DATE | Purchase date |
| harvest_date | DATE | Harvest date (if harvested) |
| status | TEXT | Status: available, pitched, depleted, retired |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `pitch_usage`

Record of yeast pitches used in batches.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| pitch_id | UUID | FK to yeast_pitches |
| batch_id | UUID | FK to batches |
| cells_pitched_billion | DECIMAL(12,2) | Cells pitched |
| viability_at_pitch | DECIMAL(5,2) | Viability at time of pitch |
| pitch_rate | DECIMAL(5,3) | Actual pitch rate (M cells/mL/°P) |
| pitched_at | TIMESTAMPTZ | Pitch timestamp |
| pitched_by | UUID | FK to auth.users |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |

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
