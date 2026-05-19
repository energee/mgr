# AI Integration

MGR is built with an **AI-first design philosophy**. This document describes the built-in AI assistant, its architecture, available tools, and how external AI agents can interact with the system.

## AI Assistant Overview

MGR includes a built-in chat assistant accessible from any page via the sidebar panel (toggle with `Cmd+.` / `Ctrl+.`). The assistant can query live brewery data, analyze recipes, check production status, and guide users through the application.

### Tech Stack

| Component | Technology |
|-----------|------------|
| LLM | Anthropic Claude Sonnet 4 (`claude-sonnet-4-20250514`) |
| SDK | Vercel AI SDK v6 (`ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`) |
| Streaming | `streamText` with `toUIMessageStreamResponse` |
| Tool calling | Vercel AI SDK `tool()` with Zod schemas |
| Markdown rendering | `streamdown` with code, math, mermaid, CJK plugins |
| API route | `POST /api/chat` |

### API Key Resolution

The chat API resolves the Anthropic API key in this order:
1. **User preference** — `user_preferences.anthropic_api_key` for the authenticated user
2. **System setting** — `system_settings` where `key = 'anthropic_api_key'`

If neither is configured, the chat returns a 400 error prompting the user to add a key in Settings.

### Page Context Awareness

The chat panel sends the current page context (section, entity type, entity ID) with each request. The system prompt is augmented with this context so the assistant knows what the user is looking at:

```
The user is currently viewing: batch detail (ID: abc-123) in the production section.
```

### Help Content Integration

The system prompt includes structured help content from `src/lib/help-content.ts`, enabling the assistant to give specific navigation instructions ("Go to Production > Batches > New to create a batch").

### Tool Step Limit

The assistant stops after **5 tool invocation steps** per message (`stopWhen: stepCountIs(5)`), preventing runaway tool loops.

---

## Architecture Decisions

### DEC-AI-001: Schema Registry for AI Context
**Status**: Implemented

The `_schema_registry` table provides AI-specific metadata:

```sql
_schema_registry:
  table_name      TEXT PRIMARY KEY
  description     TEXT              -- Human-readable description
  domain          TEXT              -- Domain grouping
  relationships   JSONB             -- hasMany, belongsTo relations
  key_fields      JSONB             -- Important fields for queries
  state_machine   JSONB             -- State transitions if applicable
  query_examples  JSONB             -- Natural language query examples
  ai_context      JSONB             -- AI-specific context and actions
  calculated_fields JSONB           -- Fields computed via views
```

AI agents query this table first to understand the schema without external documentation.

### DEC-AI-002: Database Functions for AI
**Status**: Implemented

| Function | Purpose |
|----------|---------|
| `analyze_recipe_style_compliance(recipe_id)` | Compare recipe estimates to BJCP guidelines |
| `get_recipe_summary(recipe_id)` | Comprehensive recipe data in structured format |
| `suggest_recipe_improvements(recipe_id)` | AI-generated improvement suggestions |
| `analyze_batch_performance(batch_id)` | Compare actuals vs targets |
| `get_inventory_overview()` | Current inventory status |
| `get_ai_schema_context(domain)` | Schema information for AI context |

Migration: `supabase/migrations/00008_ai_integration.sql`

### DEC-AI-003: TypeScript AI Utilities
**Status**: Implemented

TypeScript utilities in `src/lib/ai/`:

```typescript
// Recipe analysis
import {
  analyzeStyleCompliance,
  getRecipeSummary,
  getRecipeSuggestions,
  BrewingCalculations,
  WaterChemistry,
  FermentationAnalysis
} from '@/lib/ai';

// Schema context
import {
  getSchemaContext,
  getDomainSummary,
  getValidTransitions,
  QUERY_TEMPLATES,
  DOMAIN_DESCRIPTIONS
} from '@/lib/ai';

// Query helpers
import { AIQueryHelpers } from '@/lib/ai';
```

---

## Chat Tools Reference

