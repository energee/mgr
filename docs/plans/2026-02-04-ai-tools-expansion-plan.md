# AI Tools Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand the AI chat assistant from 15 read-only tools to ~26 tools, adding data retrieval for orders/customers/brands and navigation-based write tools for batch operations.

**Architecture:** Write tools return `NavigationIntent` objects that the chat panel renders as action cards. Clicking navigates to existing forms/dialogs with pre-filled data via a zustand prefill store. All mutation logic stays in existing forms. See `docs/plans/2026-02-04-ai-tools-expansion-design.md` for the full design.

**Tech Stack:** Vercel AI SDK `tool()`, zustand, Next.js App Router, Supabase queries

**Key docs:**
- Design: `docs/plans/2026-02-04-ai-tools-expansion-design.md`
- Current tools: `src/app/api/chat/tools.ts`
- Chat panel: `src/components/domain/chat-panel.tsx`
- Batch entity: `src/entities/batch.tsx`
- Batch detail page: `src/app/(app)/production/batches/[id]/page.tsx`
- Batch readings page: `src/app/(app)/production/batches/[id]/readings/page.tsx`
- Entity form: `src/components/universal/entity-form.tsx`
- Query keys: `src/lib/query-keys.ts`

**Important context:**
- Tool results are currently hidden in chat (rendered as `null` when `state === "result"`)
- `transfer_to_brite`, `start_packaging`, `complete` are simple state transitions — no dialog, just a status update via EntityDetail dropdown
- `start_fermentation` and `cancel`/`archive` have full dialog flows
- Readings are on a separate page (`/production/batches/[id]/readings`) with `BatchReadingForm`, not a dialog
- There is NO existing transfer dialog or batch note dialog — `recordBatchTransfer` and `addBatchNote` are deferred to a future plan
- The keg transaction page (`src/app/(app)/inventory/kegs/transactions/new/page.tsx`) shows the existing `useSearchParams` prefill pattern
- No tests exist for chat tools; existing test files are in `src/lib/__tests__/` and `src/lib/ai/__tests__/`

---

### Task 1: Install zustand and create prefill store

**Files:**
- Create: `src/stores/prefill-store.ts`

**Step 1: Install zustand**

Run: `bun add zustand`
Expected: Package added to dependencies

**Step 2: Create the prefill store**

```typescript
// src/stores/prefill-store.ts
import { create } from "zustand";

export interface NavigationIntent {
  action: "navigate";
  url: string;
  prefillData?: Record<string, unknown>;
  openDialog?: string;
  description: string;
}

interface PrefillStore {
  prefillData: Record<string, unknown> | null;
  openDialog: string | null;
  setPrefill: (data: Record<string, unknown>, dialog?: string | null) => void;
  consume: () => {
    prefillData: Record<string, unknown> | null;
    openDialog: string | null;
  };
}

export const usePrefillStore = create<PrefillStore>((set, get) => ({
  prefillData: null,
  openDialog: null,

  setPrefill: (data, dialog) =>
    set({ prefillData: data, openDialog: dialog ?? null }),

  consume: () => {
    const { prefillData, openDialog } = get();
    set({ prefillData: null, openDialog: null });
    return { prefillData, openDialog };
  },
}));
```

**Step 3: Verify build**

Run: `bun lint`
Expected: No new errors

**Step 4: Commit**

```
feat: add zustand prefill store for AI navigation intents
```

---

### Task 2: Add NavigationIntent rendering to chat panel

**Files:**
- Modify: `src/components/domain/chat-panel.tsx`

**Context:** Currently, tool results are hidden in the chat panel (`part.type` checks skip tool results). We need to detect NavigationIntent results and render them as clickable action cards.

The chat panel renders message parts around lines 89-148. Tool result parts currently render as `null` when `state === "result"` and "Looking up data..." when in-progress.

**Step 1: Add imports and hook**

At the top of `chat-panel.tsx`, add:
```typescript
import { useRouter } from "next/navigation";
import { usePrefillStore, type NavigationIntent } from "@/stores/prefill-store";
import { ExternalLink } from "lucide-react";
```

Inside the `ChatPanel` component, add:
```typescript
const router = useRouter();
const setPrefill = usePrefillStore((s) => s.setPrefill);
```

**Step 2: Add NavigationIntent detection helper**

