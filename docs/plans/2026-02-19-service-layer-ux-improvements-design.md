# Service Layer & UX Improvements Design

**Date:** 2026-02-19
**Branch:** `ux-improvements`
**Status:** Draft — awaiting approval

## Problem Statement

The MGR codebase has grown to 36 entity types with a powerful entity config pattern, but accumulated technical debt in four areas:

1. **Duplicated data access logic** — UI components (`EntityDetailUnified`, `EntityDataTable`) and AI chat tools (`tools.ts`) implement parallel query/mutation logic against Supabase, with no shared layer. Adding a new entity requires updating both paths independently.

2. **Entity config bloat** — Every entity carries three representations of the same field layout (`formFields`, `detailSections`, `sections`), with `formFields` and `detailSections` deprecated but still populated across all 36 entities. Nine entities lack `sections` entirely, falling back to legacy rendering.

3. **AI chat limitations** — The chat has 38 handcrafted read-only tools with no write capabilities. Page context covers only 4 of 36 entity types. Tool results render as raw JSON with no truncation or structured formatting.

4. **Silent failures and inconsistent error handling** — 25+ locations log errors to `console.error()` with no user-visible feedback. No route-level error boundaries exist. Hardcoded API endpoints, stale time values, and query keys are scattered throughout.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Service layer approach | Shared TypeScript factory functions | Both UI and AI consume the same data access layer; no HTTP boundary needed |
| External libraries | None (skip supabase-cache-helpers, tRPC, Effect-TS) | Existing patterns + type tightening solve the core problems without new dependencies |
| Dynamic table type safety | Tighten `EntityConfig.table` to `keyof Database["public"]["Tables"]` | Eliminates ~52 `as any` casts across 39 files |
| AI write capabilities | Confirmed writes via MutationIntent action cards | User always reviews before data changes; uses existing UI patterns |
| AI SDK | Keep Vercel AI SDK | Already integrated, optimized for chat UI; Agent SDK doesn't add sufficient value for single-agent chat |
| Cache invalidation | Return invalidation hints from service methods | Service layer stays pure; calling code handles React Query |
| Deprecated component cleanup | Include in this branch | Clean break alongside service layer work |
| Migration scope | All 36 entities at once | Avoids partial migration state |
| Supabase type regeneration | Prerequisite step before type tightening | ~30% of `as any` casts exist because generated types are stale |

## Architecture

### 0. Prerequisites

#### Regenerate Supabase Types

Before any type-tightening work, regenerate `src/types/supabase.ts` from the current database schema. ~30% of `as any` casts exist because the generated types are missing views (`vessels_with_current_batch`, `notification_queue`, etc.) and RPC functions (`analyze_batch_performance`, `get_inventory_overview`, `archive_batch`, `start_batch_fermentation`, etc.) added after the last type generation.

```bash
pnpm exec supabase gen types typescript --project-id <id> > src/types/supabase.ts
```

#### Define JSON Field Types

Add proper TypeScript types for JSON columns that are currently cast as `unknown[]`:

```typescript
// src/types/domain.ts
export interface BrewEvent {
  type: string;
  timestamp: string;
  description: string;
  data?: Record<string, unknown>;
}

export interface BatchReading {
  type: "gravity" | "temperature" | "ph" | "dissolved_oxygen";
  value: number;
  unit: string;
  recorded_at: string;
}
```

This eliminates ~10 `as unknown` casts across brew log and batch reading components.

### 1. Service Layer (`src/services/`)

#### Type-Safe Foundation

```typescript
// src/services/types.ts
import type { Database } from "@/types/supabase";

export type TableName = keyof Database["public"]["Tables"];
export type ViewName = keyof Database["public"]["Views"];
export type TableOrViewName = TableName | ViewName;

export type ServiceResult<T> =
  | { success: true; data: T; invalidate: string[][] }
  | { success: false; error: ServiceError };

export type ServiceError =
  | { code: "VALIDATION"; issues: z.ZodIssue[] }
  | { code: "CONFLICT"; currentVersion: number; message: string }
  | { code: "NOT_FOUND"; table: string; id: string }
  | { code: "FK_VIOLATION"; message: string }
  | { code: "RLS_DENIED"; message: string }
  | { code: "INVALID_TRANSITION"; from: string; to: string; message: string }
  | { code: "UNKNOWN"; message: string; cause?: unknown };
```

