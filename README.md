# MGR

[![Test](https://github.com/energee/mgr/actions/workflows/test.yml/badge.svg)](https://github.com/energee/mgr/actions/workflows/test.yml)
[![last commit](https://img.shields.io/github/last-commit/energee/mgr)](https://github.com/energee/mgr/commits/main)
[![open issues](https://img.shields.io/github/issues/energee/mgr)](https://github.com/energee/mgr/issues)

A full-stack brewery management system covering production, inventory, purchasing, sales, and TTB compliance reporting. Built with an AI-first, config-driven architecture.

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
# Point NEXT_PUBLIC_SUPABASE_URL at your local stack (see below) or a hosted project

# 3. Zero-to-running local database
make db-local     # reset + migrations + RLS role fixtures + demo data

# 4. Start dev server (uses Turbopack)
make dev          # or: bun dev
```

Open [http://localhost:3000](http://localhost:3000).

`make db-local` is what makes both the dev server and `bun run test:integration`
work from a fresh clone — it runs `supabase start`, replays every migration,
loads the RLS role fixtures, and applies `supabase/seed.sql` demo data. It is
**destructive**: `supabase db reset` drops the local database (it never touches
a remote one). Skip it only if you already have a seeded database. Run
`bun db:generate:local` afterwards if the migrations changed the schema types.

To work against a **hosted** Supabase project instead, apply migrations with
`scripts/db-push.sh` (see [Deployment](#deployment)) and run `bun db:generate`
to refresh the generated types.

### Environment variables

`.env.example` is the reference — copy it and read the comments. Only four
variables are required:

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL (validated at import time in `src/lib/env.ts`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only key for privileged routes — never expose to the client |
| `SUPABASE_PROJECT_ID` | yes | Used by `bun db:generate` |
| `NEXT_PUBLIC_SITE_URL` | production | Canonical domain for invites and magic-link redirects; falls back to `NEXT_PUBLIC_APP_URL`, then `localhost:3000` |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | optional | Error tracking; auth token only for CI source-map upload |
| `ANTHROPIC_API_KEY` | optional | AI chat — can also be set per-user or globally in `system_settings` |
| `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI` | optional | QuickBooks Online OAuth |
| `SQUARE_ENVIRONMENT`, `SQUARE_WEBHOOK_URL` | optional | Square POS webhook ingestion |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | optional | Transactional email — set as **Supabase Edge Function secrets**, not Next.js env vars |
| `LOG_LEVEL` | optional | `debug` \| `info` \| `warn` \| `error` |
| `ENABLE_DEV_ENDPOINTS`, `DEV_LOGIN_ALLOW_REMOTE_DB` | dev only | Dev-login route; read the warning in `.env.example` before setting the second one |

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
  migrations/            # SQL migrations — `00XXX_description.sql` for
                         # locally authored ones, `<timestamp>_*.sql` for
                         # migrations pulled back from a live project
```

## Commands

| Command | Description |
|---------|-------------|
| `make dev` | Start dev server (Turbopack) |
| `make check-fast` | Lint + typecheck (fast feedback loop) |
| `make check` | Pre-commit gate: lint, typecheck, tests, DB rules, build |
| `make check-all` | Full gate including Playwright E2E |
| `bun run test` | Unit tests (Vitest — note: `bun test` is Bun's own runner, don't use it) |
| `bun run test:integration` | Integration tests against the local DB (run `make db-local` first) |
| `bun run test:coverage` | Unit tests with coverage |
| `bun run test:watch` | Tests in watch mode |
| `bun e2e` | Playwright end-to-end tests |
| `make db-local` | Reset the local DB: migrations + RLS fixtures + demo data |
| `make verify-feature ID=F003` | Verify one feature from `docs/feature_list.json` |
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

## Testing

Three layers, gated in order — no layer advances until the previous one is green:

| Layer | Command | Covers |
|-------|---------|--------|
| 1 — static | `make check-fast` | ESLint + `tsc --noEmit` |
| 2 — unit | `make check` | layer 1 + Vitest + DB rule checks + `next build`. **Required before every commit.** |
| 3 — E2E | `make check-all` | layer 2 + Playwright |

Integration tests (`bun run test:integration`) hit a real local Postgres and
need `make db-local` first; they are not part of `make check`.

## Deployment

Deployed on Vercel. `vercel.json` delegates build-skipping to
`scripts/vercel-ignore-build.sh`, so pushes that touch only docs don't trigger a
build.

Database migrations are **not** applied by the deploy. Push them explicitly:

```bash
SUPABASE_DB_URL='postgresql://...@db.<ref>.supabase.co:5432/postgres' \
  bash scripts/db-push.sh
```

`scripts/db-push.sh` runs `supabase db push --include-all` and regenerates
`supabase/live-catalog.snapshot.txt`, which the live-drift watchdog compares
against. Commit the refreshed snapshot together with the migration. The script
fails closed on pre-existing drift rather than silently re-baselining it.

## Troubleshooting

Start with [`docs/agents/gotchas.md`](docs/agents/gotchas.md) — it collects the
failure modes that make no sense on first encounter (a stale PostgREST schema
cache serving old enum values or columns, migration-number collisions,
`bun test` vs `bun run test`). For stale build/type caches: `make clean`.

## Documentation

- [`docs/spec/`](docs/spec/) — technical specification ([start here](docs/spec/README.md))
- [`docs/data-model/`](docs/data-model/) — schema documentation by domain
- [`docs/spec/architecture.md`](docs/spec/architecture.md) — architecture and security rules
- [`docs/spec/decisions.md`](docs/spec/decisions.md) — schema decisions log
- [`AGENTS.md`](AGENTS.md) — agent instructions, verification gate, and routing index for [`docs/agents/`](docs/agents/) topic docs

## License

Licensed under the [GNU Affero General Public License v3.0](LICENSE).

    Copyright (C) 2026 Ted Slesinski

    This program is free software: you can redistribute it and/or modify it
    under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or (at your
    option) any later version. It is distributed WITHOUT ANY WARRANTY; see the
    license for details.

AGPL section 13 applies: if you run a modified version of this software as a
network service, you must offer its source to the users of that service.