Add a helper function inside the component (or above it):
```typescript
function isNavigationIntent(result: unknown): result is NavigationIntent {
  return (
    typeof result === "object" &&
    result !== null &&
    "action" in result &&
    (result as Record<string, unknown>).action === "navigate"
  );
}
```

**Step 3: Add NavigationIntent card rendering**

In the message parts mapping, find where tool-result parts are handled. Replace the `null` return for tool results with a check:

```typescript
// For tool-result parts, check for NavigationIntent
if (isNavigationIntent(part.result)) {
  const intent = part.result;
  return (
    <div
      key={`${message.id}-${i}`}
      className="rounded-lg border bg-muted/50 p-3 text-sm"
    >
      <p className="mb-2 text-foreground">{intent.description}</p>
      <Button
        size="sm"
        variant="default"
        onClick={() => {
          if (intent.prefillData || intent.openDialog) {
            setPrefill(intent.prefillData ?? {}, intent.openDialog);
          }
          router.push(intent.url);
          close(); // Close the chat panel
        }}
      >
        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
        Open Form
      </Button>
    </div>
  );
}
// Otherwise, continue to return null for non-navigation tool results
```

Note: The exact location depends on how parts are iterated. Read the current file to find the tool-result rendering. The `close` function comes from the chat context.

**Step 4: Verify build**

Run: `bun lint`
Expected: No new errors

**Step 5: Commit**

```
feat: render NavigationIntent action cards in chat panel
```

---

### Task 3: Add batch form prefill consumption

**Files:**
- Modify: `src/app/(app)/production/batches/new/page.tsx`

**Context:** The batch new page currently renders `<EntityForm entity={batchEntity} basePath="/production/batches" />` with no `defaultValues`. We need to consume prefill data from the store.

The keg transaction page (`src/app/(app)/inventory/kegs/transactions/new/page.tsx`) shows the existing pattern using `useSearchParams`. We'll use the prefill store instead.

**Step 1: Add prefill consumption to batch new page**

```typescript
"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { batchEntity } from "@/entities/batch";
import { usePrefillStore } from "@/stores/prefill-store";
import { useRef } from "react";

export default function NewBatchPage() {
  // Consume prefill data once on mount
  const consumed = useRef(false);
  const consume = usePrefillStore((s) => s.consume);

  const defaultValues = (() => {
    if (consumed.current) return undefined;
    consumed.current = true;
    const { prefillData } = consume();
    return prefillData ?? undefined;
  })();

  return (
    <EntityForm
      entity={batchEntity}
      basePath="/production/batches"
      defaultValues={defaultValues}
    />
  );
}
```

**Step 2: Verify build**

Run: `bun lint`
Expected: No new errors

**Step 3: Commit**

```
feat: consume prefill store data in batch creation form
```

---

### Task 4: Add dialog auto-open to batch detail page

**Files:**
- Modify: `src/app/(app)/production/batches/[id]/page.tsx`

**Context:** The batch detail page manages `showStartFermentation`, `showCancellation`, and `showBlend` state. We need to consume `openDialog` from the prefill store on mount to auto-open the right dialog.

**Step 1: Add prefill store import and consumption**

Add imports:
```typescript
import { useEffect, useRef } from "react"; // add useRef to existing import
import { usePrefillStore } from "@/stores/prefill-store";
```

Inside the component, add after the existing state declarations:
```typescript
const consumed = useRef(false);
const consume = usePrefillStore((s) => s.consume);

useEffect(() => {
  if (consumed.current) return;
  consumed.current = true;
  const { openDialog } = consume();
  if (!openDialog) return;

  if (openDialog === "start_fermentation") {
    setShowStartFermentation(true);
  } else if (openDialog === "cancel" || openDialog === "archive") {
    setShowCancellation(true);
  } else if (openDialog === "blend") {
    setShowBlend(true);
  }
}, [consume]);
```

**Step 2: Verify build**

Run: `bun lint`
Expected: No new errors

**Step 3: Commit**

```
feat: auto-open batch dialogs from AI prefill store
```

---

### Task 5: Add reading page auto-show form

**Files:**
- Modify: `src/app/(app)/production/batches/[id]/readings/page.tsx`

**Context:** The readings page has a `showForm` state that controls whether `BatchReadingForm` is visible. We need to auto-show it when navigated from AI with prefill data. The readings page toggles `showForm` with a "+" button.

**Step 1: Add prefill store consumption**

