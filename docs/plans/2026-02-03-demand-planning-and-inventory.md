# Demand Planning & Inventory Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable backward planning from orders to raw materials, supporting TBD products and planned allocations.

**Architecture:**
- Add TBD product support to order items (style hint + notes when brand unknown)
- Add recipe status (draft/spec/complete) for incomplete recipe specs
- Add batch planning fields (target dates calculated from recipe)
- Create entity configs and pages for inventory lots, PO receives, and allocations
- Enhance production planning to show demand → batch → material requirements

**Tech Stack:** Next.js 16, Supabase, React Query, Zod, Universal Entity Components

---

## Phase 1: Schema Changes for TBD & Planning

### Task 1: Add TBD fields to order_items and recipe status

**Files:**
- Create: `supabase/migrations/00067_tbd_planning_fields.sql`

**Step 1: Write the migration**

```sql
-- Add TBD support to order_items
-- When brand_id is NULL, the product is TBD and style_id + tbd_notes provide context

ALTER TABLE order_items
ADD COLUMN style_id UUID REFERENCES beer_styles(id) ON DELETE SET NULL,
ADD COLUMN tbd_notes TEXT;

COMMENT ON COLUMN order_items.style_id IS 'Style hint for TBD products (when brand_id is NULL)';
COMMENT ON COLUMN order_items.tbd_notes IS 'Description for TBD products (e.g., "contract brew for ABC, ~6.5% ABV")';

-- Add index for TBD order items queries
CREATE INDEX idx_order_items_tbd ON order_items(style_id) WHERE brand_id IS NULL;

-- Add recipe status for incomplete specs
-- draft: just started, very incomplete
-- spec: has style + rough targets, enough for planning but not brewing
-- complete: fully specified, ready to brew

ALTER TABLE recipes
ADD COLUMN status TEXT NOT NULL DEFAULT 'complete';

-- Backfill: existing recipes are complete, templates stay as-is
UPDATE recipes SET status = 'complete' WHERE status IS NULL;

-- Add constraint for valid status values
ALTER TABLE recipes
ADD CONSTRAINT chk_recipe_status CHECK (status IN ('draft', 'spec', 'complete'));

COMMENT ON COLUMN recipes.status IS 'Recipe completeness: draft (incomplete), spec (enough for planning), complete (ready to brew)';

-- Add batch planning fields for estimated dates
ALTER TABLE batches
ADD COLUMN target_package_date DATE,
ADD COLUMN estimated_volume_bbl DECIMAL(10,2);

COMMENT ON COLUMN batches.target_package_date IS 'Estimated packaging date, calculated from recipe fermentation/conditioning time';
COMMENT ON COLUMN batches.estimated_volume_bbl IS 'Estimated volume for planning (before actual measurement)';

-- Update schema registry
UPDATE _schema_registry SET
  key_fields = '["order_id", "brand_id", "style_id", "package_type_id", "quantity"]'::jsonb,
  description = 'Order line items. brand_id NULL = TBD product, use style_id + tbd_notes for planning.',
  updated_at = NOW()
WHERE table_name = 'order_items';

UPDATE _schema_registry SET
  key_fields = '["name", "style_id", "status", "is_template", "is_active"]'::jsonb,
  state_machine = '{"stateField": "status", "states": ["draft", "spec", "complete"], "transitions": {"draft": ["spec", "complete"], "spec": ["complete"]}}'::jsonb,
  updated_at = NOW()
WHERE table_name = 'recipes';
```

**Step 2: Apply migration locally**

Run: `bun supabase migration up --local`
Expected: Migration applies successfully

**Step 3: Verify schema changes**

Run: `bun supabase db dump --local --schema public | grep -A5 "order_items\|recipes"`
Expected: New columns visible in schema dump

**Step 4: Commit**

```bash
git add supabase/migrations/00067_tbd_planning_fields.sql
git commit -m "feat(schema): add TBD planning fields to order_items and recipe status"
```

---

### Task 2: Update order_items entity config for TBD support

**Files:**
- Modify: `src/entities/order-item.tsx`

**Step 1: Update the Zod schema**

In `src/entities/order-item.tsx`, update the schema to include new fields:

```typescript
export const orderItemSchema = z.object({
  order_id: z.string().uuid("Order is required"),
  brand_id: z.string().uuid().nullable().optional(),
  package_type_id: z.string().uuid().nullable().optional(),
  batch_id: z.string().uuid().nullable().optional(),
  style_id: z.string().uuid().nullable().optional(),  // NEW
  tbd_notes: z.string().nullable().optional(),         // NEW
  quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
  unit_price: z.coerce.number().nullable().optional(),
  notes: z.string().nullable().optional(),
}).refine(
  (data) => data.brand_id || data.style_id,
  {
    message: "Either Brand or Style (for TBD) is required",
    path: ["brand_id"],
  }
);
```

**Step 2: Update listColumns to show TBD indicator**

Add after brand_id column:

```typescript
{
  accessorKey: "style_id",
  header: "Style (TBD)",
  relation: {
    entity: "beer_style",
    displayField: "name",
  },
  render: (value, row) => {
    if (row.brand_id) return null; // Not TBD
    return value ? (
      <span className="text-muted-foreground italic">TBD: {value}</span>
    ) : null;
  },
},
```

**Step 3: Update formFields to include TBD fields**

Add after brand_id field:

```typescript
{
  name: "style_id",
  label: "Style (for TBD)",
  type: "select",
  colSpan: 6,
  description: "Use when product is TBD - select the style category",
  dynamicOptions: {
    table: "beer_styles",
    valueField: "id",
    labelField: "name",
    orderBy: "category,name",
  },
},
{
  name: "tbd_notes",
  label: "TBD Notes",
  type: "textarea",
  colSpan: 12,
  placeholder: "Contract brew details, target specs, customer requirements...",
  description: "Details about the TBD product for planning purposes",
},
```

**Step 4: Run lint to verify**

Run: `bun lint`
Expected: No new errors

**Step 5: Commit**

```bash
git add src/entities/order-item.tsx
git commit -m "feat(order-item): add TBD support with style_id and tbd_notes fields"
```

---

### Task 3: Update recipe entity config for status field

