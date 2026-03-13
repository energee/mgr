# Data Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the broken order items experience, build inventory-aware ordering, add bin management, location transfers, and delivery grouping.

**Architecture:** Layered implementation — schema first, then fix the immediate 404 bug, then build out entity pages for bins/transfers/deliveries. Each task is independently deployable. All new entities follow the universal EntityConfig pattern. Custom domain components only where the generic pattern doesn't fit (order items editor, FG inventory section).

**Tech Stack:** Next.js 16, Supabase (Postgres), React Query, Zod, Universal Entity Components, shadcn/ui

---

## Phase 1: Schema Migration

### Task 1: Create the schema migration

**Files:**
- Create: `supabase/migrations/00073_data_enhancements.sql`

**Step 1: Write the migration**

Create `supabase/migrations/00073_data_enhancements.sql`:

```sql
-- =============================================================================
-- Data Enhancements: Bins for raw materials, deliveries, transfer improvements
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. bin_inventory_items: Raw material quantities per bin
--    Mirrors bin_inventory (which tracks finished goods) for inventory_lots
-- -----------------------------------------------------------------------------

CREATE TABLE bin_inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_lot_id UUID NOT NULL REFERENCES inventory_lots(id) ON DELETE CASCADE,
  bin_id UUID NOT NULL REFERENCES bins(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(inventory_lot_id, bin_id)
);

COMMENT ON TABLE bin_inventory_items IS 'Tracks raw material (inventory lot) quantities stored in each bin.';

CREATE INDEX idx_bin_inventory_items_lot ON bin_inventory_items(inventory_lot_id);
CREATE INDEX idx_bin_inventory_items_bin ON bin_inventory_items(bin_id);

-- -----------------------------------------------------------------------------
-- 2. deliveries: Groups transfers + orders into delivery runs
-- -----------------------------------------------------------------------------

CREATE TABLE deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_transit', 'completed', 'cancelled')),
  scheduled_date DATE,
  ship_date TIMESTAMPTZ,
  receive_date TIMESTAMPTZ,
  driver_name TEXT,
  vehicle TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE deliveries IS 'Groups location transfers and order fulfillments into a single delivery run.';

CREATE INDEX idx_deliveries_status ON deliveries(status);
CREATE INDEX idx_deliveries_scheduled ON deliveries(scheduled_date);

-- Auto-generate delivery numbers: DEL-YYYYMMDD-NNN
CREATE OR REPLACE FUNCTION generate_delivery_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_date TEXT;
  v_seq INTEGER;
BEGIN
  v_date := TO_CHAR(COALESCE(NEW.scheduled_date, CURRENT_DATE), 'YYYYMMDD');
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(delivery_number FROM 'DEL-' || v_date || '-(\d+)') AS INTEGER)
  ), 0) + 1
  INTO v_seq
  FROM deliveries
  WHERE delivery_number LIKE 'DEL-' || v_date || '-%';

  NEW.delivery_number := 'DEL-' || v_date || '-' || LPAD(v_seq::TEXT, 3, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_delivery_number
  BEFORE INSERT ON deliveries
  FOR EACH ROW
  WHEN (NEW.delivery_number IS NULL OR NEW.delivery_number = '')
  EXECUTE FUNCTION generate_delivery_number();

-- -----------------------------------------------------------------------------
-- 3. Add delivery_id to location_transfers and orders
-- -----------------------------------------------------------------------------

ALTER TABLE location_transfers
ADD COLUMN delivery_id UUID REFERENCES deliveries(id) ON DELETE SET NULL;

CREATE INDEX idx_location_transfers_delivery ON location_transfers(delivery_id);

ALTER TABLE orders
ADD COLUMN delivery_id UUID REFERENCES deliveries(id) ON DELETE SET NULL;

CREATE INDEX idx_orders_delivery ON orders(delivery_id);

-- -----------------------------------------------------------------------------
-- 4. Extend transfer_lines for raw materials
--    Currently finished_good_id is NOT NULL; make it nullable, add inventory_lot_id
-- -----------------------------------------------------------------------------

ALTER TABLE transfer_lines
ALTER COLUMN finished_good_id DROP NOT NULL;

ALTER TABLE transfer_lines
ADD COLUMN inventory_lot_id UUID REFERENCES inventory_lots(id) ON DELETE CASCADE;

ALTER TABLE transfer_lines
ADD CONSTRAINT transfer_lines_item_xor
CHECK (
  (finished_good_id IS NOT NULL AND inventory_lot_id IS NULL) OR
  (finished_good_id IS NULL AND inventory_lot_id IS NOT NULL)
);

CREATE INDEX idx_transfer_lines_lot ON transfer_lines(inventory_lot_id);

-- -----------------------------------------------------------------------------
-- 5. Views
-- -----------------------------------------------------------------------------

-- bin_contents: Union of FG and raw materials per bin
CREATE VIEW bin_contents
WITH (security_invoker = true)
AS
SELECT
  bi.bin_id,
  'finished_good'::TEXT AS item_type,
  fg.id AS item_id,
  b.name AS item_name,
  pt.name AS package_name,
  fg.lot_number,
  bi.quantity,
  fg.production_date AS item_date
FROM bin_inventory bi
JOIN finished_goods fg ON fg.id = bi.finished_good_id
JOIN brands b ON b.id = fg.brand_id
JOIN package_types pt ON pt.id = fg.package_type_id
WHERE bi.quantity > 0

UNION ALL

SELECT
  bii.bin_id,
  'raw_material'::TEXT AS item_type,
  il.id AS item_id,
  ii.name AS item_name,
  NULL AS package_name,
  il.lot_number,
  bii.quantity,
  il.received_date AS item_date
FROM bin_inventory_items bii
JOIN inventory_lots il ON il.id = bii.inventory_lot_id
JOIN inventory_items ii ON ii.id = il.inventory_item_id
WHERE bii.quantity > 0;

COMMENT ON VIEW bin_contents IS 'Unified view of all items (FG and raw materials) stored in bins.';

-- deliveries_with_summary: Delivery with stop counts
CREATE VIEW deliveries_with_summary
WITH (security_invoker = true)
AS
SELECT
  d.*,
  COALESCE(lt_counts.transfer_count, 0) AS transfer_count,
  COALESCE(o_counts.order_count, 0) AS order_count,
  COALESCE(lt_counts.transfer_count, 0) + COALESCE(o_counts.order_count, 0) AS total_stops
FROM deliveries d
LEFT JOIN (
  SELECT delivery_id, COUNT(*) AS transfer_count
  FROM location_transfers
  WHERE delivery_id IS NOT NULL
  GROUP BY delivery_id
) lt_counts ON lt_counts.delivery_id = d.id
LEFT JOIN (
  SELECT delivery_id, COUNT(*) AS order_count
  FROM orders
  WHERE delivery_id IS NOT NULL
  GROUP BY delivery_id
) o_counts ON o_counts.delivery_id = d.id;

COMMENT ON VIEW deliveries_with_summary IS 'Deliveries with counts of associated transfers and orders.';

-- location_transfers view for list display
CREATE VIEW location_transfers_with_details
WITH (security_invoker = true)
AS
SELECT
  lt.*,
  fb.name AS from_bin_name,
  fl.name AS from_location_name,
  tb.name AS to_bin_name,
  tl.name AS to_location_name,
  d.delivery_number,
  (SELECT COUNT(*) FROM transfer_lines tl2 WHERE tl2.transfer_id = lt.id) AS lines_count
FROM location_transfers lt
JOIN bins fb ON fb.id = lt.from_bin_id
JOIN locations fl ON fl.id = fb.location_id
JOIN bins tb ON tb.id = lt.to_bin_id
JOIN locations tl ON tl.id = tb.location_id
LEFT JOIN deliveries d ON d.id = lt.delivery_id;

COMMENT ON VIEW location_transfers_with_details IS 'Location transfers with bin/location names and line counts.';

-- bins_with_summary: Bin with item counts
CREATE VIEW bins_with_summary
WITH (security_invoker = true)
AS
SELECT
  b.*,
  l.name AS location_name,
  l.location_type,
  COALESCE(fg_counts.fg_count, 0) AS fg_item_count,
  COALESCE(rm_counts.rm_count, 0) AS rm_item_count,
  COALESCE(fg_counts.fg_count, 0) + COALESCE(rm_counts.rm_count, 0) AS total_item_count
FROM bins b
JOIN locations l ON l.id = b.location_id
LEFT JOIN (
  SELECT bin_id, COUNT(*) AS fg_count
  FROM bin_inventory
  WHERE quantity > 0
  GROUP BY bin_id
) fg_counts ON fg_counts.bin_id = b.id
LEFT JOIN (
  SELECT bin_id, COUNT(*) AS rm_count
  FROM bin_inventory_items
  WHERE quantity > 0
  GROUP BY bin_id
) rm_counts ON rm_counts.bin_id = b.id;

COMMENT ON VIEW bins_with_summary IS 'Bins with location info and item counts.';

-- -----------------------------------------------------------------------------
-- 6. RLS Policies
-- -----------------------------------------------------------------------------

ALTER TABLE bin_inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY bin_inventory_items_access ON bin_inventory_items
  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY deliveries_access ON deliveries
  FOR ALL USING (auth.uid() IS NOT NULL);

-- -----------------------------------------------------------------------------
-- 7. Schema Registry
-- -----------------------------------------------------------------------------

INSERT INTO _schema_registry (
  table_name, description, domain, relationships, key_fields, state_machine, query_examples
) VALUES
('bin_inventory_items', 'Tracks raw material (inventory lot) quantities stored in each bin.', 'inventory',
 '["belongs_to: inventory_lots", "belongs_to: bins"]',
 '["inventory_lot_id", "bin_id", "quantity"]',
 NULL,
 '["Get raw materials in bin", "Find where lot is stored"]'),

('deliveries', 'Groups location transfers and order fulfillments into a single delivery run.', 'inventory',
 '["has_many: location_transfers", "has_many: orders"]',
 '["delivery_number", "status", "scheduled_date", "driver_name"]',
 '{"stateField": "status", "states": ["planned", "in_transit", "completed", "cancelled"], "transitions": {"planned": ["in_transit", "cancelled"], "in_transit": ["completed", "cancelled"]}}',
 '["List planned deliveries", "Get deliveries for date", "Find in-transit deliveries"]')

ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  state_machine = EXCLUDED.state_machine,
  query_examples = EXCLUDED.query_examples,
  updated_at = NOW();

-- Update transfer_lines registry to include inventory_lot support
UPDATE _schema_registry
SET relationships = '["belongs_to: location_transfers", "belongs_to: finished_goods", "belongs_to: inventory_lots"]',
    key_fields = '["finished_good_id", "inventory_lot_id", "quantity"]',
    updated_at = NOW()
WHERE table_name = 'transfer_lines';

-- Update location_transfers registry to include delivery reference
UPDATE _schema_registry
SET relationships = '["belongs_to: bins (from)", "belongs_to: bins (to)", "has_many: transfer_lines", "belongs_to: deliveries"]',
    key_fields = '["status", "from_bin_id", "to_bin_id", "delivery_id"]',
    updated_at = NOW()
WHERE table_name = 'location_transfers';
```

