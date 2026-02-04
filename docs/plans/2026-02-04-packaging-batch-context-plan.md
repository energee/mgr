# Packaging Session Batch Context Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add interactive batch selection to the packaging session line items editor, populating the existing `source_batches` JSONB field.

**Architecture:** No schema changes. Add a batch dropdown to `session-line-items-editor.tsx` that queries batches by brand (via recipe), writes to `source_batches`. Add query key factory. Update read-only display.

**Tech Stack:** React, Supabase client, React Query, shadcn/ui Select

---

### Task 1: Add query key factory for packaging batches

**Files:**
- Modify: `src/lib/query-keys.ts`

**Step 1: Add packagingKeys factory**

Add to `query-keys.ts` after `sessionLineItemKeys`:

```typescript
// =============================================================================
// Packaging Keys
// =============================================================================

export const packagingKeys = {
  batchesForBrand: (brandId: string) =>
    ["packaging", "batches-for-brand", brandId] as const,
};
```

**Step 2: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat: add packagingKeys query key factory"
```

---

### Task 2: Add batch selection to session line items editor

**Files:**
- Modify: `src/components/domain/session-line-items-editor.tsx`

**Context:**
- Reference: `src/components/domain/order-items-editor.tsx` for pattern (availability hooks, inline dropdowns)
- Reference: `src/entities/batch.tsx` for batch state machine display config
- The editor currently has columns: Brand, Package Type, Planned Qty, Actual Qty
- Add a Batch column between Brand and Package Type
- The `source_batches` JSONB field format: `[{batch_id: uuid, planned_qty: int|null, actual_qty: int|null}]`

**Step 1: Add useBatchesForBrand hook**

Inside the editor file, add a hook that fetches batches for a given brand:

```typescript
import { packagingKeys } from "@/lib/query-keys";
import { Badge } from "@/components/ui/badge";

interface BatchOption {
  id: string;
  batch_number: string;
  name: string;
  status: string;
  volume_bbl: number | null;
  current_vessel_name: string | null;
}

// Status priority for sorting (lower = shown first)
const STATUS_SORT_ORDER: Record<string, number> = {
  conditioning: 1,
  packaging: 2,
  fermenting: 3,
  planned: 4,
};

// Status display config matching batch entity state machine
const BATCH_STATUS_COLORS: Record<string, string> = {
  planned: "bg-gray-100 text-gray-700",
  fermenting: "bg-blue-100 text-blue-700",
  conditioning: "bg-blue-100 text-blue-700",
  packaging: "bg-yellow-100 text-yellow-700",
};

function useBatchesForBrand(brandId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: packagingKeys.batchesForBrand(brandId ?? ""),
    queryFn: async () => {
      if (!brandId) return [];
      // Query batches through recipe -> brand relationship
      const { data, error } = await supabase
        .from("batches_with_brew_info")
        .select("id, batch_number, name, status, volume_bbl, current_vessel_name, recipe_id")
        .in("status", ["planned", "fermenting", "conditioning", "packaging"]);
      if (error) throw error;

      // Now filter by brand - need to check recipe.brand_id
      // Fetch recipes for these batches to get brand
      const recipeIds = [...new Set((data ?? []).map((b) => b.recipe_id).filter(Boolean))];
      if (recipeIds.length === 0) return [];

      const { data: recipes, error: recipeError } = await supabase
        .from("recipes")
        .select("id, brand_id")
        .in("id", recipeIds)
        .eq("brand_id", brandId);
      if (recipeError) throw recipeError;

      const validRecipeIds = new Set((recipes ?? []).map((r) => r.id));
      const filtered = (data ?? [])
        .filter((b) => b.recipe_id && validRecipeIds.has(b.recipe_id))
        .sort((a, b) => {
          const aOrder = STATUS_SORT_ORDER[a.status] ?? 99;
          const bOrder = STATUS_SORT_ORDER[b.status] ?? 99;
          return aOrder - bOrder;
        });

      return filtered as BatchOption[];
    },
    enabled: !!brandId,
  });
}
```

**Step 2: Update NewItemState and SessionLineItemRow types**

```typescript
interface SessionLineItemRow {
  id: string;
  brand_id: string;
  brand_name: string;
  package_type_id: string;
  package_type_name: string;
  planned_quantity: number | null;
  actual_quantity: number | null;
  source_batches: Array<{ batch_id: string; planned_qty: number | null; actual_qty: number | null }>;
}