Add imports:
```typescript
import { useRef } from "react"; // add to existing import
import { usePrefillStore } from "@/stores/prefill-store";
```

Inside the component, add after existing state:
```typescript
const consumed = useRef(false);
const consume = usePrefillStore((s) => s.consume);

useEffect(() => {
  if (consumed.current) return;
  consumed.current = true;
  const { prefillData } = consume();
  if (prefillData) {
    setShowForm(true);
    // Store prefill data for the form
    setPrefillValues(prefillData);
  }
}, [consume]);

const [prefillValues, setPrefillValues] = useState<Record<string, unknown> | null>(null);
```

Then pass `prefillValues` to `BatchReadingForm` if it accepts default values. If it doesn't, this is a stretch — check the current `BatchReadingForm` props. If it doesn't support defaults, the simplest approach is to just auto-show the form:

```typescript
// Simplified: just auto-show the form
useEffect(() => {
  if (consumed.current) return;
  consumed.current = true;
  const { prefillData } = consume();
  if (prefillData) {
    setShowForm(true);
  }
}, [consume]);
```

**Step 2: Verify build**

Run: `bun lint`
Expected: No new errors

**Step 3: Commit**

```
feat: auto-show reading form when navigated from AI
```

---

### Task 6: Add new read tools — batch lookup and search

**Files:**
- Modify: `src/app/api/chat/tools.ts`

**Context:** Add `getBatchDetail` (lookup by UUID or batch number) and `searchBatches` (filter by status, recipe, dates). These use `batches_with_brew_info` view. Reference existing tool patterns in the file.

**Step 1: Add getBatchDetail tool**

After the existing `getBatchLogs` tool, add:

```typescript
getBatchDetail: tool({
  description:
    "Get full details for a specific batch by UUID or batch number. Returns batch info, recipe name, current vessel, brew dates, and status.",
  inputSchema: z.object({
    batchId: z.string().uuid().optional().describe("The batch UUID"),
    batchNumber: z
      .string()
      .optional()
      .describe("The batch number (e.g. '42' or 'B-042')"),
  }),
  execute: async ({ batchId, batchNumber }) => {
    let query = supabase
      .from("batches_with_brew_info")
      .select(
        "id, batch_number, name, status, volume_bbl, planned_start_date, actual_og, actual_fg, actual_abv, brew_date, current_vessel_name, notes, recipe:recipes(id, name)"
      );
    if (batchId) {
      query = query.eq("id", batchId);
    } else if (batchNumber) {
      query = query.ilike("batch_number", `%${escapeLike(batchNumber)}%`);
    } else {
      throw new Error("Either batchId or batchNumber is required");
    }
    const { data, error } = batchId
      ? await query.single()
      : await query.limit(5);
    if (error) throw new Error(error.message);
    return data;
  },
}),
```

**Step 2: Add searchBatches tool**

```typescript
searchBatches: tool({
  description:
    "Search and filter batches by status, recipe name, date range, or batch number. Returns matching batches with recipe and vessel info.",
  inputSchema: z.object({
    status: z
      .string()
      .optional()
      .describe(
        "Filter by status: planned, fermenting, conditioning, packaging, completed, cancelled, archived"
      ),
    recipeName: z
      .string()
      .optional()
      .describe("Filter by recipe name (partial match)"),
    startDate: z.string().optional().describe("Start of date range (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("End of date range (YYYY-MM-DD)"),
    batchNumber: z.string().optional().describe("Filter by batch number (partial match)"),
    limit: z.number().optional().default(20).describe("Max results"),
  }),
  execute: async ({ status, recipeName, startDate, endDate, batchNumber, limit }) => {
    let query = supabase
      .from("batches_with_brew_info")
      .select(
        "id, batch_number, name, status, volume_bbl, planned_start_date, brew_date, current_vessel_name, recipe:recipes(id, name)"
      )
      .order("planned_start_date", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);
    if (batchNumber)
      query = query.ilike("batch_number", `%${escapeLike(batchNumber)}%`);
    if (startDate) query = query.gte("planned_start_date", startDate);
    if (endDate) query = query.lte("planned_start_date", endDate);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    // If recipeName filter, do client-side filtering (recipe is a joined object)
    if (recipeName && data) {
      const lower = recipeName.toLowerCase();
      return data.filter(
        (b: Record<string, unknown>) => {
          const recipe = b.recipe as { name: string } | null;
          return recipe?.name?.toLowerCase().includes(lower);
        }
      );
    }
    return data;
  },
}),
```

