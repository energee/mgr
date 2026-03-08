# MGR — Brewery Management System

A full-stack brewery management system covering production, inventory, purchasing, sales, and TTB compliance. Built with an AI-first, config-driven architecture.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) + React 19 |
| Database | Supabase (PostgreSQL + Row Level Security) |
| UI | shadcn/ui + Tailwind CSS 4 |
| State | TanStack Query (server), TanStack Table (lists), React Hook Form (forms) |
| Validation | Zod |
| AI | Vercel AI SDK + Claude |
| Auth | Supabase Auth (magic link + OTP) |
| Monitoring | Sentry (optional) |
| Email | Resend (optional) |

## Getting Started

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) (`corepack enable && corepack prepare pnpm@latest --activate`)
- [Supabase CLI](https://supabase.com/docs/guides/cli)

### Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local with your Supabase project URL, anon key, and service role key

# 3. Run database migrations
supabase db push

# 4. Generate TypeScript types from your database schema
pnpm db:generate

# 5. Start dev server (uses Turbopack)
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
src/
  app/
    (auth)/              # Login, magic link, OTP
    (app)/               # Authenticated app shell
      dashboard/         # Production, inventory, sales dashboards
      production/        # Batches, recipes, vessels, brew logs, yeast, planning
      inventory/         # Raw materials, finished goods, lots, kegs, bins, transfers
      purchasing/        # Suppliers, purchase orders, ingredient demand
      sales/             # Orders, pick lists, customers
      reports/           # TTB, production summary, COGS, projections, batch cost
      settings/          # Brewery, users, pricing, integrations
    portal/              # Customer-facing order portal
    api/                 # API routes (chat, webhooks, invites)
  components/
    ui/                  # shadcn primitives + animated icons
    universal/           # Config-driven components (EntityList, EntityDetailUnified)
    domain/              # Domain-specific components (recipe editor, brew log, etc.)
    dashboard/           # Dashboard widgets (stats, charts, sections)
  entities/              # Entity configuration files (37 entities)
  services/              # Server-side business logic
  lib/                   # Utilities, Supabase client, query keys, formatters
  hooks/                 # Custom React hooks
  types/                 # TypeScript types (including generated Supabase types)
  contexts/              # React contexts (permissions, notifications)

docs/
  spec/                  # Technical specification
    architecture.md      # Tech stack, design patterns, security rules
    decisions.md         # Schema review decisions (DEC-*)
    workflows.md         # State machines, allocation rules
    ai-integration.md    # AI patterns, brewing science
  data-model/            # Schema documentation per domain
  plans/                 # Implementation plans

supabase/
  migrations/            # Numbered SQL migrations (00001–00139)
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm typecheck` | Run `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm lint:fix` | ESLint with auto-fix |
| `pnpm test` | Run unit tests (Vitest) |
| `pnpm test:watch` | Tests in watch mode |
| `pnpm e2e` | Run Playwright end-to-end tests |
| `pnpm db:generate` | Generate Supabase TypeScript types |
| `pnpm db:generate:local` | Generate types from local Supabase |
| `pnpm analyze` | Bundle analysis |

## Architecture

### Entity Configuration Pattern

Every domain entity is defined declaratively in `src/entities/`. A single config file specifies list columns, form schema, state machine, relations, and AI context. Universal components render from these configs.

```typescript
// src/entities/batch.tsx
export const batchEntity: EntityConfig<Batch> = {
  name: "batch",
  table: "batches",
  viewTable: "batches_with_details",  // view with computed fields
  listColumns: [...],
  formSchema: batchSchema,
  stateMachine: { stateField: "status", states: {...}, transitions: {...} },
  relations: [...],
};
```

`EntityList` renders any entity's list page. `EntityDetailUnified` renders detail/edit views with inline editing. Custom pages (like the recipe editor) override this when needed.

### Page Pattern

```
/[domain]/[entity]/           → EntityList
/[domain]/[entity]/new        → EntityDetailUnified (create)
/[domain]/[entity]/[id]       → EntityDetailUnified (view + edit)
```

### Key Design Decisions

- **Allocation-based inventory** — quantities are calculated from an `allocations` table, never stored as mutable balances. This eliminates sync bugs and provides a full audit trail.
- **State machines** — all stateful entities (batches, orders, purchase orders) use a universal state machine pattern with transitions validated on both client and server.
- **Calculated fields via views** — recipe estimates (OG, FG, ABV, IBU, SRM), vessel status, and inventory quantities are computed in PostgreSQL views, not stored.
- **Centralized query keys** — all React Query cache keys use factory functions from `src/lib/query-keys.ts`.
- **Row Level Security** — every table has RLS policies. Views use `security_invoker = true`.

### Integrations

- **QuickBooks Online** — sync invoices and customers
- **Square** — POS webhook for order ingestion
- **Slack** — notifications for batch events, low inventory alerts
- **AI Chat** — Claude-powered assistant with brewery context and write capabilities

## Key Concepts

| Concept | Description |
|---------|-------------|
| Batches | A single production run of beer, tracked through planning → brewing → fermenting → conditioning → packaging |
| Recipes | Declarative beer recipes with grain bill, hop schedule, yeast, water chemistry, and mash/fermentation profiles |
| Brinks | Physical yeast containers with viability tracking, cell counts, and lineage (parent → child harvests) |
| Allocations | Every inventory movement (raw material usage, finished goods, order fulfillment) is an allocation record |
| TTB Compliance | Built-in mapping to TTB Form 5130.9 lines for federal tax reporting |
| Customer Portal | External-facing portal where customers can view orders and submit change requests |

## Documentation

- [`docs/spec/`](docs/spec/) — technical specification ([start here](docs/spec/README.md))
- [`docs/data-model/`](docs/data-model/) — schema documentation by domain
- [`docs/spec/architecture.md`](docs/spec/architecture.md) — architecture and security rules
- [`docs/spec/decisions.md`](docs/spec/decisions.md) — schema decisions log
- [`CLAUDE.md`](CLAUDE.md) — AI assistant instructions and codebase conventions