**Step 2: Apply the migration**

Apply via Supabase MCP `apply_migration` tool with name `data_enhancements`.

**Step 3: Verify**

Run: `SELECT table_name FROM _schema_registry WHERE table_name IN ('bin_inventory_items', 'deliveries') ORDER BY table_name;`
Expected: Both rows returned.

Run: `SELECT * FROM bin_contents LIMIT 0;` and `SELECT * FROM deliveries_with_summary LIMIT 0;`
Expected: No errors (views exist and are queryable).

**Step 4: Commit**

```bash
git add supabase/migrations/00073_data_enhancements.sql
git commit -m "feat: add schema for bin inventory items, deliveries, and transfer enhancements"
```

---

## Phase 2: Fix Order Items Experience

### Task 2: Wire OrderItemsEditor into order detail page

The order detail page currently renders a generic relation tab for "Items" that links to non-existent routes (404). Replace it with the existing `OrderItemsEditor` component.

**Files:**
- Modify: `src/entities/order.tsx` (lines 292-299 — the order_items relation)

**Step 1: Update the order entity config**

In `src/entities/order.tsx`, change the `order_items` relation to not show in detail (since we'll use a custom section instead):

```typescript
// Change this relation (around line 292):
{
  name: "order_items",
  entity: "order_item",
  type: "hasMany",
  foreignKey: "order_id",
  showInDetail: true,    // <-- change to false
  detailTab: "Items",    // <-- remove this line
}
```

To:

```typescript
{
  name: "order_items",
  entity: "order_item",
  type: "hasMany",
  foreignKey: "order_id",
  showInDetail: false,
}
```

Then add a custom section in `detailSections` (after the "quick-links" section, around line 139) that renders the `OrderItemsEditor`:

```typescript
// At the top of the file, add import:
import { OrderItemsEditor } from "@/components/domain/order-items-editor";

// Create wrapper component that extracts props from entity data:
function OrderItemsSection({ data }: { data: Record<string, unknown> }) {
  return (
    <OrderItemsEditor
      orderId={data.id as string}
      customerId={data.customer_id as string | null}
    />
  );
}

// Add to detailSections array (after quick-links):
{
  id: "items",
  title: "Order Items",
  component: OrderItemsSection,
  tab: "Items",
},
```

**Step 2: Verify the fix**

Run: `bun lint`
Expected: No new errors.

Navigate to any order detail page and confirm:
- The "Items" tab renders the inline editor (not a broken "Add" link)
- Existing items display correctly
- Add/edit/delete work as before

**Step 3: Commit**

```bash
git add src/entities/order.tsx
git commit -m "fix: replace broken order items relation tab with inline editor"
```

### Task 3: Add query keys for inventory availability

**Files:**
- Modify: `src/lib/query-keys.ts`

**Step 1: Add new query key factories**

Add these key factories to `src/lib/query-keys.ts`:

```typescript
export const binKeys = {
  all: () => ["bins"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters ? (["bins", "list", filters] as const) : (["bins", "list"] as const),
  detail: (id: string) => ["bins", id] as const,
  contents: (binId: string) => ["bins", binId, "contents"] as const,
};

export const transferKeys = {
  all: () => ["transfers"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters ? (["transfers", "list", filters] as const) : (["transfers", "list"] as const),
  detail: (id: string) => ["transfers", id] as const,
  lines: (transferId: string) => ["transfers", transferId, "lines"] as const,
};

export const deliveryKeys = {
  all: () => ["deliveries"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters ? (["deliveries", "list", filters] as const) : (["deliveries", "list"] as const),
  detail: (id: string) => ["deliveries", id] as const,
  stops: (deliveryId: string) => ["deliveries", deliveryId, "stops"] as const,
};

export const finishedGoodKeys = {
  all: () => ["finished-goods"] as const,
  availability: (brandId: string, packageTypeId: string) =>
    ["finished-goods", "availability", brandId, packageTypeId] as const,
  binInventory: (fgId: string) => ["finished-goods", fgId, "bins"] as const,
  commitments: (fgId: string) => ["finished-goods", fgId, "commitments"] as const,
};
```

**Step 2: Verify**

Run: `bun lint`
Expected: No new errors (unused exports are fine — they'll be used in later tasks).

**Step 3: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat: add query key factories for bins, transfers, deliveries, FG availability"
```

### Task 4: Add inventory awareness to OrderItemsEditor

Enhance the existing `OrderItemsEditor` to show finished goods availability when selecting brand + package.

**Files:**
- Modify: `src/components/domain/order-items-editor.tsx`

**Step 1: Add availability hook**

Add a custom hook inside the file that fetches FG availability for a given brand + package type:

```typescript
import { finishedGoodKeys } from "@/lib/query-keys";

function useAvailability(brandId: string | null, packageTypeId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: finishedGoodKeys.availability(brandId ?? "", packageTypeId ?? ""),
    queryFn: async () => {
      if (!brandId || !packageTypeId) return [];
      const { data, error } = await supabase
        .from("finished_goods_with_availability")
        .select("id, lot_number, production_date, quantity, available_quantity")
        .eq("brand_id", brandId)
        .eq("package_type_id", packageTypeId)
        .gt("available_quantity", 0)
        .order("production_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!brandId && !!packageTypeId,
  });
}
```

**Step 2: Add availability summary hook**

Add a hook that gets total available per brand (for dropdown badges):

```typescript
function useBrandAvailability() {
  const supabase = createClient();
  return useQuery({
    queryKey: ["finished-goods", "brand-availability"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finished_goods_with_availability")
        .select("brand_id, package_type_id, available_quantity")
        .gt("available_quantity", 0);
      if (error) throw error;
      // Aggregate: { brandId: totalAvailable, "brandId:packageTypeId": totalAvailable }
      const byBrand: Record<string, number> = {};
      const byBrandPackage: Record<string, number> = {};
      for (const row of data ?? []) {
        if (row.brand_id) {
          byBrand[row.brand_id] = (byBrand[row.brand_id] ?? 0) + (row.available_quantity ?? 0);
        }
        if (row.brand_id && row.package_type_id) {
          const key = `${row.brand_id}:${row.package_type_id}`;
          byBrandPackage[key] = (byBrandPackage[key] ?? 0) + (row.available_quantity ?? 0);
        }
      }
      return { byBrand, byBrandPackage };
    },
  });
}
```

**Step 3: Update brand dropdown to show availability**

In the brand `<Select>` component, sort brands with stock first and append availability badges:

```typescript
const { data: availability } = useBrandAvailability();

// Sort brands: those with stock first
const sortedBrands = useMemo(() => {
  if (!brands || !availability) return brands ?? [];
  return [...brands].sort((a, b) => {
    const aAvail = availability.byBrand[a.id] ?? 0;
    const bAvail = availability.byBrand[b.id] ?? 0;
    if (aAvail > 0 && bAvail === 0) return -1;
    if (aAvail === 0 && bAvail > 0) return 1;
    return a.name.localeCompare(b.name);
  });
}, [brands, availability]);
```

In the `<SelectItem>` for brands, show availability:

```tsx
<SelectItem key={brand.id} value={brand.id}>
  <span className="flex items-center gap-2">
    {brand.name}
    {availability?.byBrand[brand.id]
      ? <Badge variant="secondary" className="text-xs">{availability.byBrand[brand.id]} avail</Badge>
      : <span className="text-xs text-muted-foreground">no stock</span>
    }
  </span>
</SelectItem>
```

Apply the same pattern to the package type dropdown, using `availability.byBrandPackage[`${selectedBrandId}:${pt.id}`]`.

**Step 4: Add inline FG inventory panel**

After the brand + package dropdowns in the add-item row, show a collapsible panel with matching FGs:

```tsx
function AvailabilityPanel({ brandId, packageTypeId }: { brandId: string | null; packageTypeId: string | null }) {
  const { data: fgItems, isLoading } = useAvailability(brandId, packageTypeId);

  if (!brandId || !packageTypeId) return null;
  if (isLoading) return <div className="text-sm text-muted-foreground p-2"><Loader2 className="h-3 w-3 animate-spin inline mr-1" />Checking inventory...</div>;
  if (!fgItems || fgItems.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-2 border rounded bg-muted/50">
        No inventory — will need production
      </div>
    );
  }

  const totalAvailable = fgItems.reduce((sum, fg) => sum + (fg.available_quantity ?? 0), 0);

  return (
    <div className="text-sm border rounded p-2 space-y-1 bg-muted/30">
      <div className="font-medium">{totalAvailable} available across {fgItems.length} lot{fgItems.length !== 1 ? "s" : ""}</div>
      {fgItems.map((fg) => (
        <div key={fg.id} className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{fg.lot_number} ({fg.production_date})</span>
          <span>{fg.available_quantity} avail</span>
        </div>
      ))}
    </div>
  );
}
```

Render `<AvailabilityPanel>` below the add-item row when brand and package are selected.

**Step 5: Add quantity warning**

In the add-item row and inline edit, after the quantity input, check if quantity exceeds total available:

```tsx
{totalAvailable !== undefined && quantity > totalAvailable && (
  <div className="text-xs text-orange-500 mt-1">
    Exceeds available ({totalAvailable}). Will need production.
  </div>
)}
```

**Step 6: Verify**

Run: `bun lint`
Expected: No new errors.

Navigate to an order, add an item:
- Brand dropdown shows availability badges
- Package dropdown shows availability badges
- Selecting both shows the FG inventory panel
- Entering qty > available shows orange warning

**Step 7: Commit**

```bash
git add src/components/domain/order-items-editor.tsx
git commit -m "feat: add inventory awareness to order items editor"
```

---

## Phase 3: Bin Entity Pages

### Task 5: Create bin entity config

**Files:**
- Create: `src/entities/bin.tsx`
- Modify: `src/entities/index.ts`

**Step 1: Create the entity config**

Create `src/entities/bin.tsx`:

```typescript
/**
 * Bin Entity Configuration
 *
 * Storage bins within locations. Tracks physical storage of both
 * finished goods and raw materials.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";

// =============================================================================
// Types
// =============================================================================

interface BinView {
  id: string;
  location_id: string;
  name: string;
  bin_type: string;
  capacity: number | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  location_name: string;
  location_type: string;
  fg_item_count: number;
  rm_item_count: number;
  total_item_count: number;
}

// =============================================================================
// Constants
// =============================================================================

const BIN_TYPES = [
  "storage",
  "cold_room",
  "staging",
  "taproom",
  "shipping",
  "hold",
  "quarantine",
] as const;

const binTypeDisplay: Record<string, { label: string }> = {
  storage: { label: "Storage" },
  cold_room: { label: "Cold Room" },
  staging: { label: "Staging" },
  taproom: { label: "Taproom" },
  shipping: { label: "Shipping" },
  hold: { label: "Hold" },
  quarantine: { label: "Quarantine" },
};

// =============================================================================
// Zod Schema
// =============================================================================

export const binSchema = z.object({
  name: z.string().min(1, "Bin name is required"),
  location_id: z.string().uuid("Location is required"),
  bin_type: z.enum(BIN_TYPES, { required_error: "Bin type is required" }),
  capacity: z.coerce.number().int().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
});

export type BinFormValues = z.infer<typeof binSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const binEntity: EntityConfig<BinView> = {
  name: "bin",
  table: "bins",
  viewTable: "bins_with_summary",
  displayName: "Bin",
  displayNamePlural: "Bins",
  description: "Storage bins within locations for finished goods and raw materials",
  domain: "inventory",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    { accessorKey: "name", header: "Bin Name", sortable: true },
    { accessorKey: "location_name", header: "Location", sortable: true },
    {
      accessorKey: "bin_type",
      header: "Type",
      sortable: true,
      cell: (value: unknown) => binTypeDisplay[value as string]?.label ?? String(value),
    },
    { accessorKey: "capacity", header: "Capacity", sortable: true },
    { accessorKey: "total_item_count", header: "Items", sortable: true },
  ],

  listFilters: [
    {
      field: "bin_type",
      label: "Type",
      options: BIN_TYPES.map((t) => ({
        value: t,
        label: binTypeDisplay[t].label,
      })),
    },
    {
      field: "is_active",
      label: "Status",
      options: [
        { value: "true", label: "Active" },
        { value: "false", label: "Inactive" },
      ],
    },
  ],

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name", "location_name"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "name",
    subtitle: "location_name",
    badge: "bin_type",
  },

  detailSections: [
    {
      id: "overview",
      title: "Bin Details",
      fields: [
        { field: "name", label: "Name" },
        { field: "location_id", label: "Location" },
        { field: "bin_type", label: "Type" },
        { field: "capacity", label: "Capacity" },
        { field: "is_active", label: "Active" },
      ],
    },
    {
      id: "summary",
      title: "Contents Summary",
      fields: [
        { field: "fg_item_count", label: "Finished Goods" },
        { field: "rm_item_count", label: "Raw Materials" },
        { field: "total_item_count", label: "Total Items" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: binSchema,

  formFields: [
    {
      name: "name",
      label: "Bin Name",
      type: "text",
      required: true,
      placeholder: "e.g. BRW-CR-01",
      colSpan: 6,
    },
    {
      name: "location_id",
      label: "Location",
      type: "relation",
      required: true,
      colSpan: 6,
      relation: {
        entity: "location",
        displayField: "name",
      },
    },
    {
      name: "bin_type",
      label: "Bin Type",
      type: "select",
      required: true,
      colSpan: 6,
      options: BIN_TYPES.map((t) => ({
        value: t,
        label: binTypeDisplay[t].label,
      })),
    },
    {
      name: "capacity",
      label: "Capacity",
      type: "number",
      colSpan: 6,
      description: "Maximum units or cases this bin can hold",
    },
    {
      name: "is_active",
      label: "Active",
      type: "switch",
      colSpan: 6,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "location",
      entity: "location",
      type: "belongsTo",
      foreignKey: "location_id",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "List all cold room bins",
    "Show bins at the warehouse",
    "Find bins with available capacity",
    "What bins are in quarantine?",
  ],

  keyFields: ["name", "bin_type", "location_id", "capacity"],
};
```

**Step 2: Register the entity**

In `src/entities/index.ts`, add:

```typescript
// Add import (with inventory domain imports):
import { binEntity } from "./bin";

// Add registration (in Inventory domain section):
registerEntity(binEntity);

// Add re-exports:
export { binEntity } from "./bin";
export type { BinFormValues } from "./bin";
```

**Step 3: Verify**

Run: `bun lint`
Expected: No new errors.

**Step 4: Commit**

```bash
git add src/entities/bin.tsx src/entities/index.ts
git commit -m "feat: add bin entity config"
```

### Task 6: Create bin pages and add to navigation

**Files:**
- Create: `src/app/(app)/inventory/bins/page.tsx`
- Create: `src/app/(app)/inventory/bins/new/page.tsx`
- Create: `src/app/(app)/inventory/bins/[id]/page.tsx`
- Create: `src/app/(app)/inventory/bins/[id]/edit/page.tsx`
- Modify: `src/components/domain/app-sidebar.tsx`

**Step 1: Create list page**

Create `src/app/(app)/inventory/bins/page.tsx`:

```typescript
"use client";

import { EntityList } from "@/components/universal/entity-list";
import { binEntity } from "@/entities/bin";

export default function BinsPage() {
  return <EntityList entity={binEntity} basePath="/inventory/bins" />;
}
```

**Step 2: Create new page**

Create `src/app/(app)/inventory/bins/new/page.tsx`:

```typescript
"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { binEntity } from "@/entities/bin";

export default function NewBinPage() {
  return <EntityForm entity={binEntity} basePath="/inventory/bins" />;
}
```

**Step 3: Create detail page**

Create `src/app/(app)/inventory/bins/[id]/page.tsx`:

```typescript
"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { binEntity } from "@/entities/bin";

export default function BinDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={binEntity} id={id} basePath="/inventory/bins" />;
}
```

**Step 4: Create edit page**

Create `src/app/(app)/inventory/bins/[id]/edit/page.tsx`:

```typescript
"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { binEntity } from "@/entities/bin";

export default function EditBinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={binEntity} id={id} basePath="/inventory/bins" />;
}
```

**Step 5: Add bins to sidebar navigation**

In `src/components/domain/app-sidebar.tsx`, add to the Inventory section (around line 108-113):

```typescript
// Add after "Allocations" item:
{ label: "Bins", href: "/inventory/bins", icon: AnimatedWarehouse },
```

**Step 6: Verify**

Run: `bun lint`
Expected: No new errors.

**Step 7: Commit**

```bash
git add src/app/\(app\)/inventory/bins/ src/components/domain/app-sidebar.tsx
git commit -m "feat: add bin pages and sidebar navigation"
```

---

## Phase 4: Finished Good Inventory Section

### Task 7: Create FG inventory section domain component

**Files:**
- Create: `src/components/domain/fg-inventory-section.tsx`
- Modify: `src/entities/finished-good.tsx`

**Step 1: Create the component**

Create `src/components/domain/fg-inventory-section.tsx`:

```typescript
"use client";

/**
 * Finished Good Inventory Section
 *
 * Shows inventory stats, bin breakdown, and commitments for a finished good.
 * Used as a custom section on the FG detail page.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { finishedGoodKeys } from "@/lib/query-keys";
import Link from "next/link";

interface FGInventorySectionProps {
  data: Record<string, unknown>;
}

export function FGInventorySection({ data }: FGInventorySectionProps) {
  const fgId = data.id as string;
  const totalQty = (data.quantity as number) ?? 0;
  const allocatedQty = (data.allocated_quantity as number) ?? 0;
  const availableQty = (data.available_quantity as number) ?? 0;

  const supabase = createClient();

  // Fetch bin breakdown
  const { data: binRows, isLoading: binsLoading } = useQuery({
    queryKey: finishedGoodKeys.binInventory(fgId),
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("bin_inventory")
        .select("quantity, bin_id, bins(name, location_id, locations(name))")
        .eq("finished_good_id", fgId)
        .gt("quantity", 0)
        .order("quantity", { ascending: false });
      if (error) throw error;
      return rows;
    },
  });

  // Fetch commitments (allocations to orders)
  const { data: commitments, isLoading: commitmentsLoading } = useQuery({
    queryKey: finishedGoodKeys.commitments(fgId),
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("allocations")
        .select("id, quantity, status, destination_id, destination_type")
        .eq("source_type", "finished_good")
        .eq("source_id", fgId)
        .in("destination_type", ["order"])
        .in("status", ["planned", "completed"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return rows;
    },
  });

  return (
    <div className="space-y-4">
      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-sm text-muted-foreground">Total</div>
            <div className="text-2xl font-semibold">{totalQty}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-sm text-muted-foreground">Allocated</div>
            <div className="text-2xl font-semibold">{allocatedQty}</div>
          </CardContent>
        </Card>
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-4 pb-4">
            <div className="text-sm text-muted-foreground">Available</div>
            <div className="text-2xl font-bold text-primary">{availableQty}</div>
          </CardContent>
        </Card>
      </div>

      {/* Bin Breakdown */}
      <div>
        <h4 className="text-sm font-medium mb-2">Location Breakdown</h4>
        {binsLoading ? (
          <div className="text-sm text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin inline mr-1" />Loading...</div>
        ) : !binRows || binRows.length === 0 ? (
          <div className="text-sm text-muted-foreground">Not assigned to any bins</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Location</TableHead>
                <TableHead>Bin</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {binRows.map((row: Record<string, unknown>) => {
                const bin = row.bins as Record<string, unknown> | null;
                const location = bin?.locations as Record<string, unknown> | null;
                return (
                  <TableRow key={row.bin_id as string}>
                    <TableCell>{(location?.name as string) ?? "—"}</TableCell>
                    <TableCell>
                      <Link
                        href={`/inventory/bins/${row.bin_id}`}
                        className="text-primary hover:underline"
                      >
                        {(bin?.name as string) ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">{row.quantity as number}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Commitments */}
      <div>
        <h4 className="text-sm font-medium mb-2">Commitments</h4>
        {commitmentsLoading ? (
          <div className="text-sm text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin inline mr-1" />Loading...</div>
        ) : !commitments || commitments.length === 0 ? (
          <div className="text-sm text-muted-foreground">No commitments</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Destination</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commitments.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/sales/orders/${row.destination_id}`}
                      className="text-primary hover:underline"
                    >
                      Order
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">{row.quantity}</TableCell>
                  <TableCell>
                    <Badge variant={row.status === "completed" ? "default" : "secondary"}>
                      {row.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Wire into finished-good entity config**

In `src/entities/finished-good.tsx`:

1. Add import at top:
```typescript
import { FGInventorySection } from "@/components/domain/fg-inventory-section";
```

2. Replace the existing "inventory" section (lines 114-123) with the custom component:

```typescript
{
  id: "inventory",
  title: "Inventory",
  component: FGInventorySection,
},
```

**Step 3: Verify**

Run: `bun lint`
Expected: No new errors.

Navigate to a finished good detail page. Confirm:
- Stat cards show total/allocated/available
- Bin breakdown table renders (may be empty if no bin_inventory data)
- Commitments table renders

**Step 4: Commit**

```bash
git add src/components/domain/fg-inventory-section.tsx src/entities/finished-good.tsx
git commit -m "feat: add inventory section to finished good detail page"
```

---

## Phase 5: Location Transfer Pages

### Task 8: Create location transfer entity config

**Files:**
- Create: `src/entities/location-transfer.tsx`
- Modify: `src/entities/index.ts`

**Step 1: Create the entity config**

Create `src/entities/location-transfer.tsx`:

```typescript
/**
 * Location Transfer Entity Configuration
 *
 * Tracks physical movement of finished goods and raw materials between bins.
 * Supports state machine: planned → in_transit → completed (or cancelled).
 */

import { z } from "zod";
import type { EntityConfig, StateMachineConfig } from "@/types/entity";

// =============================================================================
// Types
// =============================================================================

interface LocationTransferView {
  id: string;
  from_bin_id: string;
  to_bin_id: string;
  status: string;
  ship_date: string | null;
  receive_date: string | null;
  shipped_by: string | null;
  received_by: string | null;
  delivery_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  from_bin_name: string;
  from_location_name: string;
  to_bin_name: string;
  to_location_name: string;
  delivery_number: string | null;
  lines_count: number;
}

// =============================================================================
// State Machine
// =============================================================================

const transferStates = ["planned", "in_transit", "completed", "cancelled"] as const;

const transferTransitions: Record<string, string[]> = {
  planned: ["in_transit", "cancelled"],
  in_transit: ["completed", "cancelled"],
};

const transferStateMachine: StateMachineConfig<LocationTransferView> = {
  stateField: "status",
  states: [...transferStates],
  initialState: "planned",
  transitions: transferTransitions,
  stateDisplay: {
    planned: { label: "Planned", color: "default" },
    in_transit: { label: "In Transit", color: "info" },
    completed: { label: "Completed", color: "success" },
    cancelled: { label: "Cancelled", color: "error" },
  },
};

// =============================================================================
// Zod Schema
// =============================================================================

export const locationTransferSchema = z.object({
  from_bin_id: z.string().uuid("Source bin is required"),
  to_bin_id: z.string().uuid("Destination bin is required"),
  notes: z.string().nullable().optional(),
}).refine(
  (data) => data.from_bin_id !== data.to_bin_id,
  {
    message: "Cannot transfer to the same bin",
    path: ["to_bin_id"],
  }
);

export type LocationTransferFormValues = z.infer<typeof locationTransferSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const locationTransferEntity: EntityConfig<LocationTransferView> = {
  name: "location_transfer",
  table: "location_transfers",
  viewTable: "location_transfers_with_details",
  displayName: "Transfer",
  displayNamePlural: "Transfers",
  description: "Physical movement of goods between storage bins",
  domain: "inventory",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "from_location_name",
      header: "From",
      sortable: true,
      cell: (value: unknown, row: Record<string, unknown>) =>
        `${value} / ${row.from_bin_name}`,
    },
    {
      accessorKey: "to_location_name",
      header: "To",
      sortable: true,
      cell: (value: unknown, row: Record<string, unknown>) =>
        `${value} / ${row.to_bin_name}`,
    },
    { accessorKey: "lines_count", header: "Items", sortable: true },
    { accessorKey: "status", header: "Status", sortable: true },
    { accessorKey: "ship_date", header: "Ship Date", sortable: true },
    { accessorKey: "delivery_number", header: "Delivery", sortable: true },
  ],

  listFilters: [
    {
      field: "status",
      label: "Status",
      options: transferStates.map((s) => ({
        value: s,
        label: transferStateMachine.stateDisplay?.[s]?.label ?? s,
      })),
    },
  ],

  defaultSort: { column: "created_at", direction: "desc" },
  searchableFields: ["from_bin_name", "to_bin_name", "from_location_name", "to_location_name"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "from_bin_name",
    subtitle: "to_bin_name",
    badge: "status",
  },

  detailSections: [
    {
      id: "overview",
      title: "Transfer Details",
      fields: [
        { field: "from_bin_id", label: "From Bin" },
        { field: "to_bin_id", label: "To Bin" },
        { field: "status", label: "Status" },
        { field: "delivery_number", label: "Delivery" },
      ],
    },
    {
      id: "shipping",
      title: "Shipping",
      fields: [
        { field: "ship_date", label: "Ship Date", format: "date" },
        { field: "shipped_by", label: "Shipped By" },
        { field: "receive_date", label: "Receive Date", format: "date" },
        { field: "received_by", label: "Received By" },
      ],
    },
    {
      id: "notes",
      title: "Notes",
      fields: [
        { field: "notes", label: "Notes", fullWidth: true },
      ],
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------
  stateMachine: transferStateMachine,

  actions: [
    {
      name: "ship",
      label: "Ship",
      icon: "truck",
      type: "button",
      fromStates: ["planned"],
      toState: "in_transit",
    },
    {
      name: "receive",
      label: "Receive",
      icon: "check",
      type: "button",
      fromStates: ["in_transit"],
      toState: "completed",
    },
    {
      name: "cancel",
      label: "Cancel",
      icon: "x",
      type: "button",
      fromStates: ["planned", "in_transit"],
      toState: "cancelled",
      variant: "destructive",
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: locationTransferSchema,

  formFields: [
    {
      name: "from_bin_id",
      label: "From Bin",
      type: "relation",
      required: true,
      colSpan: 6,
      relation: {
        entity: "bin",
        displayField: "name",
      },
    },
    {
      name: "to_bin_id",
      label: "To Bin",
      type: "relation",
      required: true,
      colSpan: 6,
      relation: {
        entity: "bin",
        displayField: "name",
      },
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "delivery",
      entity: "delivery",
      type: "belongsTo",
      foreignKey: "delivery_id",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show planned transfers",
    "List in-transit transfers",
    "Get transfers for a specific bin",
    "Find completed transfers this week",
  ],

  keyFields: ["from_bin_id", "to_bin_id", "status", "delivery_id"],
};
```

**Step 2: Register in entity registry**

In `src/entities/index.ts`:

```typescript
import { locationTransferEntity } from "./location-transfer";

// In Inventory domain section:
registerEntity(locationTransferEntity);

// In exports:
export { locationTransferEntity } from "./location-transfer";
export type { LocationTransferFormValues } from "./location-transfer";
```

**Step 3: Verify**

Run: `bun lint`

**Step 4: Commit**

```bash
git add src/entities/location-transfer.tsx src/entities/index.ts
git commit -m "feat: add location transfer entity config"
```

### Task 9: Create location transfer pages and add to navigation

**Files:**
- Create: `src/app/(app)/inventory/transfers/page.tsx`
- Create: `src/app/(app)/inventory/transfers/new/page.tsx`
- Create: `src/app/(app)/inventory/transfers/[id]/page.tsx`
- Modify: `src/components/domain/app-sidebar.tsx`

**Step 1: Create list page**

Create `src/app/(app)/inventory/transfers/page.tsx`:

```typescript
"use client";

import { EntityList } from "@/components/universal/entity-list";
import { locationTransferEntity } from "@/entities/location-transfer";

export default function TransfersPage() {
  return (
    <EntityList
      entity={locationTransferEntity}
      basePath="/inventory/transfers"
    />
  );
}
```

**Step 2: Create new page**

Create `src/app/(app)/inventory/transfers/new/page.tsx`:

```typescript
"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { locationTransferEntity } from "@/entities/location-transfer";

export default function NewTransferPage() {
  return (
    <EntityForm
      entity={locationTransferEntity}
      basePath="/inventory/transfers"
    />
  );
}
```

**Step 3: Create detail page**

Create `src/app/(app)/inventory/transfers/[id]/page.tsx`:

```typescript
"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { locationTransferEntity } from "@/entities/location-transfer";

export default function TransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetail
      entity={locationTransferEntity}
      id={id}
      basePath="/inventory/transfers"
    />
  );
}
```

**Step 4: Add transfers to sidebar**

In `src/components/domain/app-sidebar.tsx`, in the Inventory section after the Bins entry:

```typescript
{ label: "Transfers", href: "/inventory/transfers", icon: AnimatedArrowRightLeft },
```

**Step 5: Verify**

Run: `bun lint`

**Step 6: Commit**

```bash
git add src/app/\(app\)/inventory/transfers/ src/components/domain/app-sidebar.tsx
git commit -m "feat: add location transfer pages and sidebar navigation"
```

---

## Phase 6: Deliveries

### Task 10: Create delivery entity config

**Files:**
- Create: `src/entities/delivery.tsx`
- Modify: `src/entities/index.ts`

**Step 1: Create the entity config**

Create `src/entities/delivery.tsx`:

```typescript
/**
 * Delivery Entity Configuration
 *
 * Groups location transfers and order fulfillments into a single delivery run.
 * A truck might restock the taproom and deliver orders on the same trip.
 */

import { z } from "zod";
import type { EntityConfig, StateMachineConfig } from "@/types/entity";

// =============================================================================
// Types
// =============================================================================

interface DeliveryView {
  id: string;
  delivery_number: string;
  status: string;
  scheduled_date: string | null;
  ship_date: string | null;
  receive_date: string | null;
  driver_name: string | null;
  vehicle: string | null;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  transfer_count: number;
  order_count: number;
  total_stops: number;
}

// =============================================================================
// State Machine
// =============================================================================

const deliveryStates = ["planned", "in_transit", "completed", "cancelled"] as const;

const deliveryTransitions: Record<string, string[]> = {
  planned: ["in_transit", "cancelled"],
  in_transit: ["completed", "cancelled"],
};

const deliveryStateMachine: StateMachineConfig<DeliveryView> = {
  stateField: "status",
  states: [...deliveryStates],
  initialState: "planned",
  transitions: deliveryTransitions,
  stateDisplay: {
    planned: { label: "Planned", color: "default" },
    in_transit: { label: "In Transit", color: "info" },
    completed: { label: "Completed", color: "success" },
    cancelled: { label: "Cancelled", color: "error" },
  },
};

// =============================================================================
// Zod Schema
// =============================================================================

export const deliverySchema = z.object({
  scheduled_date: z.string().nullable().optional(),
  driver_name: z.string().nullable().optional(),
  vehicle: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type DeliveryFormValues = z.infer<typeof deliverySchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const deliveryEntity: EntityConfig<DeliveryView> = {
  name: "delivery",
  table: "deliveries",
  viewTable: "deliveries_with_summary",
  displayName: "Delivery",
  displayNamePlural: "Deliveries",
  description: "Groups transfers and order fulfillments into delivery runs",
  domain: "inventory",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    { accessorKey: "delivery_number", header: "Delivery #", sortable: true },
    { accessorKey: "scheduled_date", header: "Scheduled", sortable: true },
    { accessorKey: "driver_name", header: "Driver", sortable: true },
    { accessorKey: "total_stops", header: "Stops", sortable: true },
    { accessorKey: "status", header: "Status", sortable: true },
  ],

  listFilters: [
    {
      field: "status",
      label: "Status",
      options: deliveryStates.map((s) => ({
        value: s,
        label: deliveryStateMachine.stateDisplay?.[s]?.label ?? s,
      })),
    },
  ],

  defaultSort: { column: "scheduled_date", direction: "desc" },
  searchableFields: ["delivery_number", "driver_name", "vehicle"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "delivery_number",
    badge: "status",
  },

  detailSections: [
    {
      id: "overview",
      title: "Delivery Details",
      fields: [
        { field: "delivery_number", label: "Delivery #" },
        { field: "status", label: "Status" },
        { field: "scheduled_date", label: "Scheduled Date", format: "date" },
        { field: "driver_name", label: "Driver" },
        { field: "vehicle", label: "Vehicle" },
      ],
    },
    {
      id: "shipping",
      title: "Shipping",
      fields: [
        { field: "ship_date", label: "Shipped", format: "datetime" },
        { field: "receive_date", label: "Received", format: "datetime" },
      ],
    },
    {
      id: "summary",
      title: "Stops Summary",
      fields: [
        { field: "transfer_count", label: "Transfers" },
        { field: "order_count", label: "Orders" },
        { field: "total_stops", label: "Total Stops" },
      ],
    },
    {
      id: "notes",
      title: "Notes",
      fields: [
        { field: "notes", label: "Notes", fullWidth: true },
      ],
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------
  stateMachine: deliveryStateMachine,

  actions: [
    {
      name: "ship",
      label: "Ship",
      icon: "truck",
      type: "button",
      fromStates: ["planned"],
      toState: "in_transit",
    },
    {
      name: "complete",
      label: "Complete",
      icon: "check",
      type: "button",
      fromStates: ["in_transit"],
      toState: "completed",
    },
    {
      name: "cancel",
      label: "Cancel",
      icon: "x",
      type: "button",
      fromStates: ["planned", "in_transit"],
      toState: "cancelled",
      variant: "destructive",
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: deliverySchema,

  formFields: [
    {
      name: "scheduled_date",
      label: "Scheduled Date",
      type: "date",
      colSpan: 6,
    },
    {
      name: "driver_name",
      label: "Driver",
      type: "text",
      colSpan: 6,
    },
    {
      name: "vehicle",
      label: "Vehicle",
      type: "text",
      colSpan: 6,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "transfers",
      entity: "location_transfer",
      type: "hasMany",
      foreignKey: "delivery_id",
      showInDetail: true,
      detailTab: "Transfers",
    },
    {
      name: "orders",
      entity: "order",
      type: "hasMany",
      foreignKey: "delivery_id",
      showInDetail: true,
      detailTab: "Orders",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show planned deliveries",
    "List deliveries for this week",
    "Find deliveries by driver",
    "Show in-transit deliveries",
  ],

  keyFields: ["delivery_number", "status", "scheduled_date", "driver_name"],
};
```

**Step 2: Register in entity registry**

In `src/entities/index.ts`:

```typescript
import { deliveryEntity } from "./delivery";

// In Inventory domain section:
registerEntity(deliveryEntity);

// In exports:
export { deliveryEntity } from "./delivery";
export type { DeliveryFormValues } from "./delivery";
```

**Step 3: Verify**

Run: `bun lint`

**Step 4: Commit**

```bash
git add src/entities/delivery.tsx src/entities/index.ts
git commit -m "feat: add delivery entity config"
```

### Task 11: Create delivery pages and add to navigation

**Files:**
- Create: `src/app/(app)/inventory/deliveries/page.tsx`
- Create: `src/app/(app)/inventory/deliveries/new/page.tsx`
- Create: `src/app/(app)/inventory/deliveries/[id]/page.tsx`
- Modify: `src/components/domain/app-sidebar.tsx`

**Step 1: Create list page**

Create `src/app/(app)/inventory/deliveries/page.tsx`:

```typescript
"use client";

import { EntityList } from "@/components/universal/entity-list";
import { deliveryEntity } from "@/entities/delivery";

export default function DeliveriesPage() {
  return (
    <EntityList
      entity={deliveryEntity}
      basePath="/inventory/deliveries"
    />
  );
}
```

**Step 2: Create new page**

Create `src/app/(app)/inventory/deliveries/new/page.tsx`:

```typescript
"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { deliveryEntity } from "@/entities/delivery";

export default function NewDeliveryPage() {
  return (
    <EntityForm
      entity={deliveryEntity}
      basePath="/inventory/deliveries"
    />
  );
}
```

**Step 3: Create detail page**

Create `src/app/(app)/inventory/deliveries/[id]/page.tsx`:

```typescript
"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { deliveryEntity } from "@/entities/delivery";

export default function DeliveryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetail
      entity={deliveryEntity}
      id={id}
      basePath="/inventory/deliveries"
    />
  );
}
```

**Step 4: Add deliveries to sidebar**

In `src/components/domain/app-sidebar.tsx`, in the Inventory section after the Transfers entry:

```typescript
{ label: "Deliveries", href: "/inventory/deliveries", icon: AnimatedTruck },
```

**Step 5: Add delivery relation to order entity**

In `src/entities/order.tsx`, add a `belongsTo` relation for delivery:

```typescript
// In the relations array:
{
  name: "delivery",
  entity: "delivery",
  type: "belongsTo",
  foreignKey: "delivery_id",
  showInDetail: true,
},
```

**Step 6: Verify**

Run: `bun lint`

**Step 7: Commit**

```bash
git add src/app/\(app\)/inventory/deliveries/ src/components/domain/app-sidebar.tsx src/entities/order.tsx
git commit -m "feat: add delivery pages, sidebar nav, and order-delivery relation"
```

---

## Phase 7: Generate Types and Final Verification

### Task 12: Generate TypeScript types and final lint

**Step 1: Generate types**

After the migration is applied, regenerate Supabase TypeScript types:

```bash
bun supabase gen types typescript --project-id <project-id> > src/types/supabase.ts
```

Or use the Supabase MCP `generate_typescript_types` tool.

**Step 2: Fix any type errors**

Review entity configs that reference view types. Update type definitions if the generated types don't match (e.g., `BinView`, `LocationTransferView`, `DeliveryView` interfaces may need adjustment to match actual generated types).

**Step 3: Full lint check**

Run: `bun lint`
Fix any errors introduced by new code.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: regenerate types and fix lint"
```

### Task 13: Run security advisors

After all migrations are applied, run the Supabase security advisor to check for issues:

Use `get_advisors` MCP tool with type "security".

Review any warnings about:
- Missing RLS policies on new tables
- Views without security_invoker
- Functions without search_path

Fix any issues found.

**Commit if fixes needed:**

```bash
git add -A
git commit -m "fix: address security advisor recommendations"
```
