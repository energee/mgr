# System Domain

## `settings`

Brewery settings (singleton table for single-tenant mode).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key (fixed) |
| brewery_name | TEXT | Brewery name |
| address | JSONB | Address |
| phone | TEXT | Phone |
| email | TEXT | Email |
| website | TEXT | Website |
| timezone | TEXT | Timezone |
| currency | TEXT | Currency code |
| date_format | TEXT | Date format preference |
| lot_format | TEXT | Lot code format: standard, julian, coded |
| ttb_permit_number | TEXT | TTB permit number |
| ttb_registry_number | TEXT | TTB registry number |
| default_batch_size_bbl | DECIMAL(6,2) | Default batch size |
| default_efficiency | DECIMAL(4,1) | Default mash efficiency |
| fiscal_year_start_month | INTEGER | Fiscal year start month |
| **Default Water Profile** | | |
| default_water_calcium | DECIMAL(6,1) | Default source water Ca ppm |
| default_water_magnesium | DECIMAL(6,1) | Default source water Mg ppm |
| default_water_sodium | DECIMAL(6,1) | Default source water Na ppm |
| default_water_sulfate | DECIMAL(6,1) | Default source water SO4 ppm |
| default_water_chloride | DECIMAL(6,1) | Default source water Cl ppm |
| default_water_bicarbonate | DECIMAL(6,1) | Default source water HCO3 ppm |
| default_water_ph | DECIMAL(3,1) | Default source water pH |
| features | JSONB | Feature flags |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

The settings table uses a singleton constraint to ensure only one row exists:
```sql
CONSTRAINT settings_singleton CHECK (id = '00000000-0000-0000-0000-000000000001'::uuid)
```

---

## `locations`

Physical locations/facilities.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Location name |
| address | JSONB | Address |
| location_type | TEXT | Type: brewery, warehouse, taproom, offsite |
| is_primary | BOOLEAN | Is this the primary location |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## Future: Multi-Tenant Support

The following tables would be added for multi-tenant SaaS deployment:

### `breweries`

Brewery/tenant records.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Brewery name |
| slug | TEXT | URL slug (unique) |
| address | JSONB | Address |
| settings | JSONB | Brewery-specific settings |
| subscription_tier | TEXT | Subscription level |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

### `user_breweries`

User-to-brewery membership with roles.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | FK to auth.users |
| brewery_id | UUID | FK to breweries |
| roles | TEXT[] | Assigned roles |
| is_primary | BOOLEAN | User's primary brewery |
| created_at | TIMESTAMPTZ | Created timestamp |

**Unique constraint:** (user_id, brewery_id)

**Roles:** admin, production_manager, brewer, sales

When multi-tenant is enabled, all other tables would include a `brewery_id` column with RLS policies enforcing tenant isolation.
