# Overview

## What is MGR?

MGR is a comprehensive brewery management system designed for professional brewing operations. It handles the complete lifecycle from production planning through fulfillment, with emphasis on:

- **Planning & Allocation**: Plan batches months ahead, allocate inventory before it exists, adjust as reality differs from plan
- **Traceability**: Track beer from ingredients through batch, packaging, inventory, and customer delivery
- **Flexibility**: Rollback when possible, adjust when not, never block operations
- **Cost Tracking**: Full COGS visibility including ingredient costs, yeast lineage spreading, and landed costs

## Core Principles

1. **Planning-First**: Everything can be planned in advance (batches, packaging, orders)
2. **Allocation-Based Inventory**: No mutable running balances; quantities calculated from allocations
3. **Non-Blocking Operations**: Brewers should never be blocked by system state; log what happened, reconcile later
4. **Full Audit Trail**: All changes logged with revisions; history recalculates on backdated adjustments
5. **Mobile-First for Operations**: Brewing floor activities designed for mobile use

## Key Flows

### Production Flow

```
Recipe ──────────────────────────────────────────────────────────────────────────────────────────────
    │
    ├──→ Brew Log (hot-side) ──→ brew_log_batches ──→ Batch (cold-side) ──→ Packaging ──→ FG ──→ Orders
    │    - brew_date (actual)    (volume allocation)  - planned_start_date
    │    - events timeline                            - fermentation
    │    - OG (from events)                           - FG, ABV
    │
    └──→ Batch (cold-side)  ←─────────────────────────┘
         can have multiple brews (blend)
         or one brew can split to multiple batches
```

### Purchasing Flow

```
Demand (planned batches) → PO Generation → Supplier → Receive → Inventory Lots → Usage → COGS
```

## Design Philosophy

1. **Primitives over Modules** - Composable building blocks, not monolithic features
2. **Schema as Documentation** - Database schema is self-describing for AI integration
3. **One Pattern, Many Uses** - Universal components that adapt to context via configuration
4. **Minimize, Don't Maximize** - Only build what's needed

## Related Documents

- [Architecture](./architecture.md) - Technical implementation details
- [Modules](./modules.md) - Feature specifications
- [Workflows](./workflows.md) - State machines and processes