**Files:**
- Modify: `src/entities/recipe.tsx`
- Modify: `src/lib/schemas/recipe.ts`

**Step 1: Update the Zod schema in `src/lib/schemas/recipe.ts`**

Add the status field:

```typescript
// Add near the top with other field definitions
status: z.enum(["draft", "spec", "complete"]).default("complete"),
```

**Step 2: Update recipe entity config**

In `src/entities/recipe.tsx`, add state machine config:

```typescript
import type { EntityConfig, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";

// After imports, add state machine:
const recipeStateMachine: StateMachineConfig<Recipe> = {
  stateField: "status",
  states: ["draft", "spec", "complete"],
  initialState: "draft",
  transitions: {
    draft: ["spec", "complete"],
    spec: ["complete"],
    complete: [],
  },
  stateDisplay: {
    draft: { label: "Draft", color: "default" },
    spec: { label: "Spec", color: "warning" },
    complete: { label: "Complete", color: "success" },
  },
};

const statusOptions = statesAsOptions(recipeStateMachine);
```

**Step 3: Add status to listColumns**

After `is_template` column:

```typescript
{
  accessorKey: "status",
  header: "Status",
  sortable: true,
  render: (value) => (
    <StatusBadge
      status={value as string}
      config={recipeEntity.stateMachine?.stateDisplay}
    />
  ),
},
```

**Step 4: Add status to formFields**

After `is_template` field:

```typescript
{
  name: "status",
  label: "Recipe Status",
  type: "select",
  options: statusOptions,
  description: "Draft = incomplete, Spec = enough for planning, Complete = ready to brew",
  colSpan: 6,
},
```

**Step 5: Add stateMachine to entity config**

Add to the entity config object:

```typescript
stateMachine: recipeStateMachine,
```

**Step 6: Add status filter to listFilters**

```typescript
{
  field: "status",
  type: "multiselect",
  label: "Status",
  options: statusOptions,
},
```

**Step 7: Run lint to verify**

Run: `bun lint`
Expected: No new errors

**Step 8: Commit**

```bash
git add src/entities/recipe.tsx src/lib/schemas/recipe.ts
git commit -m "feat(recipe): add status field (draft/spec/complete) for planning support"
```

---

## Phase 2: Inventory Lots Entity & Pages

### Task 4: Create inventory-lot entity config

**Files:**
- Create: `src/entities/inventory-lot.tsx`

**Step 1: Create the entity config file**

```typescript
/**
 * Inventory Lot Entity Configuration
 *
 * Inventory lots track raw materials with lot numbers, expiration dates,
 * and FIFO costing. Quantities are derived from allocations.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type InventoryLot = Database["public"]["Tables"]["inventory_lots"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const inventoryLotSchema = z.object({
  inventory_item_id: z.string().uuid("Inventory item is required"),
  po_receive_id: z.string().uuid().nullable().optional(),
  lot_number: z.string().nullable().optional(),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  unit: z.string().min(1, "Unit is required"),
  unit_cost: z.coerce.number().nullable().optional(),
  landed_cost: z.coerce.number().nullable().optional(),
  received_date: z.string().nullable().optional(),
  expiration_date: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type InventoryLotFormValues = z.infer<typeof inventoryLotSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const inventoryLotEntity: EntityConfig<InventoryLot> = {
  name: "inventory_lot",
  table: "inventory_lots",
  viewTable: "inventory_lots_with_quantities",
  displayName: "Inventory Lot",
  displayNamePlural: "Inventory Lots",
  description: "Lot-level inventory tracking for raw materials with FIFO costing",
  domain: "inventory",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "lot_number",
      header: "Lot #",
      sortable: true,
    },
    {
      accessorKey: "inventory_item_id",
      header: "Item",
      relation: {
        entity: "inventory_item",
        displayField: "name",
      },
    },
    {
      accessorKey: "received_quantity",
      header: "Received",
      sortable: true,
    },
    {
      accessorKey: "allocated_quantity",
      header: "Allocated",
      sortable: true,
    },
    {
      accessorKey: "remaining_quantity",
      header: "Remaining",
      sortable: true,
    },
    {
      accessorKey: "unit",
      header: "Unit",
    },
    {
      accessorKey: "expiration_date",
      header: "Expires",
      sortable: true,
      format: "date",
    },
    {
      accessorKey: "received_date",
      header: "Received",
      sortable: true,
      format: "date",
    },
  ],

  listFilters: [
    {
      field: "inventory_item_id",
      type: "select",
      label: "Item",
      dynamicOptions: {
        table: "inventory_items",
        valueField: "id",
        labelField: "name",
        orderBy: "name",
      },
    },
  ],

  defaultSort: { column: "received_date", direction: "desc" },
  searchableFields: ["lot_number", "location", "notes"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "lot_number",
  },

  detailSections: [
    {
      id: "overview",
      title: "Lot Information",
      fields: [
        { field: "lot_number", label: "Lot Number" },
        { field: "inventory_item_id", label: "Inventory Item" },
        { field: "location", label: "Storage Location" },
      ],
    },
    {
      id: "quantities",
      title: "Quantities",
      fields: [
        { field: "quantity", label: "Original Quantity" },
        { field: "received_quantity", label: "Received" },
        { field: "allocated_quantity", label: "Allocated" },
        { field: "remaining_quantity", label: "Remaining" },
        { field: "unit", label: "Unit" },
      ],
    },
    {
      id: "costs",
      title: "Costs",
      fields: [
        { field: "unit_cost", label: "Unit Cost", format: "currency" },
        { field: "landed_cost", label: "Landed Cost", format: "currency" },
      ],
    },
    {
      id: "dates",
      title: "Dates",
      fields: [
        { field: "received_date", label: "Received Date", format: "date" },
        { field: "expiration_date", label: "Expiration Date", format: "date" },
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
  // Form
  // ---------------------------------------------------------------------------
  formSchema: inventoryLotSchema,

  formFields: [
    {
      name: "inventory_item_id",
      label: "Inventory Item",
      type: "relation",
      relation: { entity: "inventory_item", displayField: "name" },
      required: true,
      colSpan: 6,
    },
    {
      name: "lot_number",
      label: "Lot Number",
      type: "text",
      placeholder: "e.g., LOT-2025-001 or supplier lot #",
      colSpan: 6,
    },
    {
      name: "quantity",
      label: "Quantity",
      type: "number",
      required: true,
      colSpan: 4,
    },
    {
      name: "unit",
      label: "Unit",
      type: "select",
      required: true,
      options: [
        { value: "lb", label: "Pounds (lb)" },
        { value: "oz", label: "Ounces (oz)" },
        { value: "kg", label: "Kilograms (kg)" },
        { value: "g", label: "Grams (g)" },
        { value: "each", label: "Each" },
        { value: "gal", label: "Gallons" },
      ],
      colSpan: 4,
    },
    {
      name: "location",
      label: "Storage Location",
      type: "text",
      placeholder: "e.g., Grain Room A",
      colSpan: 4,
    },
    {
      name: "unit_cost",
      label: "Unit Cost",
      type: "number",
      placeholder: "0.00",
      colSpan: 4,
    },
    {
      name: "landed_cost",
      label: "Landed Cost",
      type: "number",
      placeholder: "0.00",
      description: "Total cost including shipping/handling",
      colSpan: 4,
    },
    {
      name: "po_receive_id",
      label: "PO Receive",
      type: "relation",
      relation: { entity: "po_receive", displayField: "id" },
      colSpan: 4,
    },
    {
      name: "received_date",
      label: "Received Date",
      type: "date",
      colSpan: 6,
    },
    {
      name: "expiration_date",
      label: "Expiration Date",
      type: "date",
      colSpan: 6,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Quality notes, storage requirements...",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "inventory_item",
      entity: "inventory_item",
      type: "belongsTo",
      foreignKey: "inventory_item_id",
      showInDetail: true,
    },
    {
      name: "po_receive",
      entity: "po_receive",
      type: "belongsTo",
      foreignKey: "po_receive_id",
      showInDetail: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show lots expiring this month",
    "Get available lots for Cascade hops (FIFO order)",
    "Find lots with remaining quantity",
    "Calculate COGS for batch using FIFO",
  ],

  keyFields: ["lot_number", "inventory_item_id", "quantity", "remaining_quantity", "expiration_date"],
};
```

