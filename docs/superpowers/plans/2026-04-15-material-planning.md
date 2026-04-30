# Unified Material Planning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified material planning system that tracks required materials across brewing, packaging, and order fulfillment with forward-looking shortfall detection and drop dead dates.

**Architecture:** Database-first approach — migrations create new tables and RPCs, then entity configs + UI components consume them. The selling format BOM is the core primitive; the planning RPC aggregates demand from three sources (brewing batches, packaging sessions, orders) and compares against inventory + open POs to compute shortfalls and order-by dates.

**Tech Stack:** PostgreSQL (migrations, RPCs), TypeScript/React (entity configs, custom editors, planning page), React Query (data fetching), Zod (validation), PostgREST (API layer).

**Spec:** `docs/superpowers/specs/2026-04-15-material-planning-design.md`

**Worktree:** `/Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging`
**Branch:** `feat/packaging`

---

## File Map

### New Files
| File | Purpose |
|------|---------|
| `supabase/migrations/00160_selling_format_materials.sql` | BOM table, pallet columns on selling_formats |
| `supabase/migrations/00161_supplier_catalog_inventory_items.sql` | Extend supplier_catalog, drop supplier text field |
| `supabase/migrations/00162_order_shipping_materials.sql` | order_materials, customer_shipping_materials, customer_pallet_configs, brewery_shipping_defaults |
| `supabase/migrations/00163_calculate_material_shortfalls.sql` | Unified shortfall RPC replacing calculate_ingredient_shortfalls |
| `src/components/domain/selling-format-bom-editor.tsx` | BOM editor for selling format detail page |
| `src/components/domain/packaging-session-materials.tsx` | Read-only material preview on packaging session |
| `src/components/domain/order-shipping-materials-editor.tsx` | Editable shipping materials on order detail |
| `src/components/domain/customer-shipping-preferences.tsx` | Customer shipping material defaults editor |
| `src/components/domain/customer-pallet-configs.tsx` | Customer pallet layer config editor |
| `src/components/domain/brewery-shipping-defaults.tsx` | Settings-level brewery default shipping materials |
| `src/app/(app)/purchasing/material-planning/page.tsx` | Material planning dashboard page |
| `src/hooks/use-material-planning.ts` | Hooks for material planning queries and order material auto-calc |

### Modified Files
| File | Changes |
|------|---------|
| `src/entities/selling-format.tsx` | Add pallet fields to schema/sections, add BOM relation |
| `src/entities/customer.tsx` | Add shipping preferences and pallet config relations |
| `src/entities/order.tsx` | Add shipping materials relation |
| `src/entities/packaging-session.tsx` | Add materials preview section |
| `src/lib/query-keys.ts` | Add materialPlanningKeys factory |
| `docs/data-model/inventory.md` | Document selling_format_materials |
| `docs/data-model/purchasing.md` | Document supplier_catalog extension, order_materials, customer tables |

---

## Task 1: Selling Format Materials Migration

**Files:**
- Create: `supabase/migrations/00160_selling_format_materials.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration: 00160_selling_format_materials
--
-- Adds Bill of Materials (BOM) support to selling formats. Each selling format
-- can define required packaging materials (cans, lids, PakTechs, trays, keg caps)
-- with quantities per unit. Also adds pallet layer fields to selling_formats.
-- =============================================================================

-- =============================================================================
-- SELLING FORMAT MATERIALS (BOM)
-- =============================================================================

CREATE TABLE selling_format_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  selling_format_id UUID NOT NULL REFERENCES selling_formats(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity_per_unit DECIMAL(10,4) NOT NULL CHECK (quantity_per_unit > 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(selling_format_id, inventory_item_id)
);

ALTER TABLE selling_format_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage selling format materials"
  ON selling_format_materials FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX idx_sfm_selling_format ON selling_format_materials(selling_format_id);
CREATE INDEX idx_sfm_inventory_item ON selling_format_materials(inventory_item_id);

-- Updated at trigger
CREATE TRIGGER set_selling_format_materials_updated_at
  BEFORE UPDATE ON selling_format_materials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- PALLET FIELDS ON SELLING FORMATS
-- =============================================================================

ALTER TABLE selling_formats ADD COLUMN units_per_layer INTEGER;
ALTER TABLE selling_formats ADD COLUMN default_layers INTEGER;
ALTER TABLE selling_formats ADD COLUMN pallet_quantity INTEGER;

-- Add CHECK constraints
ALTER TABLE selling_formats ADD CONSTRAINT chk_units_per_layer_positive
  CHECK (units_per_layer IS NULL OR units_per_layer > 0);
ALTER TABLE selling_formats ADD CONSTRAINT chk_default_layers_positive
  CHECK (default_layers IS NULL OR default_layers > 0);
ALTER TABLE selling_formats ADD CONSTRAINT chk_pallet_quantity_positive
  CHECK (pallet_quantity IS NULL OR pallet_quantity > 0);

-- Trigger to auto-compute pallet_quantity from units_per_layer * default_layers
CREATE OR REPLACE FUNCTION compute_pallet_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.units_per_layer IS NOT NULL AND NEW.default_layers IS NOT NULL THEN
    NEW.pallet_quantity := NEW.units_per_layer * NEW.default_layers;
  ELSIF NEW.units_per_layer IS NULL OR NEW.default_layers IS NULL THEN
    -- Allow manual pallet_quantity if only one of the two layer fields is set
    -- But clear it if both are null
    IF NEW.units_per_layer IS NULL AND NEW.default_layers IS NULL THEN
      NEW.pallet_quantity := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_compute_pallet_quantity
  BEFORE INSERT OR UPDATE OF units_per_layer, default_layers
  ON selling_formats
  FOR EACH ROW EXECUTE FUNCTION compute_pallet_quantity();

-- =============================================================================
-- SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields)
VALUES (
  'selling_format_materials',
  'Bill of materials for selling formats — defines packaging materials (cans, lids, PakTechs, trays, keg caps) needed per unit of a selling format.',
  'inventory',
  '{"belongs_to": ["selling_formats", "inventory_items"]}'::jsonb,
  '["selling_format_id", "inventory_item_id", "quantity_per_unit"]'::jsonb
)
ON CONFLICT (table_name) DO UPDATE
SET description = EXCLUDED.description,
    domain = EXCLUDED.domain,
    relationships = EXCLUDED.relationships,
    key_fields = EXCLUDED.key_fields;

-- Update selling_formats registry to note new pallet fields
UPDATE _schema_registry
SET
  key_fields = '["name", "container_id", "unit_count", "units_per_layer", "default_layers", "pallet_quantity", "is_active"]'::jsonb,
  updated_at = NOW()
WHERE table_name = 'selling_formats';
```

- [ ] **Step 2: Apply the migration**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && npx supabase migration up --local 2>&1 | tail -20`

Verify: no errors. If `update_updated_at_column` trigger function doesn't exist, check what the project uses — search migrations for `update_updated_at_column` or `moddatetime`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00160_selling_format_materials.sql
git commit -m "feat: add selling_format_materials BOM table and pallet layer fields"
```

---

## Task 2: Supplier Catalog Extension Migration

**Files:**
- Create: `supabase/migrations/00161_supplier_catalog_inventory_items.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration: 00161_supplier_catalog_inventory_items
--
-- Extends supplier_catalog to support inventory_items as a catalog_type.
-- This allows packaging materials, shipping supplies, and any inventory item
-- to have structured supplier relationships with pricing and lead times.
-- Also removes the free-text supplier field from inventory_items.
-- =============================================================================

-- =============================================================================
-- EXTEND SUPPLIER CATALOG
-- =============================================================================

-- supplier_catalog.catalog_type currently accepts: malt, hop, yeast, adjunct,
-- sugar, spice, fruit, additive. Add 'inventory_item' as a valid type.
-- There is no CHECK constraint on catalog_type (verified by searching migrations),
-- so this is purely a documentation/convention change.

COMMENT ON COLUMN supplier_catalog.catalog_type IS
  'Catalog type: malt, hop, yeast, adjunct, sugar, spice, fruit, additive, inventory_item. '
  'When catalog_type = inventory_item, catalog_id references inventory_items.id.';

-- =============================================================================
-- DROP FREE-TEXT SUPPLIER FIELD
-- =============================================================================

-- First, migrate any existing free-text supplier data to notes for reference
UPDATE inventory_items
SET notes = CASE
  WHEN notes IS NOT NULL AND supplier IS NOT NULL
    THEN notes || E'\n[Migrated supplier: ' || supplier || ']'
  WHEN supplier IS NOT NULL
    THEN '[Migrated supplier: ' || supplier || ']'
  ELSE notes
END
WHERE supplier IS NOT NULL AND supplier != '';

ALTER TABLE inventory_items DROP COLUMN supplier;

-- =============================================================================
-- INDEX FOR INVENTORY_ITEM CATALOG LOOKUPS
-- =============================================================================

-- The existing indexes on supplier_catalog(catalog_type, catalog_id) will
-- cover inventory_item lookups. Add a partial index for preferred supplier
-- resolution on inventory_items specifically.
CREATE INDEX IF NOT EXISTS idx_supplier_catalog_inv_item_preferred
  ON supplier_catalog(catalog_id, is_preferred DESC, price ASC)
  WHERE catalog_type = 'inventory_item';

-- =============================================================================
-- SCHEMA REGISTRY UPDATE
-- =============================================================================

UPDATE _schema_registry
SET
  description = 'Links suppliers to catalog items (malts, hops, yeast, adjuncts, etc.) and inventory items (packaging materials, shipping supplies) with pricing, lead times, and minimum order quantities.',
  updated_at = NOW()
WHERE table_name = 'supplier_catalog';
```