**Step 3: Verify build**

Run: `bun lint`
Expected: No new errors

**Step 4: Commit**

```
feat: add getBatchDetail and searchBatches AI chat tools
```

---

### Task 7: Add new read tools — orders and customers

**Files:**
- Modify: `src/app/api/chat/tools.ts`

**Context:** Add `searchOrders`, `getOrderDetail`, and `getCustomers`. Orders use the `orders` table with joins. Customers use `customers_with_order_summary` view.

**Step 1: Add searchOrders tool**

```typescript
searchOrders: tool({
  description:
    "Search orders by status, customer name, or date range. Returns order headers with customer info.",
  inputSchema: z.object({
    status: z
      .string()
      .optional()
      .describe(
        "Filter by status: draft, confirmed, scheduled, picking, packed, fulfilled, cancelled"
      ),
    customerName: z
      .string()
      .optional()
      .describe("Filter by customer name (partial match)"),
    startDate: z.string().optional().describe("Order date start (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Order date end (YYYY-MM-DD)"),
    limit: z.number().optional().default(20).describe("Max results"),
  }),
  execute: async ({ status, customerName, startDate, endDate, limit }) => {
    let query = supabase
      .from("orders")
      .select(
        "id, order_number, status, order_date, requested_date, scheduled_date, notes, customer:customers(id, name)"
      )
      .order("order_date", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);
    if (startDate) query = query.gte("order_date", startDate);
    if (endDate) query = query.lte("order_date", endDate);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    if (customerName && data) {
      const lower = customerName.toLowerCase();
      return data.filter(
        (o: Record<string, unknown>) => {
          const customer = o.customer as { name: string } | null;
          return customer?.name?.toLowerCase().includes(lower);
        }
      );
    }
    return data;
  },
}),
```

**Step 2: Add getOrderDetail tool**

```typescript
getOrderDetail: tool({
  description:
    "Get full details for an order including line items with brand, package type, quantity, and price.",
  inputSchema: z.object({
    orderId: z.string().uuid().describe("The order UUID"),
  }),
  execute: async ({ orderId }) => {
    const { data, error } = await supabase
      .from("orders")
      .select(
        `id, order_number, status, order_date, requested_date, scheduled_date, fulfilled_date, shipping_address, notes,
         customer:customers(id, name, customer_type, email, phone),
         items:order_items(id, quantity, unit_price, notes, brand:brands(id, name), package_type:package_types(id, name, volume_oz), batch:batches(id, batch_number))`
      )
      .eq("id", orderId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
}),
```

**Step 3: Add getCustomers tool**

```typescript
getCustomers: tool({
  description:
    "Search customers by name. Returns customer info with order statistics.",
  inputSchema: z.object({
    query: z.string().optional().describe("Search by customer name"),
    limit: z.number().optional().default(20).describe("Max results"),
  }),
  execute: async ({ query, limit }) => {
    let q = supabase
      .from("customers_with_order_summary")
      .select(
        "id, name, customer_type, contact_name, email, phone, total_orders, total_revenue, pending_orders, last_order_date"
      )
      .eq("is_active", true)
      .order("name")
      .limit(limit);

    if (query) q = q.ilike("name", `%${escapeLike(query)}%`);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  },
}),
```

**Step 4: Verify build**

Run: `bun lint`
Expected: No new errors

**Step 5: Commit**

```
feat: add order and customer AI chat tools
```

---

### Task 8: Add new read tools — brands, finished goods, and entity lookup

**Files:**
- Modify: `src/app/api/chat/tools.ts`

**Step 1: Add getBrands tool**

```typescript
getBrands: tool({
  description: "Search brands by name. Returns brand info with style.",
  inputSchema: z.object({
    query: z.string().optional().describe("Search by brand name"),
    limit: z.number().optional().default(20).describe("Max results"),
  }),
  execute: async ({ query, limit }) => {
    let q = supabase
      .from("brands")
      .select("id, name, variant, abv, description, style:beer_styles(id, name)")
      .order("name")
      .limit(limit);

    if (query) q = q.ilike("name", `%${escapeLike(query)}%`);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  },
}),
```

**Step 2: Add getFinishedGoods tool**