**Step 2: Register the entity**

In `src/entities/index.ts`, add:

```typescript
export { inventoryLotEntity } from "./inventory-lot";
```

**Step 3: Run lint**

Run: `bun lint`
Expected: No errors

**Step 4: Commit**

```bash
git add src/entities/inventory-lot.tsx src/entities/index.ts
git commit -m "feat(inventory-lot): add entity config for lot-level inventory tracking"
```

---

### Task 5: Create inventory lot pages

**Files:**
- Create: `src/app/(app)/inventory/lots/page.tsx`
- Create: `src/app/(app)/inventory/lots/[id]/page.tsx`
- Create: `src/app/(app)/inventory/lots/new/page.tsx`
- Create: `src/app/(app)/inventory/lots/[id]/edit/page.tsx`

**Step 1: Create list page**

`src/app/(app)/inventory/lots/page.tsx`:

```typescript
import { EntityList } from "@/components/universal/entity-list";
import { inventoryLotEntity } from "@/entities/inventory-lot";

export default function InventoryLotsPage() {
  return <EntityList entity={inventoryLotEntity} />;
}
```

**Step 2: Create detail page**

`src/app/(app)/inventory/lots/[id]/page.tsx`:

```typescript
import { EntityDetail } from "@/components/universal/entity-detail";
import { inventoryLotEntity } from "@/entities/inventory-lot";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function InventoryLotDetailPage({ params }: Props) {
  const { id } = await params;
  return <EntityDetail entity={inventoryLotEntity} id={id} />;
}
```

**Step 3: Create new page**

`src/app/(app)/inventory/lots/new/page.tsx`:

```typescript
import { EntityForm } from "@/components/universal/entity-form";
import { inventoryLotEntity } from "@/entities/inventory-lot";

export default function NewInventoryLotPage() {
  return <EntityForm entity={inventoryLotEntity} />;
}
```

**Step 4: Create edit page**

`src/app/(app)/inventory/lots/[id]/edit/page.tsx`:

```typescript
import { EntityForm } from "@/components/universal/entity-form";
import { inventoryLotEntity } from "@/entities/inventory-lot";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditInventoryLotPage({ params }: Props) {
  const { id } = await params;
  return <EntityForm entity={inventoryLotEntity} id={id} />;
}
```

**Step 5: Run lint**

Run: `bun lint`
Expected: No errors

**Step 6: Commit**

```bash
git add src/app/\(app\)/inventory/lots/
git commit -m "feat(inventory-lots): add CRUD pages for inventory lot management"
```

---

## Phase 3: PO Receives Entity & Pages

### Task 6: Create po-receive entity config

**Files:**
- Create: `src/entities/po-receive.tsx`

**Step 1: Create the entity config file**

