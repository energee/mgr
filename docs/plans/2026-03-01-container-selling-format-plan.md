# Container + Selling Format Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `package_types`/`keg_types` dual-FK model with unified `containers` + `selling_formats` tables, adding per-channel format visibility.

**Architecture:** New `containers` table holds physical vessels (cans, bottles, kegs). `selling_formats` table holds groupings (single, 4-pack, case) per container. `channel_formats` junction table controls which selling formats appear in each sales channel. All existing FKs (`package_type_id`, `keg_type_id`) migrate to a single `selling_format_id`.

**Tech Stack:** PostgreSQL migrations, TypeScript entity configs, React components, Supabase client.

---

## Phase 1: Database Schema

### Task 1: Create new tables

**Files:**
- Create: `supabase/migrations/00099_containers_and_selling_formats.sql`

**Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration: Create containers, selling_formats, and channel_formats tables
-- =============================================================================
-- Replaces the package_types/keg_types dual-table model with a unified
-- container + selling format hierarchy. Containers are physical vessels
-- (cans, bottles, kegs). Selling formats define how they're grouped for
-- sale (single, 4-pack, case of 24, per keg).

-- -----------------------------------------------------------------------------
-- 1. containers table
-- -----------------------------------------------------------------------------
CREATE TABLE containers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('package', 'keg')),
  volume_oz DECIMAL(6,2),
  volume_bbl DECIMAL(10,4),
  deposit_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT containers_package_needs_oz CHECK (type != 'package' OR volume_oz IS NOT NULL),
  CONSTRAINT containers_keg_needs_bbl CHECK (type != 'keg' OR volume_bbl IS NOT NULL)
);

ALTER TABLE containers ENABLE ROW LEVEL SECURITY;

CREATE POLICY containers_select ON containers
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY containers_write ON containers
  FOR ALL
  USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

-- Trigger for updated_at
CREATE TRIGGER set_containers_updated_at
  BEFORE UPDATE ON containers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------------------------------------
-- 2. selling_formats table
-- -----------------------------------------------------------------------------
CREATE TABLE selling_formats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id UUID NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit_count INTEGER NOT NULL DEFAULT 1 CHECK (unit_count > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(container_id, name)
);

ALTER TABLE selling_formats ENABLE ROW LEVEL SECURITY;

CREATE POLICY selling_formats_select ON selling_formats
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY selling_formats_write ON selling_formats
  FOR ALL
  USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

CREATE TRIGGER set_selling_formats_updated_at
  BEFORE UPDATE ON selling_formats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Index for container lookups
CREATE INDEX idx_selling_formats_container ON selling_formats(container_id);

-- -----------------------------------------------------------------------------
-- 3. channel_formats junction table
-- -----------------------------------------------------------------------------
CREATE TABLE channel_formats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  selling_format_id UUID NOT NULL REFERENCES selling_formats(id) ON DELETE CASCADE,
  sales_channel_id UUID NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  UNIQUE(selling_format_id, sales_channel_id)
);

ALTER TABLE channel_formats ENABLE ROW LEVEL SECURITY;

CREATE POLICY channel_formats_select ON channel_formats
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY channel_formats_write ON channel_formats
  FOR ALL
  USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

CREATE INDEX idx_channel_formats_channel ON channel_formats(sales_channel_id);
CREATE INDEX idx_channel_formats_format ON channel_formats(selling_format_id);

