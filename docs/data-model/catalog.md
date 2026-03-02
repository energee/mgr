# Catalog Domain

Catalog tables store reference data for ingredients. These are templates with properties used for calculations and inventory management.

## Catalog Architecture

The catalog uses **separate tables per ingredient type** (malts, hops, yeasts, etc.) for strong typing and type-specific fields. Cross-domain references use a polymorphic pattern. A unified `catalog_items` table was considered (see DEC-SIMP-001 in `docs/spec/decisions.md`) but deferred in favor of the current approach, which provides better type safety and query performance for type-specific operations.

### Polymorphic References

When other tables need to reference any catalog item, they use:

```sql
catalog_type  TEXT  -- 'malt', 'hop', 'yeast', 'adjunct', 'sugar', 'spice', 'fruit', 'additive'
catalog_id    UUID  -- FK to the appropriate table
```

**Tables using this pattern:**
- `supplier_catalog` - What suppliers offer
- `po_line_items` - What's being ordered
- `inventory_items` - Stock tracking items
- `batch_additions` - Post-brew additions

**Note**: The polymorphic `catalog_type + catalog_id` pattern does not enforce referential integrity at the database level (no FK constraint to a specific table). Application-layer validation ensures `catalog_id` references a valid record in the table corresponding to `catalog_type`.

### Recipe Ingredient Pattern

Recipe ingredients use **concrete junction tables** with direct FKs for stronger typing:

```
recipes ──┬── recipe_malts ──── malts
          ├── recipe_hops ──── hops
          ├── recipe_adjuncts ── adjuncts
          ├── recipe_sugars ─── sugars
          ├── recipe_spices ─── spices
          └── recipe_fruits ─── fruits
```

**Why concrete tables for recipes?**
- Enables queries like "all recipes using Citra hops"
- Type-specific columns (timing, boil_time_min for hops)
- Database-level referential integrity
- Proper indexing for ingredient searches

### Querying All Catalog Items

To query across all ingredient types:

```sql
-- Union query for all catalog items
SELECT 'malt' as type, id, name FROM malts WHERE is_active = true
UNION ALL
SELECT 'hop' as type, id, name FROM hops WHERE is_active = true
UNION ALL
SELECT 'yeast' as type, id, name FROM yeasts WHERE is_active = true
UNION ALL
SELECT 'adjunct' as type, id, name FROM adjuncts WHERE is_active = true
UNION ALL
SELECT 'sugar' as type, id, name FROM sugars WHERE is_active = true
UNION ALL
SELECT 'spice' as type, id, name FROM spices WHERE is_active = true
UNION ALL
SELECT 'fruit' as type, id, name FROM fruits WHERE is_active = true
UNION ALL
SELECT 'additive' as type, id, name FROM additives WHERE is_active = true;
```

### Valid catalog_type Values

```
malt | hop | yeast | adjunct | sugar | spice | fruit | additive
```

---

## `beer_styles`

Beer style definitions (e.g., BJCP styles).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Style name (e.g., "American IPA") |
| category | TEXT | Style category (e.g., "IPA") |
| og_min | DECIMAL(4,3) | Min original gravity |
| og_max | DECIMAL(4,3) | Max original gravity |
| fg_min | DECIMAL(4,3) | Min final gravity |
| fg_max | DECIMAL(4,3) | Max final gravity |
| ibu_min | INTEGER | Min IBU |
| ibu_max | INTEGER | Max IBU |
| srm_min | INTEGER | Min color (SRM) |
| srm_max | INTEGER | Max color (SRM) |
| abv_min | DECIMAL(3,1) | Min ABV % |
| abv_max | DECIMAL(3,1) | Max ABV % |
| description | TEXT | Style description |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `yeasts`

