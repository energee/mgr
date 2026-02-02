# AI Integration Polish — Design Document

## Overview

Polish the AI chat assistant across four areas: tool use for live data access, page-aware context, markdown rendering, session persistence, and keyboard shortcut.

## 1. Tool Use / Live Data Access

Extend `src/app/api/chat/route.ts` with Vercel AI SDK `tool()` definitions. Tools use the authenticated Supabase client (user's session, RLS applies). `maxSteps: 5` on `streamText` for multi-tool chains.

### Tools (15 total)

**Existing SQL functions (called via Supabase RPC):**

| Tool | SQL Function | Parameters |
|------|-------------|------------|
| `analyzeRecipe` | `analyze_recipe_style_compliance` | `recipeId: uuid` |
| `getRecipeSummary` | `get_recipe_summary` | `recipeId: uuid` |
| `suggestImprovements` | `suggest_recipe_improvements` | `recipeId: uuid` |
| `analyzeBatch` | `analyze_batch_performance` | `batchId: uuid` |
| `getInventoryOverview` | `get_inventory_overview` | (none) |

**Existing AIQueryHelper methods (called via TypeScript):**

| Tool | Helper Method | Parameters |
|------|--------------|------------|
| `searchRecipes` | `searchRecipes` | `query: string, limit?: number` |
| `getBatchStatus` | `getBatchStatusSummary` | (none) |
| `getVesselAvailability` | `getVesselAvailability` | (none) |
| `getProductionSchedule` | `getProductionSchedule` | `startDate: string, endDate: string` |
| `getIngredientInventory` | `getIngredientInventory` | `category?: string` |

**New query tools (direct Supabase queries):**

| Tool | Table/View | Parameters | Returns |
|------|-----------|------------|---------|
| `getBatchLogs` | `batch_logs` | `batchId: uuid` | Gravity readings, status changes, measurements, notes |
| `getVesselCleanings` | `vessel_cleanings` | `vesselId: uuid` | Cleaning history (type, chemicals, duration) |
| `getBatchTransfers` | `vessel_transfers` | `batchId: uuid` | Transfer timeline between vessels |
| `getRecipeCost` | `recipes_with_cogs` | `recipeId: uuid` | COGS breakdown |
| `getLotExpiration` | `inventory_lots_with_quantities` | `daysAhead?: number` | Lots expiring within N days, FIFO order |

All tools are **read-only**. No write operations exposed to the assistant.

### Implementation

Tools defined in a separate file `src/app/api/chat/tools.ts` to keep the route clean. The route imports and passes them to `streamText`. Each tool:
- Has a Zod parameter schema
- Has a clear `description` for Claude to understand when to use it
- Receives the Supabase client as a closure parameter
- Returns JSON data (Claude formats it for the user)

## 2. Page-Aware Context

### Client Side

A utility function `parsePageContext(pathname: string)` extracts entity type, entity ID, and section from the URL:

```
/production/batches/abc-123  → { section: "production", entityType: "batch", entityId: "abc-123" }
/production/recipes          → { section: "production", entityType: "recipe" }
/inventory/hops              → { section: "inventory" }
/settings/system             → (omitted — not relevant)
/                            → (omitted — dashboard)
```

The `useChat` hook's `body` option passes `pageContext` alongside messages.

### Server Side

The chat route reads `pageContext` from the request body and appends to the system prompt:

```
The user is currently viewing: [Entity Type] detail (ID: [id]) in the [Section] section.
```

When only a section is known: `The user is browsing the [Section] section.`
When on dashboard/settings: nothing appended.

## 3. Chat Quality-of-Life

### Markdown Rendering

Install `react-markdown` and `remark-gfm`. In the chat panel, assistant messages render through `<ReactMarkdown>` with GFM support (tables, strikethrough, task lists). User messages stay plain text. Styling uses Tailwind prose classes scoped to assistant messages.

### Session Persistence

Create `ChatProvider` context that wraps the app layout in `src/app/(app)/layout.tsx`. The provider manages:
- `messages` / chat state (from `useChat` hook)
- `isOpen` toggle
- `pageContext` derived from `usePathname()`

`ChatLayout` becomes a thin consumer of this context. Messages survive page navigations but not tab close.

### Keyboard Shortcut

`Cmd+.` (Mac) / `Ctrl+.` (Windows) toggles the chat panel. Implemented as a `useEffect` keydown listener in `ChatProvider`. Calls `preventDefault()` to avoid browser default behavior.

## Files to Create/Modify

### New files:
- `src/app/api/chat/tools.ts` — Tool definitions
- `src/contexts/chat-context.tsx` — ChatProvider with session state

### Modified files:
- `src/app/api/chat/route.ts` — Import tools, read pageContext, extend system prompt
- `src/components/domain/chat-panel.tsx` — Markdown rendering, consume context
- `src/components/domain/chat-layout.tsx` — Use ChatProvider context
- `src/components/domain/chat-toggle.tsx` — Use ChatProvider context
- `src/app/(app)/layout.tsx` — Wrap with ChatProvider

### Dependencies:
- `react-markdown`
- `remark-gfm`