-- -----------------------------------------------------------------------------
-- 4. Schema registry entries
-- -----------------------------------------------------------------------------
INSERT INTO _schema_registry (table_name, description, domain, relationships)
VALUES
  ('containers', 'Physical vessels — cans, bottles, kegs. Parent of selling_formats.', 'inventory',
   '[{"type": "hasMany", "target": "selling_formats", "foreignKey": "container_id"}]'),
  ('selling_formats', 'How a container is grouped for sale — single, 4-pack, case, per keg.', 'inventory',
   '[{"type": "belongsTo", "target": "containers", "foreignKey": "container_id"}, {"type": "hasMany", "target": "channel_formats", "foreignKey": "selling_format_id"}]'),
  ('channel_formats', 'Junction table: which selling formats appear in which sales channel.', 'sales',
   '[{"type": "belongsTo", "target": "selling_formats", "foreignKey": "selling_format_id"}, {"type": "belongsTo", "target": "sales_channels", "foreignKey": "sales_channel_id"}]')
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships;
```

**Step 2: Apply the migration locally**

Run: `supabase db reset` or `supabase migration up`

**Step 3: Commit**

```
git add supabase/migrations/00099_containers_and_selling_formats.sql
git commit -m "feat: create containers, selling_formats, and channel_formats tables"
```

---

### Task 2: Migrate data from package_types and keg_types

**Files:**
- Create: `supabase/migrations/00100_migrate_to_containers.sql`

**Step 1: Write the data migration**

This migration must:
1. Insert containers from `package_types` (deduped by container_type + volume_oz) and `keg_types`
2. Insert selling_formats for each old package_type/keg_type row
3. Add `selling_format_id` columns to all tables that have `package_type_id`/`keg_type_id`
4. Backfill `selling_format_id` using a mapping
5. Seed `channel_formats` from current `show_in_pricing` state

```sql
-- =============================================================================
-- Migration: Migrate data from package_types/keg_types to containers/selling_formats
-- =============================================================================
-- Phase 1: Populate new tables from old data
-- Phase 2: Add selling_format_id to referencing tables and backfill
-- Phase 3: Seed channel_formats from show_in_pricing

-- -----------------------------------------------------------------------------
-- Phase 1: Populate containers and selling_formats
-- -----------------------------------------------------------------------------

-- 1a. Create containers from package_types (deduped by container_type + volume_oz)
-- Each unique (container_type, volume_oz) becomes one container.
-- The container name is derived from volume + type, e.g. "16oz Can"
INSERT INTO containers (id, name, type, volume_oz, is_active, position, created_at, updated_at)
SELECT DISTINCT ON (container_type, volume_oz)
  gen_random_uuid(),
  -- Build name: "Xoz Type" for packages
  CASE
    WHEN volume_oz = FLOOR(volume_oz) THEN FLOOR(volume_oz)::text
    ELSE volume_oz::text
  END || 'oz ' || INITCAP(container_type),
  'package',
  volume_oz,
  bool_or(is_active),
  ROW_NUMBER() OVER (ORDER BY container_type, volume_oz) * 10,
  MIN(created_at),
  MAX(updated_at)
FROM package_types
WHERE container_type != 'keg'
GROUP BY container_type, volume_oz;

-- 1b. Create containers from keg_types
INSERT INTO containers (id, name, type, volume_bbl, deposit_amount, is_active, position, created_at, updated_at)
SELECT
  gen_random_uuid(),
  name,
  'keg',
  volume_bbl,
  deposit_amount,
  is_active,
  COALESCE(position, 0) + 1000, -- offset to sort after packages
  created_at,
  updated_at
FROM keg_types;

-- 1c. Create selling_formats from package_types
-- Each package_type row becomes one selling_format linked to its container
INSERT INTO selling_formats (id, container_id, name, unit_count, is_active, position, created_at, updated_at)
SELECT
  pt.id, -- REUSE the package_type UUID as the selling_format UUID for easy FK migration
  c.id,
  pt.name, -- Use the full package_type name as the selling format name for now
  COALESCE(pt.units_per_case, 1),
  pt.is_active,
  ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY COALESCE(pt.units_per_case, 1)) * 10,
  pt.created_at,
  pt.updated_at
FROM package_types pt
JOIN containers c ON c.type = 'package'
  AND c.volume_oz = pt.volume_oz
  AND LOWER(c.name) LIKE '%' || pt.container_type || '%'
WHERE pt.container_type != 'keg';

-- 1d. Create selling_formats from keg_types ("Per Keg" for each)
INSERT INTO selling_formats (id, container_id, name, unit_count, is_active, position, created_at, updated_at)
SELECT
  kt.id, -- REUSE the keg_type UUID as the selling_format UUID
  c.id,
  'Per Keg',
  1,
  kt.is_active,
  0,
  kt.created_at,
  kt.updated_at
