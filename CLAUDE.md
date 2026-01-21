# MGR - Brewery Management System

## Quick Context

MGR is a professional brewery management system following an **AI-first, minimalist design philosophy**.

**Key Docs**:
- `README.md` - Setup, commands, project structure
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

## When making commits

1. Never put Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>