```typescript
/**
 * PO Receive Entity Configuration
 *
 * PO receives track partial receipts against purchase order line items.
 * Each receive can create an inventory lot with lot number and expiration.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type POReceive = Database["public"]["Tables"]["po_receives"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const poReceiveSchema = z.object({
  po_line_item_id: z.string().uuid("PO line item is required"),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  lot_number: z.string().nullable().optional(),
  expiration_date: z.string().nullable().optional(),
  received_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type POReceiveFormValues = z.infer<typeof poReceiveSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const poReceiveEntity: EntityConfig<POReceive> = {
  name: "po_receive",
  table: "po_receives",
  displayName: "PO Receive",
  displayNamePlural: "PO Receives",
  description: "Partial receipts against purchase order line items",
  domain: "purchasing",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "po_line_item_id",
      header: "PO Line Item",
    },
    {
      accessorKey: "quantity",
      header: "Qty Received",
      sortable: true,
    },
    {
      accessorKey: "lot_number",
      header: "Lot #",
      sortable: true,
    },
    {
      accessorKey: "received_date",
      header: "Received",
      sortable: true,
      format: "date",
    },
    {
      accessorKey: "expiration_date",
      header: "Expires",
      sortable: true,
      format: "date",
    },
  ],

  defaultSort: { column: "received_date", direction: "desc" },
  searchableFields: ["lot_number", "notes"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "lot_number",
  },

  detailSections: [
    {
      id: "overview",
      title: "Receipt Information",
      fields: [
        { field: "po_line_item_id", label: "PO Line Item" },
        { field: "quantity", label: "Quantity Received" },
        { field: "lot_number", label: "Lot Number" },
        { field: "received_date", label: "Received Date", format: "date" },
        { field: "expiration_date", label: "Expiration Date", format: "date" },
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
  // Form
  // ---------------------------------------------------------------------------
  formSchema: poReceiveSchema,

  formFields: [
    {
      name: "po_line_item_id",
      label: "PO Line Item",
      type: "relation",
      relation: { entity: "po_line_item", displayField: "id" },
      required: true,
      colSpan: 12,
    },
    {
      name: "quantity",
      label: "Quantity Received",
      type: "number",
      required: true,
      colSpan: 4,
    },
    {
      name: "lot_number",
      label: "Lot Number",
      type: "text",
      placeholder: "Supplier's lot number",
      colSpan: 4,
    },
    {
      name: "received_date",
      label: "Received Date",
      type: "date",
      colSpan: 4,
    },
    {
      name: "expiration_date",
      label: "Expiration Date",
      type: "date",
      colSpan: 6,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Quality notes, discrepancies...",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "po_line_item",
      entity: "po_line_item",
      type: "belongsTo",
      foreignKey: "po_line_item_id",
      showInDetail: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show receives for PO-2025-001",
    "Find recent receipts",
    "List receives with expiration dates",
  ],

  keyFields: ["po_line_item_id", "quantity", "lot_number", "received_date"],
};
```

**Step 2: Register the entity**

In `src/entities/index.ts`, add:

```typescript
export { poReceiveEntity } from "./po-receive";
```

**Step 3: Run lint**

Run: `bun lint`
Expected: No errors

**Step 4: Commit**

```bash
git add src/entities/po-receive.tsx src/entities/index.ts
git commit -m "feat(po-receive): add entity config for PO receipt tracking"
```

---

### Task 7: Add PO receives as relation on purchase order detail

**Files:**
- Modify: `src/entities/purchase-order.tsx`
- Modify: `src/entities/po-line-item.tsx`

**Step 1: Add receives relation to po-line-item entity**

In `src/entities/po-line-item.tsx`, add to relations array:

```typescript
{
  name: "receives",
  entity: "po_receive",
  type: "hasMany",
  foreignKey: "po_line_item_id",
  showInDetail: true,
  detailTab: "Receives",
},
```

**Step 2: Add viewTable to show received quantities**

Update po-line-item entity to use the view:

```typescript
viewTable: "po_line_items_with_quantities",
```

**Step 3: Update listColumns to show received/outstanding**

Add after quantity column:

```typescript
{
  accessorKey: "received_quantity",
  header: "Received",
  sortable: true,
},
{
  accessorKey: "outstanding_quantity",
  header: "Outstanding",
  sortable: true,
},
```

**Step 4: Run lint**

Run: `bun lint`
Expected: No errors

**Step 5: Commit**

```bash
git add src/entities/po-line-item.tsx
git commit -m "feat(po-line-item): add receives relation and quantity columns"
```

---

### Task 8: Create receive action on PO detail page

**Files:**
- Create: `src/components/domain/po-receive-dialog.tsx`
- Modify: `src/entities/purchase-order.tsx`

**Step 1: Create the receive dialog component**

`src/components/domain/po-receive-dialog.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { poReceiveSchema, type POReceiveFormValues } from "@/entities/po-receive";
import { entityKeys } from "@/lib/query-keys";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Package } from "lucide-react";

interface POReceiveDialogProps {
  poLineItemId: string;
  itemDescription: string;
  outstandingQty: number;
  unit: string;
  onSuccess?: () => void;
}

export function POReceiveDialog({
  poLineItemId,
  itemDescription,
  outstandingQty,
  unit,
  onSuccess,
}: POReceiveDialogProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const supabase = createClient();

  const form = useForm<POReceiveFormValues>({
    resolver: zodResolver(poReceiveSchema),
    defaultValues: {
      po_line_item_id: poLineItemId,
      quantity: outstandingQty,
      lot_number: "",
      received_date: new Date().toISOString().split("T")[0],
      expiration_date: "",
      notes: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: POReceiveFormValues) => {
      const { error } = await supabase.from("po_receives").insert(values);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Receipt recorded");
      queryClient.invalidateQueries({ queryKey: entityKeys.all("purchase_order") });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("po_line_item") });
      setOpen(false);
      form.reset();
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Package className="h-4 w-4 mr-2" />
          Receive
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receive: {itemDescription}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity ({unit})</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-muted-foreground">
                    Outstanding: {outstandingQty} {unit}
                  </p>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lot_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Lot Number</FormLabel>
                  <FormControl>
                    <Input placeholder="Supplier lot #" {...field} value={field.value || ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="received_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Received Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value || ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="expiration_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Expiration Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value || ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Quality notes, discrepancies..."
                      {...field}
                      value={field.value || ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Recording..." : "Record Receipt"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Run lint**

Run: `bun lint`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/domain/po-receive-dialog.tsx
git commit -m "feat(po-receive): add receipt dialog component"
```

---

## Phase 4: Allocations Entity & Pages

### Task 9: Create allocation entity config

**Files:**
- Create: `src/entities/allocation.tsx`

**Step 1: Create the entity config file**