```typescript
getFinishedGoods: tool({
  description:
    "Get finished goods inventory with availability. Filter by brand or package type.",
  inputSchema: z.object({
    brandId: z.string().uuid().optional().describe("Filter by brand UUID"),
    query: z.string().optional().describe("Search by brand name"),
    limit: z.number().optional().default(20).describe("Max results"),
  }),
  execute: async ({ brandId, query, limit }) => {
    let q = supabase
      .from("finished_goods_with_availability")
      .select(
        "id, lot_number, brand_name, package_type_name, total_quantity, allocated_quantity, reserved_quantity, available_quantity, production_date, best_by_date"
      )
      .gt("available_quantity", 0)
      .order("brand_name")
      .limit(limit);

    if (brandId) q = q.eq("brand_id", brandId);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    if (query && data) {
      const lower = query.toLowerCase();
      return data.filter(
        (fg: Record<string, unknown>) =>
          typeof fg.brand_name === "string" &&
          fg.brand_name.toLowerCase().includes(lower)
      );
    }
    return data;
  },
}),
```

**Step 3: Add lookupEntity tool**

```typescript
lookupEntity: tool({
  description:
    "Resolve a human-friendly name to a UUID. Searches batches (by number), recipes (by name), customers (by name), brands (by name), and orders (by number). Use this when you need a UUID for another tool.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("The name or number to search for (e.g. 'batch 42', 'Hazy IPA')"),
    entityType: z
      .enum(["batch", "recipe", "customer", "brand", "order"])
      .optional()
      .describe("Narrow search to a specific entity type"),
  }),
  execute: async ({ query, entityType }) => {
    const results: Array<{
      type: string;
      id: string;
      display: string;
    }> = [];
    const escaped = escapeLike(query);

    if (!entityType || entityType === "batch") {
      const { data } = await supabase
        .from("batches")
        .select("id, batch_number, name")
        .or(
          `batch_number.ilike.%${escaped}%,name.ilike.%${escaped}%`
        )
        .limit(5);
      if (data) {
        for (const b of data) {
          results.push({
            type: "batch",
            id: b.id,
            display: `${b.batch_number}${b.name ? ` — ${b.name}` : ""}`,
          });
        }
      }
    }

    if (!entityType || entityType === "recipe") {
      const { data } = await supabase
        .from("recipes")
        .select("id, name")
        .ilike("name", `%${escaped}%`)
        .limit(5);
      if (data) {
        for (const r of data) {
          results.push({ type: "recipe", id: r.id, display: r.name });
        }
      }
    }

    if (!entityType || entityType === "customer") {
      const { data } = await supabase
        .from("customers")
        .select("id, name")
        .ilike("name", `%${escaped}%`)
        .eq("is_active", true)
        .limit(5);
      if (data) {
        for (const c of data) {
          results.push({ type: "customer", id: c.id, display: c.name });
        }
      }
    }

    if (!entityType || entityType === "brand") {
      const { data } = await supabase
        .from("brands")
        .select("id, name")
        .ilike("name", `%${escaped}%`)
        .limit(5);
      if (data) {
        for (const b of data) {
          results.push({ type: "brand", id: b.id, display: b.name });
        }
      }
    }

    if (!entityType || entityType === "order") {
      const { data } = await supabase
        .from("orders")
        .select("id, order_number")
        .ilike("order_number", `%${escaped}%`)
        .limit(5);
      if (data) {
        for (const o of data) {
          results.push({
            type: "order",
            id: o.id,
            display: o.order_number,
          });
        }
      }
    }

    return results;
  },
}),
```

**Step 4: Verify build**

Run: `bun lint`
Expected: No new errors

**Step 5: Commit**

```
feat: add brand, finished goods, and entity lookup AI tools
```

---

### Task 9: Add navigation tool — createBatch

**Files:**
- Modify: `src/app/api/chat/tools.ts`

**Context:** This tool validates the recipe exists, then returns a NavigationIntent that the chat panel renders as an action card. It does NOT create the batch — it navigates the user to the form.

**Step 1: Add createBatch tool**

After all read tools, add a new section:

```typescript
// =========================================================================
// Navigation Tools (return NavigationIntent for the client to handle)
// =========================================================================

createBatch: tool({
  description:
    "Prepare a new batch from a recipe. Returns a navigation action that opens the batch creation form with pre-filled data. The user will review and submit the form.",
  inputSchema: z.object({
    recipeName: z
      .string()
      .optional()
      .describe("Recipe name to search for"),
    recipeId: z.string().uuid().optional().describe("Recipe UUID if known"),
    plannedStartDate: z.string().optional().describe("Planned start date (YYYY-MM-DD)"),
    targetVolumeBbl: z
      .number()
      .optional()
      .describe("Target volume in barrels"),
  }),
  execute: async ({ recipeName, recipeId, plannedStartDate, targetVolumeBbl }) => {
    // Resolve recipe
    let recipe: { id: string; name: string; volume_bbl: number | null } | null =
      null;

    if (recipeId) {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, name, volume_bbl")
        .eq("id", recipeId)
        .single();
      if (error) throw new Error(`Recipe not found: ${error.message}`);
      recipe = data;
    } else if (recipeName) {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, name, volume_bbl")
        .ilike("name", `%${escapeLike(recipeName)}%`)
        .limit(1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error(
          `No recipe found matching "${recipeName}". Use searchRecipes to find the right name.`
        );
      }
      recipe = data[0];
    } else {
      throw new Error("Either recipeName or recipeId is required");
    }

    // Get next batch number
    const { data: batches } = await supabase
      .from("batches")
      .select("batch_number")
      .order("created_at", { ascending: false })
      .limit(1);

    const prefillData: Record<string, unknown> = {
      recipe_id: recipe.id,
    };
    if (plannedStartDate) prefillData.planned_start_date = plannedStartDate;
    if (targetVolumeBbl) {
      prefillData.volume_bbl = targetVolumeBbl;
    } else if (recipe.volume_bbl) {
      prefillData.volume_bbl = recipe.volume_bbl;
    }

    const datePart = plannedStartDate ? ` planned for ${plannedStartDate}` : "";
    return {
      action: "navigate" as const,
      url: "/production/batches/new",
      prefillData,
      description: `Create a new batch of ${recipe.name}${datePart}`,
    };
  },
}),
```

**Step 2: Verify build**

Run: `bun lint`
Expected: No new errors

**Step 3: Commit**

```
feat: add createBatch navigation tool
```

---

### Task 10: Add navigation tool — transitionBatch

**Files:**
- Modify: `src/app/api/chat/tools.ts`

**Context:** This tool validates the batch exists and the transition is valid, then returns a NavigationIntent. For `start_fermentation` and `cancel`/`archive`, it opens the dialog. For simple transitions (`transfer_to_brite`, `start_packaging`, `complete`), it navigates to the detail page and describes which action to click (no dialog exists).

**Step 1: Add transitionBatch tool**

