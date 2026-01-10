# MGR - Brewery Management System

## Quick Context

MGR is a professional brewery management system following an **AI-first, minimalist design philosophy**.

**Key Docs**:
- `README.md` - Setup, commands, project structure
- `docs/MGR-SPECIFICATION.md` - Full specification including architecture decisions (Section 2A/2B/2C)
- `docs/AI.md` - AI integration guide with query examples and analysis functions
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

1. Check `docs/MGR-SPECIFICATION.md` Section 2B for schema decisions and their status
2. Follow entity configuration pattern for new entities
3. Use universal components; only create domain components when necessary
4. Update data model docs in `docs/data-model/` when changing schema
5. Add `_schema_registry` entries in migrations for new tables
6. Document new architecture decisions in Section 2A/2B of the specification

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