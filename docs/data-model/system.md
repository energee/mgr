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
| default_batch_size_gallons | DECIMAL(6,2) | Default batch size in gallons |
| default_efficiency | DECIMAL(4,1) | Default mash efficiency |
| default_water_profile_id | UUID | FK to water_profiles (brewery's source water - see below) |
| fiscal_year_start_month | INTEGER | Fiscal year start month |
| features | JSONB | Feature flags |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

The settings table uses a singleton constraint to ensure only one row exists:
```sql
CONSTRAINT settings_singleton CHECK (id = '00000000-0000-0000-0000-000000000001'::uuid)
```

### Water Profile Defaults

The `default_water_profile_id` references a water profile in `production.water_profiles`. This represents the brewery's **source water** chemistry.

**Resolution order for recipes:**
1. Recipe has `water_profile_id` set → use recipe's profile
2. Recipe has `water_profile_id` = NULL → use `settings.default_water_profile_id`

Individual water chemistry values (Ca, Mg, SO4, etc.) are stored on the `water_profiles` table, not on settings. See `docs/data-model/production.md` for water_profiles schema.

---

## `locations`

Physical locations/facilities. Locations are the top level of the storage hierarchy.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Location name |
| address | JSONB | Address (see schema below) |
| location_type | TEXT | Type: brewery, warehouse, taproom, offsite |
| is_primary | BOOLEAN | Is this the primary location |
| is_offsite_premises | BOOLEAN | Whether this is an offsite TTB premise (affects reporting) |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

### Location Types

| Type | Description | Typical Bin Types |
|------|-------------|-------------------|
| brewery | Main production facility | storage, cold_room, staging |
| warehouse | Off-site storage | storage, shipping |
| taproom | Customer-facing location | taproom, hold |
| offsite | External storage/partner | storage, quarantine |

### Location → Bin Hierarchy

```
Location (brewery, warehouse, taproom, offsite)
    └── Bins (storage units within location)
        └── bin_inventory (FG quantities per bin)
```

**Constraints:**
- Each bin belongs to exactly one location
- `is_offsite_premises = true` affects TTB Line 19 reporting
- Primary location (`is_primary = true`) is used as default for new batches

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

### Entities Using entity_revisions

All stateful entities track changes via `entity_revisions`. The following entities are tracked:

| Entity | entity_type | Key Changes Tracked |
|--------|-------------|---------------------|
| batches | batch | Status transitions, FG/ABV updates, notes |
| brew_logs | brew_log | Status transitions, events modifications |
| recipes | recipe | Ingredient changes, parameter updates |
| orders | order | Status transitions, line item changes |
| packaging_sessions | packaging_session | Status transitions, quantity adjustments |
| finished_goods | finished_good | Quantity adjustments, location changes |
| vessels | vessel | Status transitions, cleaning events |
| inventory_items | inventory_item | Stock adjustments |

**Note:** Legacy tables may have `revisions JSONB` columns. These should be migrated to `entity_revisions` during implementation.

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

### Migration from JSONB Revisions

For tables with legacy `revisions JSONB` columns:

```sql
-- Example migration: packaging_sessions
INSERT INTO entity_revisions (entity_type, entity_id, action, previous_value, new_value, user_id, created_at)
SELECT
  'packaging_session',
  ps.id,
  (r->>'action')::text,
  r->'previous_value',
  r->'new_value',
  (r->>'user_id')::uuid,
  (r->>'timestamp')::timestamptz
FROM packaging_sessions ps,
     jsonb_array_elements(ps.revisions) r
WHERE ps.revisions IS NOT NULL;

-- Then drop the column
ALTER TABLE packaging_sessions DROP COLUMN revisions;
```

### Creating Revision Records

Application code should create revision records on all entity changes:

```typescript
async function createRevision(
  entityType: string,
  entityId: string,
  action: 'created' | 'updated' | 'status_changed' | 'deleted',
  changes: { field?: string; previousValue?: any; newValue?: any; reason?: string },
  userId: string
) {
  await supabase.from('entity_revisions').insert({
    entity_type: entityType,
    entity_id: entityId,
    action,
    field: changes.field,
    previous_value: changes.previousValue,
    new_value: changes.newValue,
    reason: changes.reason,
    user_id: userId
  });
}
```

---

## Soft Delete Rules

Entities with `is_active` flag use soft delete. This section documents when soft vs hard delete is allowed.

### Delete Rules by Entity

| Entity | Delete Type | Blocking Conditions |
|--------|-------------|---------------------|
| **Catalog** | | |
| malts, hops, etc. | Soft only | None (set is_active=false) |
| yeasts | Soft only | None |
| beer_styles | Soft only | None |
| **Production** | | |
| recipes | Soft only | None |
| batches | No delete | Use status=cancelled instead |
| brew_logs | No delete | Use status=cancelled instead |
| vessels | Soft only | Must be empty (no current batch) |
| **Inventory** | | |
| inventory_items | Soft only | None (lots remain for history) |
| allocations | No delete | Use status=cancelled instead |
| finished_goods | No delete | Use allocations to remove quantity |
| **Packaging** | | |
| package_types | Soft only | None |
| packaging_sessions | No delete | Use status=cancelled instead |
| **Sales** | | |
| customers | Soft only | No unpaid orders |
| orders | Soft (draft only) | Hard delete only if draft, no line items |
| price_tiers | Soft only | None |
| **Purchasing** | | |
| suppliers | Soft only | No open POs |
| purchase_orders | Soft (draft only) | Hard delete only if draft |
| **System** | | |
| locations | Soft only | No associated bins with inventory |
| bins | Soft only | Must be empty |

### Application Enforcement

```typescript
// Check before soft delete
async function canDeactivate(entity: string, id: string): Promise<boolean> {
  switch (entity) {
    case 'vessel':
      const vessel = await getVesselWithCurrentBatch(id);
      return vessel.current_batch_id === null;

    case 'customer':
      const openOrders = await supabase
        .from('orders')
        .select('id')
        .eq('customer_id', id)
        .not('status', 'in', ['fulfilled', 'cancelled'])
        .limit(1);
      return openOrders.data?.length === 0;

    case 'bin':
      const binInventory = await supabase
        .from('bin_inventory')
        .select('quantity')
        .eq('bin_id', id)
        .gt('quantity', 0)
        .limit(1);
      return binInventory.data?.length === 0;

    default:
      return true;
  }
}
```

### Query Patterns

Always filter for active records in normal queries:

```sql
-- Standard query pattern
SELECT * FROM customers WHERE is_active = true;

-- Admin view (include inactive)
SELECT * FROM customers;

-- Find inactive records
SELECT * FROM customers WHERE is_active = false;
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
| ai_context | JSONB | AI-specific context and guidance for this table |
| calculated_fields | JSONB | Array of field names that are calculated (not stored) |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

This table is read-only for authenticated users and is populated via migrations.

---

## `user_preferences`

Per-user preferences including unit display settings. Auto-created on user signup via database trigger.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | FK to auth.users (unique) |
| volume_unit | TEXT | Volume display: bbl, gal, l, hl |
| weight_unit | TEXT | Weight display: lbs, kg |
| temperature_unit | TEXT | Temperature display: f, c |
| gravity_unit | TEXT | Gravity display: plato, sg |
| retail_volume_unit | TEXT | Retail volume display: oz, ml |
| theme | TEXT | UI theme: light, dark, system |
| date_format | TEXT | Date format preference |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

### Constraints

```sql
CONSTRAINT user_preferences_user_unique UNIQUE (user_id)
CHECK (volume_unit IN ('bbl', 'gal', 'l', 'hl'))
CHECK (weight_unit IN ('lbs', 'kg'))
CHECK (temperature_unit IN ('f', 'c'))
CHECK (gravity_unit IN ('plato', 'sg'))
CHECK (retail_volume_unit IN ('oz', 'ml'))
CHECK (theme IN ('light', 'dark', 'system'))
```

### Defaults

| Column | Default | Rationale |
|--------|---------|-----------|
| volume_unit | `bbl` | US brewing industry standard |
| weight_unit | `lbs` | US standard |
| temperature_unit | `f` | US standard |
| gravity_unit | `plato` | Professional brewing convention |
| retail_volume_unit | `oz` | US retail standard |
| theme | `system` | Respects OS preference |

### Auto-Creation Trigger

```sql
CREATE OR REPLACE FUNCTION create_user_preferences()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_user_preferences();
```

### Query Examples

```sql
-- Get user's unit preferences
SELECT volume_unit, weight_unit, temperature_unit, gravity_unit
FROM user_preferences
WHERE user_id = auth.uid();

-- Update volume preference
UPDATE user_preferences
SET volume_unit = 'gal', updated_at = now()
WHERE user_id = auth.uid();
```

### Application Usage

```typescript
// Hook provides preferences with defaults
const { data: prefs } = useUnitPreferences();

// Convert for display
const displayVolume = formatVolume(batch.volume_bbl, prefs.volume_unit);

// Convert input to canonical
const canonicalVolume = parseVolumeInput(userInput, prefs.volume_unit);
```

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