FROM keg_types kt
JOIN containers c ON c.type = 'keg' AND c.name = kt.name;

-- -----------------------------------------------------------------------------
-- Phase 2: Add selling_format_id to referencing tables
-- -----------------------------------------------------------------------------

-- Because we reused old UUIDs as selling_format IDs, the backfill is simple:
-- selling_format_id = COALESCE(keg_type_id, package_type_id)

-- order_items
ALTER TABLE order_items ADD COLUMN selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
UPDATE order_items SET selling_format_id = COALESCE(keg_type_id, package_type_id);

-- session_line_items
ALTER TABLE session_line_items ADD COLUMN selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
UPDATE session_line_items SET selling_format_id = COALESCE(keg_type_id, package_type_id);

-- finished_goods
ALTER TABLE finished_goods ADD COLUMN selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
UPDATE finished_goods SET selling_format_id = COALESCE(keg_type_id, package_type_id);

-- keg_transactions (keg_type_id only)
ALTER TABLE keg_transactions ADD COLUMN selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
UPDATE keg_transactions SET selling_format_id = keg_type_id;

-- keg_owner_deposits (keg_type_id only)
ALTER TABLE keg_owner_deposits ADD COLUMN selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
UPDATE keg_owner_deposits SET selling_format_id = keg_type_id;

-- order_change_request_items
ALTER TABLE order_change_request_items ADD COLUMN selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
UPDATE order_change_request_items SET selling_format_id = COALESCE(keg_type_id, package_type_id);

-- square_catalog_map
ALTER TABLE square_catalog_map ADD COLUMN selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
UPDATE square_catalog_map SET selling_format_id = COALESCE(keg_type_id, package_type_id);

-- square_draft_sales (keg_type_id only)
ALTER TABLE square_draft_sales ADD COLUMN selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
UPDATE square_draft_sales SET selling_format_id = keg_type_id;

-- pricing_tier_prices.format_id already has no FK — it will just point to selling_formats.id
-- No schema change needed, just the application code change to use selling_formats

-- pricing_history.format_id — same, no FK, just conceptual
-- No schema change needed

-- Create indexes on new columns
CREATE INDEX idx_order_items_selling_format ON order_items(selling_format_id);
CREATE INDEX idx_session_line_items_selling_format ON session_line_items(selling_format_id);
CREATE INDEX idx_finished_goods_selling_format ON finished_goods(selling_format_id);
CREATE INDEX idx_keg_transactions_selling_format ON keg_transactions(selling_format_id);

