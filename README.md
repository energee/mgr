# MGR - Brewery Management System

A professional brewery management system for tracking production, inventory, sales, and TTB compliance.

## Tech Stack

- **Framework**: Next.js 16 (App Router) + React 19
- **Database**: Supabase (PostgreSQL)
- **UI**: shadcn/ui + Tailwind CSS 4
- **State**: TanStack Query, Form, Table
- **Validation**: Zod

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm
- Supabase CLI

### Setup

1. **Install dependencies**
   ```bash
   pnpm install
   ```

2. **Set up environment**
   ```bash
   cp .env.example .env.local
   # Add your Supabase credentials
   ```

3. **Run database migrations**
   ```bash
   supabase db push
   ```

4. **Generate types**
   ```bash
   pnpm db:generate
   ```

5. **Start development server**
   ```bash
   pnpm dev
   ```

Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
src/
  app/
    (auth)/         # Login, signup
    (app)/          # Authenticated app
      production/   # Batches, recipes, vessels
      packaging/    # Sessions, formats
      inventory/    # Finished goods, bins, transfers
      sales/        # Orders, customers
  components/
    ui/             # shadcn components
    universal/      # EntityList, EntityDetail, EntityForm
    domain/         # Domain-specific components
  entities/         # Entity configurations
  lib/              # Utilities, Supabase client
  types/            # TypeScript types

docs/
  MGR-SPECIFICATION.md   # Full system specification
  data-model/            # Schema documentation

supabase/
  migrations/       # Database migrations
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Production build |
| `pnpm typecheck` | Type checking |
| `pnpm lint` | Linting |
| `pnpm db:generate` | Generate Supabase types |

## Documentation

- [Full Specification](docs/MGR-SPECIFICATION.md) - Complete system spec including schema decisions
- [Data Model](docs/data-model/) - Detailed schema documentation

## Architecture

MGR follows an **entity configuration pattern**. Each entity (batch, order, recipe) is defined declaratively:

```typescript
// src/entities/batch.tsx
export const batchConfig: EntityConfig<Batch> = {
  name: 'batch',
  table: 'batches',
  listColumns: [...],
  formSchema: batchSchema,
  stateMachine: {...},
}
```

Universal components (`EntityList`, `EntityDetail`, `EntityForm`) render from these configs, reducing boilerplate while allowing customization through escape hatches.

## Key Concepts

- **Allocation-based inventory**: Quantities calculated from allocations, never stored as mutable balances
- **State machines**: All stateful entities use consistent state machine patterns
- **Brink-based yeast tracking**: Physical yeast containers with viability tracking and lineage
- **TTB compliance**: Built-in mapping to TTB Form 5130.9 lines
