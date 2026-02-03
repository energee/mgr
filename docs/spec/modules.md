# Core Modules

## Recipe Module

### Features
- Create/edit recipes
- Template support (is_template flag)
- Variable ingredients (null ingredient_id)
- Clone recipe from template
- Calculate estimated COGS
- Mash schedule builder
- Fermentation schedule builder
- Water chemistry calculator

### Template to Recipe Flow
1. Select template
2. System clones template as new recipe
3. User fills in variable ingredients
4. User assigns to brand (if not already)
5. Recipe ready for use

### Ingredient Projections
```typescript
interface IngredientProjection {
  fixed: {
    ingredient_id: string;
    name: string;
    total_amount: number;
    unit: string;
  }[];
  variable: {
    style_id: string;
    style_name: string;
    ingredient_type: string;
    total_amount: number;
    unit: string;
    batch_count: number;
  }[];
}
```

---

## Batch Module

### Features
- Create/schedule batches
- Assign recipe
- Plan packaging output
- Track through lifecycle states
- Record vessel transfers
- Add batch additions
- Record check-in readings
- Blend batches
- View allocation status

### Batch Readings
Mobile-first interface for recording:
- Temperature
- Gravity (Plato)
- pH
- Pressure
- Dissolved oxygen
- Diacetyl (scale + notes)
- Clarity (scale + notes)
- Taste/smell (freeform)

### Batch Additions
- Dry hops (first-class, dedicated UI)
- Other additions (flexible: fruit, sugar, adjunct, etc.)
- Optional inventory lot linking
- Untracked usage supported (brewer not blocked)

---

## Brew Log Module

Brew logs are **decoupled from batches** to support flexible production scenarios:
- **Split fermentation**: 1 brew → multiple batches (different yeasts, treatments)
- **Parti-gyle**: 1 brew → multiple batches (first/second runnings)
- **Blend at knockout**: Multiple brews → 1 batch

### Architecture
```
brew_logs (hot-side)          batches (cold-side)
├── brew_number               ├── batch_number
├── brew_date (actual)        ├── planned_start_date
├── events[] (timeline)       ├── status (planned→fermenting→...)
├── recipe_id                 ├── volume_bbl
└── status                    └── notes
         │                            │
         └──── brew_log_batches ──────┘
              (volume_bbl allocation)

Note: Vessel assignment tracked via vessels.current_batch_id
```

### Features
- Record brew day events timeline
- Compare actuals to recipe targets
- Track all measurements via events array
- Record ingredient additions with actual times
- Link to one or more batches with volume allocation
- Derive summary metrics from events (OG, volumes, etc.)

### Events Structure
```typescript
interface BrewLogEvent {
  id: string;
  phase: string; // strike_water, mash_in, boil_start, ko_end, etc.
  custom_phase?: string;
  time: string; // HH:MM
  measurements: {
    metric: string; // temp_f, ph, gravity_plato, volume_bbl, etc.
    value: string | number;
    custom_metric?: string;
  }[];
  ingredient?: {
    type: string;
    id: string;
  };
  vessel?: string;
  notes?: string;
}
```

### Calculated Values (derived from events, not stored)
| Value | Source Event |
|-------|--------------|
| actual_og | `gravity_plato` from `ko_end` or `boil_end` |
| pre_boil_gravity | `gravity_plato` from `boil_start` |
| volume_to_fermenter | `volume_bbl` from `ko_end` |
| actual_mash_ph | `ph` from `mash_in` |

See [`docs/data-model/brew-logs.md`](../data-model/brew-logs.md) for full schema documentation.

---

## Packaging Module

### Features
- Create packaging sessions
- Multi-product, multi-batch per session
- Plan quantities
- Record actuals
- Auto-create finished goods on completion
- Adjust after completion
- Rollback if no downstream packed orders

### Session Line Item Structure
```typescript
interface SessionLineItem {
  brand_id?: string;
  product_id?: string;
  format_id: string;
  source_batches: {
    batch_id: string;
    planned_qty: number;
    actual_qty?: number;
  }[];
  planned_quantity: number;
  actual_quantity?: number;
}
```

---

## Inventory Module

### Features
- View finished goods by brand/format
- View bin inventory
- Create transfers between locations
- Split FG across bins
- Track in-transit inventory
- View allocation status

### Bin Inventory View
```typescript
interface BinInventoryView {
  bin: Bin;
  items: {
    finished_good: FinishedGood;
    quantity: number;
    available: number; // quantity - allocated
    allocated: number;
  }[];
}
```

---

## Keg Module

### Features
- Define keg types with custom lifecycles
- Track inventory by type/size/state/location
- Record state transitions
- Track customer balances (optional)
- Debit on order ship
- Credit on return

### Keg Transaction Types
- `fill`: clean → full (packaging)
- `ship`: full → out (order)
- `return`: out → dirty (customer return)
- `clean`: dirty → clean (washing)
- `receive`: new kegs received
- `adjust`: manual adjustment

---

## Order Module

### Features
- Create/edit orders
- Auto-price from tiers (with override)
- Assign keg types per line
- Allocate from inventory (flexible)
- Pick from bins
- Pack and debit inventory
- Push to QuickBooks