#### Generic Entity Service

```typescript
// src/services/entity-service.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import type { EntityConfig } from "@/types/entity";

export const entityService = {
  /**
   * List records for any entity, with filters, search, and sort.
   * Uses viewTable when available for computed fields.
   */
  async list<T>(
    supabase: SupabaseClient<Database>,
    entity: EntityConfig<T>,
    options?: {
      filters?: Record<string, unknown>;
      search?: string;
      sort?: { column: string; direction: "asc" | "desc" };
      limit?: number;
    }
  ): Promise<ServiceResult<T[]>>,

  /**
   * Get a single record by ID.
   */
  async getById<T>(
    supabase: SupabaseClient<Database>,
    entity: EntityConfig<T>,
    id: string
  ): Promise<ServiceResult<T>>,

  /**
   * Create a new record. Validates against entity.formSchema.
   */
  async create<T>(
    supabase: SupabaseClient<Database>,
    entity: EntityConfig<T>,
    data: unknown
  ): Promise<ServiceResult<T>>,

  /**
   * Update an existing record. Validates against entity.formSchema.
   * Uses optimistic locking when the entity has a version field.
   */
  async update<T>(
    supabase: SupabaseClient<Database>,
    entity: EntityConfig<T>,
    id: string,
    data: unknown,
    currentVersion?: number
  ): Promise<ServiceResult<T>>,

  /**
   * Transition entity state. Validates against entity.stateMachine.
   */
  async transition<T>(
    supabase: SupabaseClient<Database>,
    entity: EntityConfig<T>,
    id: string,
    targetState: string
  ): Promise<ServiceResult<T>>,

  /**
   * Delete (hard) or deactivate (soft) a record.
   */
  async remove<T>(
    supabase: SupabaseClient<Database>,
    entity: EntityConfig<T>,
    id: string,
    mode: "hard" | "soft"
  ): Promise<ServiceResult<void>>,
};
```

**Key design properties:**
- Supabase client is always the first argument (works with browser or server client)
- Entity config provides table name, view table, Zod schema, state machine
- Returns `ServiceResult<T>` with typed errors and invalidation hints
- No React dependencies — callable from hooks, route handlers, or AI tools
- Single validation pass through `entity.formSchema` (eliminates current double-validation)

#### Domain Services

For operations that don't fit generic CRUD:

```typescript
// src/services/recipe-service.ts
export const recipeService = {
  analyzeCompliance(supabase, recipeId): Promise<ServiceResult<ComplianceReport>>,
  getSummary(supabase, recipeId): Promise<ServiceResult<RecipeSummary>>,
  suggestImprovements(supabase, recipeId): Promise<ServiceResult<Suggestion[]>>,
};

// src/services/batch-service.ts
export const batchService = {
  analyzePerformance(supabase, batchId): Promise<ServiceResult<PerformanceReport>>,
  getBlendCandidates(supabase, batchId): Promise<ServiceResult<Batch[]>>,
};

// src/services/inventory-service.ts
export const inventoryService = {
  getOverview(supabase): Promise<ServiceResult<InventoryOverview>>,
  getExpiringLots(supabase, daysAhead): Promise<ServiceResult<Lot[]>>,
};
```

### 2. Entity Config Cleanup

#### Remove Triple Duplication

For all 36 entities:
- **Delete** `formFields` arrays (deprecated, replaced by `sections`) — 28 entities still have these
- **Delete** `detailSections` arrays (deprecated, replaced by `sections`) — 20 entities still have these
- **Keep** only `sections` as the single source of field layout

For the 9 entities missing `sections` (allocation, finished-good, delivery, user-profile, order-item, po-line-item, keg-transaction, po-receive, pricing-tier-price):
- Convert their `detailSections`/`formFields` to `sections` format before deletion