All tools are defined in `src/app/api/chat/tools.ts` and bound to the authenticated user's Supabase client. Read tools query data directly. Navigation tools return a `NavigationIntent` that the chat panel renders as an action card — clicking navigates the user to a pre-filled form.

### RPC Tools (Database Functions)

| Tool | Description | Input |
|------|-------------|-------|
| `analyzeRecipe` | Compare recipe against BJCP style guidelines (OG, FG, ABV, IBU, SRM) | `recipeId: UUID` |
| `getRecipeSummary` | Full recipe: grain bill, hops, yeast, water, mash/fermentation schedule, estimates | `recipeId: UUID` |
| `suggestImprovements` | Improvement suggestions for style compliance, grain bill, yeast, water chemistry | `recipeId: UUID` |
| `analyzeBatch` | Batch performance: actual vs target measurements, fermentation timeline | `batchId: UUID` |
| `getInventoryOverview` | Snapshot of finished goods, raw materials, batches in progress | *(none)* |

### Query Tools (Direct Supabase Queries)

| Tool | Description | Input |
|------|-------------|-------|
| `searchRecipes` | Search recipes by name, returns details with style info | `query: string`, `limit?: number` |
| `getBatchStatus` | Batch counts grouped by status (excludes cancelled) | *(none)* |
| `getVesselAvailability` | Vessel utilization: available, in-use, current batch assignments | *(none)* |
| `getProductionSchedule` | Batches scheduled within a date range with recipe and volume | `startDate`, `endDate` |
| `getIngredientInventory` | Raw ingredient levels with lot quantities and expiration | `category?: string` |
| `getBatchLogs` | Event log for a batch: readings, status changes, notes (chronological) | `batchId: UUID` |
| `getVesselCleanings` | Cleaning history: type, chemicals, duration, dates (most recent 20) | `vesselId: UUID` |
| `getBatchTransfers` | Transfer history: vessels, volumes, dates | `batchId: UUID` |
| `getRecipeCost` | COGS breakdown for a recipe | `recipeId: UUID` |
| `getLotExpiration` | Ingredient lots expiring within N days with available quantities | `daysAhead?: number` |
| `getBatchDetail` | Full batch details by UUID or batch number | `batchId?: UUID`, `batchNumber?: string` |
| `searchBatches` | Filter batches by status, recipe, dates, batch number | `status?`, `recipeName?`, `startDate?`, `endDate?`, `batchNumber?`, `limit?` |
| `searchOrders` | Search orders by status, customer, date range | `status?`, `customerName?`, `startDate?`, `endDate?`, `limit?` |
| `getOrderDetail` | Full order with line items, customer, fulfillment | `orderId: UUID` |
| `getCustomers` | Search customers with order statistics | `query?: string`, `limit?: number` |
| `getBrands` | Search brands with style info | `query?: string`, `limit?: number` |
| `getFinishedGoods` | Finished goods inventory with availability | `brandId?: UUID`, `query?: string`, `limit?: number` |
| `lookupEntity` | Resolve names/numbers to UUIDs across batches, recipes, customers, brands, orders | `query: string`, `entityType?: enum` |
| `searchBrewLogs` | Search brew logs by status, date range, or brew number | `status?`, `startDate?`, `endDate?`, `brewNumber?`, `limit?` |
| `searchPurchaseOrders` | Search purchase orders by status, date, or supplier | `status?`, `startDate?`, `endDate?`, `supplierName?`, `limit?` |
| `searchSuppliers` | Search suppliers by name with contact info and terms | `query?: string`, `isActive?: boolean`, `limit?` |
| `searchPickLists` | Search pick lists by status, date, or customer | `status?`, `startDate?`, `endDate?`, `customerName?`, `limit?` |
| `searchYeastPitches` | Search yeast pitches with viability and strain details | `status?`, `strainName?`, `limit?` |
| `getKegInventory` | Keg inventory by state, type, or location | `state?`, `kegTypeName?`, `locationName?`, `limit?` |
| `searchDeliveries` | Search deliveries by status or date range | `status?`, `startDate?`, `endDate?`, `limit?` |
| `searchLocationTransfers` | Search location transfers by status or date | `status?`, `startDate?`, `endDate?`, `limit?` |
| `searchAllocations` | Search inventory allocations by status, source/dest type, date | `status?`, `sourceType?`, `destinationType?`, `startDate?`, `endDate?`, `limit?` |