Yeast strains catalog.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Yeast name |
| manufacturer | TEXT | Manufacturer (e.g., "Fermentis", "White Labs") |
| product_code | TEXT | Product code (e.g., "US-05", "WLP001") |
| type | TEXT | Type: ale, lager, wild, hybrid |
| form | TEXT | Form: dry, liquid |
| attenuation_min | DECIMAL(4,1) | Min attenuation % |
| attenuation_max | DECIMAL(4,1) | Max attenuation % |
| attenuation_typical | DECIMAL(4,1) | Typical attenuation % |
| temp_min_f | INTEGER | Min fermentation temp °F |
| temp_max_f | INTEGER | Max fermentation temp °F |
| temp_ideal_f | INTEGER | Ideal fermentation temp °F |
| flocculation | TEXT | Flocculation: low, medium, high, very_high |
| alcohol_tolerance | DECIMAL(3,1) | Max ABV tolerance % |
| pitching_rate | DECIMAL(3,1) | Default pitching rate (million cells/mL/°P) |
| description | TEXT | Flavor profile and notes |
| cost_per_unit | DECIMAL(8,4) | Cost per yeast pack or vial |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Constraints:**
```sql
-- Attenuation percentages must be 0-100
ALTER TABLE yeasts ADD CONSTRAINT chk_yeast_attenuation_range
  CHECK (attenuation_min >= 0 AND attenuation_min <= 100
    AND attenuation_max >= 0 AND attenuation_max <= 100
    AND attenuation_typical >= 0 AND attenuation_typical <= 100);

-- Attenuation min <= typical <= max
ALTER TABLE yeasts ADD CONSTRAINT chk_yeast_attenuation_order
  CHECK (attenuation_min <= attenuation_typical
    AND attenuation_typical <= attenuation_max);

-- Temperature ranges must be valid
ALTER TABLE yeasts ADD CONSTRAINT chk_yeast_temp_range
  CHECK (temp_min_f >= 32 AND temp_max_f <= 120
    AND temp_min_f <= temp_ideal_f AND temp_ideal_f <= temp_max_f);

-- Alcohol tolerance must be reasonable (0-25% ABV)
ALTER TABLE yeasts ADD CONSTRAINT chk_yeast_alcohol_tolerance
  CHECK (alcohol_tolerance >= 0 AND alcohol_tolerance <= 25);

-- Pitching rate must be positive
ALTER TABLE yeasts ADD CONSTRAINT chk_yeast_pitching_rate
  CHECK (pitching_rate > 0);
```

---

## `malts`

Malt and grain catalog.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Malt name |
| maltster | TEXT | Maltster/manufacturer |
| country | TEXT | Country of origin |
| type | TEXT | Type: base, specialty, roasted, adjunct |
| color_lovibond | DECIMAL(5,1) | Color in Lovibond |
| potential_ppg | DECIMAL(4,1) | Potential points per pound per gallon |
| max_percentage | INTEGER | Max % of grain bill |
| requires_mash | BOOLEAN | Whether it needs to be mashed |
| diastatic_power | DECIMAL(5,1) | Diastatic power (°Lintner) |
| protein_percent | DECIMAL(4,1) | Protein content % |
| moisture_percent | DECIMAL(4,1) | Moisture content % |
| description | TEXT | Flavor/usage notes |
| bag_weight_lbs | DECIMAL(6,2) | Standard bag weight in pounds |
| cost_per_lb | DECIMAL(8,4) | Cost per pound |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Constraints:**
```sql
-- Color Lovibond must be non-negative
ALTER TABLE malts ADD CONSTRAINT chk_malt_color_nonnegative
  CHECK (color_lovibond >= 0);

-- Potential PPG must be positive
ALTER TABLE malts ADD CONSTRAINT chk_malt_ppg_positive
  CHECK (potential_ppg > 0);

-- Max percentage must be 0-100
ALTER TABLE malts ADD CONSTRAINT chk_malt_max_percentage
  CHECK (max_percentage IS NULL OR (max_percentage >= 0 AND max_percentage <= 100));

-- Percentages (protein, moisture) must be 0-100
ALTER TABLE malts ADD CONSTRAINT chk_malt_percentages_valid
  CHECK ((protein_percent IS NULL OR (protein_percent >= 0 AND protein_percent <= 100))
    AND (moisture_percent IS NULL OR (moisture_percent >= 0 AND moisture_percent <= 100)));

-- Diastatic power must be non-negative
ALTER TABLE malts ADD CONSTRAINT chk_malt_diastatic_power_nonnegative
  CHECK (diastatic_power IS NULL OR diastatic_power >= 0);
```

---

## `hops`