For the 2 entities missing `sections` and also lacking `detailSections` (yeast-pitch, yeast-strain):
- Create `sections` from scratch based on their `formFields`

**Estimated reduction:** ~2,000-3,000 lines removed across entity configs.

#### Remove Deprecated Types

From `src/types/entity.ts`:
- Remove `EntityFieldDef` type
- Remove `EntitySectionDef` type (legacy detail sections)
- Remove `getUnifiedSections()` bridge function
- Remove `formFields` and `detailSections` from `EntityConfig` interface

#### Type-Safe Table Names

```typescript
// In EntityConfig interface
table: TableName;                    // was: string
viewTable?: TableOrViewName;         // was: string | undefined
```

This eliminates ~52 `as any` casts and provides compile-time verification that entity configs reference real tables.

#### Fix View Type Assertions

For entities with `viewTable` that currently use `as keyof T & string` workarounds (`bin.tsx`, `pick-list.tsx`, `location-transfer.tsx`):
- Define proper merged view types (as done correctly in `batch.tsx` and `customer.tsx`)
- Remove the type assertion workarounds

#### Fix DEC-007 Violations

| File | Issue | Fix |
|------|-------|-----|
| `brew-log.tsx` | Hardcoded filter options | Use `statesAsOptions(brewLogStateMachine)` |
| `yeast-pitch.tsx` | External `STATUS_DISPLAY` dict | Move into `stateMachine.stateDisplay` |
| `user-profile.tsx` | External `STATUS_DISPLAY` + `ROLE_DISPLAY` | Move into `stateMachine.stateDisplay` / `valueDisplay` |
| `planning/page.tsx` | Hardcoded `STATUS_COLORS` | Derive from `batchEntity.stateMachine.stateDisplay` |
| `planning/timeline/page.tsx` | Hardcoded `STATUS_COLORS` | Same as above |
| `vessel.tsx` | Duplicate `VESSEL_TYPES` constant | Remove; use `valueDisplay` only |
| `customer.tsx` | Inline StatusBadge config built in render | Use `valueDisplay` pattern |
| `inventory-item.tsx` | Inline StatusBadge config built in render | Use `valueDisplay` pattern |

#### Fix Other Inconsistencies

- Extract shared unit options constant for `inventory-item.tsx` and `inventory-lot.tsx`
- Rename `vessel-transfer.ts` → `vessel-transfer.tsx` for consistency
- Remove dual `options` + `dynamicOptions` on `location.tsx` location_type field
- Decouple `sales-channel.tsx` from `orderEntity.stateMachine` — currently imports order entity to get state options
- Extract non-config exports from entity files:
  - `order.tsx`: move `changeRequestStatusDisplay` to `src/lib/constants/` or inline where used
  - `user-profile.tsx`: move `UserStatus`, `ROLE_OPTIONS`, `STATUS_OPTIONS` to a constants file
  - `yeast-pitch.tsx`: move `STATUS_DISPLAY`, `VIABILITY_STATUS_DISPLAY` into config's `stateDisplay`/`valueDisplay`
- Add missing `relations` to `po-line-item.tsx` (should reference `purchase_orders` via `po_id`)

### 3. Deprecated Component Removal

#### Delete Dead Code

- **Delete `entity-form.tsx`** (416 lines, zero usages)

#### Migrate 5 Pages

Migrate these pages from `EntityDetail` to `EntityDetailUnified`:
- `settings/users/[id]/page.tsx`
- `inventory/kegs/transactions/[id]/page.tsx`
- `inventory/finished-goods/[id]/page.tsx`
- `inventory/deliveries/[id]/page.tsx`
- `inventory/allocations/[id]/page.tsx`

#### Delete Deprecated Component

- **Delete `entity-detail.tsx`** (740 lines) after all pages are migrated

#### Extract Shared Code

