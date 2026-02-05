# AI Tools Expansion Design

## Overview

Expand the AI chat assistant's capabilities from 15 read-only tools to ~28 tools covering both data retrieval and entity mutation. Write operations use a **navigation-based pattern** where the AI prepares data and routes the user to existing forms/dialogs rather than executing mutations directly.

## Design Decisions

### Navigation-Based Writes

The AI does not execute mutations. Instead, write tools return a `NavigationIntent` that the client handles by:
1. Storing prefill data in a shared store
2. Navigating to the target form/page
3. Optionally auto-opening a specific dialog

This reuses all existing form validation, optimistic locking, error handling, cache invalidation, and submission UX. The AI acts as a smart form-filler and navigator.

### Confirmation Model

All writes require user confirmation through the existing form submission flow. The user always sees and can edit the pre-filled data before submitting.

---

## Architecture

### NavigationIntent Type

```typescript
type NavigationIntent = {
  action: "navigate";
  url: string;                              // Target route
  prefillData?: Record<string, unknown>;    // Form field values
  openDialog?: string;                      // Dialog to auto-open on detail page
  description: string;                      // Human-readable summary for chat card
};
```

### Prefill Store

A zustand store that holds pending prefill data for forms and dialogs:

```typescript
// src/stores/prefill-store.ts
interface PrefillStore {
  prefillData: Record<string, unknown> | null;
  openDialog: string | null;
  setPrefill: (data: Record<string, unknown>, dialog?: string) => void;
  consume: () => { prefillData: Record<string, unknown> | null; openDialog: string | null };
}
```

`consume()` reads and clears the data atomically (single-use).

### Chat Panel Integration

When a tool result contains a NavigationIntent, the chat message renders an action card:
- Summary text (from `description`)
- "Open Form" button
- Clicking stores prefill data and navigates via `router.push(url)`
- Card remains in chat history as a record

### Form/Dialog Prefill Consumption

- **EntityForm**: On mount, checks prefill store. If data exists, merges into `defaultValues`.
- **Entity detail pages**: On mount, checks `openDialog` in store. If set, auto-opens the matching dialog with prefilled values.

---

## New Read Tools (8 tools)

### Batch Tools

**`getBatchDetail`**
- Input: `batchId` (UUID) OR `batchNumber` (string)
- Returns: Full batch info, current vessel, recipe name, latest readings, status, brew log dates, timeline
- Replaces the need to call `analyzeBatch` + `getBatchLogs` + `getBatchTransfers` separately

**`searchBatches`**
- Input: Optional `status`, `recipeName`, `startDate`, `endDate`, `batchNumber`, `limit`
- Returns: Matching batches with recipe name, status, dates, vessel
- Fills gap: currently can only get status counts or date-range schedule

### Order Tools

**`searchOrders`**
- Input: Optional `status`, `customerName`, `startDate`, `endDate`, `limit`
- Returns: Orders with customer name, line item count, total, status

**`getOrderDetail`**
- Input: `orderId` (UUID)
- Returns: Full order with line items (brand, package type, quantity, price), customer info, fulfillment status, allocations

**`getCustomers`**
- Input: Optional `query` (name search), `limit`
- Returns: Customers with contact info and recent order count

### Product Tools

**`getBrands`**
- Input: Optional `query` (name search)
- Returns: Brands with associated finished goods and current stock levels

**`getFinishedGoods`**
- Input: Optional `brandId`, `packageType`, `query`
- Returns: Finished goods with available inventory quantities

### Utility

**`lookupEntity`**
- Input: `query` (human-friendly name), `entityType` (optional: "batch", "recipe", "customer", "brand", "order")
- Returns: Matching entities with UUID, display name, type
- Purpose: Resolve conversational references ("batch 42", "Hazy IPA") to UUIDs for other tools
- Searches across multiple tables when entityType not specified

---

## Navigation/Write Tools (5 tools)

### `createBatch`
- Input: `recipeName` or `recipeId`, `plannedStartDate`, `targetVolumeBbl` (optional)
- Validation: Recipe exists, date is valid
- Returns: NavigationIntent to `/production/batches/new` with prefilled fields
- Description: "Create a new batch of [Recipe Name] planned for [date]"

### `transitionBatch`
- Input: `batchId` or `batchNumber`, `toState` ("fermenting" | "conditioning" | "packaging" | "completed" | "cancelled")
- Validation: Batch exists, current state allows transition (checked against state machine), fetches available vessels for fermentation
- Returns: NavigationIntent to `/production/batches/[id]` with `openDialog` matching the transition (e.g., "start_fermentation", "start_conditioning", "cancel")
- Description: "Move batch #[number] from [current] to [target]"

### `addBatchReading`
- Input: `batchId` or `batchNumber`, optional `gravity`, `ph`, `temperature`, `notes`
- Validation: Batch exists, is in active state (fermenting/conditioning)
- Returns: NavigationIntent to `/production/batches/[id]` with `openDialog: "add_reading"` and prefilled values
- Description: "Add reading to batch #[number]: gravity [X], pH [Y], temp [Z]"

### `recordBatchTransfer`
- Input: `batchId` or `batchNumber`, optional `toVesselName`
- Validation: Batch exists, has current vessel, target vessel exists and is available
- Returns: NavigationIntent to `/production/batches/[id]` with `openDialog: "transfer"` and prefilled vessel
- Description: "Transfer batch #[number] to [vessel name]"

### `addBatchNote`
- Input: `batchId` or `batchNumber`, `note` (text), optional `logType` ("note", "observation", "issue")
- Validation: Batch exists
- Returns: NavigationIntent to `/production/batches/[id]` with `openDialog: "add_note"` and prefilled content
- Description: "Add note to batch #[number]"

---

## Tool Summary

| Category | Current | New | Total |
|----------|---------|-----|-------|
| SQL Function (RPC) | 5 | 0 | 5 |
| Read (direct query) | 10 | 8 | 18 |
| Navigation (write) | 0 | 5 | 5 |
| **Total** | **15** | **13** | **28** |

---

## Files to Create/Modify

### New Files
- `src/stores/prefill-store.ts` — Zustand store for prefill data
- `src/lib/ai/navigation-intent.ts` — NavigationIntent type definition

### Modified Files
- `src/app/api/chat/tools.ts` — Add 8 read tools + 5 navigation tools
- `src/app/api/chat/route.ts` — Update system prompt to describe write capabilities
- `src/components/domain/chat-panel.tsx` — Render NavigationIntent action cards in chat
- `src/components/universal/entity-form.tsx` — Read prefill data from store on mount
- `src/app/(app)/production/batches/[id]/page.tsx` — Handle `openDialog` from prefill store
- `src/contexts/chat-context.tsx` — Expose navigation handler for chat panel

### No Changes Needed
- Existing domain dialogs (start-fermentation, cancellation, etc.)
- Existing entity configs
- Existing mutation logic
- Existing validation schemas

---

## Implementation Order

1. **Prefill store + NavigationIntent type** — Foundation for write tools
2. **New read tools** — No UI changes needed, immediately useful
3. **Chat panel NavigationIntent rendering** — Action card component
4. **EntityForm prefill consumption** — Read from store on mount
5. **Navigation tools (createBatch first)** — Simplest write flow
6. **Dialog auto-open on detail pages** — Enable transitionBatch, addBatchReading, recordBatchTransfer
7. **System prompt updates** — Tell the AI about its new capabilities
8. **Remaining navigation tools** — addBatchNote, edge cases