### Navigation Tools (Write via Form Pre-fill)

Navigation tools validate inputs server-side, then return a `NavigationIntent` object. The chat panel renders this as an action card with an "Open Form" button. Clicking stores prefill data in a zustand store and navigates to the target form/dialog.

| Tool | Description | Input |
|------|-------------|-------|
| `createBatch` | Open batch creation form with recipe pre-selected | `recipeName?`, `recipeId?`, `plannedStartDate?`, `targetVolumeBbl?` |
| `transitionBatch` | Open batch transition dialog (fermentation, cancel, archive) or navigate to detail page for simple transitions | `batchId?`, `batchNumber?`, `toState: enum` |
| `addBatchReading` | Open readings page with form auto-shown | `batchId?`, `batchNumber?` |

### Current Limitations

- **Write tools are navigation-only** — the assistant pre-fills forms but the user must review and submit
- **No recipe creation tools** — deferred to future expansion
- **No order management tools** — deferred to future expansion

---

## UI Components

### Chat Panel (`src/components/domain/chat-panel.tsx`)
- Right sidebar sheet (384px default, expandable to 50vw)
- Message list with auto-scroll and streaming indicator
- User/assistant message bubbles with markdown rendering

### Chat Toggle (`src/components/domain/chat-toggle.tsx`)
- Header button with Claude icon
- Tooltip shows keyboard shortcut (`Cmd+.`)
- Visual indicator when chat is open

### Chat Layout (`src/components/domain/chat-layout.tsx`)
- Wrapper component that injects ChatPanel alongside page content

### Chat Context (`src/contexts/chat-context.tsx`)
- Global React context for chat open/close state
- Parses current URL to determine page context (section, entity type, entity ID)
- Keyboard shortcut handling (`Cmd+.` / `Ctrl+.`)
- Uses `useChat` from `@ai-sdk/react`

### AI Elements (`src/components/ai-elements/`)
Pre-built chat UI primitives:
- `conversation.tsx` — Message list container with auto-scroll
- `message.tsx` — Message bubbles with streaming markdown via `streamdown`
- `prompt-input.tsx` — Input with attachment support and paste handling

---

## Quick Start for AI Agents

The system is self-describing through:

1. **Schema Registry** - Database table `_schema_registry` contains metadata about all tables
2. **Entity Configurations** - TypeScript configs define UI, validation, and behavior
3. **Calculated Views** - Complex data derived on read, not stored
4. **Consistent Patterns** - Universal state machines, allocation-based inventory

### Core Workflow
```
Recipe → Brew Log (hot-side) → Batch (cold-side) → Packaging → Finished Goods → Orders
           ↓                        ↓
      Events timeline          Yeast pitching
      OG measurement           FG measurement
      Ingredient usage         Vessel transfers
```

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Recipe** | Blueprint for brewing - ingredients, process parameters, targets |
| **Brew Log** | Hot-side execution record - brew day events, measurements |
| **Batch** | Cold-side fermentation slot - planned independently, linked to brew logs |
| **Finished Good** | Packaged product ready for sale |
| **Allocation** | Inventory movement record (never mutable balances) |

---

## Querying the Schema

### Get All Tables and Descriptions
```sql
SELECT table_name, description, domain, relationships, key_fields, query_examples
FROM _schema_registry
ORDER BY domain, table_name;
```

### Get Tables by Domain
```sql
SELECT table_name, description, key_fields
FROM _schema_registry
WHERE domain = 'production'
ORDER BY table_name;
```

### Understand Relationships
```sql
SELECT
  table_name,
  description,
  relationships->'hasMany' as has_many,
  relationships->'belongsTo' as belongs_to
FROM _schema_registry
WHERE relationships IS NOT NULL;
```

---

## Recipe Analysis