Before deletion, extract duplicated code into shared locations:
- `RelationTable` (~150 LOC duplicated) → `src/components/universal/relation-table.tsx`
- `useRelationDisplayValues` (~50 LOC duplicated) → `src/hooks/use-relation-display-values.ts`
- `formatStateInfo()` (~12 LOC duplicated) → utility function in `src/lib/entity-utils.ts`
- `EntityDetailSkeleton` (~25 LOC duplicated) → shared skeleton component
- Keyboard shortcut logic (~60 LOC overlapping) → `src/hooks/use-entity-detail-keyboard.ts`

#### Split `entity-detail-unified.tsx` (1,427 LOC)

The primary component is well past the splitting threshold. Extract:
- `src/hooks/use-entity-form-submit.ts` — form submission, validation, error handling logic
- `src/hooks/use-conflict-resolution.ts` — conflict dialog state management
- `src/hooks/use-entity-detail-keyboard.ts` — keyboard shortcut handlers (shared with legacy component during migration)
- Keep core component at ~700 LOC

#### Update Barrel Exports

Update `src/components/universal/index.ts`:
- Remove `EntityDetail`, `EntityForm` exports
- Add `EntityDetailUnified`, `EntityKanban`, `BulkStatusActionBar`, `EntityDeleteDialog`
- Add `RelationTable` (newly extracted)

### 4. AI Chat Improvements

#### Config-Driven Tools

Replace 38 handcrafted tools with service-layer-backed generic tools:

**Generic tools (backed by `entityService`):**
- `searchEntity(entityName, filters?, search?)` — replaces 23 individual search tools
- `getEntityDetail(entityName, id)` — replaces individual detail tools

**Mutation tools (confirmed writes):**
- `createEntity(entityName, data)` — returns MutationIntent for user confirmation
- `updateEntity(entityName, id, data)` — returns MutationIntent
- `transitionEntity(entityName, id, targetState)` — returns MutationIntent

**Domain tools (kept, backed by domain services):**
- `analyzeRecipe(recipeId)` → `recipeService.analyzeCompliance()`
- `getRecipeSummary(recipeId)` → `recipeService.getSummary()`
- `suggestImprovements(recipeId)` → `recipeService.suggestImprovements()`
- `analyzeBatch(batchId)` → `batchService.analyzePerformance()`
- `getInventoryOverview()` → `inventoryService.getOverview()`

**Utility tools (kept as-is):**
- `lookupEntity(query)` — multi-table parallel search
- `getAppGuide()` — help content
- `getSchemaContext(domain?)` — NEW: exposes `_schema_registry` for AI introspection

#### Confirmed Writes: MutationIntent Pattern

Write tools return a `MutationIntent` instead of executing directly:

```typescript
interface MutationIntent {
  action: "confirm_mutation";
  entityName: string;
  operation: "create" | "update" | "transition" | "delete";
  description: string;  // Human-readable: "Move batch #42 from 'fermenting' to 'conditioning'"
  data: Record<string, unknown>;
  serviceCall: {
    method: string;        // e.g., "entityService.transition"
    args: unknown[];       // serialized arguments
  };
}
```

The chat panel renders MutationIntents as action cards with a "Confirm" button. On click:
1. Deserialize the `serviceCall` and execute through the service layer
2. Apply cache invalidation from the result
3. Show success/error inline in the chat — no navigation required

This is a strict improvement over the current NavigationIntent pattern:
- NavigationIntent: AI prefills form → user navigates → user reviews → user submits (4 steps)
- MutationIntent: AI proposes change → user clicks Confirm (2 steps)

NavigationIntents are preserved for complex operations that genuinely need the full form UI (e.g., creating a recipe with grain bill, hop schedule, etc.).

#### Expand Page Context

Extend `fetchEntityContext()` from 4 entity types to all entities:
- Use the entity registry to look up any entity by URL segment
- Use `entityService.getById()` to fetch a lightweight summary
- Inject into system prompt as currently done for batch/recipe/order/vessel

#### Tool Result Rendering

Replace generic JSON rendering with structured output:

- **Search results** → render as a compact table (name, status, key fields) with "View Details" links
- **Entity details** → render as a formatted card with key-value pairs
- **Analysis results** → render as formatted sections (compliance scores, suggestions, etc.)
- **Large results** → truncate after N items with a "Show all" toggle
- **Error results** → include context about what operation failed, not just the raw database error

#### Tool Error Context

Replace the current pattern:
```typescript
if (error) throw new Error(error.message);
```
With contextual errors:
```typescript
if (error) throw new Error(`Failed to search recipes: ${error.message}`);
```

### 5. Data Fetching & Error Handling Fixes

| Issue | Fix |
|-------|-----|
| `useDynamicFilterOptions` bypasses React Query | Rewrite to use `useQueries` (align with `useDynamicOptions`) |
| `window.confirm()` for dirty guards (2 locations) | Replace with `UnsavedChangesDialog` using `AlertDialog` |
| Double Zod validation in `handleSave` | Single validation pass through service layer |
| Hardcoded `staleTime` in 9+ files | Replace all with `CACHE_DURATIONS` constants from `src/lib/constants.ts` |
| Dead link in `/purchasing/demand` toast | Fix route: `purchase-orders` → `pos` |
| `DOMAIN_WRITE_PERMISSIONS` hardcoded in component | Move to `EntityConfig` as `writePermission` field |
| 25+ `console.error`-only error paths | Add toast notifications for all user-visible failures |
| Silent failures in `use-dynamic-options.ts` | Return error state, show toast on failure instead of empty array |
| Silent failures in `planned-additions.tsx` | Show error toast, render error state |
| Silent failures in `enum-value.tsx`, `enums.ts` | Show toast or error boundary |
| Duplicate catalog queries in `batch-addition-form.tsx` | Use existing `useCatalog()` hook (5 inline queries → 1 hook call) |
| Duplicate catalog queries in `pick-list-items.tsx` | Use `useCatalog()` hook |
| Hardcoded API endpoints (25+ instances) | Create `src/lib/api-routes.ts` with typed endpoint constants |
| Inconsistent mutation invalidation (QBO sync) | Cascade invalidation to all affected query keys |
| Hardcoded query key in `notifications/page.tsx` | Use `notificationKeys` factory |

### 6. UX Fixes

| Issue | Fix |
|-------|-----|
| No `error.tsx` boundaries anywhere | Add `src/app/(app)/error.tsx`, `src/app/portal/error.tsx` |
| No `loading.tsx` boundaries | Add `src/app/(app)/loading.tsx` with global loading skeleton |
| Settings sidebar hidden on mobile | Add responsive Sheet/Drawer fallback |

## Migration Strategy

0. **Prerequisites** — Regenerate Supabase types. Define JSON field types (`BrewEvent`, `BatchReading`).
1. **Service layer first** — Build `entityService` and domain services with tests. No UI changes yet.
2. **Entity config cleanup** — Remove deprecated fields, tighten types, fix DEC-007 violations, extract non-config exports.
3. **Component cleanup** — Extract shared code, split `entity-detail-unified.tsx`, migrate 5 pages off `EntityDetail`, delete dead code.
4. **Wire UI to service layer** — Update `EntityDetailUnified` and `EntityDataTable` to use service layer for mutations.
5. **AI tool replacement** — Replace handcrafted tools with config-driven + service-backed tools. Add confirmed writes. Add structured result renderers.
6. **Data fetching & error handling** — Fix silent failures, centralize API routes, replace hardcoded constants, add error/loading boundaries.

Each phase validates with `pnpm typecheck && pnpm lint` before proceeding.

## Out of Scope

- Server-side pagination (current client-side pagination is adequate for brewery-scale data)
- Chat persistence across sessions
- Proactive AI suggestions / alerts
- Generic `InlineRowEditor` component for domain editors (domain-specific logic differences are too large)
- Agent SDK migration (Vercel AI SDK is working well for single-agent chat)
- Optimistic updates for mutations (natural follow-up but not core to this branch)
- Chat streaming timeouts / rate limiting (operational concern, not architectural)