```typescript
transitionBatch: tool({
  description:
    "Navigate to a batch to perform a state transition. For transitions with dialogs (start fermentation, cancel, archive), the dialog opens automatically. For simple transitions (conditioning, packaging, complete), navigates to the batch detail page where the user clicks the action.",
  inputSchema: z.object({
    batchId: z.string().uuid().optional().describe("The batch UUID"),
    batchNumber: z
      .string()
      .optional()
      .describe("The batch number to search for"),
    toState: z
      .enum([
        "fermenting",
        "conditioning",
        "packaging",
        "completed",
        "cancelled",
        "archived",
      ])
      .describe("Target state"),
  }),
  execute: async ({ batchId, batchNumber, toState }) => {
    // Resolve batch
    let batch: {
      id: string;
      batch_number: string;
      status: string;
    } | null = null;

    if (batchId) {
      const { data, error } = await supabase
        .from("batches")
        .select("id, batch_number, status")
        .eq("id", batchId)
        .single();
      if (error) throw new Error(`Batch not found: ${error.message}`);
      batch = data;
    } else if (batchNumber) {
      const { data, error } = await supabase
        .from("batches")
        .select("id, batch_number, status")
        .ilike("batch_number", `%${escapeLike(batchNumber)}%`)
        .limit(1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0)
        throw new Error(`No batch found matching "${batchNumber}"`);
      batch = data[0];
    } else {
      throw new Error("Either batchId or batchNumber is required");
    }

    // Validate transition using known state machine
    const validTransitions: Record<string, string[]> = {
      planned: ["fermenting", "cancelled"],
      fermenting: ["conditioning", "archived"],
      conditioning: ["packaging", "archived"],
      packaging: ["completed", "archived"],
    };

    const allowed = validTransitions[batch.status] || [];
    if (!allowed.includes(toState)) {
      throw new Error(
        `Cannot transition batch #${batch.batch_number} from "${batch.status}" to "${toState}". Valid transitions: ${allowed.join(", ") || "none"}`
      );
    }

    // Map target state to dialog name (if applicable)
    const dialogMap: Record<string, string | null> = {
      fermenting: "start_fermentation",
      cancelled: "cancel",
      archived: "archive",
      conditioning: null,
      packaging: null,
      completed: null,
    };

    const openDialog = dialogMap[toState] ?? undefined;
    const stateLabels: Record<string, string> = {
      fermenting: "Fermenting",
      conditioning: "Conditioning",
      packaging: "Packaging",
      completed: "Completed",
      cancelled: "Cancelled",
      archived: "Archived",
    };

    const description = openDialog
      ? `Move batch #${batch.batch_number} from ${batch.status} to ${stateLabels[toState]}`
      : `Navigate to batch #${batch.batch_number} — click "${stateLabels[toState]}" in the Actions menu to transition from ${batch.status}`;

    return {
      action: "navigate" as const,
      url: `/production/batches/${batch.id}`,
      openDialog: openDialog ?? undefined,
      description,
    };
  },
}),
```

**Step 2: Verify build**

Run: `bun lint`
Expected: No new errors

**Step 3: Commit**

```
feat: add transitionBatch navigation tool
```

---

### Task 11: Add navigation tool — addBatchReading

**Files:**
- Modify: `src/app/api/chat/tools.ts`

**Context:** Navigates to the batch readings page (`/production/batches/[id]/readings`) and auto-shows the form. The readings page has a `showForm` state that we toggle from the prefill store.

**Step 1: Add addBatchReading tool**

```typescript
addBatchReading: tool({
  description:
    "Navigate to the batch readings page to record a fermentation reading (gravity, pH, temperature, etc.). Opens the reading form automatically.",
  inputSchema: z.object({
    batchId: z.string().uuid().optional().describe("The batch UUID"),
    batchNumber: z
      .string()
      .optional()
      .describe("The batch number to search for"),
  }),
  execute: async ({ batchId, batchNumber }) => {
    // Resolve batch
    let batch: {
      id: string;
      batch_number: string;
      status: string;
    } | null = null;

    if (batchId) {
      const { data, error } = await supabase
        .from("batches")
        .select("id, batch_number, status")
        .eq("id", batchId)
        .single();
      if (error) throw new Error(`Batch not found: ${error.message}`);
      batch = data;
    } else if (batchNumber) {
      const { data, error } = await supabase
        .from("batches")
        .select("id, batch_number, status")
        .ilike("batch_number", `%${escapeLike(batchNumber)}%`)
        .limit(1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0)
        throw new Error(`No batch found matching "${batchNumber}"`);
      batch = data[0];
    } else {
      throw new Error("Either batchId or batchNumber is required");
    }

    // Validate batch is in an active state
    const activeStates = ["fermenting", "conditioning", "packaging"];
    if (!activeStates.includes(batch.status)) {
      throw new Error(
        `Batch #${batch.batch_number} is "${batch.status}" — readings can only be added to batches that are fermenting, conditioning, or packaging.`
      );
    }

    return {
      action: "navigate" as const,
      url: `/production/batches/${batch.id}/readings`,
      prefillData: { autoShowForm: true },
      description: `Add a reading to batch #${batch.batch_number}`,
    };
  },
}),
```

**Step 2: Verify build**

Run: `bun lint`
Expected: No new errors

**Step 3: Commit**

```
feat: add addBatchReading navigation tool
```

---

### Task 12: Update system prompt

**Files:**
- Modify: `src/app/api/chat/route.ts`

**Context:** The system prompt needs to describe the new navigation tools so the AI knows it can help create batches, transition states, and add readings.

**Step 1: Update BASE_SYSTEM_PROMPT**

Add after the existing tool description paragraph:

```typescript
const BASE_SYSTEM_PROMPT = `You are the MGR Brewery Assistant. You help brewers manage their brewery operations.

You have deep knowledge of:
- Brewing science (mashing, fermentation, water chemistry, hop utilization)
- BJCP style guidelines
- Production planning and scheduling
- Inventory management
- Recipe formulation and optimization

You are integrated into the MGR brewery management system. You have access to tools that let you query live brewery data — use them when the user asks about specific recipes, batches, inventory, vessels, or production schedules.

You also have navigation tools that can open forms with pre-filled data:
- createBatch: Opens the batch creation form with a recipe pre-selected
- transitionBatch: Opens the appropriate dialog to change batch status (start fermentation, move to conditioning, etc.)
- addBatchReading: Opens the readings page to record gravity, pH, temperature, etc.

When a user asks you to create, update, or transition something, use the appropriate navigation tool. The user will review the pre-filled form and submit it themselves.

Use the lookupEntity tool to resolve names and numbers to UUIDs when needed (e.g., "batch 42" → UUID).

Be concise and practical. When you use a tool, summarize the results clearly. Format data in tables when appropriate.
When users ask how to do something in MGR, give specific navigation instructions using the guide below.

${getHelpContentForSystemPrompt()}`;
```

**Step 2: Verify build**

Run: `bun lint`
Expected: No new errors

**Step 3: Commit**

```
feat: update AI system prompt with navigation tool descriptions
```

---

### Task 13: Update AI documentation

**Files:**
- Modify: `docs/spec/ai-integration.md`

**Step 1: Update the Chat Tools Reference section**

In the "Chat Tools Reference" section, update the tool count from 15 to the new total. Add the new tools to the tables:

Add to "Query Tools" table:
- `getBatchDetail` — Full batch details by UUID or batch number
- `searchBatches` — Filter batches by status, recipe, dates, batch number
- `searchOrders` — Search orders by status, customer, date range
- `getOrderDetail` — Full order with line items, customer, fulfillment
- `getCustomers` — Search customers with order statistics
- `getBrands` — Search brands with style info
- `getFinishedGoods` — Finished goods inventory with availability
- `lookupEntity` — Resolve names/numbers to UUIDs across all entities

Add a new "Navigation Tools" table:
- `createBatch` — Open batch creation form with recipe pre-filled
- `transitionBatch` — Open batch transition dialog (fermentation, conditioning, etc.)
- `addBatchReading` — Open readings page with form auto-shown

**Step 2: Update the Current Limitations section**

Remove limitations that are now addressed:
- ~~UUID-based lookups~~ → `lookupEntity` solves this
- ~~No order/customer data~~ → `searchOrders`, `getOrderDetail`, `getCustomers`
- ~~No brand/finished goods queries~~ → `getBrands`, `getFinishedGoods`
- ~~No batch detail tool~~ → `getBatchDetail`

Update "All tools are read-only" to note the navigation tools exist.

**Step 3: Commit**

```
docs: update AI integration docs with new tools
```

---

## Summary

| Task | Description | Files Changed |
|------|-------------|---------------|
| 1 | Install zustand, create prefill store | `package.json`, `src/stores/prefill-store.ts` |
| 2 | NavigationIntent rendering in chat panel | `src/components/domain/chat-panel.tsx` |
| 3 | Batch form prefill consumption | `src/app/(app)/production/batches/new/page.tsx` |
| 4 | Dialog auto-open on batch detail | `src/app/(app)/production/batches/[id]/page.tsx` |
| 5 | Readings page auto-show form | `src/app/(app)/production/batches/[id]/readings/page.tsx` |
| 6 | Batch read tools | `src/app/api/chat/tools.ts` |
| 7 | Order/customer read tools | `src/app/api/chat/tools.ts` |
| 8 | Brand/finished goods/lookup tools | `src/app/api/chat/tools.ts` |
| 9 | createBatch navigation tool | `src/app/api/chat/tools.ts` |
| 10 | transitionBatch navigation tool | `src/app/api/chat/tools.ts` |
| 11 | addBatchReading navigation tool | `src/app/api/chat/tools.ts` |
| 12 | Update system prompt | `src/app/api/chat/route.ts` |
| 13 | Update AI docs | `docs/spec/ai-integration.md` |

**Parallelization:** Tasks 6-8 (read tools) can be done in parallel. Tasks 9-11 (navigation tools) can be done in parallel after tasks 1-5 are complete.

**Deferred to future plan:**
- `recordBatchTransfer` — No standalone transfer dialog exists; transfers happen implicitly through state transitions. Building a dedicated transfer dialog is a separate feature.
- `addBatchNote` — No batch note dialog exists. Building one is a separate feature.
- Recipe creation/editing tools — Deferred per brainstorming prioritization.
- Order management tools — Deferred per brainstorming prioritization.