### Order Pricing Flow
1. Line item added with brand/product + format
2. System looks up customer's sales channel
3. System finds price tier for that channel
4. System finds tier_price for brand (or style fallback) + format
5. Price applied to line (can be overridden)

### Allocation Flow
1. Order confirmed → attempt allocation
2. Find available FG for brand + format
3. Create planned allocation (FG → Order)
4. If insufficient: set allocation_warning = 'unallocated'
5. At picking: assign bins
6. At packed: debit bin inventory, complete allocation

---

## Purchasing Module

### Features
- Manage suppliers and catalogs
- Generate POs from demand
- Manual PO creation
- Track PO lifecycle
- Receive partial shipments
- Auto-create inventory lots
- Calculate landed costs

### PO Generation Flow
1. Calculate demand (from planned batches, date range, or low inventory)
2. Compare to current inventory + on order
3. Factor in lead times
4. Group shortfalls by preferred supplier
5. Generate draft POs
6. User reviews and adjusts
7. Submit to supplier

### Landed Cost Calculation
```typescript
function calculateLandedCosts(po: PurchaseOrder): LotCost[] {
  const totalValue = po.line_items.reduce(
    (sum, li) => sum + (li.quantity * li.unit_price), 0
  );

  return po.line_items.map(li => {
    const lineValue = li.quantity * li.unit_price;
    const shippingAllocation = (lineValue / totalValue) * po.shipping_cost;
    const landedCost = (lineValue + shippingAllocation) / li.quantity;

    return {
      line_item_id: li.id,
      unit_cost: li.unit_price,
      shipping_allocation: shippingAllocation,
      landed_cost: landedCost
    };
  });
}
```

---

## Yeast Module

### Features
- Manage yeast strains
- Track pitches with lineage
- Record harvests
- Calculate viability decay
- Spread costs across lineage
- Track pitch usage per batch

### Lineage Tracking
```typescript
interface YeastLineage {
  root_pitch: YeastPitch;
  descendants: {
    pitch: YeastPitch;
    source_batch?: Batch;
    generation: number;
    batches_used: Batch[];
  }[];
  total_batches: number;
  cost_per_batch: number;
}
```

---

## Production Planning Module

Backward planning from order due dates to determine when batches need to start brewing.

### Features
- Aggregate demand from orders (including drafts) by brand + package type + week
- Compare demand against available finished goods inventory
- Track batches in production with estimated ready dates
- Calculate production shortfalls with recommended brew start dates
- Quick batch creation from identified shortfalls
- Configurable planning horizon (4/8/12 weeks)

### Yield Calculation

The `calculate_units_per_bbl()` function dynamically calculates yield for any package type:

```sql
-- 1 BBL = 3968 oz (31 gallons × 128 oz/gallon)
-- For cans/bottles: (3968 / volume_oz) / units_per_case = cases per BBL
-- For kegs: 3968 / volume_oz = kegs per BBL

-- Examples:
-- 16oz can, 24/case: (3968/16)/24 = 10.33 cases/BBL
-- Half barrel (1984 oz): 3968/1984 = 2 kegs/BBL
-- Sixtel (661 oz): 3968/661 = 6 sixtels/BBL
```

Package types can have an optional `units_per_bbl_override` for manual adjustment (e.g., accounting for packaging losses).

### Lead Time Calculation

```
recommended_brew_start = demand_week
                       - fermentation_days (from recipe)
                       - conditioning_days (from recipe)
                       - packaging_buffer_days (default: 2)
```

### Shortfall Detection

A shortfall exists when:
```
demand_quantity > available_quantity + in_production_units
```

Shortfalls are marked **urgent** when the recommended brew start is within 7 days of today.

### Database Objects

| Object | Type | Description |
|--------|------|-------------|
| `calculate_units_per_bbl()` | Function | Calculates yield per BBL from package dimensions |
| `order_demand_by_product` | View | Aggregates demand by brand/package/week |
| `finished_goods_supply_by_product` | View | Aggregates available inventory |
| `batches_in_production_by_brand` | View | Active batches with ready dates |
| `calculate_production_shortfalls()` | Function | Returns shortfalls with brew recommendations |

### UI Components

| Component | Path | Description |
|-----------|------|-------------|
| Planning Page | `/production/planning` | Dashboard with filters, summary cards, shortfall table |
| Create Batch Dialog | (embedded) | Pre-filled batch form from shortfall data |
| Dashboard Alert | `/dashboard` | Shows shortfall count and urgent items |

---

## Customer & Pricing Module

### Features
- Manage customers
- Assign to sales channels
- Define price tiers
- Map tiers to channels
- Set prices by style or brand (brand overrides)
- Sync customers to QuickBooks

### Price Resolution
```typescript
function resolvePrice(
  brand_id: string,
  format_id: string,
  customer_id: string
): number | null {
  const customer = getCustomer(customer_id);
  const tier = getTierForChannel(customer.sales_channel_id);

  // Try brand-specific price first
  let price = getTierPrice(tier.id, brand_id, null, format_id);

  // Fall back to style price
  if (!price) {
    const brand = getBrand(brand_id);
    price = getTierPrice(tier.id, null, brand.style_id, format_id);
  }

  return price;
}
```

---

## Related Documents

- [Workflows](./workflows.md) - State machines for each module
- [Data Model](../data-model/) - Schema details by domain
- [Decisions](./decisions.md) - Design decisions affecting modules
