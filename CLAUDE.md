# MGR - Brewery Management System

## Tech Stack
- Primary: TypeScript, JavaScript
- Frontend: HTML, CSS
- Backend: PostgREST with PostgreSQL
- Config: JSON, YAML
- Always prefer TypeScript over plain JavaScript for new files

## Quick Context

MGR is a professional brewery management system following an **AI-first, minimalist design philosophy**.

**Key Docs**:
- `README.md` - Setup, commands, project structure
- `.beads/` - Task tracking (source of truth for work items and status)
- `docs/spec/` - Technical specification (see `docs/spec/README.md` for navigation)
  - `docs/spec/decisions.md` - Schema review decisions (DEC-*)
  - `docs/spec/architecture.md` - Tech stack and design patterns
  - `docs/spec/workflows.md` - State machines and allocation rules
  - `docs/spec/ai-integration.md` - AI patterns, queries, brewing science
- `docs/data-model/` - Schema documentation (source of truth for table structures)

## Design Principles

1. **Primitives over Modules** - Composable building blocks, not monolithic features
2. **Schema as Documentation** - Database schema is self-describing via `_schema_registry`
3. **One Pattern, Many Uses** - Universal components that adapt to context
4. **Minimize, Don't Maximize** - Only build what's needed

## Key Patterns

### Entity Configuration (`src/entities/`)
Each entity has one config file defining list columns, form schema, state machine, dialogs, relations.
Universal components render from these configs.

```typescript
export const entityEntity: EntityConfig<EntityType> = {
  // Identity
  name: "entity_name",
  table: "table_name",
  viewTable: "view_name",  // Optional: for computed fields
  displayName: "Entity",
  displayNamePlural: "Entities",
  description: "...",
  domain: "production" | "inventory" | "sales" | "purchasing",

  // List View
  listColumns: [...],
  listFilters: [...],
  defaultSort: { column: "...", direction: "asc" | "desc" },
  searchableFields: [...],

  // Detail View
  detailHeader: { title: "field", subtitle: "field", badge: "status_field" },
  detailSections: [...],

  // Form
  formSchema: zodSchema,
  formFields: [...],

  // State Machine (if applicable)
  stateMachine: { stateField, states, transitions, stateDisplay },
  actions: [...],

  // Relations
  relations: [...],

  // AI Context
  queryExamples: [...],
  keyFields: [...],
};
```

### Page Pattern
All entity pages use universal components:

```
/[domain]/[entity-plural]/
  page.tsx         -> <EntityList entity={config} />
  new/page.tsx     -> <EntityForm entity={config} />
  [id]/page.tsx    -> <EntityDetail entity={config} id={id} />
  [id]/edit/page.tsx -> <EntityForm entity={config} id={id} />
```

### Migration Naming
Pattern: `00XXX_description.sql`
Current highest: `00086`
Next available: `00087`

### Reference Files by Pattern

| Pattern | Reference File |
|---------|----------------|
| Entity config with state machine | `src/entities/batch.tsx` |
| Entity config with viewTable | `src/entities/vessel.tsx` |
| Domain component (editor) | `src/components/domain/grain-bill-editor.tsx` |
| Entity pages | `src/app/(app)/production/batches/` |
| Catalog selector | `src/components/domain/hop-schedule-editor.tsx` |

### Form Field Types
Entity forms support these field types:
- `text`, `textarea`, `number` - Basic inputs
- `select` - Dropdown with static `options` or `dynamicOptions`
- `relation` - Dropdown that auto-fetches from related entity table
- `switch`, `checkbox` - Boolean toggles
- `date`, `datetime` - Date pickers
- `unit` - Number input with unit conversion (requires `unitType`)

For foreign key fields, use `type: "relation"`:
```typescript
{
  name: "location_id",
  label: "Location",
  type: "relation",
  relation: {
    entity: "location",      // Entity name from registry
    displayField: "name",    // Field to show in dropdown
  },
}
```

### Zod Schema Validation
For cross-field validation, use `.refine()`:
```typescript
export const transferSchema = z.object({
  from_vessel_id: z.string().uuid().nullable(),
  to_vessel_id: z.string().uuid(),
}).refine(
  (data) => !data.from_vessel_id || data.from_vessel_id !== data.to_vessel_id,
  {
    message: "Cannot transfer to the same vessel",
    path: ["to_vessel_id"],  // Show error on this field
  }
);
```

### Universal Components (`src/components/universal/`)
- `EntityList` - Renders any entity list from config
- `EntityDetail` - Renders any entity detail from config
- `EntityForm` - Renders any entity form from config

### State Machines
Stateful entities use universal state machine pattern. Transitions validated client + server.

### Allocations
All inventory movements via unified `allocations` table. Quantities calculated via views, never stored as mutable balances.

### Calculated Fields
Recipe estimates (OG, FG, ABV, IBU, SRM) are calculated on read via `recipes_with_estimates` view. Vessel current batch derived via `vessels_with_current_batch` view.

### Centralized Query Keys (`src/lib/query-keys.ts`)
All React Query cache keys must use factory functions from `query-keys.ts`. Never use hardcoded arrays.

```typescript
// CORRECT: Use centralized query key factories
import { entityKeys, dashboardKeys } from "@/lib/query-keys";

useQuery({
  queryKey: entityKeys.list("batches", filters),
  // ...
});

useQuery({
  queryKey: dashboardKeys.batchCounts(),
  // ...
});

// WRONG: Hardcoded query key arrays
useQuery({
  queryKey: ["batches", "list", filters],  // Don't do this
  // ...
});
```