interface NewItemState {
  brand_id: string;
  package_type_id: string;
  planned_quantity: number | null;
  actual_quantity: number | null;
  batch_id: string;  // NEW: selected batch
}
```

**Step 3: Update the fetch query to include source_batches**

In the items query, add `source_batches` to the select:

```typescript
.select("*, brands(name), package_types(name)")
```

becomes:

```typescript
.select("id, brand_id, package_type_id, planned_quantity, actual_quantity, source_batches, created_at, brands(name), package_types(name)")
```

And map `source_batches` into the row:

```typescript
source_batches: item.source_batches ?? [],
```

**Step 4: Update the addItem mutation to include source_batches**

When inserting a new line item, if a batch is selected, write source_batches:

```typescript
mutationFn: async (item: NewItemState) => {
  const sourceBatches = item.batch_id
    ? [{ batch_id: item.batch_id, planned_qty: item.planned_quantity, actual_qty: item.actual_quantity }]
    : [];
  const { error } = await supabase.from("session_line_items").insert({
    session_id: sessionId,
    brand_id: item.brand_id,
    package_type_id: item.package_type_id,
    planned_quantity: item.planned_quantity,
    actual_quantity: item.actual_quantity,
    source_batches: sourceBatches,
  });
  if (error) throw error;
},
```

**Step 5: Add batch dropdown to the table**

Add a new `<TableHead>Batch</TableHead>` column after Brand. For existing rows (read-only display of batch), show the batch number if source_batches has an entry. For the add-new row, show a Select dropdown populated by `useBatchesForBrand(newItem.brand_id)`.

For existing rows in edit mode, also add a batch Select that:
- Uses `useBatchesForBrand(item.brand_id)` for options
- Shows current batch from `item.source_batches[0]?.batch_id`
- On change, calls `updateItem.mutate({ id: item.id, field: "source_batches", value: [{batch_id: newValue, planned_qty: item.planned_quantity, actual_qty: item.actual_quantity}] })`

Each batch option renders:
```tsx
<SelectItem key={batch.id} value={batch.id}>
  <span className="flex items-center gap-2">
    {batch.batch_number}
    <Badge variant="outline" className={`text-xs ${BATCH_STATUS_COLORS[batch.status] ?? ""}`}>
      {batch.status}
    </Badge>
    {batch.volume_bbl && (
      <span className="text-xs text-muted-foreground">{batch.volume_bbl} bbl</span>
    )}
  </span>
</SelectItem>
```

**Step 6: Reset batch when brand changes**

When brand changes on the new item row, reset `batch_id` to `""`:

```typescript
onValueChange={(value) => setNewItem({ ...newItem, brand_id: value, batch_id: "" })}
```

For existing items, when brand changes, also clear source_batches:
```typescript
onValueChange={(value) => {
  updateItem.mutate({ id: item.id, field: "brand_id", value });
  updateItem.mutate({ id: item.id, field: "source_batches", value: [] });
}}
```

**Step 7: Commit**

```bash
git add src/components/domain/session-line-items-editor.tsx
git commit -m "feat: add batch selection to packaging session line items"
```

---

### Task 3: Update read-only display to show batch info

**Files:**
- Modify: `src/components/domain/session-line-items-editor.tsx` (read-only path)

**Context:**
- When `readOnly=true`, existing items show static text for brand/package
- Need to also show the batch for each line item if source_batches is populated

**Step 1: Add batch name resolution**

For read-only items, fetch batch info for all items that have source_batches:

```typescript
// Collect all batch IDs from line items
const batchIds = useMemo(() => {
  if (!items) return [];
  return items
    .map((item) => item.source_batches?.[0]?.batch_id)
    .filter(Boolean) as string[];
}, [items]);

// Fetch batch details for display
const { data: batchMap } = useQuery({
  queryKey: ["batches", "by-ids", batchIds],
  queryFn: async () => {
    if (batchIds.length === 0) return {};
    const { data, error } = await supabase
      .from("batches")
      .select("id, batch_number, name")
      .in("id", batchIds);
    if (error) throw error;
    const map: Record<string, { batch_number: string; name: string }> = {};
    for (const b of data ?? []) {
      map[b.id] = { batch_number: b.batch_number, name: b.name };
    }
    return map;
  },
  enabled: batchIds.length > 0,
});
```

**Step 2: Display batch in read-only mode**

In the Batch column for read-only rows:
```tsx
<TableCell>
  {item.source_batches?.[0]?.batch_id
    ? batchMap?.[item.source_batches[0].batch_id]?.batch_number ?? "—"
    : "—"}
</TableCell>
```

**Step 3: Commit**

```bash
git add src/components/domain/session-line-items-editor.tsx
git commit -m "feat: show batch info in read-only packaging line items"
```

---

### Task 4: Lint, test, and verify

**Step 1: Run lint**

```bash
pnpm lint
```

Fix any errors introduced by the changes.

**Step 2: Verify in browser**

Navigate to a packaging session detail page and verify:
- Batch dropdown appears in line items editor
- Selecting a brand populates batch options
- Batch options show status badges and volume
- Saving a line item with a batch persists source_batches
- Read-only view shows batch number for completed sessions

**Step 3: Final commit if lint fixes needed**

```bash
git add -A
git commit -m "fix: lint fixes for packaging batch context"
```