Hop varieties catalog.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Hop name |
| origin | TEXT | Country of origin |
| type | TEXT | Type: bittering, aroma, dual |
| alpha_acid_min | DECIMAL(4,1) | Min alpha acid % |
| alpha_acid_max | DECIMAL(4,1) | Max alpha acid % |
| alpha_acid_typical | DECIMAL(4,1) | Typical alpha acid % |
| beta_acid_min | DECIMAL(4,1) | Min beta acid % |
| beta_acid_max | DECIMAL(4,1) | Max beta acid % |
| hsi | DECIMAL(4,1) | Hop Storage Index (% loss/6mo) |
| oil_ml_100g | DECIMAL(5,2) | Total oil mL/100g |
| myrcene_percent | DECIMAL(4,1) | Myrcene oil % |
| humulene_percent | DECIMAL(4,1) | Humulene oil % |
| caryophyllene_percent | DECIMAL(4,1) | Caryophyllene oil % |
| farnesene_percent | DECIMAL(4,1) | Farnesene oil % |
| flavor_profile | TEXT | Flavor/aroma description |
| substitutes | TEXT | Suggested substitutes |
| cost_per_lb | DECIMAL(8,4) | Cost per pound |
| bag_weight_lbs | DECIMAL(6,2) | Standard package weight |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Constraints:**
```sql
-- Alpha acid percentages must be 0-100
ALTER TABLE hops ADD CONSTRAINT chk_hop_alpha_acid_range
  CHECK (alpha_acid_min >= 0 AND alpha_acid_min <= 100
    AND alpha_acid_max >= 0 AND alpha_acid_max <= 100
    AND alpha_acid_typical >= 0 AND alpha_acid_typical <= 100);

-- Alpha acid min <= typical <= max
ALTER TABLE hops ADD CONSTRAINT chk_hop_alpha_acid_order
  CHECK (alpha_acid_min <= alpha_acid_typical
    AND alpha_acid_typical <= alpha_acid_max);

-- Beta acid percentages must be 0-100
ALTER TABLE hops ADD CONSTRAINT chk_hop_beta_acid_range
  CHECK ((beta_acid_min IS NULL OR (beta_acid_min >= 0 AND beta_acid_min <= 100))
    AND (beta_acid_max IS NULL OR (beta_acid_max >= 0 AND beta_acid_max <= 100)));

-- Oil percentages must be 0-100
ALTER TABLE hops ADD CONSTRAINT chk_hop_oil_percentages
  CHECK ((myrcene_percent IS NULL OR (myrcene_percent >= 0 AND myrcene_percent <= 100))
    AND (humulene_percent IS NULL OR (humulene_percent >= 0 AND humulene_percent <= 100))
    AND (caryophyllene_percent IS NULL OR (caryophyllene_percent >= 0 AND caryophyllene_percent <= 100))
    AND (farnesene_percent IS NULL OR (farnesene_percent >= 0 AND farnesene_percent <= 100)));

-- HSI must be non-negative
ALTER TABLE hops ADD CONSTRAINT chk_hop_hsi_nonnegative
  CHECK (hsi IS NULL OR hsi >= 0);
```

---

## `adjuncts`

Adjunct ingredients (non-malt fermentables, rice, corn, etc.).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Adjunct name |
| type | TEXT | Type: grain, extract, other |
| color_lovibond | DECIMAL(5,1) | Color contribution |
| potential_ppg | DECIMAL(4,1) | Potential extract |
| requires_mash | BOOLEAN | Whether it needs mashing |
| description | TEXT | Usage notes |
| cost_per_lb | DECIMAL(8,4) | Cost per pound |
| bag_weight_lbs | DECIMAL(6,2) | Standard package weight |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `sugars`

Sugar/syrup ingredients.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Sugar name |
| type | TEXT | Type: simple, invert, honey, maple, etc. |
| color_lovibond | DECIMAL(5,1) | Color contribution |
| potential_ppg | DECIMAL(4,1) | Potential extract |
| fermentability | DECIMAL(5,1) | % fermentable |
| description | TEXT | Usage notes |
| cost_per_lb | DECIMAL(8,4) | Cost per pound |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `spices`

Spices and botanicals.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Spice name |
| type | TEXT | Type: spice, herb, botanical, other |
| description | TEXT | Flavor profile and usage |
| typical_amount | DECIMAL(8,4) | Typical amount per BBL |
| typical_unit | TEXT | Unit for typical amount |
| cost_per_unit | DECIMAL(8,4) | Cost per unit |
| unit | TEXT | Standard unit (oz, g, etc.) |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `fruits`

Fruit additions.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Fruit name |
| type | TEXT | Type: whole, puree, juice, concentrate, dried |
| form | TEXT | Form: fresh, frozen, aseptic, canned |
| sugar_content | DECIMAL(4,1) | Typical sugar content % (Brix) |
| description | TEXT | Usage notes |
| cost_per_lb | DECIMAL(8,4) | Cost per pound |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `additives`

All brewing additives: water chemistry (salts, acids), clarifiers, nutrients, enzymes, etc.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Additive name |
| type | TEXT | Type (see below) |
| description | TEXT | Usage notes |
| typical_amount | DECIMAL(8,4) | Typical amount per BBL |
| typical_unit | TEXT | Unit for typical amount |
| cost_per_unit | DECIMAL(8,4) | Cost per unit |
| unit | TEXT | Standard unit |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Additive types:**
- `water_salt` - Gypsum, Calcium Chloride, Epsom Salt, Baking Soda, Chalk, Table Salt
- `acid` - Lactic acid, Phosphoric acid, Hydrochloric acid, etc.
- `clarifier` - Irish Moss, Whirlfloc, Biofine, Gelatin
- `nutrient` - Fermaid-O, Fermaid-K, DAP, Yeast Hulls
- `enzyme` - Amylase, Clarity Ferm, Glucoamylase
- `antifoam` - FermCap-S, Antifoam agents
- `other` - Anything else
