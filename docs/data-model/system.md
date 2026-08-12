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

`old_data` / `new_data` hold **complete `to_jsonb()` row images**, not references
to the source row. `entity_revisions` is therefore a second, denormalized copy
of every tracked table, and its read policy must be at least as strict as the
source table's — see *Access control* below.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| entity_type | TEXT | **Tracked table name** (`TG_TABLE_NAME`), e.g. `orders`, `recipes` — plural, not a singular entity noun |
| entity_id | UUID | Id of the tracked row (`COALESCE(NEW.id, OLD.id)`) |
| revision_number | INTEGER | Sequential revision number per entity |
| operation | TEXT | `INSERT`, `UPDATE`, or `DELETE` |
| old_data | JSONB | Complete row image before the change (null for INSERT) |
| new_data | JSONB | Complete row image after the change (null for DELETE) |
| change_reason | TEXT | Optional user-provided reason |
| changed_by | UUID | `auth.uid()` at write time; null for system operations |
| changed_at | TIMESTAMPTZ | Timestamp of change |
| created_at | TIMESTAMPTZ | Row insert timestamp |

### Entity Types

`entity_type` is the tracked table's name. Rows are written by the
`log_entity_revision()` trigger, currently attached to:

| entity_type | Attached by | Description |
|-------------|-------------|-------------|
| batches | `00019` | Production batch changes |
| recipes | `00019` | Recipe modifications |
| orders | `00019` | Order status and field changes |
| purchase_orders | `00019` | Procurement changes |
| finished_goods | `00019` | FG adjustments |
| allocations | `00211` | Allocation ledger changes |
| inventory_lots | `00213` | Lot-level inventory changes |
| keg_transactions | `00213` | Keg movement history |
| packaging_sessions | `00213` | Packaging session changes |
| pricing_tier_prices | `00213` | Tier price changes |
| supplier_catalog | `00282`† | Price / SKU / lead time edits and preferred-supplier changes |
| enum_values | `00282`† | Status-option edits: label, color, sort_order, `is_default` |
| suppliers | `00286`† | **DELETE only** — full `old_data` image per deleted row. INSERT/UPDATE deliberately untracked: the MongoDB sync upserts every supplier on every run (#694) |

† `00282` and `00286` are committed but **not yet applied to the live
database** (#693), so those three rows describe the migration chain, not
production. The ten rows above them are live —
`supabase/live-catalog.snapshot.txt` lists exactly ten `tr_*_revision`
triggers.

No other table carries the trigger. In particular `brew_logs`, `vessels` and
`inventory_items` do **not**, despite the brew-log detail page rendering a
Revision History section that is therefore permanently empty (#695).

### Access control

Reads are gated by migration `00275` (re-stated by `00282` to add
`supplier_catalog` and `enum_values`, then by `00286` to add `suppliers`):
`entity_revisions_select` maps `entity_type` to the permission the tracked
table's own SELECT policy requires (`orders` → `orders:read`,
`purchase_orders`, `supplier_catalog` and `suppliers` → `purchasing:read`, and
so on). Any `entity_type` not enumerated falls back to
`settings:manage`, so a table that gains the trigger without a matching CASE
branch is **admin-only until the branch is added** — the failure mode is
closed, never open.

Two settings tables are deliberately *not* mapped to their own SELECT
permission. `pricing_tier_prices_select` and `enum_values_select` both admit
any authenticated principal, and a portal customer is authenticated, so
mirroring them literally would reopen the hole `00275` closed — the revision
rows are full row images. Both map to `settings:manage` instead, matching the
permission their `_write` policy already requires.

Portal customers hold no staff permission and therefore read zero revision
rows. Their writes are still recorded: `log_entity_revision()` is
`SECURITY DEFINER`, so its INSERT runs as the function's owner (`postgres`),
which owns `entity_revisions` and is not subject to its policies — no table
here sets `FORCE ROW LEVEL SECURITY`. Note that `SECURITY DEFINER` alone does
not bypass RLS: RLS is evaluated against the *definer* role, and a definer
holding neither ownership nor `BYPASSRLS` would still be checked against
`entity_revisions_insert`. Rows are immutable — there is no UPDATE or DELETE
policy.

**When you attach `log_entity_revision()` to a new table, add its CASE branch
to `entity_revisions_select` in the same migration.** The integration spec
`src/__tests__/integration/entity-revisions-rls.test.ts` enforces this: it
reads the tracked-table list from `pg_trigger` and fails if any table carrying
the trigger has no branch in the policy.

### Query Examples

`entity_revisions` has no `action`, `user_id`, `previous_value` or `new_value`
column — the trigger writes `operation` (`INSERT`/`UPDATE`/`DELETE`),
`changed_by`, `old_data` and `new_data`, per the column table above.

```sql
-- All changes to a specific batch. entity_type is the TABLE name (plural).
SELECT * FROM entity_revisions
WHERE entity_type = 'batches' AND entity_id = '...'
ORDER BY revision_number DESC;

-- Everything deleted today, with the row image that was destroyed
SELECT entity_type, entity_id, old_data, changed_by, changed_at
FROM entity_revisions
WHERE operation = 'DELETE'
  AND changed_at >= CURRENT_DATE;

-- Which supplier catalog rows lost their preferred flag, and to whom they
-- belonged (the #549 recovery query, once 00282 is live)
SELECT entity_id,
       old_data->>'supplier_id' AS supplier_id,
       changed_at
FROM entity_revisions
WHERE entity_type = 'supplier_catalog'
  AND operation = 'DELETE'
  AND (old_data->>'is_preferred')::boolean;

-- Changes by a specific user
SELECT * FROM entity_revisions
WHERE changed_by = '...'
ORDER BY changed_at DESC
LIMIT 50;
```

### Writing revision records

Don't. Application code never inserts into `entity_revisions` — the
`log_entity_revision()` trigger is the only writer, and `entity_revisions_insert`
requires `changed_by = auth.uid()`. To put a new table under the ledger, attach
the trigger in a migration and add its CASE branch in the same migration:

```sql
CREATE TRIGGER tr_<table>_revision
  AFTER INSERT OR UPDATE OR DELETE ON <table>
  FOR EACH ROW EXECUTE FUNCTION log_entity_revision();
```

The table must have an `id UUID` column: the function derives `entity_id` from
`COALESCE(NEW.id, OLD.id)` and raises `record "new" has no field "id"`
otherwise. That is why `_schema_registry` (primary key `table_name TEXT`)
cannot be tracked.

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
| containers | Soft only | None (check for selling_formats first) |
| selling_formats | Soft only | None (check for finished_goods, order_items) |
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

## `enum_values`

Centralized registry for all enum values in the system. Enables dynamic enum management without code changes and provides AI-queryable metadata.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| enum_type | TEXT | Enum category (e.g., batch_status, vessel_type) |
| value | TEXT | Actual value stored in database columns |
| label | TEXT | Human-readable display label |
| description | TEXT | Optional description |
| color | TEXT | UI color: success, warning, error, info, default |
| icon | TEXT | Lucide icon name (optional) |
| sort_order | INTEGER | Display order (lower = first) |
| group_name | TEXT | Optional grouping within enum type |
| is_default | BOOLEAN | Default value for new records |
| is_active | BOOLEAN | Inactive values hidden from dropdowns |
| metadata | JSONB | Type-specific data (e.g., state machine transitions) |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

### Constraints

```sql
CONSTRAINT uq_enum_type_value UNIQUE (enum_type, value)
```

### Enum Types

| enum_type | Description | Has State Machine |
|-----------|-------------|-------------------|
| batch_status | Batch lifecycle states | Yes |
| order_status | Order lifecycle states | Yes |
| po_status | Purchase order states | Yes |
| vessel_status | Vessel availability | No |
| vessel_type | Vessel categories | No |
| yeast_pitch_status | Yeast pitch lifecycle | Yes |
| yeast_type | Yeast categories | No |
| yeast_form | Yeast form (liquid, dry, slurry) | No |
| user_role | User permission roles | No |
| user_status | User account status | No |
| notification_status | Notification read state | No |
| notification_severity | Alert level | No |
| location_type | Location categories | No |
| container_type | Container types (package, keg) | No |
| keg_state | Keg lifecycle states | Yes |
| keg_transaction_type | Keg movement types | No |
| catalog_type | Inventory item categories | No |
| volume_unit | Volume measurement units | No |
| weight_unit | Weight measurement units | No |
| temperature_unit | Temperature units | No |
| gravity_unit | Gravity measurement units | No |
| fermentation_stage | Fermentation phases | No |
| mash_step_type | Mash schedule step types | No |
| packaging_session_status | Packaging lifecycle | Yes |

### Metadata Structures

The `metadata` JSONB column stores type-specific data. Different enum types use different structures:

#### State Machine Transitions
Used by: `batch_status`, `order_status`, `po_status`, `yeast_pitch_status`, `keg_state`, `packaging_session_status`

```json
{
  "next_states": ["brewing", "cancelled"]
}
```

#### Yeast Viability Decay
Used by: `yeast_form`

```json
{
  "viability_decay_per_day": 2
}
```
- `liquid`: 2% per day
- `dry`: 0.5% per day
- `slurry`: 3% per day

#### Unit Conversions
Used by: `volume_unit`, `weight_unit`

```json
{
  "to_liters": 117.347765
}
```
```json
{
  "to_kg": 0.453592
}
```

#### Vessel Typical Uses
Used by: `vessel_type`

```json
{
  "typical_uses": ["fermentation", "conditioning"]
}
```

#### User Role Permissions
Used by: `user_role`

```json
{
  "permissions": ["production", "inventory", "purchasing"]
}
```
- `admin`: `["all"]`
- `production_manager`: `["production", "inventory", "purchasing"]`
- `brewer`: `["recipes", "batches", "brewing"]`
- `sales`: `["orders", "customers"]`
- `viewer`: `["read"]`
- `customer`: `["portal"]` (external portal access)

**Note:** RLS policies use `user_has_permission()` to map granular permissions to roles. See `docs/spec/workflows.md` for the full permission table.

#### Mash Step Temperature Ranges
Used by: `mash_step_type`

```json
{
  "temp_range_f": [148, 158]
}
```

#### Transaction Inventory Impact
Used by: `keg_transaction_type`

```json
{
  "affects_inventory": true
}
```

### Helper Functions

```sql
-- Get all values for an enum type
SELECT * FROM get_enum_values('batch_status');

-- Get default value
SELECT get_enum_default('batch_status');  -- Returns 'planned'

-- Validate enum value
SELECT is_valid_enum('batch_status', 'brewing');  -- Returns true

-- Get display label
SELECT get_enum_label('batch_status', 'fermenting');  -- Returns 'Fermenting'

-- List all enum types
SELECT * FROM get_enum_types();
```

### Query Examples

```sql
-- All batch status options with colors
SELECT value, label, color, sort_order
FROM enum_values
WHERE enum_type = 'batch_status' AND is_active = true
ORDER BY sort_order;

-- Find state machine transitions for a status
SELECT metadata->>'next_states' AS next_states
FROM enum_values
WHERE enum_type = 'batch_status' AND value = 'brewing';
```

### RLS Policies

- All authenticated users can read enum values
- Only admins can modify enum values (checked via `user_profiles.role = 'admin'`)

---

## `user_profiles`

User profiles with cached auth info and multi-role assignment. Caches user information from `auth.users` to avoid direct joins per security guidelines. Permission-based access control via `user_has_permission()` function.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key (matches auth.users.id) |
| email | TEXT | Cached email from auth.users |
| display_name | TEXT | User's display name |
| avatar_url | TEXT | Profile avatar URL |
| roles | TEXT[] | User roles array (replaces single `role` column) |
| status | TEXT | Authorization status: only `active` may access protected UI, APIs, or authenticated RLS data; `inactive`, `pending`, and missing profiles fail closed |
| account_status_operation_id | UUID | Durable fence token while a deactivate/reactivate command crosses the Auth boundary |
| account_status_operation | TEXT | Fenced command: `deactivate` or `reactivate`; null when idle |
| account_status_operation_started_at | TIMESTAMPTZ | Audit timestamp for a fenced command; no automatic expiry |
| last_active_at | TIMESTAMPTZ | Last activity timestamp |
| invited_at | TIMESTAMPTZ | When user was invited |
| invited_by | UUID | FK to auth.users (who invited them) |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

### Constraints

```sql
-- Validated via function: each role must be one of the valid values
CONSTRAINT chk_user_roles CHECK (validate_user_roles(roles))
CONSTRAINT chk_user_status CHECK (status IN ('active', 'inactive', 'pending'))
CONSTRAINT chk_user_account_status_operation CHECK (operation fields are all null or form one complete fenced command)
```

### User Roles

A user can hold multiple roles simultaneously. The `roles` column is a `TEXT[]` array indexed with GIN.

| Role | Description | Access Level |
|------|-------------|--------------|
| admin | Full system access | All features |
| production_manager | Production/inventory/purchasing | Production domain |
| brewer | Recipes/batches/brewing | Brewing operations |
| sales | Orders/customers | Sales domain |
| viewer | Read-only access | View only |
| customer | Portal access | External customer portal |

### Auto-Creation Trigger

User profiles are automatically created when users sign up via `auth.users` trigger. The first user is assigned `admin` role; subsequent users default to `viewer`.

```sql
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_user_profile();
```

Staff invitation is complete only when the post-invite profile update returns
the created user's exact requested roles and `pending` status. If that
verification fails, the newly created Auth user is deleted so the trigger's
default active-viewer profile cannot remain usable. Cleanup failures are
reported for manual repair.

### Permission Helper Functions

All RLS policies use `user_has_permission()` to check access. This function maps permission strings to role arrays and checks if the user's roles overlap. Role membership is never sufficient on its own: `current_user_is_enabled()` must also find an `active` profile for `auth.uid()`. Every public RLS table has a restrictive authenticated policy using that predicate, so an already-issued JWT stops authorizing data access as soon as the profile becomes non-active.

```sql
-- Check a granular permission (used in RLS policies)
SELECT user_has_permission('recipes:write');  -- Returns boolean

-- Check a specific role
SELECT user_has_role('admin');  -- Returns boolean

-- Get current user's primary role
SELECT get_user_role();  -- Returns roles[1]

-- Check if current user is admin
SELECT is_admin();  -- Returns boolean
```

`roles` and `status` are authorization fields. The own-profile update path may
change display data but cannot change either field. Deactivation/reactivation
uses the dedicated server command so database access and the Supabase Auth ban
remain consistently ordered:

- Deactivate: persist `inactive` first, then ban Auth. A failed ban remains
  safely inactive and is retryable.
- Reactivate: unban Auth first, then persist `active`. If the final write
  fails, the command attempts to re-ban Auth and reports the compensation.

Each command first claims the profile with a UUID fence. Concurrent commands
return a conflict before calling Auth. Claims do not expire automatically:
allowing a paused old process to resume after an expiry could overwrite a newer
opposite Auth action.

**Permission mapping** (see `docs/spec/workflows.md` for full table):
- `recipes:read` -> admin, production_manager, brewer, sales, viewer
- `recipes:write` -> admin, brewer
- `batches:write` -> admin, production_manager, brewer
- `orders:write` -> admin, sales
- `inventory:write` -> admin, production_manager
- `settings:manage` -> admin
- etc.

### RLS Policies

- All authenticated users can view profiles (needed for displaying names)
- Users can update their own profile (name, avatar only)
- Admins can update any profile (roles, status changes)
- Admins can insert profiles (for invitations)
- All domain tables use `user_has_permission()` in their RLS policies

---

## `ai_rate_limit_buckets`

Service-role-only counters for the paid AI chat boundary. One row per Auth
user is updated atomically by `consume_ai_rate_limit`, so every application
instance shares the same request window.

| Column | Type | Description |
|--------|------|-------------|
| user_id | UUID | Primary key and FK to `auth.users`; deleted with the Auth user |
| window_started_at | TIMESTAMPTZ | Start of the current fixed request window |
| request_count | INTEGER | Requests consumed in the current window |
| updated_at | TIMESTAMPTZ | Last bucket consumption time |

RLS is enabled and all direct table privileges are revoked, including from
`service_role`. A restrictive enabled-account policy is defense in depth but
there is no permissive client policy. The `SECURITY DEFINER`
`consume_ai_rate_limit` function is the only access boundary and is executable
only by `service_role`; callers reach it after the API has enforced the
`ai:use` staff permission.

---

## MongoDB sync ownership and reconciliation

`mongodb_sync_log` records the outcome of each entity sync. A phase/entity
exception must be recorded as a failure; an error list with `failed = 0` is not
a successful result.

`mongodb_sync_mappings` is both an audit trail and the ownership registry for
legacy MongoDB imports:

| Column | Type | Description |
|--------|------|-------------|
| entity_type | TEXT | PostgreSQL aggregate or child-row kind |
| mongo_id | TEXT | Stable source identifier; child identifiers are prefixed by their aggregate source ID |
| pg_id | UUID | Stable PostgreSQL row ID owned by that source record |

Migration `00258_atomic_mongodb_aggregate_sync.sql` provides transactional
reconciliation RPCs for recipes, brew logs, batch readings, and packaging
sessions. Each RPC takes a fully transformed aggregate, serializes against
other MongoDB reconciliation calls with an advisory transaction lock, upserts
the source-owned rows, and removes only stale rows named in this ownership
registry. Manual rows without mappings are never part of cleanup. A constraint
or trigger error rolls back the parent, children, and mappings together; retrying
the same source payload updates the same UUIDs without duplication.

The old global clean operation is intentionally unsupported because it could
not distinguish imported rows from manually maintained production data.

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

### `data_integrity_findings`

Violations recorded by the nightly `check_data_integrity()` pg_cron sweep (migration 00272, repaired in 00273). One row per (check_name, entity_table, entity_id); re-detections refresh `detected_at`, and `resolved_at` is stamped when a later run no longer sees the violation. Read-only for staff with `inventory:read`; only the cron job owner writes.

Open findings are announced to active staff by `notify_data_integrity_findings()` (migration 00281, daily 05:45 UTC) through `notify_all_users()` — in-app notification of type `data_integrity` at `high` priority, plus the usual email/Slack dispatch (Slack channel routing for the type is configurable in the Slack integration card). `notification_preferences` has no per-type toggle for `data_integrity`, so it is suppressed only by a recipient's `in_app_enabled`/`email_enabled` settings — deliberate for an integrity alert. `notified_at` is what keeps that from repeating every night: the notifier only picks up rows with `resolved_at IS NULL AND notified_at IS NULL`, the sweep's re-detection upsert preserves `notified_at` while a finding stays open, and it clears `notified_at` only when a *resolved* finding re-opens (a recurrence is a new event). At most 20 findings are itemised per run; the rest stay queued for the next one.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| check_name | TEXT | Invariant that fired (`over_allocated_lot`, `negative_bin_quantity`, `negative_lot_quantity`) |
| entity_table | TEXT | Table the violating row lives in |
| entity_id | UUID | Violating row (or item) id |
| detail | TEXT | Human-readable description with the offending value |
| detected_at | TIMESTAMPTZ | Last time the sweep saw the violation |
| resolved_at | TIMESTAMPTZ | Set when the violation cleared; NULL while open |
| notified_at | TIMESTAMPTZ | Set when `notify_data_integrity_findings()` alerted staff about this open finding; NULL = not yet announced (or the finding re-opened after being resolved) |
