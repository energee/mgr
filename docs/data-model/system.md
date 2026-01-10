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
| default_water_profile_id | UUID | FK to water_profiles (default source water) |
| fiscal_year_start_month | INTEGER | Fiscal year start month |
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

## `entity_revisions`

Unified audit trail for all entity changes. Replaces scattered JSONB revision arrays with a single, queryable audit log.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| entity_type | TEXT | Entity type: batch, order, recipe, packaging_session, etc. |
| entity_id | UUID | FK to the entity record |
| action | TEXT | Action: created, updated, status_changed, deleted |
| field | TEXT | Specific field changed (nullable for status changes) |
| previous_value | JSONB | Previous value (nullable for creates) |
| new_value | JSONB | New value (nullable for deletes) |
| reason | TEXT | Reason for change (optional) |
| user_id | UUID | FK to auth.users |
| created_at | TIMESTAMPTZ | Timestamp of change |

### Entity Types

| entity_type | Description |
|-------------|-------------|
| batch | Production batch changes |
| brew_log | Brew log changes |
| recipe | Recipe modifications |
| order | Order status and field changes |
| packaging_session | Packaging session changes |
| finished_good | FG adjustments |
| inventory_item | Inventory changes |
| vessel | Vessel status changes |

### Actions

| action | Description |
|--------|-------------|
| created | Entity was created |
| updated | One or more fields changed |
| status_changed | State machine transition |
| deleted | Entity was soft-deleted |

### Query Examples

```sql
-- All changes to a specific batch
SELECT * FROM entity_revisions
WHERE entity_type = 'batch' AND entity_id = '...'
ORDER BY created_at DESC;

-- All status changes today
SELECT * FROM entity_revisions
WHERE action = 'status_changed'
AND created_at >= CURRENT_DATE;

-- Changes by a specific user
SELECT * FROM entity_revisions
WHERE user_id = '...'
ORDER BY created_at DESC
LIMIT 50;
```

---

## `_schema_registry`

Self-documenting schema metadata for AI agents. Query this table to understand the database structure.

| Column | Type | Description |
|--------|------|-------------|
| table_name | TEXT | Primary key - table name |
| description | TEXT | Human-readable description |
| domain | TEXT | Domain: system, production, inventory, packaging, purchasing, sales |
| relationships | JSONB | Array of relationship descriptions |
| key_fields | JSONB | Array of important fields |
| state_machine | JSONB | State machine definition (if applicable) |
| query_examples | JSONB | Example queries for this table |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

This table is read-only for authenticated users and is populated via migrations.

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