Available key factories:
- `entityKeys` - Generic CRUD operations (list, detail, options)
- `dashboardKeys` - Dashboard metrics and summaries
- `notificationKeys` - User notifications
- `catalogKeys` - Catalog/lookup data
- `recipeKeys`, `batchKeys`, `orderKeys` - Domain-specific queries

When adding new queries, add a key factory to `query-keys.ts` first.

## Schema Registry

The `_schema_registry` table contains self-documenting metadata about all tables. Query it to understand the schema:

```sql
SELECT table_name, description, domain, relationships
FROM _schema_registry
ORDER BY domain, table_name;
```

## When Making Changes

1. Check `docs/spec/decisions.md` for schema decisions and their status
2. Follow entity configuration pattern for new entities
3. Use universal components; only create domain components when necessary
4. Update data model docs in `docs/data-model/` when changing schema
5. Add `_schema_registry` entries in migrations for new tables
6. Document new architecture decisions in `docs/spec/decisions.md` or `docs/spec/architecture.md`

## UI Component Rules (MUST FOLLOW)

See `docs/spec/architecture.md` for full details on DEC-007 and DEC-008.

### Status labels from entity configs (DEC-007)
```typescript
// CORRECT: Use helper functions
import { getStateLabel } from "@/types/entity";
<Badge>{getStateLabel(vesselEntity, status)}</Badge>

// WRONG: Hardcoded status labels in components
const labels = { available: "Available" };
```

### No empty strings in Select options (DEC-008)
```typescript
// WRONG: Radix Select reserves "" for "no selection"
{ value: "", label: "All" }

// CORRECT: Don't add "All" options - entity-list.tsx adds them automatically
// For "None" options, use sentinel: { value: "_none", label: "None" }
```

## Database Security Rules (MUST FOLLOW)

When writing SQL migrations, always follow these rules. See `docs/spec/architecture.md` for full details.

### Views: Use security_invoker
```sql
-- ALWAYS use security_invoker = true
CREATE VIEW my_view
WITH (security_invoker = true)
AS SELECT ...;
```

### Never expose auth.users
```sql
-- WRONG: Don't join auth.users in views
SELECT u.email FROM auth.users u ...

-- CORRECT: Cache user info in the table itself
ALTER TABLE my_table ADD COLUMN user_name TEXT;
```

### Enable RLS on all tables
```sql
-- Always pair policies with RLS enabled
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;
CREATE POLICY my_policy ON my_table ...;
```

### Set search_path on functions
```sql
CREATE FUNCTION my_func()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public  -- Always set this
AS $$ ... $$;
```

### Restrictive RLS policies
```sql
-- WRONG: Too permissive
WITH CHECK (true)

-- CORRECT: Specific conditions
WITH CHECK (auth.uid() = user_id)
```

## AI Integration

MGR is designed for AI assistance. Key resources:

### Database Functions
```sql
-- Analyze recipe against style guidelines
SELECT * FROM analyze_recipe_style_compliance('recipe-uuid');

-- Get comprehensive recipe summary
SELECT * FROM get_recipe_summary('recipe-uuid');

-- Get improvement suggestions
SELECT * FROM suggest_recipe_improvements('recipe-uuid');

-- Analyze batch performance
SELECT * FROM analyze_batch_performance('batch-uuid');

-- Get schema context for AI
SELECT * FROM get_ai_schema_context('production');
```

### TypeScript Utilities (`src/lib/ai/`)
```typescript
import {
  analyzeStyleCompliance,
  getRecipeSummary,
  BrewingCalculations,
  WaterChemistry,
  AIQueryHelpers
} from '@/lib/ai';
```

### Recipe Analysis
When reviewing recipes, check:
- Style compliance (OG, FG, ABV, IBU, SRM vs BJCP guidelines)
- Grain bill balance (70-90% base malt typical)
- Hop schedule (bittering vs flavor/aroma)
- Water chemistry (sulfate:chloride ratio for style)
- Fermentation temp vs yeast range

## Database Debugging

When debugging database issues, always check:
1. PostgREST schema cache (`NOTIFY pgrst, 'reload schema'`)
2. Stale enum/lookup table data
3. Check constraints and triggers

...before assuming application-level bugs.

## Problem Solving Guidelines

Before implementing any fix, first explain: 1) What you believe the root cause is, 2) Why you believe this, 3) Two alternative approaches ranked by likelihood of success. Wait for confirmation before writing code.

When a first fix attempt doesn't work, STOP and re-analyze the root cause before trying another patch. Present 2-3 alternative approaches with tradeoffs before implementing.

Debug systematically: 1) Reproduce the exact error, 2) Identify which layer the bug is in (database, API, frontend), 3) Check for stale caches or data, 4) Propose the minimal fix, 5) Verify the fix resolves the original error. Show each step.

For cross-stack bugs, use separate task agents to investigate in parallel: Agent 1 checks database schema, constraints, and recent migrations. Agent 2 traces the API request/response flow. Agent 3 checks frontend form submission logic. Then synthesize findings.

When a test-driven fix is feasible: first write a failing test that reproduces the bug, run it to confirm it fails, then fix the underlying code. Run the test again — if it still fails, analyze why and iterate. Keep looping until the test passes and all existing tests still pass. Summarize what caused the bug and what changed.

## When making commits

1. Always run `pnpm lint` before committing and fix any errors introduced by your changes
2. Never put Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>