### Get Recipe with Calculated Estimates
```sql
SELECT
  r.*,
  est_og, est_fg, est_abv, est_ibu, est_srm, est_cogs
FROM recipes_with_estimates r
WHERE r.id = :recipe_id;
```

### Get Recipe Ingredients
```sql
-- Grain bill
SELECT rm.*, m.name as malt_name, m.type as malt_type
FROM recipe_malts rm
JOIN malts m ON m.id = rm.malt_id
WHERE rm.recipe_id = :recipe_id
ORDER BY rm.position;

-- Hop schedule
SELECT rh.*, h.name as hop_name, h.type as hop_type
FROM recipe_hops rh
JOIN hops h ON h.id = rh.hop_id
WHERE rh.recipe_id = :recipe_id
ORDER BY rh.position;

-- Yeast
SELECT y.* FROM yeasts y
JOIN recipes r ON r.yeast_id = y.id
WHERE r.id = :recipe_id;
```

### Compare Recipe to Style Guidelines
```sql
SELECT
  r.name as recipe_name,
  bs.name as style_name,
  -- OG comparison
  r_est.est_og as recipe_og,
  bs.og_min as style_og_min,
  bs.og_max as style_og_max,
  CASE
    WHEN r_est.est_og BETWEEN bs.og_min AND bs.og_max THEN 'in_range'
    WHEN r_est.est_og < bs.og_min THEN 'below_range'
    ELSE 'above_range'
  END as og_status,
  -- IBU comparison
  r_est.est_ibu as recipe_ibu,
  bs.ibu_min as style_ibu_min,
  bs.ibu_max as style_ibu_max,
  CASE
    WHEN r_est.est_ibu BETWEEN bs.ibu_min AND bs.ibu_max THEN 'in_range'
    WHEN r_est.est_ibu < bs.ibu_min THEN 'below_range'
    ELSE 'above_range'
  END as ibu_status,
  -- ABV comparison
  r_est.est_abv as recipe_abv,
  bs.abv_min as style_abv_min,
  bs.abv_max as style_abv_max,
  -- SRM comparison
  r_est.est_srm as recipe_srm,
  bs.srm_min as style_srm_min,
  bs.srm_max as style_srm_max
FROM recipes r
JOIN recipes_with_estimates r_est ON r_est.id = r.id
JOIN beer_styles bs ON bs.id = r.style_id
WHERE r.id = :recipe_id;
```

---

## Common AI Tasks

### 1. Recipe Review
When reviewing a recipe, check:
- **Style compliance** - Does it meet BJCP guidelines?
- **Grain bill balance** - Base malt percentage, specialty grain ratios
- **Hop schedule** - Bittering vs flavor/aroma additions
- **Water chemistry** - Sulfate/chloride ratio for style
- **Yeast match** - Attenuation, flavor profile for style

### 2. Batch Analysis
```sql
-- Get batch with all related data
SELECT
  b.*,
  r.name as recipe_name,
  bl.brew_date,
  bl.events as brew_events,
  v.name as vessel_name
FROM batches b
LEFT JOIN recipes r ON r.id = b.recipe_id
LEFT JOIN brew_log_batches blb ON blb.batch_id = b.id
LEFT JOIN brew_logs bl ON bl.id = blb.brew_log_id
LEFT JOIN vessels_with_current_batch v ON v.current_batch_id = b.id
WHERE b.id = :batch_id;
```

### 3. Inventory Status
```sql
-- Available finished goods by brand
SELECT
  br.name as brand_name,
  pt.name as package_type,
  SUM(bi.quantity) as total_quantity,
  SUM(bi.quantity) - COALESCE(
    (SELECT SUM(a.quantity)
     FROM allocations a
     WHERE a.source_type = 'finished_good'
     AND a.source_id = fg.id
     AND a.status IN ('planned', 'completed')), 0
  ) as available
FROM bin_inventory bi
JOIN finished_goods fg ON fg.id = bi.finished_good_id
JOIN brands br ON br.id = fg.brand_id
JOIN selling_formats sf ON sf.id = fg.selling_format_id
JOIN containers c ON c.id = sf.container_id
GROUP BY br.id, sf.id, c.id, fg.id;
```