- [ ] **Step 2: Apply the migration**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && npx supabase migration up --local 2>&1 | tail -20`

Verify: no errors.

- [ ] **Step 3: Update the inventory_item entity config**

In `src/entities/inventory-item.tsx`, remove the `supplier` field from the Zod schema, list columns, sections, and searchableFields. The `supplier` column no longer exists in the database.

Search for all occurrences of `supplier` in the file and remove them:
- Zod schema: remove `supplier: z.string().nullable().optional()`
- List columns: remove the column with `accessorKey: "supplier"`
- Sections: remove the field with `name: "supplier"`
- searchableFields: remove `"supplier"` from the array

- [ ] **Step 4: Search for other references to inventory_items.supplier**

Run: `grep -rn "supplier" src/ --include="*.ts" --include="*.tsx" | grep -i "inventory"` to find any other code referencing the dropped column. Fix any references found.

- [ ] **Step 5: Run type check**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && bunx tsc --noEmit 2>&1 | tail -20`

Fix any type errors from the removed column.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00161_supplier_catalog_inventory_items.sql src/entities/inventory-item.tsx
# Add any other modified files found in step 4
git commit -m "feat: extend supplier_catalog for inventory items, drop free-text supplier field"
```

---

## Task 3: Order & Customer Shipping Materials Migration

**Files:**
- Create: `supabase/migrations/00162_order_shipping_materials.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration: 00162_order_shipping_materials
--
-- Adds tables for order-level shipping materials, customer shipping preferences,
-- customer pallet configurations, and brewery-wide shipping material defaults.
-- =============================================================================

-- =============================================================================
-- BREWERY SHIPPING DEFAULTS
-- =============================================================================

CREATE TABLE brewery_shipping_defaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  material_role TEXT NOT NULL CHECK (material_role IN ('pallet', 'wrap', 'other')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(material_role)
);

ALTER TABLE brewery_shipping_defaults ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage brewery shipping defaults"
  ON brewery_shipping_defaults FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER set_brewery_shipping_defaults_updated_at
  BEFORE UPDATE ON brewery_shipping_defaults
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- CUSTOMER SHIPPING MATERIALS
-- =============================================================================

CREATE TABLE customer_shipping_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  material_role TEXT NOT NULL CHECK (material_role IN ('pallet', 'wrap', 'other')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(customer_id, material_role)
);

ALTER TABLE customer_shipping_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage customer shipping materials"
  ON customer_shipping_materials FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_csm_customer ON customer_shipping_materials(customer_id);

CREATE TRIGGER set_customer_shipping_materials_updated_at
  BEFORE UPDATE ON customer_shipping_materials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- CUSTOMER PALLET CONFIGS
-- =============================================================================

CREATE TABLE customer_pallet_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  selling_format_id UUID NOT NULL REFERENCES selling_formats(id) ON DELETE CASCADE,
  layers INTEGER NOT NULL CHECK (layers > 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(customer_id, selling_format_id)
);

ALTER TABLE customer_pallet_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage customer pallet configs"
  ON customer_pallet_configs FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_cpc_customer ON customer_pallet_configs(customer_id);

CREATE TRIGGER set_customer_pallet_configs_updated_at
  BEFORE UPDATE ON customer_pallet_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- ORDER MATERIALS
-- =============================================================================

CREATE TABLE order_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  estimated_qty DECIMAL(10,4) NOT NULL DEFAULT 0,
  actual_qty DECIMAL(10,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(order_id, inventory_item_id)
);

ALTER TABLE order_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage order materials"
  ON order_materials FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_om_order ON order_materials(order_id);

CREATE TRIGGER set_order_materials_updated_at
  BEFORE UPDATE ON order_materials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields)