-- -----------------------------------------------------------------------------
-- Phase 3: Seed channel_formats from show_in_pricing
-- -----------------------------------------------------------------------------
-- For every selling_format where the old show_in_pricing was true,
-- enable it in ALL active sales channels (preserving current global behavior)
INSERT INTO channel_formats (selling_format_id, sales_channel_id)
SELECT sf.id, sc.id
FROM selling_formats sf
JOIN sales_channels sc ON sc.is_active = true
WHERE sf.id IN (
  SELECT id FROM package_types WHERE show_in_pricing = true AND container_type != 'keg'
  UNION ALL
  SELECT id FROM keg_types WHERE show_in_pricing = true
);
```

**Step 2: Apply and verify**

Run: `supabase db reset`
Verify: Check that `containers`, `selling_formats`, `channel_formats` have correct data.

**Step 3: Commit**

```
git add supabase/migrations/00100_migrate_to_containers.sql
git commit -m "feat: migrate package_types/keg_types data to containers/selling_formats"
```

---

### Task 3: Rebuild views and functions

**Files:**
- Create: `supabase/migrations/00101_rebuild_views_for_containers.sql`

This is the largest migration. It must:

1. Drop and recreate `packaging_formats` as a simple view over `selling_formats JOIN containers`
2. Rebuild all views that join `package_types`/`keg_types` to use `selling_format_id` → `selling_formats` → `containers`
3. Rebuild affected functions
4. Update the keg fulfillment trigger

The full SQL for each view/function rebuild should follow the patterns documented by the explore agent. Each view that currently does `LEFT JOIN package_types pt ON pt.id = fg.package_type_id LEFT JOIN keg_types kt ON kt.id = fg.keg_type_id` becomes `LEFT JOIN selling_formats sf ON sf.id = fg.selling_format_id LEFT JOIN containers c ON c.id = sf.container_id`.

Key views to rebuild:
- `packaging_formats` — now `SELECT sf.id, sf.name, c.name AS container_name, c.type AS container_type, c.volume_oz, c.volume_bbl, sf.unit_count, c.deposit_amount, sf.is_active, c.is_active AS container_active FROM selling_formats sf JOIN containers c ON c.id = sf.container_id`
- `finished_goods_with_availability` — replace dual LEFT JOIN with single chain
- `finished_goods_with_ttb_class` — replace dual LEFT JOIN, derive volume from `c.volume_oz` or `c.volume_bbl`
- `finished_goods_supply_by_product` — group by `selling_format_id`
- `order_demand_by_product` — group by `selling_format_id`
- `bin_contents` — single JOIN chain
- All keg views (`customer_keg_balances`, `keg_aging_report`, `keg_fleet_summary`, etc.) — join `selling_formats` → `containers` where `c.type = 'keg'`
- `keg_inventory` view — use `selling_format_id`
- TTB functions — join via `selling_formats` → `containers`
- `calculate_production_shortfalls` — join via `selling_formats` → `containers`
- `get_inventory_overview` — join via `selling_formats` → `containers`
- `get_price_for_customer` — recreate fresh, `format_id` references `selling_formats.id`
- `apply_change_request` — update to use `selling_format_id`
- `create_keg_ship_transactions_from_order` trigger function — use `selling_format_id`

**Important:** The `keg_owner_deposits` table uses `keg_type_id` as part of its unique constraint and joins. This needs careful handling — `selling_format_id` replaces it but the deposit logic (per keg type per owner) must be preserved.

**Step 1: Write the migration** (subagent should generate the full SQL based on the view definitions documented above)

**Step 2: Apply and verify**

Run: `supabase db reset`
Verify: Run `SELECT * FROM packaging_formats LIMIT 5`, `SELECT * FROM finished_goods_with_availability LIMIT 5`, etc.

**Step 3: Commit**

```
git add supabase/migrations/00101_rebuild_views_for_containers.sql
git commit -m "feat: rebuild all views and functions for containers/selling_formats"
```

---

### Task 4: Drop old columns and tables

**Files:**
- Create: `supabase/migrations/00102_drop_old_packaging_tables.sql`

```sql
-- =============================================================================
-- Migration: Drop old package_types/keg_types columns and tables
-- =============================================================================
-- All referencing tables now use selling_format_id. Old columns can be dropped.

-- Drop old FK columns from referencing tables
ALTER TABLE order_items DROP COLUMN package_type_id, DROP COLUMN keg_type_id;
ALTER TABLE session_line_items DROP COLUMN package_type_id, DROP COLUMN keg_type_id;
ALTER TABLE finished_goods DROP COLUMN package_type_id, DROP COLUMN keg_type_id;
ALTER TABLE keg_transactions DROP COLUMN keg_type_id;
ALTER TABLE keg_owner_deposits DROP COLUMN keg_type_id;
ALTER TABLE order_change_request_items DROP COLUMN package_type_id, DROP COLUMN keg_type_id;
ALTER TABLE square_catalog_map DROP COLUMN package_type_id, DROP COLUMN keg_type_id;
ALTER TABLE square_draft_sales DROP COLUMN keg_type_id;

-- Make selling_format_id NOT NULL where appropriate
ALTER TABLE order_items ALTER COLUMN selling_format_id SET NOT NULL;
-- session_line_items, finished_goods may have NULL selling_format_id for old records

-- Drop old tables (CASCADE drops their policies, triggers, indexes)
DROP TABLE IF EXISTS package_types CASCADE;
DROP TABLE IF EXISTS keg_types CASCADE;

