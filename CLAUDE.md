# MGR - Brewery Management System

## Quick Context

MGR is a professional brewery management system following an **AI-first, minimalist design philosophy**.

**Read First**: `docs/MGR-SPECIFICATION.md` - Full specification including architecture decisions (Section 2A)

## Design Principles

1. **Primitives over Modules** - Composable building blocks, not monolithic features
2. **Schema as Documentation** - Database schema is self-describing for AI integration
3. **One Pattern, Many Uses** - Universal components that adapt to context
4. **Minimize, Don't Maximize** - Only build what's needed

## Tech Stack

- Next.js 16.x + React 19.x
- Supabase (PostgreSQL, Auth, Storage, Realtime)
- TanStack (Query, Form, Table, Virtual)
- shadcn/ui + Tailwind CSS 4.x
- Zod validation

## Key Patterns

### Entity Configuration (`/entities/`)
Each entity has one config file defining list columns, form schema, state machine, dialogs, relations.
Universal components render from these configs.

### Universal Components (`/components/universal/`)
- `EntityList` - Renders any entity list from config
- `EntityDetail` - Renders any entity detail from config
- `EntityForm` - Renders any entity form from config

### State Machines
Stateful entities use universal state machine pattern. Transitions validated client + server.

### Allocations
All inventory movements via `allocations` table. Quantities calculated, never stored as balances.

## Project Structure

```
app/
  (auth)/           # Login, signup
  (app)/            # Authenticated app shell
    production/     # Batches, recipes, vessels, brew logs
    packaging/      # Sessions, formats
    inventory/      # Finished goods, bins, transfers, kegs
    purchasing/     # POs, suppliers, ingredients
    sales/          # Orders, customers, pricing
    settings/       # System config, users, integrations
  api/              # API routes

components/
  ui/               # shadcn components
  universal/        # EntityList, EntityDetail, EntityForm, etc.
  domain/           # Domain-specific (BatchReadings, BrewLogTimeline)

entities/           # Entity configurations
lib/                # Utilities, Supabase client, state machine, allocations
types/              # TypeScript types, generated DB types
supabase/           # Migrations, seed data
```

## Commands

```bash
pnpm dev              # Development server
pnpm build            # Production build
pnpm typecheck        # Type checking
pnpm lint             # Linting
pnpm db:migrate       # Push migrations to Supabase
pnpm db:generate      # Generate TypeScript types from Supabase
pnpm db:seed          # Seed data
```

## Database Setup

To set up the database and generate types:

1. **Install Supabase CLI**: `brew install supabase/tap/supabase`
2. **Link to project**: `supabase link --project-ref <your-project-ref>`
3. **Push migrations**: `supabase db push`
4. **Generate types**: `pnpm db:generate`

The generated types will be at `src/types/supabase.ts`. This provides full type safety
for all Supabase queries. Without generated types, queries use `as any` type assertions.

**Schema Registry**: The `_schema_registry` table contains self-documenting metadata
about all tables. AI agents can query this to understand the schema structure.

## When Making Changes

1. Check `docs/MGR-SPECIFICATION.md` Section 2A for architecture decisions
2. Follow entity configuration pattern for new entities
3. Use universal components; only create domain components when necessary
4. Document new decisions in Section 2A of the specification
5. Keep this file updated if project structure changes