```typescript
/**
 * Allocation Entity Configuration
 *
 * Allocations track all inventory movements with polymorphic source/destination.
 * - source_type: inventory_lot, batch, finished_good, external
 * - destination_type: batch, finished_good, order, taproom_sale, sample, adjustment, destruction, loss, transfer
 * - status: planned, pending_approval, completed, rejected, cancelled
 */

import { z } from "zod";
import type { EntityConfig, StateMachineConfig, ValueDisplayConfig } from "@/types/entity";
import { statesAsOptions, valuesAsOptions, getValueDisplay } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { StatusBadge } from "@/components/universal/status-badge";

type Allocation = Database["public"]["Tables"]["allocations"]["Row"];

// =============================================================================
// Constants
// =============================================================================

const SOURCE_TYPES = [
  { value: "inventory_lot", label: "Inventory Lot" },
  { value: "batch", label: "Batch" },
  { value: "finished_good", label: "Finished Good" },
  { value: "external", label: "External" },
] as const;

const DESTINATION_TYPES = [
  { value: "batch", label: "Batch" },
  { value: "finished_good", label: "Finished Good" },
  { value: "order", label: "Order" },
  { value: "taproom_sale", label: "Taproom Sale" },
  { value: "sample", label: "Sample" },
  { value: "adjustment", label: "Adjustment" },
  { value: "destruction", label: "Destruction" },
  { value: "loss", label: "Loss" },
  { value: "transfer", label: "Transfer" },
] as const;

const REASON_CODES = [
  { value: "breakage", label: "Breakage" },
  { value: "sample_customer", label: "Customer Sample" },
  { value: "sample_quality", label: "Quality Sample" },
  { value: "contamination", label: "Contamination" },
  { value: "expired", label: "Expired" },
  { value: "spillage", label: "Spillage" },
  { value: "theft", label: "Theft" },
] as const;

// =============================================================================
// Zod Schema
// =============================================================================

export const allocationSchema = z.object({
  source_type: z.enum(["inventory_lot", "batch", "finished_good", "external"]),
  source_id: z.string().uuid().nullable().optional(),
  destination_type: z.enum(["batch", "finished_good", "order", "taproom_sale", "sample", "adjustment", "destruction", "loss", "transfer"]),
  destination_id: z.string().uuid().nullable().optional(),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  volume_bbl: z.coerce.number().nullable().optional(),
  unit_cost: z.coerce.number().nullable().optional(),
  status: z.enum(["planned", "pending_approval", "completed", "rejected", "cancelled"]).default("planned"),
  reason_code: z.string().nullable().optional(),
  lot_number: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  requires_approval: z.boolean().default(false),
});

export type AllocationFormValues = z.infer<typeof allocationSchema>;

// =============================================================================
// State Machine
// =============================================================================

const allocationStateMachine: StateMachineConfig<Allocation> = {
  stateField: "status",
  states: ["planned", "pending_approval", "completed", "rejected", "cancelled"],
  initialState: "planned",
  transitions: {
    planned: ["pending_approval", "completed", "cancelled"],
    pending_approval: ["completed", "rejected"],
    completed: [],
    rejected: [],
    cancelled: [],
  },
  stateDisplay: {
    planned: { label: "Planned", color: "info" },
    pending_approval: { label: "Pending Approval", color: "warning" },
    completed: { label: "Completed", color: "success" },
    rejected: { label: "Rejected", color: "error" },
    cancelled: { label: "Cancelled", color: "default" },
  },
};

const statusOptions = statesAsOptions(allocationStateMachine);

// =============================================================================
// Value Display Configuration
// =============================================================================

const sourceTypeDisplay: ValueDisplayConfig = {
  field: "source_type",
  display: {
    inventory_lot: { label: "Inventory Lot", color: "default" },
    batch: { label: "Batch", color: "info" },
    finished_good: { label: "Finished Good", color: "success" },
    external: { label: "External", color: "warning" },
  },
};

const destinationTypeDisplay: ValueDisplayConfig = {
  field: "destination_type",
  display: {
    batch: { label: "Batch", color: "info" },
    finished_good: { label: "Finished Good", color: "success" },
    order: { label: "Order", color: "info" },
    taproom_sale: { label: "Taproom", color: "default" },
    sample: { label: "Sample", color: "warning" },
    adjustment: { label: "Adjustment", color: "default" },
    destruction: { label: "Destruction", color: "error" },
    loss: { label: "Loss", color: "error" },
    transfer: { label: "Transfer", color: "info" },
  },
};

// =============================================================================
// Entity Configuration
// =============================================================================

export const allocationEntity: EntityConfig<Allocation> = {
  name: "allocation",
  table: "allocations",
  displayName: "Allocation",
  displayNamePlural: "Allocations",
  description: "Inventory movements and reservations",
  domain: "inventory",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "status",
      header: "Status",
      sortable: true,
      render: (value) => (
        <StatusBadge
          status={value as string}
          config={allocationEntity.stateMachine?.stateDisplay}
        />
      ),
    },
    {
      accessorKey: "source_type",
      header: "Source",
      sortable: true,
      render: (value) => {
        const display = getValueDisplay(allocationEntity, "source_type", value as string);
        return display?.label || value;
      },
    },
    {
      accessorKey: "destination_type",
      header: "Destination",
      sortable: true,
      render: (value) => {
        const display = getValueDisplay(allocationEntity, "destination_type", value as string);
        return display?.label || value;
      },
    },
    {
      accessorKey: "quantity",
      header: "Qty",
      sortable: true,
    },
    {
      accessorKey: "created_at",
      header: "Created",
      sortable: true,
      format: "datetime",
    },
  ],

  listFilters: [
    {
      field: "status",
      type: "multiselect",
      label: "Status",
      options: statusOptions,
    },
    {
      field: "source_type",
      type: "multiselect",
      label: "Source Type",
      options: SOURCE_TYPES.map(t => ({ value: t.value, label: t.label })),
    },
    {
      field: "destination_type",
      type: "multiselect",
      label: "Destination Type",
      options: DESTINATION_TYPES.map(t => ({ value: t.value, label: t.label })),
    },
  ],

  defaultSort: { column: "created_at", direction: "desc" },
  searchableFields: ["lot_number", "notes"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "id",
    badge: "status",
  },

  detailSections: [
    {
      id: "overview",
      title: "Allocation Details",
      fields: [
        { field: "status", label: "Status" },
        { field: "source_type", label: "Source Type" },
        { field: "source_id", label: "Source ID" },
        { field: "destination_type", label: "Destination Type" },
        { field: "destination_id", label: "Destination ID" },
      ],
    },
    {
      id: "quantities",
      title: "Quantities",
      fields: [
        { field: "quantity", label: "Quantity" },
        { field: "volume_bbl", label: "Volume (BBL)" },
        { field: "unit_cost", label: "Unit Cost", format: "currency" },
        { field: "lot_number", label: "Lot Number" },
      ],
    },
    {
      id: "reason",
      title: "Reason",
      fields: [
        { field: "reason_code", label: "Reason Code" },
        { field: "notes", label: "Notes", fullWidth: true },
      ],
    },
    {
      id: "approval",
      title: "Approval",
      fields: [
        { field: "requires_approval", label: "Requires Approval" },
        { field: "approved_by", label: "Approved By" },
        { field: "approved_at", label: "Approved At", format: "datetime" },
        { field: "rejection_reason", label: "Rejection Reason" },
      ],
      collapsible: true,
    },
    {
      id: "timestamps",
      title: "Timestamps",
      fields: [
        { field: "created_at", label: "Created", format: "datetime" },
        { field: "completed_at", label: "Completed", format: "datetime" },
        { field: "cancelled_at", label: "Cancelled", format: "datetime" },
      ],
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: allocationSchema,

  formFields: [
    {
      name: "status",
      label: "Status",
      type: "select",
      options: statusOptions,
      colSpan: 4,
    },
    {
      name: "requires_approval",
      label: "Requires Approval",
      type: "switch",
      colSpan: 4,
    },
    {
      name: "source_type",
      label: "Source Type",
      type: "select",
      options: SOURCE_TYPES.map(t => ({ value: t.value, label: t.label })),
      required: true,
      colSpan: 6,
    },
    {
      name: "source_id",
      label: "Source ID",
      type: "text",
      placeholder: "UUID of source record",
      colSpan: 6,
    },
    {
      name: "destination_type",
      label: "Destination Type",
      type: "select",
      options: DESTINATION_TYPES.map(t => ({ value: t.value, label: t.label })),
      required: true,
      colSpan: 6,
    },
    {
      name: "destination_id",
      label: "Destination ID",
      type: "text",
      placeholder: "UUID of destination record",
      colSpan: 6,
    },
    {
      name: "quantity",
      label: "Quantity",
      type: "number",
      required: true,
      colSpan: 4,
    },
    {
      name: "volume_bbl",
      label: "Volume (BBL)",
      type: "number",
      colSpan: 4,
    },
    {
      name: "unit_cost",
      label: "Unit Cost",
      type: "number",
      colSpan: 4,
    },
    {
      name: "lot_number",
      label: "Lot Number",
      type: "text",
      colSpan: 6,
    },
    {
      name: "reason_code",
      label: "Reason Code",
      type: "select",
      options: REASON_CODES.map(r => ({ value: r.value, label: r.label })),
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
  // State Machine
  // ---------------------------------------------------------------------------
  stateMachine: allocationStateMachine,

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "complete",
      label: "Mark Complete",
      icon: "check",
      type: "button",
      fromStates: ["planned"],
      toState: "completed",
    },
    {
      name: "submit_for_approval",
      label: "Submit for Approval",
      icon: "send",
      type: "button",
      fromStates: ["planned"],
      toState: "pending_approval",
    },
    {
      name: "approve",
      label: "Approve",
      icon: "check-circle",
      type: "button",
      fromStates: ["pending_approval"],
      toState: "completed",
    },
    {
      name: "reject",
      label: "Reject",
      icon: "x-circle",
      type: "button",
      variant: "destructive",
      fromStates: ["pending_approval"],
      toState: "rejected",
      confirm: true,
    },
    {
      name: "cancel",
      label: "Cancel",
      icon: "x",
      type: "dropdown",
      variant: "destructive",
      fromStates: ["planned", "pending_approval"],
      toState: "cancelled",
      confirm: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Value Display
  // ---------------------------------------------------------------------------
  valueDisplay: [sourceTypeDisplay, destinationTypeDisplay],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show planned allocations for next week",
    "Get allocations for finished good lot X",
    "Find pending approvals",
    "List destruction allocations this month",
  ],

  keyFields: ["status", "source_type", "destination_type", "quantity"],
};
```

