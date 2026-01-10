# Catalog Domain

Catalog tables store reference data for ingredients. These are templates with properties used for calculations and inventory management.

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
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

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