VALUES
  ('brewery_shipping_defaults', 'Brewery-wide default shipping materials (pallet type, wrap type) applied when no customer preference exists.', 'purchasing', '{"belongs_to": ["inventory_items"]}'::jsonb, '["material_role", "inventory_item_id"]'::jsonb),
  ('customer_shipping_materials', 'Customer-specific default materials for shipping. Overrides brewery defaults by material_role.', 'sales', '{"belongs_to": ["customers", "inventory_items"]}'::jsonb, '["customer_id", "material_role", "inventory_item_id"]'::jsonb),
  ('customer_pallet_configs', 'Customer-specific pallet layer count per selling format. Multiplied by selling_formats.units_per_layer to get effective pallet quantity.', 'sales', '{"belongs_to": ["customers", "selling_formats"]}'::jsonb, '["customer_id", "selling_format_id", "layers"]'::jsonb),
  ('order_materials', 'Auto-calculated shipping materials per order with manual override. Estimated from pallet counts and customer/brewery shipping preferences.', 'sales', '{"belongs_to": ["orders", "inventory_items"]}'::jsonb, '["order_id", "inventory_item_id", "estimated_qty", "actual_qty"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE
SET description = EXCLUDED.description,
    domain = EXCLUDED.domain,
    relationships = EXCLUDED.relationships,
    key_fields = EXCLUDED.key_fields;
```

- [ ] **Step 2: Apply the migration**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && npx supabase migration up --local 2>&1 | tail -20`

Verify: no errors. If `update_updated_at_column` doesn't exist, check what trigger function the project uses for updated_at timestamps.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00162_order_shipping_materials.sql
git commit -m "feat: add order_materials, customer shipping preferences, pallet configs, brewery defaults"
```

---

## Task 4: Unified Material Shortfalls RPC

**Files:**
- Create: `supabase/migrations/00163_calculate_material_shortfalls.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration: 00163_calculate_material_shortfalls
--
-- Creates calculate_material_shortfalls RPC that unifies brewing ingredient
-- demand, packaging material demand, and shipping material demand into a
-- single shortfall report with drop dead dates.
--
-- Replaces calculate_ingredient_shortfalls for the material planning page.
-- The old function is kept for backwards compatibility but this is the
-- preferred function going forward.
-- =============================================================================

-- =============================================================================
-- PACKAGING MATERIAL DEMAND
-- Helper function: calculates material demand from planned packaging sessions
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_packaging_material_demand(
  p_horizon_weeks INTEGER DEFAULT 8
)
RETURNS TABLE (
  inventory_item_id UUID,
  inventory_item_name TEXT,
  category TEXT,
  total_required DECIMAL(12,4),
  unit TEXT,
  earliest_needed_by DATE,
  source_count INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sfm.inventory_item_id,
    ii.name as inventory_item_name,
    ii.category,
    SUM(sli.planned_quantity * sfm.quantity_per_unit)::DECIMAL(12,4) as total_required,
    ii.unit,
    MIN(ps.session_date)::DATE as earliest_needed_by,
    COUNT(DISTINCT ps.id)::INTEGER as source_count
  FROM packaging_sessions ps
  JOIN session_line_items sli ON sli.session_id = ps.id
  JOIN selling_format_materials sfm ON sfm.selling_format_id = sli.selling_format_id
  JOIN inventory_items ii ON ii.id = sfm.inventory_item_id
  WHERE ps.status = 'planned'
    AND ps.session_date <= (CURRENT_DATE + (p_horizon_weeks * 7))
    AND sli.selling_format_id IS NOT NULL
    AND sli.planned_quantity > 0
  GROUP BY sfm.inventory_item_id, ii.name, ii.category, ii.unit;
END;
$$;

COMMENT ON FUNCTION calculate_packaging_material_demand(INTEGER) IS
  'Calculates packaging material demand from planned sessions within horizon. '
  'Multiplies session line item quantities by selling format BOM.';

-- =============================================================================
-- SHIPPING MATERIAL DEMAND
-- Helper function: calculates material demand from confirmed/scheduled orders
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_shipping_material_demand(
  p_horizon_weeks INTEGER DEFAULT 8
)
RETURNS TABLE (
  inventory_item_id UUID,
  inventory_item_name TEXT,
  category TEXT,
  total_required DECIMAL(12,4),
  unit TEXT,
  earliest_needed_by DATE,
  source_count INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH order_pallet_counts AS (
    -- Calculate pallet count per order from order_materials.actual_qty
    -- (or estimated_qty if actual not set)
    SELECT
      om.order_id,
      om.inventory_item_id,
      COALESCE(om.actual_qty, om.estimated_qty) as material_qty
    FROM order_materials om
    JOIN orders o ON o.id = om.order_id
    WHERE o.status IN ('confirmed', 'scheduled', 'picking', 'packed')
      AND o.expected_date <= (CURRENT_DATE + (p_horizon_weeks * 7))
  )
  SELECT
    opc.inventory_item_id,
    ii.name as inventory_item_name,
    ii.category,
    SUM(opc.material_qty)::DECIMAL(12,4) as total_required,
    ii.unit,
    MIN(o.expected_date)::DATE as earliest_needed_by,
    COUNT(DISTINCT opc.order_id)::INTEGER as source_count
  FROM order_pallet_counts opc
  JOIN inventory_items ii ON ii.id = opc.inventory_item_id
  JOIN orders o ON o.id = opc.order_id
  GROUP BY opc.inventory_item_id, ii.name, ii.category, ii.unit;
END;
$$;

COMMENT ON FUNCTION calculate_shipping_material_demand(INTEGER) IS
  'Calculates shipping material demand from confirmed/scheduled orders within horizon. '
  'Reads from order_materials (auto-calculated or manually adjusted).';

-- =============================================================================
-- UNIFIED MATERIAL SHORTFALLS
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_material_shortfalls(
  p_horizon_weeks INTEGER DEFAULT 8
)
RETURNS TABLE (
  inventory_item_id UUID,
  inventory_item_name TEXT,
  category TEXT,
  demand_source TEXT,
  needed_by_date DATE,
  quantity_needed DECIMAL(12,4),
  on_hand DECIMAL(12,4),
  incoming_po DECIMAL(12,4),
  shortfall DECIMAL(12,4),
  unit TEXT,
  best_supplier_id UUID,
  best_supplier_name TEXT,
  lead_time_days INTEGER,
  drop_dead_date DATE,
  is_past_due BOOLEAN,
  source_count INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH
  -- ==========================================================================
  -- DEMAND: Brewing ingredients (from existing calculate_ingredient_demand)
  -- ==========================================================================
  brewing_demand AS (
    SELECT
      ii.id as inventory_item_id,
      ii.name as inventory_item_name,
      ii.category,
      'brewing'::TEXT as demand_source,
      d.earliest_required_by as needed_by_date,
      d.total_required as quantity_needed,
      ii.unit,
      d.batch_count as source_count
    FROM calculate_ingredient_demand(p_horizon_weeks, true, true) d
    -- Map catalog items to inventory_items via catalog_type/catalog_id
    JOIN inventory_items ii
      ON ii.catalog_type = d.catalog_type
      AND ii.catalog_id = d.catalog_id
      AND ii.is_active = true
  ),

  -- ==========================================================================
  -- DEMAND: Packaging materials (from selling format BOMs)
  -- ==========================================================================
  packaging_demand AS (
    SELECT
      d.inventory_item_id,
      d.inventory_item_name,
      d.category,
      'packaging'::TEXT as demand_source,
      d.earliest_needed_by as needed_by_date,
      d.total_required as quantity_needed,
      d.unit,
      d.source_count
    FROM calculate_packaging_material_demand(p_horizon_weeks) d
  ),

  -- ==========================================================================
  -- DEMAND: Shipping materials (from order_materials)
  -- ==========================================================================
  shipping_demand AS (
    SELECT
      d.inventory_item_id,
      d.inventory_item_name,
      d.category,
      'shipping'::TEXT as demand_source,
      d.earliest_needed_by as needed_by_date,
      d.total_required as quantity_needed,
      d.unit,
      d.source_count
    FROM calculate_shipping_material_demand(p_horizon_weeks) d
  ),

  -- ==========================================================================
  -- UNION ALL DEMAND SOURCES
  -- ==========================================================================
  all_demand AS (
    SELECT * FROM brewing_demand
    UNION ALL
    SELECT * FROM packaging_demand
    UNION ALL
    SELECT * FROM shipping_demand
  ),

  -- ==========================================================================
  -- SUPPLY: Current inventory
  -- ==========================================================================
  inventory_available AS (
    SELECT
      ii.id as inventory_item_id,
      COALESCE(SUM(ilq.remaining_quantity), 0) as available_qty
    FROM inventory_items ii
    LEFT JOIN inventory_lots_with_quantities ilq ON ilq.inventory_item_id = ii.id
    WHERE ii.is_active = true
    GROUP BY ii.id
  ),

  -- ==========================================================================
  -- SUPPLY: Open PO quantities (using inventory_item linkage)
  -- ==========================================================================
  po_received_summary AS (
    SELECT pr.po_line_item_id, SUM(pr.quantity) as received_qty
    FROM po_receives pr
    GROUP BY pr.po_line_item_id
  ),
  open_po_quantities AS (
    -- For catalog-linked items (brewing ingredients)
    SELECT
      ii.id as inventory_item_id,
      COALESCE(
        SUM(pli.quantity - COALESCE(prs.received_qty, 0)),
        0
      ) as on_order_qty
    FROM po_line_items pli
    JOIN purchase_orders po ON po.id = pli.po_id
    JOIN inventory_items ii
      ON ii.catalog_type = pli.catalog_type
      AND ii.catalog_id = pli.catalog_id
    LEFT JOIN po_received_summary prs ON prs.po_line_item_id = pli.id
    WHERE po.status IN ('submitted', 'confirmed', 'partial')
    GROUP BY ii.id

    UNION ALL

    -- For inventory_item-linked items (packaging/shipping materials)
    SELECT
      pli.catalog_id as inventory_item_id,
      COALESCE(
        SUM(pli.quantity - COALESCE(prs.received_qty, 0)),
        0
      ) as on_order_qty
    FROM po_line_items pli
    JOIN purchase_orders po ON po.id = pli.po_id
    LEFT JOIN po_received_summary prs ON prs.po_line_item_id = pli.id
    WHERE po.status IN ('submitted', 'confirmed', 'partial')
      AND pli.catalog_type = 'inventory_item'
    GROUP BY pli.catalog_id
  ),
  -- Aggregate PO quantities per item (may have rows from both unions)
  po_agg AS (
    SELECT
      inventory_item_id,
      SUM(on_order_qty) as on_order_qty
    FROM open_po_quantities
    GROUP BY inventory_item_id
  ),

  -- ==========================================================================
  -- SUPPLIERS: Best supplier per inventory item
  -- ==========================================================================
  best_suppliers AS (
    SELECT DISTINCT ON (inv_item_id)
      inv_item_id,
      supplier_id,
      supplier_name,
      resolved_lead_time
    FROM (
      -- Suppliers for inventory_item catalog type
      SELECT
        sc.catalog_id as inv_item_id,
        sc.supplier_id,
        s.name as supplier_name,
        COALESCE(sc.lead_time_days, s.default_lead_time_days, 7) as resolved_lead_time
      FROM supplier_catalog sc
      JOIN suppliers s ON s.id = sc.supplier_id
      WHERE sc.catalog_type = 'inventory_item'

      UNION ALL

      -- Suppliers for brewing ingredient catalog types (mapped through inventory_items)
      SELECT
        ii.id as inv_item_id,
        sc.supplier_id,
        s.name as supplier_name,
        COALESCE(sc.lead_time_days, s.default_lead_time_days, 7) as resolved_lead_time
      FROM supplier_catalog sc
      JOIN suppliers s ON s.id = sc.supplier_id
      JOIN inventory_items ii
        ON ii.catalog_type = sc.catalog_type
        AND ii.catalog_id = sc.catalog_id
      WHERE sc.catalog_type != 'inventory_item'
    ) suppliers_union
    ORDER BY inv_item_id, resolved_lead_time ASC, supplier_name
  )

  -- ==========================================================================
  -- FINAL RESULT
  -- ==========================================================================
  SELECT
    ad.inventory_item_id,
    ad.inventory_item_name,
    ad.category,
    ad.demand_source,
    ad.needed_by_date,
    ad.quantity_needed,
    COALESCE(ia.available_qty, 0)::DECIMAL(12,4) as on_hand,
    COALESCE(pa.on_order_qty, 0)::DECIMAL(12,4) as incoming_po,
    GREATEST(
      ad.quantity_needed - COALESCE(ia.available_qty, 0) - COALESCE(pa.on_order_qty, 0),
      0
    )::DECIMAL(12,4) as shortfall,
    ad.unit,
    bs.supplier_id as best_supplier_id,
    bs.supplier_name as best_supplier_name,
    COALESCE(bs.resolved_lead_time, 7)::INTEGER as lead_time_days,
    (ad.needed_by_date - COALESCE(bs.resolved_lead_time, 7))::DATE as drop_dead_date,
    ((ad.needed_by_date - COALESCE(bs.resolved_lead_time, 7)) < CURRENT_DATE)::BOOLEAN as is_past_due,
    ad.source_count
  FROM all_demand ad
  LEFT JOIN inventory_available ia ON ia.inventory_item_id = ad.inventory_item_id
  LEFT JOIN po_agg pa ON pa.inventory_item_id = ad.inventory_item_id
  LEFT JOIN best_suppliers bs ON bs.inv_item_id = ad.inventory_item_id
  ORDER BY is_past_due DESC, drop_dead_date ASC, ad.demand_source, ad.quantity_needed DESC;
END;
$$;

COMMENT ON FUNCTION calculate_material_shortfalls(INTEGER) IS
  'Unified material shortfall report across brewing ingredients, packaging materials, '
  'and shipping materials. Compares demand against inventory + open POs, calculates '
  'drop dead dates using supplier lead time cascade. Replaces calculate_ingredient_shortfalls.';

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_packaging_sessions_status_date
  ON packaging_sessions(status, session_date)
  WHERE status = 'planned';

CREATE INDEX IF NOT EXISTS idx_session_line_items_format
  ON session_line_items(selling_format_id)
  WHERE selling_format_id IS NOT NULL;
```

- [ ] **Step 2: Apply the migration**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && npx supabase migration up --local 2>&1 | tail -20`

Verify: no errors.

- [ ] **Step 3: Smoke test the RPC**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && npx supabase db execute --local "SELECT * FROM calculate_material_shortfalls(8) LIMIT 5;"`

Expect: empty result set or rows if test data exists. No SQL errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00163_calculate_material_shortfalls.sql
git commit -m "feat: add unified calculate_material_shortfalls RPC with packaging and shipping demand"
```

---

## Task 5: Query Keys and Types

**Files:**
- Modify: `src/lib/query-keys.ts`
- Create: `src/hooks/use-material-planning.ts`

- [ ] **Step 1: Add query key factories**

In `src/lib/query-keys.ts`, add a new section after `purchasingKeys`:

```typescript
// =============================================================================
// Material Planning Keys
// =============================================================================

export const materialPlanningKeys = {
  all: () => ["material-planning"] as const,
  shortfalls: (options?: { horizonWeeks?: number; demandSource?: string }) =>
    options
      ? (["material-planning", "shortfalls", options] as const)
      : (["material-planning", "shortfalls"] as const),
  bom: (sellingFormatId: string) =>
    ["material-planning", "bom", sellingFormatId] as const,
  orderMaterials: (orderId: string) =>
    ["material-planning", "order-materials", orderId] as const,
  customerShippingMaterials: (customerId: string) =>
    ["material-planning", "customer-shipping", customerId] as const,
  customerPalletConfigs: (customerId: string) =>
    ["material-planning", "customer-pallets", customerId] as const,
  breweryShippingDefaults: () =>
    ["material-planning", "brewery-defaults"] as const,
  sessionMaterials: (sessionId: string) =>
    ["material-planning", "session-materials", sessionId] as const,
};
```

- [ ] **Step 2: Create the material planning hooks file**

Create `src/hooks/use-material-planning.ts`:

```typescript
/**
 * Hooks for material planning queries — BOM management, shortfall detection,
 * order materials auto-calculation, and shipping preference resolution.
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { materialPlanningKeys, entityKeys } from "@/lib/query-keys";
import { dynamicFrom } from "@/lib/supabase/dynamic-from";

// =============================================================================
// Types
// =============================================================================

export type SellingFormatMaterial = {
  id: string;
  selling_format_id: string;
  inventory_item_id: string;
  quantity_per_unit: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  inventory_item?: {
    id: string;
    name: string;
    category: string;
    unit: string;
  };
};

export type MaterialShortfall = {
  inventory_item_id: string;
  inventory_item_name: string;
  category: string;
  demand_source: string;
  needed_by_date: string;
  quantity_needed: number;
  on_hand: number;
  incoming_po: number;
  shortfall: number;
  unit: string;
  best_supplier_id: string | null;
  best_supplier_name: string | null;
  lead_time_days: number;
  drop_dead_date: string;
  is_past_due: boolean;
  source_count: number;
};

export type OrderMaterial = {
  id: string;
  order_id: string;
  inventory_item_id: string;
  estimated_qty: number;
  actual_qty: number | null;
  created_at: string;
  updated_at: string;
  inventory_item?: {
    id: string;
    name: string;
    category: string;
    unit: string;
  };
};

// =============================================================================
// BOM Queries
// =============================================================================

export function useSellingFormatBOM(sellingFormatId: string) {
  const supabase = createClient();
  return useQuery({
    queryKey: materialPlanningKeys.bom(sellingFormatId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("selling_format_materials")
        .select("*, inventory_item:inventory_items(id, name, category, unit)")
        .eq("selling_format_id", sellingFormatId)
        .order("created_at");
      if (error) throw error;
      return data as SellingFormatMaterial[];
    },
    enabled: !!sellingFormatId,
  });
}

// =============================================================================
// Shortfall Queries
// =============================================================================

export function useMaterialShortfalls(options?: {
  horizonWeeks?: number;
  demandSource?: string;
}) {
  const supabase = createClient();
  const horizonWeeks = options?.horizonWeeks ?? 8;
  return useQuery({
    queryKey: materialPlanningKeys.shortfalls(options),
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "calculate_material_shortfalls",
        { p_horizon_weeks: horizonWeeks }
      );
      if (error) throw error;
      let results = data as MaterialShortfall[];
      if (options?.demandSource && options.demandSource !== "all") {
        results = results.filter(
          (r) => r.demand_source === options.demandSource
        );
      }
      return results;
    },
  });
}

// =============================================================================
// Order Materials
// =============================================================================

export function useOrderMaterials(orderId: string) {
  const supabase = createClient();
  return useQuery({
    queryKey: materialPlanningKeys.orderMaterials(orderId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_materials")
        .select("*, inventory_item:inventory_items(id, name, category, unit)")
        .eq("order_id", orderId)
        .order("created_at");
      if (error) throw error;
      return data as OrderMaterial[];
    },
    enabled: !!orderId,
  });
}

// =============================================================================
// Session Material Preview
// =============================================================================

export type SessionMaterialPreview = {
  inventory_item_id: string;
  inventory_item_name: string;
  unit: string;
  needed: number;
  on_hand: number;
  shortfall: number;
};

export function useSessionMaterialPreview(sessionId: string) {
  const supabase = createClient();
  return useQuery({
    queryKey: materialPlanningKeys.sessionMaterials(sessionId),
    queryFn: async () => {
      // Get session line items with their selling format BOMs
      const { data: lineItems, error: liError } = await supabase
        .from("session_line_items")
        .select(`
          planned_quantity,
          selling_format_id,
          selling_format_materials:selling_format_materials(
            inventory_item_id,
            quantity_per_unit,
            inventory_item:inventory_items(id, name, unit)
          )
        `)
        .eq("session_id", sessionId)
        .not("selling_format_id", "is", null);

      if (liError) throw liError;

      // Aggregate material needs across all line items
      const materialMap = new Map<
        string,
        { name: string; unit: string; needed: number }
      >();

      for (const li of lineItems ?? []) {
        const qty = li.planned_quantity ?? 0;
        for (const mat of (li as Record<string, unknown>).selling_format_materials as Array<{
          inventory_item_id: string;
          quantity_per_unit: number;
          inventory_item: { id: string; name: string; unit: string };
        }> ?? []) {
          const key = mat.inventory_item_id;
          const existing = materialMap.get(key);
          if (existing) {
            existing.needed += qty * mat.quantity_per_unit;
          } else {
            materialMap.set(key, {
              name: mat.inventory_item.name,
              unit: mat.inventory_item.unit,
              needed: qty * mat.quantity_per_unit,
            });
          }
        }
      }

      // Get on-hand quantities for each material
      const itemIds = Array.from(materialMap.keys());
      if (itemIds.length === 0) return [];

      const { data: inventory, error: invError } = await dynamicFrom(
        supabase,
        "inventory_lots_with_quantities"
      )
        .select("inventory_item_id, remaining_quantity")
        .in("inventory_item_id", itemIds);

      if (invError) throw invError;

      // Sum on-hand per item
      const onHandMap = new Map<string, number>();
      for (const lot of inventory ?? []) {
        const current = onHandMap.get(lot.inventory_item_id) ?? 0;
        onHandMap.set(
          lot.inventory_item_id,
          current + (lot.remaining_quantity ?? 0)
        );
      }

      // Build result
      const results: SessionMaterialPreview[] = [];
      for (const [itemId, mat] of materialMap) {
        const onHand = onHandMap.get(itemId) ?? 0;
        results.push({
          inventory_item_id: itemId,
          inventory_item_name: mat.name,
          unit: mat.unit,
          needed: mat.needed,
          on_hand: onHand,
          shortfall: Math.max(mat.needed - onHand, 0),
        });
      }

      return results.sort((a, b) => b.shortfall - a.shortfall);
    },
    enabled: !!sessionId,
  });
}
```

- [ ] **Step 3: Run type check**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && bunx tsc --noEmit 2>&1 | tail -20`

Fix any type errors. The `selling_format_materials` table may not be in the generated Supabase types yet — if so, regenerate types first: `npx supabase gen types typescript --local > src/types/supabase.ts`

- [ ] **Step 4: Commit**

```bash
git add src/lib/query-keys.ts src/hooks/use-material-planning.ts
git commit -m "feat: add material planning query keys and hooks"
```

---

## Task 6: Selling Format Entity Config Updates

**Files:**
- Modify: `src/entities/selling-format.tsx`

- [ ] **Step 1: Update the Zod schema**

Add `units_per_layer`, `default_layers`, and `pallet_quantity` to the schema:

```typescript
export const sellingFormatSchema = z.object({
  name: z.string().min(1, "Name is required"),
  container_id: z.string().uuid("Container is required"),
  unit_count: z.coerce.number().int().positive("Unit count must be positive").default(1),
  units_per_layer: z.coerce.number().int().positive("Must be positive").nullable().optional(),
  default_layers: z.coerce.number().int().positive("Must be positive").nullable().optional(),
  pallet_quantity: z.coerce.number().int().positive("Must be positive").nullable().optional(),
  is_active: z.boolean().default(true),
  position: z.coerce.number().int().min(0).default(0),
});
```

- [ ] **Step 2: Add pallet fields to the sections**

Add a new "Pallet Configuration" section after the "overview" section:

```typescript
{
  id: "pallet",
  title: "Pallet Configuration",
  fields: [
    {
      name: "units_per_layer",
      label: "Units Per Layer",
      type: "number",
      placeholder: "e.g., 25",
      description: "How many of this format fit in one pallet layer",
      colSpan: 4,
    },
    {
      name: "default_layers",
      label: "Default Layers",
      type: "number",
      placeholder: "e.g., 4",
      description: "Default number of layers per pallet",
      colSpan: 4,
    },
    {
      name: "pallet_quantity",
      label: "Pallet Quantity",
      type: "number",
      description: "Auto-calculated: units_per_layer × default_layers",
      editable: false,
      colSpan: 4,
    },
  ],
},
```

- [ ] **Step 3: Add BOM relation**

Add a `relations` array to the entity config (after `actions`):

```typescript
relations: [
  {
    name: "bill_of_materials",
    entity: "selling_format_material",
    type: "hasMany",
    foreignKey: "selling_format_id",
    showInDetail: true,
    detailTab: "Bill of Materials",
  },
],
```

- [ ] **Step 4: Run type check**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && bunx tsc --noEmit 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add src/entities/selling-format.tsx
git commit -m "feat: add pallet config fields and BOM relation to selling format entity"
```

---

## Task 7: Selling Format BOM Editor Component

**Files:**
- Create: `src/components/domain/selling-format-bom-editor.tsx`

- [ ] **Step 1: Build the BOM editor**

Model after `grain-bill-editor.tsx` — a table with add/remove rows and an inventory item picker. Key differences from grain-bill-editor:
- Fetches inventory items (not catalog malts) — use `entityKeys.list("inventory_items")` or filter by category
- Saves to `selling_format_materials` table via Supabase
- Fields: inventory item (picker), quantity_per_unit (number input), notes (text input)
- No drag-to-reorder needed (BOMs don't have position ordering)

```typescript
"use client";

/**
 * SellingFormatBOMEditor - Bill of Materials editor for selling formats.
 *
 * Manages the packaging materials required to produce one unit of a selling
 * format (e.g., a case of 24 needs 24 cans, 24 lids, 6 PakTechs, 1 tray).
 * Uses inventory items as the material source.
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { materialPlanningKeys, entityKeys } from "@/lib/query-keys";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type {
  SellingFormatMaterial,
} from "@/hooks/use-material-planning";

type InventoryItem = {
  id: string;
  name: string;
  category: string;
  unit: string;
  is_active: boolean;
};

type SellingFormatBOMEditorProps = {
  sellingFormatId: string;
  disabled?: boolean;
};

export function SellingFormatBOMEditor({
  sellingFormatId,
  disabled = false,
}: SellingFormatBOMEditorProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  // Fetch existing BOM
  const { data: bomItems = [], isLoading } = useQuery({
    queryKey: materialPlanningKeys.bom(sellingFormatId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("selling_format_materials")
        .select("*, inventory_item:inventory_items(id, name, category, unit)")
        .eq("selling_format_id", sellingFormatId)
        .order("created_at");
      if (error) throw error;
      return data as SellingFormatMaterial[];
    },
    enabled: !!sellingFormatId,
  });

  // Fetch available inventory items for the picker
  const { data: inventoryItems = [] } = useQuery({
    queryKey: entityKeys.list("inventory_items", { is_active: true }),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, category, unit, is_active")
        .eq("is_active", true)
        .order("category")
        .order("name");
      if (error) throw error;
      return data as InventoryItem[];
    },
  });

  // Filter out items already in the BOM
  const existingItemIds = new Set(bomItems.map((b) => b.inventory_item_id));
  const availableItems = inventoryItems.filter(
    (item) => !existingItemIds.has(item.id)
  );
  const filteredItems = searchValue
    ? availableItems.filter((item) =>
        item.name.toLowerCase().includes(searchValue.toLowerCase())
      )
    : availableItems;

  // Add material mutation
  const addMaterial = useMutation({
    mutationFn: async (inventoryItemId: string) => {
      const { error } = await supabase
        .from("selling_format_materials")
        .insert({
          selling_format_id: sellingFormatId,
          inventory_item_id: inventoryItemId,
          quantity_per_unit: 1,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: materialPlanningKeys.bom(sellingFormatId),
      });
    },
    onError: (err) => {
      toast({
        title: "Failed to add material",
        description: String(err),
        variant: "destructive",
      });
    },
  });

  // Update material mutation
  const updateMaterial = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<{ quantity_per_unit: number; notes: string | null }>;
    }) => {
      const { error } = await supabase
        .from("selling_format_materials")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: materialPlanningKeys.bom(sellingFormatId),
      });
    },
    onError: (err) => {
      toast({
        title: "Failed to update material",
        description: String(err),
        variant: "destructive",
      });
    },
  });

  // Remove material mutation
  const removeMaterial = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("selling_format_materials")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: materialPlanningKeys.bom(sellingFormatId),
      });
    },
    onError: (err) => {
      toast({
        title: "Failed to remove material",
        description: String(err),
        variant: "destructive",
      });
    },
  });

  const handleAdd = useCallback(
    (itemId: string) => {
      addMaterial.mutate(itemId);
      setAddOpen(false);
      setSearchValue("");
    },
    [addMaterial]
  );

  const handleQuantityChange = useCallback(
    (id: string, value: string) => {
      const num = parseFloat(value);
      if (!isNaN(num) && num > 0) {
        updateMaterial.mutate({ id, updates: { quantity_per_unit: num } });
      }
    },
    [updateMaterial]
  );

  const handleNotesChange = useCallback(
    (id: string, value: string) => {
      updateMaterial.mutate({
        id,
        updates: { notes: value || null },
      });
    },
    [updateMaterial]
  );

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading BOM...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Required Materials</h3>
        {!disabled && (
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Add Material
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="end">
              <Command>
                <CommandInput
                  placeholder="Search inventory items..."
                  value={searchValue}
                  onValueChange={setSearchValue}
                />
                <CommandList>
                  <CommandEmpty>No items found.</CommandEmpty>
                  <CommandGroup>
                    {filteredItems.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={item.name}
                        onSelect={() => handleAdd(item.id)}
                      >
                        <span>{item.name}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {item.category} · {item.unit}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {bomItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No materials defined. Add packaging materials required to produce one
          unit of this selling format.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Material</TableHead>
              <TableHead className="w-[120px]">Qty Per Unit</TableHead>
              <TableHead>Notes</TableHead>
              {!disabled && <TableHead className="w-[50px]" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {bomItems.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div>
                    <span className="font-medium">
                      {item.inventory_item?.name ?? "Unknown"}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {item.inventory_item?.category} ·{" "}
                      {item.inventory_item?.unit}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    defaultValue={item.quantity_per_unit}
                    onBlur={(e) =>
                      handleQuantityChange(item.id, e.target.value)
                    }
                    disabled={disabled}
                    className="w-[100px]"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="text"
                    defaultValue={item.notes ?? ""}
                    placeholder="e.g., 1 PakTech per 4 cans"
                    onBlur={(e) => handleNotesChange(item.id, e.target.value)}
                    disabled={disabled}
                  />
                </TableCell>
                {!disabled && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeMaterial.mutate(item.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire BOM editor into selling format detail**

The `relations` config added in Task 6 may auto-render the relation tab. If not, the BOM editor component needs to be imported and referenced. Check how `OrderItemsRelation` is wired in `src/entities/order.tsx` (line ~349) as a reference for custom relation components.

If the entity system supports `component` on relations, update the relation in `selling-format.tsx`:

```typescript
relations: [
  {
    name: "bill_of_materials",
    entity: "selling_format_material",
    type: "hasMany",
    foreignKey: "selling_format_id",
    showInDetail: true,
    detailTab: "Bill of Materials",
    component: SellingFormatBOMEditor,
  },
],
```

Import at top of file:
```typescript
import { SellingFormatBOMEditor } from "@/components/domain/selling-format-bom-editor";
```

- [ ] **Step 3: Run type check and lint**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && bunx tsc --noEmit 2>&1 | tail -20 && bun lint 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add src/components/domain/selling-format-bom-editor.tsx src/entities/selling-format.tsx
git commit -m "feat: add selling format BOM editor component"
```

---

## Task 8: Packaging Session Material Preview

**Files:**
- Create: `src/components/domain/packaging-session-materials.tsx`
- Modify: `src/entities/packaging-session.tsx`

- [ ] **Step 1: Build the material preview component**

```typescript
"use client";

/**
 * PackagingSessionMaterials - Read-only material requirements preview
 * for a packaging session. Shows materials needed, on hand, and shortfalls
 * calculated from session line items and selling format BOMs.
 */

import { useSessionMaterialPreview } from "@/hooks/use-material-planning";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

type PackagingSessionMaterialsProps = {
  sessionId: string;
};

export function PackagingSessionMaterials({
  sessionId,
}: PackagingSessionMaterialsProps) {
  const { data: materials = [], isLoading } =
    useSessionMaterialPreview(sessionId);

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        Calculating materials...
      </div>
    );
  }

  if (materials.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No material requirements. Add line items with selling formats that have
        a bill of materials configured.
      </p>
    );
  }

  const hasShortfalls = materials.some((m) => m.shortfall > 0);

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Material</TableHead>
            <TableHead className="text-right">Needed</TableHead>
            <TableHead className="text-right">On Hand</TableHead>
            <TableHead className="text-right">Shortfall</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {materials.map((mat) => (
            <TableRow key={mat.inventory_item_id}>
              <TableCell>
                <span className="font-medium">
                  {mat.inventory_item_name}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {mat.unit}
                </span>
              </TableCell>
              <TableCell className="text-right">
                {mat.needed.toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                {mat.on_hand.toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                {mat.shortfall > 0 ? (
                  <Badge variant="destructive">
                    {mat.shortfall.toLocaleString()}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">--</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {hasShortfalls && (
        <p className="text-sm text-muted-foreground">
          Some materials have shortfalls.{" "}
          <Link
            href="/purchasing/material-planning"
            className="text-primary underline"
          >
            View material planning
          </Link>{" "}
          for details.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add materials section to packaging session entity**

In `src/entities/packaging-session.tsx`, add a new section with the custom component. Check how existing custom section components are referenced (e.g., `component: createQBOSyncDisplay("customer")` in `customer.tsx`).

Add to the `sections` array:

```typescript
{
  id: "materials",
  title: "Materials Required",
  component: PackagingSessionMaterials,
  collapsible: true,
},
```

Import at top:
```typescript
import { PackagingSessionMaterials } from "@/components/domain/packaging-session-materials";
```

- [ ] **Step 3: Run type check and lint**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && bunx tsc --noEmit 2>&1 | tail -20 && bun lint 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add src/components/domain/packaging-session-materials.tsx src/entities/packaging-session.tsx
git commit -m "feat: add material requirements preview to packaging session detail"
```

---

## Task 9: Order Shipping Materials Editor

**Files:**
- Create: `src/components/domain/order-shipping-materials-editor.tsx`
- Modify: `src/entities/order.tsx`

- [ ] **Step 1: Build the order shipping materials editor**

Similar pattern to BOM editor but with estimated/actual qty columns. Read-only estimated, editable actual.

```typescript
"use client";

/**
 * OrderShippingMaterialsEditor - Manages shipping materials for an order.
 * Shows auto-calculated estimated quantities with editable actual quantities.
 */

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useOrderMaterials } from "@/hooks/use-material-planning";
import { materialPlanningKeys } from "@/lib/query-keys";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type OrderShippingMaterialsEditorProps = {
  orderId: string;
  disabled?: boolean;
};

export function OrderShippingMaterialsEditor({
  orderId,
  disabled = false,
}: OrderShippingMaterialsEditorProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: materials = [], isLoading } = useOrderMaterials(orderId);

  const updateActualQty = useMutation({
    mutationFn: async ({ id, actual_qty }: { id: string; actual_qty: number }) => {
      const { error } = await supabase
        .from("order_materials")
        .update({ actual_qty })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: materialPlanningKeys.orderMaterials(orderId),
      });
    },
    onError: (err) => {
      toast({
        title: "Failed to update quantity",
        description: String(err),
        variant: "destructive",
      });
    },
  });

  const handleActualQtyChange = useCallback(
    (id: string, value: string) => {
      const num = parseFloat(value);
      if (!isNaN(num) && num >= 0) {
        updateActualQty.mutate({ id, actual_qty: num });
      }
    },
    [updateActualQty]
  );

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        Loading shipping materials...
      </div>
    );
  }

  if (materials.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No shipping materials calculated. Shipping materials are auto-generated
        when the order has line items and pallet quantities are configured.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Material</TableHead>
          <TableHead className="w-[120px] text-right">Estimated</TableHead>
          <TableHead className="w-[120px] text-right">Actual</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {materials.map((mat) => (
          <TableRow key={mat.id}>
            <TableCell>
              <span className="font-medium">
                {mat.inventory_item?.name ?? "Unknown"}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                {mat.inventory_item?.unit}
              </span>
            </TableCell>
            <TableCell className="text-right">
              {mat.estimated_qty.toLocaleString()}
            </TableCell>
            <TableCell className="text-right">
              <Input
                type="number"
                step="1"
                min="0"
                defaultValue={mat.actual_qty ?? mat.estimated_qty}
                onBlur={(e) => handleActualQtyChange(mat.id, e.target.value)}
                disabled={disabled}
                className="w-[100px] ml-auto"
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Wire into order entity config**

In `src/entities/order.tsx`, add a shipping materials section. Check for the pattern used by other custom section components in the file.

Add to sections array (after the order items relation or notes section):

```typescript
{
  id: "shipping-materials",
  title: "Shipping Materials",
  component: OrderShippingMaterialsEditor,
  collapsible: true,
},
```

Import at top:
```typescript
import { OrderShippingMaterialsEditor } from "@/components/domain/order-shipping-materials-editor";
```

- [ ] **Step 3: Run type check and lint**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && bunx tsc --noEmit 2>&1 | tail -20 && bun lint 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add src/components/domain/order-shipping-materials-editor.tsx src/entities/order.tsx
git commit -m "feat: add shipping materials editor to order detail page"
```

---

## Task 10: Customer Shipping Preferences & Pallet Configs

**Files:**
- Create: `src/components/domain/customer-shipping-preferences.tsx`
- Create: `src/components/domain/customer-pallet-configs.tsx`
- Modify: `src/entities/customer.tsx`

- [ ] **Step 1: Build customer shipping preferences editor**

Simple CRUD editor for `customer_shipping_materials` — one row per material role (pallet, wrap, other). Uses inventory item picker.

Follow the same pattern as `SellingFormatBOMEditor` but simpler — only 3 possible rows (one per role). Use a select for material_role and an inventory item picker.

- [ ] **Step 2: Build customer pallet configs editor**

CRUD editor for `customer_pallet_configs` — one row per selling format with a layers input. Shows selling format name, current `units_per_layer`, the layer count input, and computed effective pallet quantity.

- [ ] **Step 3: Wire into customer entity**

In `src/entities/customer.tsx`, add two new sections after the "billing" section (line ~271):

```typescript
{
  id: "shipping-preferences",
  title: "Shipping Preferences",
  component: CustomerShippingPreferences,
  collapsible: true,
},
{
  id: "pallet-configs",
  title: "Pallet Configurations",
  component: CustomerPalletConfigs,
  collapsible: true,
},
```

Import at top:
```typescript
import { CustomerShippingPreferences } from "@/components/domain/customer-shipping-preferences";
import { CustomerPalletConfigs } from "@/components/domain/customer-pallet-configs";
```

- [ ] **Step 4: Run type check and lint**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && bunx tsc --noEmit 2>&1 | tail -20 && bun lint 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add src/components/domain/customer-shipping-preferences.tsx src/components/domain/customer-pallet-configs.tsx src/entities/customer.tsx
git commit -m "feat: add customer shipping preferences and pallet config editors"
```

---

## Task 11: Brewery Shipping Defaults

**Files:**
- Create: `src/components/domain/brewery-shipping-defaults.tsx`

- [ ] **Step 1: Build brewery defaults editor**

Simple settings-level component for managing `brewery_shipping_defaults`. One row per material role with an inventory item picker. This can either live on an existing settings page or be a standalone page at `/settings/shipping-defaults`.

Check `src/app/(app)/settings/` for existing settings pages and follow the same page pattern. The component is similar to `CustomerShippingPreferences` but operates on `brewery_shipping_defaults` table without a customer_id filter.

- [ ] **Step 2: Create settings page if needed**

If no suitable existing settings page exists, create:
- `src/app/(app)/settings/shipping-defaults/page.tsx` — wraps the component

- [ ] **Step 3: Add navigation link**

Add the new settings page to the settings navigation. Check where settings nav links are defined (likely in a layout or sidebar component).

- [ ] **Step 4: Run type check and lint**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && bunx tsc --noEmit 2>&1 | tail -20 && bun lint 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add src/components/domain/brewery-shipping-defaults.tsx src/app/(app)/settings/shipping-defaults/
git commit -m "feat: add brewery shipping defaults settings page"
```

---

## Task 12: Material Planning Page

**Files:**
- Create: `src/app/(app)/purchasing/material-planning/page.tsx`

- [ ] **Step 1: Build the material planning page**

Client component using `useMaterialShortfalls` hook. Features:
- Horizon selector (2/4/8/12 weeks, default 8)
- Demand source filter (all/brewing/packaging/shipping)
- "Show only shortfalls" toggle
- Table with columns: Material, Category, Source, Needed By, Qty Needed, On Hand, Incoming (PO), Shortfall, Best Supplier, Lead Time, Order By, Status
- Color coding: past due = red/destructive, has shortfall but within lead time = amber/warning, OK = default
- Status badge: "PAST DUE", "Order Now", "OK"

Follow the pattern from `src/app/(app)/inventory/kegs/reports/page.tsx` for the report page structure:
- `"use client"`
- `useQuery` with the RPC
- Type definitions for the data
- Filter state with `useState`
- Table rendering with conditional styling

```typescript
"use client";

/**
 * Material Planning Page
 *
 * Unified view of material shortfalls across brewing, packaging, and shipping.
 * Shows drop dead dates based on supplier lead times and factors in open POs.
 */

import { useState } from "react";
import { useMaterialShortfalls } from "@/hooks/use-material-planning";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const HORIZON_OPTIONS = [
  { value: "2", label: "2 weeks" },
  { value: "4", label: "4 weeks" },
  { value: "8", label: "8 weeks" },
  { value: "12", label: "12 weeks" },
];

const SOURCE_OPTIONS = [
  { value: "all", label: "All Sources" },
  { value: "brewing", label: "Brewing" },
  { value: "packaging", label: "Packaging" },
  { value: "shipping", label: "Shipping" },
];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "--";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function StatusBadgeForShortfall({
  isPastDue,
  shortfall,
}: {
  isPastDue: boolean;
  shortfall: number;
}) {
  if (isPastDue) {
    return <Badge variant="destructive">PAST DUE</Badge>;
  }
  if (shortfall > 0) {
    return (
      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
        Order Now
      </Badge>
    );
  }
  return (
    <span className="text-sm text-muted-foreground">OK</span>
  );
}

export default function MaterialPlanningPage() {
  const [horizonWeeks, setHorizonWeeks] = useState(8);
  const [demandSource, setDemandSource] = useState("all");
  const [shortfallsOnly, setShortfallsOnly] = useState(false);

  const { data: shortfalls = [], isLoading } = useMaterialShortfalls({
    horizonWeeks,
    demandSource,
  });

  const filtered = shortfallsOnly
    ? shortfalls.filter((s) => s.shortfall > 0)
    : shortfalls;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Material Planning</h1>
        <p className="text-sm text-muted-foreground">
          Unified view of material needs across brewing, packaging, and shipping
          with drop dead dates.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label>Horizon</Label>
          <Select
            value={String(horizonWeeks)}
            onValueChange={(v) => setHorizonWeeks(Number(v))}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HORIZON_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Label>Source</Label>
          <Select value={demandSource} onValueChange={setDemandSource}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="shortfalls-only"
            checked={shortfallsOnly}
            onCheckedChange={setShortfallsOnly}
          />
          <Label htmlFor="shortfalls-only">Shortfalls only</Label>
        </div>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">
          Calculating shortfalls...
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {shortfallsOnly
            ? "No shortfalls detected within the selected horizon."
            : "No material demand within the selected horizon."}
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Needed By</TableHead>
                <TableHead className="text-right">Needed</TableHead>
                <TableHead className="text-right">On Hand</TableHead>
                <TableHead className="text-right">Incoming</TableHead>
                <TableHead className="text-right">Shortfall</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Lead Time</TableHead>
                <TableHead>Order By</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row, idx) => (
                <TableRow
                  key={`${row.inventory_item_id}-${row.demand_source}-${idx}`}
                  className={cn(
                    row.is_past_due && "bg-destructive/10",
                    !row.is_past_due &&
                      row.shortfall > 0 &&
                      "bg-amber-50 dark:bg-amber-950/20"
                  )}
                >
                  <TableCell>
                    <div>
                      <span className="font-medium">
                        {row.inventory_item_name}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {row.category}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="capitalize">
                    {row.demand_source}
                  </TableCell>
                  <TableCell>{formatDate(row.needed_by_date)}</TableCell>
                  <TableCell className="text-right">
                    {row.quantity_needed.toLocaleString()} {row.unit}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.on_hand.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.incoming_po.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {row.shortfall > 0
                      ? row.shortfall.toLocaleString()
                      : "--"}
                  </TableCell>
                  <TableCell>
                    {row.best_supplier_name ?? "--"}
                  </TableCell>
                  <TableCell>
                    {row.lead_time_days ? `${row.lead_time_days}d` : "--"}
                  </TableCell>
                  <TableCell>{formatDate(row.drop_dead_date)}</TableCell>
                  <TableCell>
                    <StatusBadgeForShortfall
                      isPastDue={row.is_past_due}
                      shortfall={row.shortfall}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add navigation link**

Find where purchasing navigation links are defined (check sidebar/layout for `/purchasing/` routes) and add a "Material Planning" link pointing to `/purchasing/material-planning`.

- [ ] **Step 3: Run type check and lint**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && bunx tsc --noEmit 2>&1 | tail -20 && bun lint 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/purchasing/material-planning/page.tsx
# Add any nav/sidebar changes
git commit -m "feat: add material planning page at /purchasing/material-planning"
```

---

## Task 13: Order Materials Auto-Calculation

**Files:**
- Modify: `src/hooks/use-material-planning.ts`

- [ ] **Step 1: Add auto-calculation function**

Add a mutation/function to `use-material-planning.ts` that auto-calculates order materials:

```typescript
/**
 * Auto-calculates shipping materials for an order based on:
 * 1. Line item quantities + selling format pallet_quantity
 * 2. Customer pallet configs (layer overrides)
 * 3. Customer shipping materials -> brewery shipping defaults
 */
export function useCalculateOrderMaterials(orderId: string, customerId: string) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // 1. Get order line items with selling format pallet info
      const { data: lineItems, error: liErr } = await supabase
        .from("order_items")
        .select(`
          quantity,
          selling_format_id,
          selling_format:selling_formats(
            id, units_per_layer, pallet_quantity
          )
        `)
        .eq("order_id", orderId);
      if (liErr) throw liErr;

      // 2. Get customer pallet configs (layer overrides)
      const { data: palletConfigs, error: pcErr } = await supabase
        .from("customer_pallet_configs")
        .select("selling_format_id, layers")
        .eq("customer_id", customerId);
      if (pcErr) throw pcErr;

      const configMap = new Map(
        (palletConfigs ?? []).map((c) => [c.selling_format_id, c.layers])
      );

      // 3. Calculate total pallets needed
      let totalPallets = 0;
      for (const li of lineItems ?? []) {
        const sf = (li as Record<string, unknown>).selling_format as {
          id: string;
          units_per_layer: number | null;
          pallet_quantity: number | null;
        } | null;
        if (!sf || !li.quantity) continue;

        // Resolve effective pallet quantity
        const customerLayers = configMap.get(sf.id);
        let effectivePalletQty: number | null;
        if (customerLayers && sf.units_per_layer) {
          effectivePalletQty = customerLayers * sf.units_per_layer;
        } else {
          effectivePalletQty = sf.pallet_quantity;
        }

        if (effectivePalletQty && effectivePalletQty > 0) {
          totalPallets += Math.ceil(li.quantity / effectivePalletQty);
        }
      }

      // 4. Resolve shipping materials (customer -> brewery defaults)
      const { data: customerMats, error: cmErr } = await supabase
        .from("customer_shipping_materials")
        .select("inventory_item_id, material_role")
        .eq("customer_id", customerId);
      if (cmErr) throw cmErr;

      const { data: breweryDefaults, error: bdErr } = await supabase
        .from("brewery_shipping_defaults")
        .select("inventory_item_id, material_role");
      if (bdErr) throw bdErr;

      // Build role -> inventory_item_id map (customer overrides brewery)
      const materialMap = new Map<string, string>();
      for (const bd of breweryDefaults ?? []) {
        materialMap.set(bd.material_role, bd.inventory_item_id);
      }
      for (const cm of customerMats ?? []) {
        materialMap.set(cm.material_role, cm.inventory_item_id);
      }

      // 5. Upsert order_materials
      if (totalPallets > 0 && materialMap.size > 0) {
        const rows = Array.from(materialMap.values()).map((inventoryItemId) => ({
          order_id: orderId,
          inventory_item_id: inventoryItemId,
          estimated_qty: totalPallets,
          actual_qty: totalPallets,
        }));

        const { error: upsertErr } = await supabase
          .from("order_materials")
          .upsert(rows, {
            onConflict: "order_id,inventory_item_id",
          });
        if (upsertErr) throw upsertErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: materialPlanningKeys.orderMaterials(orderId),
      });
    },
  });
}
```

- [ ] **Step 2: Wire auto-calculation into order save flow**

Find where orders are saved/updated (likely in a hook or service). After order line items are saved, call the auto-calculation. This may involve:
- Finding the order save mutation (check `src/hooks/` or the order entity's save flow)
- Adding a call to recalculate shipping materials after line items change

The exact integration point depends on how the order entity handles saves. Check `src/hooks/use-packaging.ts` or similar hooks for the pattern.

- [ ] **Step 3: Run type check and lint**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && bunx tsc --noEmit 2>&1 | tail -20 && bun lint 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-material-planning.ts
# Add any other modified files
git commit -m "feat: add order materials auto-calculation from pallet quantities and customer preferences"
```

---

## Task 14: Selling Format Volume Display Fix

**Files:**
- Varies — search for where selling format volume is displayed

- [ ] **Step 1: Find volume display locations**

Run: `grep -rn "volume_oz\|volume.*unit_count\|384\|total.*volume" src/ --include="*.ts" --include="*.tsx" | grep -i "format\|selling"` to find where selling format volumes are computed or displayed.

Also check: `src/entities/selling-format.tsx`, `src/entities/container.tsx`, views that join selling_formats with containers.

- [ ] **Step 2: Update display to show "16oz x 24" format**

Wherever the rolled-up volume is shown (e.g., `container.volume_oz * selling_format.unit_count`), replace with a display like:

```typescript
`${container.volume_oz}oz x ${sellingFormat.unit_count}`
```

or for kegs:
```typescript
`${container.volume_bbl} BBL`
```

This may involve updating column render functions, view components, or formatting utilities.

- [ ] **Step 3: Run type check and lint**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && bunx tsc --noEmit 2>&1 | tail -20 && bun lint 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add -A  # Add all modified display files
git commit -m "fix: show container volume with unit count (16oz x 24) instead of rolled-up total"
```

---

## Task 15: Documentation Updates

**Files:**
- Modify: `docs/data-model/inventory.md`
- Modify: `docs/data-model/purchasing.md`
- Modify: `docs/data-model/packaging.md`

- [ ] **Step 1: Update inventory data model docs**

Add `selling_format_materials` table documentation to `docs/data-model/inventory.md` following the existing table documentation pattern. Include columns, constraints, and example data.

- [ ] **Step 2: Update purchasing data model docs**

In `docs/data-model/purchasing.md`:
- Update `supplier_catalog` section to document `catalog_type: 'inventory_item'`
- Add `order_materials` table documentation
- Add `brewery_shipping_defaults` table documentation
- Document the `calculate_material_shortfalls` RPC replacing `calculate_ingredient_shortfalls`

- [ ] **Step 3: Update packaging data model docs**

In `docs/data-model/packaging.md` (or `docs/data-model/sales.md` if customer tables live there):
- Add `customer_shipping_materials` table documentation
- Add `customer_pallet_configs` table documentation
- Document pallet layer fields on `selling_formats`

- [ ] **Step 4: Commit**

```bash
git add docs/data-model/
git commit -m "docs: update data model docs for material planning tables and RPCs"
```

---

## Task 16: Final Validation

- [ ] **Step 1: Run full type check**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && bunx tsc --noEmit 2>&1`

Fix any errors.

- [ ] **Step 2: Run lint**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && bun lint 2>&1`

Fix any errors.

- [ ] **Step 3: Start dev server and verify**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && bun dev`

Verify in browser:
1. Selling format detail page shows BOM editor and pallet config fields
2. Can add/remove materials from BOM
3. Packaging session detail shows materials required section
4. Material planning page loads at `/purchasing/material-planning`
5. Filters work (horizon, source, shortfalls only)
6. Customer detail shows shipping preferences and pallet config sections
7. Order detail shows shipping materials section
8. Selling format volume displays as "16oz x 24" not "384oz"

- [ ] **Step 4: Regenerate Supabase types**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/packaging && npx supabase gen types typescript --local > src/types/supabase.ts`

Commit if types changed.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final type fixes and validation for material planning feature"
```