**Step 2: Register the entity**

In `src/entities/index.ts`, add:

```typescript
export { allocationEntity } from "./allocation";
```

**Step 3: Run lint**

Run: `bun lint`
Expected: No errors

**Step 4: Commit**

```bash
git add src/entities/allocation.tsx src/entities/index.ts
git commit -m "feat(allocation): add entity config for inventory movements and reservations"
```

---

### Task 10: Create allocation pages

**Files:**
- Create: `src/app/(app)/inventory/allocations/page.tsx`
- Create: `src/app/(app)/inventory/allocations/[id]/page.tsx`
- Create: `src/app/(app)/inventory/allocations/new/page.tsx`

**Step 1: Create list page**

`src/app/(app)/inventory/allocations/page.tsx`:

```typescript
import { EntityList } from "@/components/universal/entity-list";
import { allocationEntity } from "@/entities/allocation";

export default function AllocationsPage() {
  return <EntityList entity={allocationEntity} />;
}
```

**Step 2: Create detail page**

`src/app/(app)/inventory/allocations/[id]/page.tsx`:

```typescript
import { EntityDetail } from "@/components/universal/entity-detail";
import { allocationEntity } from "@/entities/allocation";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AllocationDetailPage({ params }: Props) {
  const { id } = await params;
  return <EntityDetail entity={allocationEntity} id={id} />;
}
```

**Step 3: Create new page**

`src/app/(app)/inventory/allocations/new/page.tsx`:

```typescript
import { EntityForm } from "@/components/universal/entity-form";
import { allocationEntity } from "@/entities/allocation";

export default function NewAllocationPage() {
  return <EntityForm entity={allocationEntity} />;
}
```

**Step 4: Run lint**

Run: `bun lint`
Expected: No errors

**Step 5: Commit**

```bash
git add src/app/\(app\)/inventory/allocations/
git commit -m "feat(allocations): add list, detail, and new pages"
```

---

## Phase 5: Planning Dashboard Enhancement

### Task 11: Create backward planning view

**Files:**
- Create: `src/app/(app)/production/planning/backward/page.tsx`
- Create: `src/lib/planning/backward-planner.ts`

