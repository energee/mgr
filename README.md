# MGR

[![Test](https://github.com/energee/mgr/actions/workflows/test.yml/badge.svg)](https://github.com/energee/mgr/actions/workflows/test.yml)
[![DB Lint](https://github.com/energee/mgr/actions/workflows/db-lint.yml/badge.svg)](https://github.com/energee/mgr/actions/workflows/db-lint.yml)
[![last commit](https://img.shields.io/github/last-commit/energee/mgr)](https://github.com/energee/mgr/commits/main)
[![open issues](https://img.shields.io/github/issues/energee/mgr)](https://github.com/energee/mgr/issues)

A full-stack operations management system covering production, inventory, purchasing, sales, and compliance reporting. Built with an AI-first, config-driven architecture.

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

- Node.js 24+
- [Bun](https://bun.sh/) 1.3+ (`curl -fsSL https://bun.sh/install | bash`)
- [Supabase CLI](https://supabase.com/docs/guides/cli)

### Setup

```bash
# 1. Install dependencies and run environment checks
make setup        # or: bun install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local with your Supabase project URL, anon key, and service role key

# 3. Run database migrations
supabase db push

# 4. Generate TypeScript types from your database schema
bun db:generate

# 5. Start dev server (uses Turbopack)
make dev          # or: bun dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
src/
  app/
    (auth)/              # Login, magic link, OTP
    (app)/               # Authenticated app shell
      dashboard/         # Production, inventory, sales dashboards
      production/        # Batches, recipes, production logs, planning
      inventory/         # Raw materials, finished goods, lots, containers, transfers
      purchasing/        # Suppliers, purchase orders, material demand
      sales/             # Orders, pick lists, customers
      reports/           # Compliance, production summary, COGS, projections, batch cost
      settings/          # Organization, users, pricing, integrations
    portal/              # Customer-facing order portal
    api/                 # API routes (chat, webhooks, invites)
  components/
    ui/                  # shadcn primitives + animated icons
    universal/           # Config-driven components (EntityList, EntityDetailUnified)
    domain/              # Feature-specific components (recipe editor, production log, etc.)
    dashboard/           # Dashboard widgets (stats, charts, sections)
  entities/              # Entity configs, one directory per entity (~40 entities)
  domain/                # Business-logic calculations (units, BOM, planning, compliance)
  services/              # Entity orchestration over domain logic and Supabase
  integrations/          # Third-party clients (Square, QuickBooks, Slack, email)
  lib/                   # Infrastructure: Supabase client, query keys, formatters
  hooks/                 # Custom React hooks
  types/                 # TypeScript types (including generated Supabase types)
  contexts/              # React contexts (permissions, notifications)

docs/
  spec/                  # Technical specification
    architecture.md      # Tech stack, design patterns, security rules
    decisions.md         # Schema review decisions (DEC-*)
    workflows.md         # State machines, allocation rules
    ai-integration.md    # AI patterns and queries
  data-model/            # Schema documentation per domain
  agents/                # Agent-facing quick references
  plans/                 # Implementation plans

supabase/
  migrations/            # Numbered SQL migrations (00001–00266)
```

## Commands

| Command | Description |
|---------|-------------|
| `make dev` | Start dev server (Turbopack) |
| `make check-fast` | Lint + typecheck (fast feedback loop) |
| `make check` | Pre-commit gate: lint, typecheck, tests, DB rules, build |
| `make check-all` | Full gate including Playwright E2E |
| `bun run test` | Unit tests (Vitest — note: `bun test` is Bun's own runner, don't use it) |
| `bun run test:watch` | Tests in watch mode |
| `bun e2e` | Playwright end-to-end tests |
| `bun db:generate` | Generate Supabase TypeScript types |
| `bun analyze` | Bundle analysis |

Run `make help` for the full target list.

## Architecture

### Entity Configuration Pattern

Every domain entity is defined declaratively in `src/entities/<name>/` (`core.ts` + `presentation.tsx` + `index.ts`). The config specifies list columns, form schema, state machine, relations, and AI context. Universal components render from these configs.

```typescript
// src/entities/order/core.ts
export const orderEntity: EntityConfig<Order> = {
  name: "order",
  table: "orders",
  viewTable: "orders_with_details",  // view with computed fields
  listColumns: [...],
  formSchema: orderSchema,
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
- **Calculated fields via views** — recipe estimates, equipment status, and inventory quantities are computed in PostgreSQL views, not stored.
- **Centralized query keys** — all React Query cache keys use factory functions from `src/lib/query-keys.ts`.
- **Row Level Security** — every table has RLS policies. Views use `security_invoker = true`.

### Integrations

- **QuickBooks Online** — sync invoices and customers
- **Square** — POS webhook for order ingestion
- **Slack** — notifications for production events, low inventory alerts
- **AI Chat** — Claude-powered assistant with full domain context and write capabilities

## Key Concepts

| Concept | Description |
|---------|-------------|
| Batches | A single production run, tracked through planning → in-progress → packaging states |
| Recipes | Declarative bills of materials with process profiles and cost rollups |
| Allocations | Every inventory movement (raw material usage, finished goods, order fulfillment) is an allocation record |
| Compliance Reports | Built-in mapping of production data to regulatory reporting lines |
| Customer Portal | External-facing portal where customers can view orders and submit change requests |

## Documentation

- [`docs/spec/`](docs/spec/) — technical specification ([start here](docs/spec/README.md))
- [`docs/data-model/`](docs/data-model/) — schema documentation by domain
- [`docs/spec/architecture.md`](docs/spec/architecture.md) — architecture and security rules
- [`docs/spec/decisions.md`](docs/spec/decisions.md) — schema decisions log
- [`AGENTS.md`](AGENTS.md) — agent instructions, verification gate, and routing index for [`docs/agents/`](docs/agents/) topic docs