### 4. Production Planning
```sql
-- Batches in progress with timeline
SELECT
  b.batch_number,
  b.status,
  r.name as recipe_name,
  b.planned_start_date,
  bl.brew_date as actual_brew_date,
  b.planned_start_date + INTERVAL '1 day' * r.fermentation_days as est_fermentation_end,
  b.planned_start_date + INTERVAL '1 day' * (r.fermentation_days + r.conditioning_days) as est_ready_date
FROM batches b
JOIN recipes r ON r.id = b.recipe_id
LEFT JOIN brew_log_batches blb ON blb.batch_id = b.id
LEFT JOIN brew_logs bl ON bl.id = blb.brew_log_id
WHERE b.status NOT IN ('completed', 'cancelled')
ORDER BY b.planned_start_date;
```

---

## TypeScript AI Utilities (`src/lib/ai/`)

### Recipe Analyzer (`recipe-analyzer.ts`)

**Functions:**
- `analyzeStyleCompliance(recipeId)` — Calls `analyze_recipe_style_compliance` RPC
- `getRecipeSummary(recipeId)` — Calls `get_recipe_summary` RPC
- `getRecipeSuggestions(recipeId)` — Calls `suggest_recipe_improvements` RPC

**Calculation Utilities:**
- `BrewingCalculations.calculateOG(grains, volumeGal, efficiency)`
- `BrewingCalculations.calculateFG(og, attenuationPercent)`
- `BrewingCalculations.calculateABV(og, fg)`
- `BrewingCalculations.calculateIBU(hops, og, volumeGal)` — Tinseth formula
- `BrewingCalculations.calculateSRM(grains, volumeGal)` — Morey equation
- `BrewingCalculations.sgToPlato(sg)` / `platoToSG(plato)` — Gravity unit conversion

**Water Chemistry:**
- `WaterChemistry.sulfateChlorideRatio(sulfate, chloride)`
- `WaterChemistry.getRecommendedProfile(styleCategory)` — Returns target sulfate/chloride ranges
- `WaterChemistry.analyzeForStyle(profile, styleCategory)` — Suitability check with recommendation

**Fermentation Analysis:**
- `FermentationAnalysis.validateFermentationTemp(tempF, yeast)` — Check temp vs yeast range
- `FermentationAnalysis.estimateTimeline(og, yeastType)` — Estimate primary + conditioning days

### Schema Context (`schema-context.ts`)

**Functions:**
- `getSchemaContext(domain?)` — Full schema metadata via `get_ai_schema_context` RPC
- `getSchemaRegistry(domain?)` — Direct query of `_schema_registry` table
- `getDomainSummary()` — High-level domain overview with table lists
- `getTableInfo(tableName)` — Single table info with relationships
- `getRelatedTables(tableName)` — Find parent/child tables
- `getStateMachine(tableName)` — State machine config for stateful entities
- `getValidTransitions(tableName, currentState)` — Valid next states
- `generateAIContextPrompt(domains?)` — Generate schema prompt text for AI

**Constants:**
- `DOMAIN_DESCRIPTIONS` — Human-readable descriptions for each domain
- `QUERY_TEMPLATES` — Pre-built SQL templates for recipes, batches, inventory, vessels

### Query Helpers (`query-helpers.ts`)

`AIQueryHelpers` object with pre-built Supabase queries:

| Helper | Description |
|--------|-------------|
| `searchRecipes(query, options?)` | Search by name, optional estimates |
| `findRecipesWithIngredient(type, id)` | Recipes using a specific malt/hop/yeast |
| `getBatchStatusSummary()` | Count batches by status |
| `getBatchesReadyForTransition()` | Batches with possible next states |
| `getVesselAvailability()` | Available vs in-use vessels |
| `getBrandInventory(brandId)` | Inventory levels for a brand |
| `getPendingOrders(options?)` | Orders awaiting fulfillment |
| `getRecentBrewLogs(limit?)` | Recent brew day records |
| `getStyleGuidelines(styleId)` | BJCP style specs |
| `compareRecipeToStyle(recipeId)` | Recipe vs style analysis |
| `getYeastInventory()` | Yeast pitches with viability status |
| `getIngredientInventory(category?)` | Raw ingredient stock levels |
| `getProductionSchedule(startDate, endDate)` | Batches in date range |