**Step 1: Create the planning calculation utilities**

`src/lib/planning/backward-planner.ts`:

```typescript
/**
 * Backward Planning Calculator
 *
 * Calculates requirements backward from orders:
 * Orders → Finished Goods → Batches → Raw Materials
 */

import { createClient } from "@/lib/supabase/client";

export interface OrderDemand {
  order_id: string;
  order_number: string;
  customer_name: string | null;
  requested_date: string | null;
  items: OrderItemDemand[];
}

export interface OrderItemDemand {
  order_item_id: string;
  brand_id: string | null;
  brand_name: string | null;
  style_id: string | null;
  style_name: string | null;
  package_type_id: string | null;
  package_type_name: string | null;
  quantity: number;
  is_tbd: boolean;
  tbd_notes: string | null;
  // Fulfillment status
  allocated_quantity: number;
  available_quantity: number;
  shortage: number;
}

export interface ProductionRequirement {
  brand_id: string | null;
  brand_name: string | null;
  style_id: string | null;
  style_name: string | null;
  package_type_id: string | null;
  package_type_name: string | null;
  total_demand: number;
  allocated: number;
  available_fg: number;
  planned_batches: number;
  shortage: number;
  is_tbd: boolean;
  // Estimated dates
  target_package_by: string | null;
  target_brew_by: string | null;
}

export interface MaterialRequirement {
  inventory_item_id: string;
  item_name: string;
  catalog_type: string;
  total_required: number;
  unit: string;
  on_hand: number;
  on_order: number;
  allocated: number;
  shortage: number;
  order_by_date: string | null;
}

/**
 * Get order demand with fulfillment status
 */
export async function getOrderDemand(
  horizonWeeks: number = 8
): Promise<OrderDemand[]> {
  const supabase = createClient();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() + horizonWeeks * 7);

  const { data: orders, error } = await supabase
    .from("orders")
    .select(`
      id,
      order_number,
      requested_date,
      customers(name),
      order_items(
        id,
        brand_id,
        brands(name),
        style_id,
        beer_styles(name),
        package_type_id,
        package_types(name),
        quantity,
        tbd_notes
      )
    `)
    .in("status", ["draft", "confirmed", "scheduled"])
    .or(`requested_date.lte.${cutoffDate.toISOString()},requested_date.is.null`)
    .order("requested_date", { ascending: true });

  if (error) throw error;

  return (orders || []).map((order) => ({
    order_id: order.id,
    order_number: order.order_number,
    customer_name: (order.customers as { name: string } | null)?.name || null,
    requested_date: order.requested_date,
    items: (order.order_items || []).map((item: Record<string, unknown>) => ({
      order_item_id: item.id as string,
      brand_id: item.brand_id as string | null,
      brand_name: (item.brands as { name: string } | null)?.name || null,
      style_id: item.style_id as string | null,
      style_name: (item.beer_styles as { name: string } | null)?.name || null,
      package_type_id: item.package_type_id as string | null,
      package_type_name: (item.package_types as { name: string } | null)?.name || null,
      quantity: item.quantity as number,
      is_tbd: !item.brand_id,
      tbd_notes: item.tbd_notes as string | null,
      allocated_quantity: 0, // TODO: calculate from allocations
      available_quantity: 0, // TODO: calculate from FG
      shortage: item.quantity as number, // TODO: calculate
    })),
  }));
}

/**
 * Aggregate demand into production requirements
 */
export async function getProductionRequirements(
  horizonWeeks: number = 8
): Promise<ProductionRequirement[]> {
  const orders = await getOrderDemand(horizonWeeks);

  // Aggregate by brand + package (or style + package for TBD)
  const requirements = new Map<string, ProductionRequirement>();

  for (const order of orders) {
    for (const item of order.items) {
      const key = item.is_tbd
        ? `tbd-${item.style_id}-${item.package_type_id}`
        : `brand-${item.brand_id}-${item.package_type_id}`;

      const existing = requirements.get(key);
      if (existing) {
        existing.total_demand += item.quantity;
        existing.shortage += item.shortage;
      } else {
        requirements.set(key, {
          brand_id: item.brand_id,
          brand_name: item.brand_name,
          style_id: item.style_id,
          style_name: item.style_name,
          package_type_id: item.package_type_id,
          package_type_name: item.package_type_name,
          total_demand: item.quantity,
          allocated: item.allocated_quantity,
          available_fg: item.available_quantity,
          planned_batches: 0, // TODO: query planned batches
          shortage: item.shortage,
          is_tbd: item.is_tbd,
          target_package_by: order.requested_date,
          target_brew_by: null, // TODO: calculate based on fermentation time
        });
      }
    }
  }

  return Array.from(requirements.values());
}

/**
 * Calculate raw material requirements from production plan
 */
export async function getMaterialRequirements(
  horizonWeeks: number = 8
): Promise<MaterialRequirement[]> {
  // This would query planned batches, get their recipes,
  // and aggregate ingredient requirements
  // For now, return empty - implement after batch planning is connected
  return [];
}
```

**Step 2: Create the backward planning page**