-- Remove old schema registry entries
DELETE FROM _schema_registry WHERE table_name IN ('package_types', 'keg_types', 'packaging_formats');

-- Remove old enum_values for package_container_type (no longer needed — container type is on containers.type)
DELETE FROM enum_values WHERE enum_type = 'package_container_type';
```

**Step 1: Apply and verify**

Run: `supabase db reset`
Verify: `\dt package_types` should show "Did not find any relation"

**Step 2: Regenerate Supabase types**

Run: `supabase gen types typescript --local > src/types/supabase.ts`

**Step 3: Commit**

```
git add supabase/migrations/00102_drop_old_packaging_tables.sql src/types/supabase.ts
git commit -m "feat: drop package_types/keg_types tables and regenerate types"
```

---

## Phase 2: Entity Configs and Query Keys

### Task 5: Create container and selling_format entity configs

**Files:**
- Create: `src/entities/container.tsx`
- Create: `src/entities/selling-format.tsx`
- Modify: `src/entities/index.ts`
- Modify: `src/lib/query-keys.ts`

Create entity configs following the `batch.tsx` pattern. `container.tsx` should have fields: `name`, `type` (select with options `package`/`keg`), `volume_oz`, `volume_bbl`, `deposit_amount`, `is_active`, `position`. `selling-format.tsx` should have fields: `name`, `container_id` (relation to container), `unit_count`, `is_active`, `position`.

Add query key factories for `containerKeys` and `sellingFormatKeys` in `query-keys.ts`. Also add `channelFormatKeys`.

Update `src/entities/index.ts` to export the new entities and remove `package-type` and `keg-type` exports.

**Commit:** `feat: add container and selling_format entity configs`

---

### Task 6: Update all entity configs that reference old tables

**Files:**
- Modify: `src/entities/order-item.tsx` — replace `package_type_id`/`keg_type_id` with `selling_format_id` relation
- Modify: `src/entities/session-line-item.tsx` — same
- Modify: `src/entities/finished-good.tsx` — same
- Modify: `src/entities/keg-inventory.tsx` — replace `keg_type_id` with `selling_format_id`
- Modify: `src/entities/keg-transaction.tsx` — same
- Modify: `src/entities/pricing-tier-price.tsx` — update `format_id` dropdown to use `selling_formats` table
- Modify: `src/entities/po-line-item.tsx` — update `packaging` reference
- Delete: `src/entities/package-type.tsx`
- Delete: `src/entities/keg-type.tsx`

For each entity, replace dual FK fields with a single `selling_format_id` relation field:
```typescript
{
  name: "selling_format_id",
  label: "Format",
  type: "relation",
  relation: {
    entity: "selling_format",
    displayField: "name",
  },
}
```

**Commit:** `refactor: update entity configs for selling_format_id`

---

### Task 7: Update hooks and catalog utilities

**Files:**
- Modify: `src/hooks/use-catalog.ts` — replace `usePackageTypes()` with `useContainers()` and `useSellingFormats()`, update `PackagingFormat` type
- Modify: `src/lib/query-keys.ts` — remove `packageTypeKeys`/`packagingFormatKeys`, ensure `containerKeys`/`sellingFormatKeys`/`channelFormatKeys` are present
- Modify: `src/lib/enums.ts` — remove `PACKAGE_CONTAINER_TYPE` if no longer needed
- Modify: `src/lib/__tests__/query-keys.test.ts` — update tests for new key factories

**Commit:** `refactor: update hooks and query keys for containers/selling_formats`

---

## Phase 3: Settings UI

### Task 8: Create containers settings page

**Files:**
- Create: `src/app/(app)/settings/containers/page.tsx`
- Create: `src/app/(app)/settings/containers/[id]/page.tsx`
- Create: `src/app/(app)/settings/containers/new/page.tsx`
- Modify: `src/app/(app)/settings/layout.tsx` — replace "Package Types" and "Keg Types" nav with "Containers"
- Delete: `src/app/(app)/settings/formats/` directory (old package types pages)

The containers detail page should include inline selling format management — a sub-list showing the container's selling formats with add/remove/reorder capability. This can be implemented as a relation section using `EntityDetailUnified` or a custom domain component.

**Commit:** `feat: containers settings page replacing package types and keg types`

---

### Task 9: Rewrite pricing settings page

**Files:**
- Modify: `src/app/(app)/settings/pricing/page.tsx`

This is the most complex UI task. The pricing page needs:

1. **Matrix view:** Columns grouped by container. Query `channel_formats` for the active channel to get visible selling formats. Group by `container_id`. Column headers: container name group → selling format name sub-header.

2. **Formats tab:** Nested container > selling format > channel toggle grid. Query all active selling formats with their containers. For each selling format, show toggle per sales channel (presence in `channel_formats`).

3. Remove all `format_source`, `packaging_formats`, `show_in_pricing`, `units_per_case` references. Replace with `selling_formats JOIN containers` queries and `channel_formats` mutations.

4. Remove the `FormatManagement` component's direct mutations of `package_types.show_in_pricing` / `keg_types.show_in_pricing`. Replace with `channel_formats` insert/delete.

5. Column header labels: use `sf.name` directly (e.g., "Case of 24", "4-Pack", "Per Keg") instead of computing from `units_per_case`.

**Commit:** `feat: rewrite pricing matrix for containers/selling_formats with per-channel visibility`

---

## Phase 4: Order and Session Editors

### Task 10: Rewrite order-items-editor

**Files:**
- Modify: `src/components/domain/order-items-editor.tsx`

Replace the dual-FK `format_source` discrimination pattern with a single `selling_format_id`:

1. Remove `format_source` from state and all branching logic
2. Replace `package_type_id`/`keg_type_id` fields with `selling_format_id`
3. Format selector dropdown queries `selling_formats JOIN containers` (can reuse `packaging_formats` view or query directly)
4. `lookupTierPrice` passes `selling_format_id` as `format_id` to `get_price_for_customer`
5. "Apply tier price" button condition: `item.selling_format_id && item.brand_id`
6. Keg owner field shows when the selected selling format's container has `type = 'keg'`
7. Update all mutation payloads to write `selling_format_id` instead of dual FKs

**Commit:** `refactor: order-items-editor uses selling_format_id`

---

### Task 11: Rewrite session-line-items-editor

**Files:**
- Modify: `src/components/domain/session-line-items-editor.tsx`

Same pattern as Task 10 — replace dual-FK with `selling_format_id`. Simpler than order-items-editor (no pricing logic).

**Commit:** `refactor: session-line-items-editor uses selling_format_id`

---

## Phase 5: Supporting Components

### Task 12: Update allocation and pick list components

**Files:**
- Modify: `src/components/domain/order-allocation.tsx` — replace `package_type_id` with `selling_format_id`
- Modify: `src/components/domain/order-pick-list.tsx` — same
- Modify: `src/components/domain/pick-list-items.tsx` — same
- Modify: `src/app/(app)/sales/orders/[id]/allocations/page.tsx` — same

Replace all `package_type_id` queries/lookups with `selling_format_id` → `selling_formats` joins.

**Commit:** `refactor: allocation and pick list components use selling_format_id`

---

### Task 13: Update keg-specific components

**Files:**
- Modify: `src/components/domain/customer-keg-balances.tsx` — `keg_type_id` → `selling_format_id`
- Modify: `src/components/domain/keg-owner-deposits-editor.tsx` — query `selling_formats` where `containers.type = 'keg'` instead of `keg_types`
- Modify: `src/app/(app)/inventory/kegs/reports/page.tsx` — update type fields and keys
- Modify: `src/app/(app)/inventory/kegs/transactions/new/page.tsx` — `keg_type_id` param → `selling_format_id`

**Commit:** `refactor: keg components use selling_format_id`

---

### Task 14: Update portal and change request components

**Files:**
- Modify: `src/app/portal/(main)/orders/[id]/page.tsx` — replace dual FK joins with `selling_formats(id, name)`
- Modify: `src/components/domain/change-request-review.tsx` — same
- Modify: `src/components/portal/change-request-builder.tsx` — same

**Commit:** `refactor: portal components use selling_format_id`

---

### Task 15: Update revision history component

**Files:**
- Modify: `src/components/domain/revision-history.tsx` — update FK-to-table mapping to use `selling_format_id: "selling_formats"` instead of dual `keg_type_id`/`package_type_id`

**Commit:** `refactor: revision-history uses selling_format_id`

---

## Phase 6: API Routes and Lib

### Task 16: Update Square integration

**Files:**
- Modify: `src/app/api/square/webhook/route.ts` — replace `package_type_id`/`keg_type_id` with `selling_format_id`
- Modify: `src/app/api/square/sync/catalog/route.ts` — same, update grouping logic
- Modify: `src/app/api/square/sync/inventory/route.ts` — replace `package_types` join with `selling_formats` join, use `sf.unit_count` instead of `pt.units_per_case`
- Modify: `src/lib/square/catalog.ts` — update catalog mapping to use `selling_format_id`
- Modify: `src/lib/square/pricing.ts` — update comments and format resolution

**Commit:** `refactor: Square integration uses selling_format_id`

---

### Task 17: Update QuickBooks and AI integrations

**Files:**
- Modify: `src/lib/quickbooks/sync-invoice.ts` — replace `package_types` join with `selling_formats` join
- Modify: `src/app/api/chat/tools.ts` — update PostgREST query string

**Commit:** `refactor: QuickBooks and AI tools use selling_format_id`

---

### Task 18: Update production planning

**Files:**
- Modify: `src/lib/planning/backward-planner.ts` — replace `package_type_id` with `selling_format_id`
- Modify: `src/types/planning.ts` — update type fields
- Modify: `src/app/(app)/production/planning/page.tsx` — update React keys
- Modify: `src/app/(app)/production/planning/backward/page.tsx` — same
- Modify: `src/app/(app)/production/planning/timeline/page.tsx` — same

**Commit:** `refactor: production planning uses selling_format_id`

---

## Phase 7: Cleanup and Docs

### Task 19: Update keg settings page

**Files:**
- Modify: `src/app/(app)/settings/keg-types/page.tsx` — remove keg types tab, keep keg owners only (rename page to just "Keg Owners" or keep under inventory/kegs)
- Delete: `src/app/(app)/settings/keg-types/[id]/page.tsx` and `new/page.tsx` if they exist

**Commit:** `refactor: remove keg types settings page (now in containers)`

---

### Task 20: Update documentation

**Files:**
- Modify: `CLAUDE.md` — update entity config references, migration numbering, form field examples
- Modify: `docs/data-model/` — add container/selling_format docs, remove package_type/keg_type docs
- Modify: `docs/spec/` — update relevant architecture docs if they reference old tables

**Commit:** `docs: update documentation for containers/selling_formats model`

---

### Task 21: Final validation

**Step 1:** Run `pnpm typecheck` — must pass with zero errors
**Step 2:** Run `pnpm lint` — fix any errors introduced
**Step 3:** Run `pnpm test` — all tests must pass
**Step 4:** Run `supabase db reset` — verify clean migration
**Step 5:** Manual smoke test: create a container, add selling formats, enable in channels, set prices in matrix

**Commit:** Any final fixes discovered during validation.

---

## Task Dependencies

```
Task 1 (create tables)
  → Task 2 (migrate data)
    → Task 3 (rebuild views)
      → Task 4 (drop old tables + regen types)
        → Task 5-7 (entity configs, hooks, query keys) [parallel]
          → Task 8-9 (settings UI) [parallel]
          → Task 10-11 (editors) [parallel]
          → Task 12-18 (components, API, planning) [parallel after 5-7]
            → Task 19-20 (cleanup, docs)
              → Task 21 (validation)
```

Tasks 5-7 can run in parallel after Task 4.
Tasks 8-18 can mostly run in parallel after Tasks 5-7.
Tasks 19-21 are sequential at the end.