---

## Recipe Calculation Formulas

### Original Gravity (OG)
```
Points = SUM(malt.weight_lbs * malt.ppg)
OG = 1 + (Points * mash_efficiency / volume_gal) / 1000
```

### Final Gravity (FG)
```
FG = 1 + (OG - 1) * (1 - attenuation / 100)
```

### ABV (Alcohol by Volume)
```
ABV = (OG - FG) * 131.25
```

### IBU (Tinseth Formula)
```
For each hop addition:
  Utilization = 1.65 * 0.000125^(OG-1) * (1 - e^(-0.04 * boil_time)) / 4.15
  IBU_contribution = (weight_oz * alpha_acid * utilization * 74.89) / volume_gal
IBU = SUM(IBU_contributions)
```

### SRM (Morey Equation)
```
MCU = SUM(malt.weight_lbs * malt.color_lov / volume_gal)
SRM = 1.4922 * MCU^0.6859
```

---

## Water Chemistry Guidelines

### Style Profiles
| Style | SO4:Cl Ratio | Character |
|-------|--------------|-----------|
| IPA/Hoppy | 2:1 to 3:1 | Hop-forward, crisp |
| Balanced | 1:1 | Balanced |
| Malty | 1:2 | Malt-forward, full |
| Pilsner | Low both | Soft, delicate |
| Stout | 1:1 to 1:2 | Smooth, full |

### Key Ions
- **Calcium (Ca)**: 50-150 ppm - enzyme function, yeast health
- **Magnesium (Mg)**: 10-30 ppm - yeast nutrient
- **Sulfate (SO4)**: 50-350 ppm - hop dryness/bitterness
- **Chloride (Cl)**: 50-250 ppm - fullness, malt sweetness
- **Sodium (Na)**: 0-150 ppm - palate fullness
- **Bicarbonate (HCO3)**: 0-250 ppm - pH buffering

---

## Mash Schedule Guidance

### Single Infusion (Most Common)
```json
[{
  "step_type": "infusion",
  "temperature_f": 152,
  "duration_min": 60,
  "water_ratio": 1.25
}]
```

### Step Mash (German Styles)
```json
[
  { "step_type": "temperature", "temperature_f": 122, "duration_min": 15 },
  { "step_type": "temperature", "temperature_f": 148, "duration_min": 30 },
  { "step_type": "temperature", "temperature_f": 158, "duration_min": 15 }
]
```

### Temperature Effects
| Temp (F) | Effect |
|----------|--------|
| 148-152 | More fermentable, drier beer |
| 152-156 | Balanced |
| 156-160 | Less fermentable, fuller body |

---

## Fermentation Guidance

### Schedule Template
```json
[
  { "stage": "primary", "temperature_f": 68, "duration_days": 7 },
  { "stage": "diacetyl_rest", "temperature_f": 72, "duration_days": 2 },
  { "stage": "cold_crash", "temperature_f": 34, "duration_days": 3 }
]
```

### Yeast Temperature Ranges
- **Ale yeasts**: 60-75F (style dependent)
- **Lager yeasts**: 46-58F
- **Belgian yeasts**: 65-85F (often ramped)

---

## Natural Language Query Examples

**Recipes:**
- "Show me all IPA recipes"
- "What recipes have ABV over 7%?"
- "List recipes using Citra hops"
- "What's the grain bill for [recipe name]?"
- "Does this recipe meet BJCP guidelines for [style]?"

**Production:**
- "What batches are currently fermenting?"
- "When will batch [number] be ready for packaging?"
- "What's the OG variance for [recipe] batches?"
- "Which vessels are available?"

**Inventory:**
- "How much [brand] do we have in stock?"
- "What's going to expire in the next 30 days?"
- "Do we have enough [hop] for the planned batches?"