`src/app/(app)/production/planning/backward/page.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { planningKeys } from "@/lib/query-keys";
import {
  getOrderDemand,
  getProductionRequirements,
  type OrderDemand,
  type ProductionRequirement,
} from "@/lib/planning/backward-planner";
import { StatsStrip, DashboardSection, DashboardEmpty } from "@/components/dashboard";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import Link from "next/link";

export default function BackwardPlanningPage() {
  const [horizonWeeks, setHorizonWeeks] = useState(8);

  const { data: orders = [], isLoading: ordersLoading, refetch: refetchOrders } = useQuery({
    queryKey: planningKeys.orderDemand(horizonWeeks),
    queryFn: () => getOrderDemand(horizonWeeks),
  });

  const { data: requirements = [], isLoading: reqLoading, refetch: refetchReqs } = useQuery({
    queryKey: planningKeys.productionRequirements(horizonWeeks),
    queryFn: () => getProductionRequirements(horizonWeeks),
  });

  const isLoading = ordersLoading || reqLoading;

  // Stats
  const totalOrders = orders.length;
  const totalItems = orders.reduce((sum, o) => sum + o.items.length, 0);
  const tbdItems = orders.reduce((sum, o) => sum + o.items.filter(i => i.is_tbd).length, 0);
  const shortages = requirements.filter(r => r.shortage > 0).length;

  const handleRefresh = () => {
    refetchOrders();
    refetchReqs();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">Backward Planning</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        <StatsStrip
          stats={[
            { value: totalOrders, label: "orders" },
            { value: totalItems, label: "line items" },
            { value: tbdItems, label: "TBD items", variant: tbdItems > 0 ? "warning" : "default" },
            { value: shortages, label: "shortages", variant: shortages > 0 ? "error" : "default" },
          ]}
        >
          <Select value={horizonWeeks.toString()} onValueChange={(v) => setHorizonWeeks(parseInt(v))}>
            <SelectTrigger className="h-8 w-[100px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="4">4 weeks</SelectItem>
              <SelectItem value="8">8 weeks</SelectItem>
              <SelectItem value="12">12 weeks</SelectItem>
            </SelectContent>
          </Select>
        </StatsStrip>
      </div>

      {/* Production Requirements */}
      <DashboardSection title="Production Requirements">
        {requirements.length === 0 ? (
          <DashboardEmpty message="No production requirements for the selected horizon" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Package</TableHead>
                <TableHead className="text-right">Demand</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Shortage</TableHead>
                <TableHead>Target Package</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requirements.map((req, idx) => (
                <TableRow key={idx}>
                  <TableCell>
                    {req.is_tbd ? (
                      <span className="text-muted-foreground italic">
                        TBD: {req.style_name || "Unknown style"}
                      </span>
                    ) : (
                      req.brand_name || "Unknown"
                    )}
                  </TableCell>
                  <TableCell>{req.package_type_name || "—"}</TableCell>
                  <TableCell className="text-right">{req.total_demand}</TableCell>
                  <TableCell className="text-right">{req.available_fg}</TableCell>
                  <TableCell className="text-right">
                    {req.shortage > 0 ? (
                      <Badge variant="destructive">{req.shortage}</Badge>
                    ) : (
                      <Badge variant="outline">OK</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {req.target_package_by || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DashboardSection>

      {/* Order Details */}
      <DashboardSection title="Order Details" collapsible defaultOpen={false}>
        {orders.length === 0 ? (
          <DashboardEmpty message="No open orders in the selected horizon" />
        ) : (
          <div className="space-y-4">
            {orders.map((order) => (
              <div key={order.order_id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <Link
                      href={`/sales/orders/${order.order_id}`}
                      className="font-medium hover:underline"
                    >
                      {order.order_number}
                    </Link>
                    {order.customer_name && (
                      <span className="text-muted-foreground ml-2">
                        {order.customer_name}
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {order.requested_date || "No date"}
                  </span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Package</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.items.map((item) => (
                      <TableRow key={item.order_item_id}>
                        <TableCell>
                          {item.is_tbd ? (
                            <Badge variant="outline">TBD: {item.style_name || "?"}</Badge>
                          ) : (
                            item.brand_name || "—"
                          )}
                        </TableCell>
                        <TableCell>{item.package_type_name || "—"}</TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {item.tbd_notes || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </DashboardSection>
    </div>
  );
}
```

**Step 3: Add query keys for planning**

In `src/lib/query-keys.ts`, add:

```typescript
export const planningKeys = {
  all: () => ["planning"] as const,
  orderDemand: (horizonWeeks: number) => [...planningKeys.all(), "orderDemand", horizonWeeks] as const,
  productionRequirements: (horizonWeeks: number) => [...planningKeys.all(), "productionRequirements", horizonWeeks] as const,
  materialRequirements: (horizonWeeks: number) => [...planningKeys.all(), "materialRequirements", horizonWeeks] as const,
};
```

**Step 4: Run lint**

Run: `bun lint`
Expected: No errors

**Step 5: Commit**

```bash
git add src/lib/planning/ src/app/\(app\)/production/planning/backward/ src/lib/query-keys.ts
git commit -m "feat(planning): add backward planning view from orders to production"
```

---

## Phase 6: Navigation Updates

### Task 12: Add new pages to sidebar navigation

**Files:**
- Modify: `src/components/layout/sidebar-nav.tsx` (or equivalent navigation config)

**Step 1: Find and update navigation config**

Search for sidebar navigation and add:

Under Inventory section:
```typescript
{ name: "Lots", href: "/inventory/lots", icon: "package" },
{ name: "Allocations", href: "/inventory/allocations", icon: "git-branch" },
```

Under Production > Planning:
```typescript
{ name: "Backward Planning", href: "/production/planning/backward", icon: "arrow-left" },
```

**Step 2: Run lint**

Run: `bun lint`
Expected: No errors

**Step 3: Verify navigation renders**

Run: `bun dev`
Navigate to sidebar and verify new items appear

**Step 4: Commit**

```bash
git add src/components/layout/
git commit -m "feat(nav): add inventory lots, allocations, and backward planning to sidebar"
```

---

## Phase 7: TypeScript Type Generation

### Task 13: Regenerate Supabase types

**Files:**
- Modify: `src/types/supabase.ts`

**Step 1: Generate types from local database**

Run: `bun supabase gen types typescript --local > src/types/supabase.ts`
Expected: Types regenerated with new columns

**Step 2: Verify types compile**

Run: `bun tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/types/supabase.ts
git commit -m "chore: regenerate supabase types for new schema"
```

---

## Summary

This plan implements:

1. **TBD Product Support** - Order items can have style_id + tbd_notes when brand is unknown
2. **Recipe Status** - Recipes have draft/spec/complete status for planning incomplete specs
3. **Batch Planning Fields** - Target dates for backward planning calculations
4. **Inventory Lots** - Full CRUD for lot-level raw material tracking
5. **PO Receives** - Track partial receipts against PO line items
6. **Allocations** - View and manage inventory reservations and movements
7. **Backward Planning** - Dashboard showing orders → production → material requirements

**Total tasks:** 13
**Estimated commits:** 13

---

**Plan complete and saved to `docs/plans/2026-02-03-demand-planning-and-inventory.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