**Purchasing:**
- "What purchase orders are outstanding?"
- "When does our next order from [supplier] arrive?"
- "Show me all suppliers for hops"

**Fulfillment:**
- "What pick lists need to go out today?"
- "Show pick lists for [customer]"

**Logistics:**
- "Show deliveries scheduled this week"
- "What transfers are in transit?"
- "How many kegs do we have filled at [location]?"

**Yeast:**
- "What yeast pitches are available?"
- "Show me pitches with low viability"

**Analysis:**
- "Compare actual vs target OG for recent batches"
- "What's our average fermentation time for IPAs?"
- "Which recipes have the highest COGS?"

---

## File Reference

### API
- `src/app/api/chat/route.ts` — Chat endpoint (auth, API key resolution, streaming)
- `src/app/api/chat/tools.ts` — Tool definitions (32 read tools + 3 navigation tools)

### Prefill Store
- `src/contexts/prefill-store.ts` — Zustand store for NavigationIntent data (prefill + dialog auto-open)

### AI Library
- `src/lib/ai/index.ts` — Public exports
- `src/lib/ai/recipe-analyzer.ts` — Brewing calculations, recipe analysis, water chemistry
- `src/lib/ai/schema-context.ts` — Schema introspection, query templates, domain summaries
- `src/lib/ai/query-helpers.ts` — Pre-built Supabase queries (13 helpers)

### UI Components
- `src/components/domain/chat-panel.tsx` — Chat sidebar panel
- `src/components/domain/chat-toggle.tsx` — Header toggle button
- `src/components/domain/chat-layout.tsx` — Layout wrapper
- `src/contexts/chat-context.tsx` — Chat state, page context, keyboard shortcut

### AI Elements
- `src/components/ai-elements/conversation.tsx` — Message list container
- `src/components/ai-elements/message.tsx` — Streaming markdown message bubbles
- `src/components/ai-elements/prompt-input.tsx` — Chat input with attachments

### Database
- `supabase/migrations/00008_ai_integration.sql` — AI RPC functions
- `supabase/migrations/00064_ai_api_key_settings.sql` — API key storage

### Other
- `src/lib/help-content.ts` — Help content injected into system prompt

---

## Entity Configuration Structure

Each entity in `src/entities/` is defined declaratively:

```typescript
interface EntityConfig<T> {
  name: string;           // Entity identifier
  table: string;          // Database table name
  displayName: string;    // Human-readable name
  domain: string;         // Domain: production, inventory, sales, etc.

  // List view configuration
  listColumns: ColumnDef<T>[];
  listFilters: FilterDef[];
  defaultSort: { field: string; direction: 'asc' | 'desc' };

  // Form configuration
  formSchema: ZodSchema;  // Validation schema
  formFields: FieldDef[]; // Field definitions

  // State machine (if stateful)
  stateMachine?: {
    stateField: string;
    states: string[];
    transitions: Record<string, string[]>;
  };

  // Relations
  relations: RelationDef[];

  // AI context
  queryExamples: string[];
  keyFields: string[];
}
```

---

## Best Practices for AI Interaction

1. **Always query `_schema_registry` first** to understand available tables
2. **Use calculated views** (`recipes_with_estimates`, `vessels_with_current_batch`) instead of base tables when estimates are needed
3. **Check state machine transitions** before suggesting status changes
4. **Understand allocation flow** - quantities are never stored, always calculated
5. **Reference style guidelines** when analyzing recipes
6. **Consider brewing science** - temperature effects, water chemistry, yeast behavior

## Error Handling

Common issues AI should detect:
- Recipe estimates outside style guidelines
- Fermentation temperature outside yeast range
- Water chemistry imbalanced for style
- Mash temperature affecting fermentability
- Low yeast viability
- Insufficient inventory for planned production

---

## Related Documents

- [Architecture](./architecture.md) - System design decisions
- [Modules](./modules.md) - Feature specifications
- [Workflows](./workflows.md) - State machines
- [Data Model](../data-model/) - Schema details
