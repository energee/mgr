# Sales Domain

## `customers`

Customer records.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Customer name |
| customer_type | TEXT | Type: distributor, retail, taproom, direct |
| contact_name | TEXT | Primary contact |
| email | TEXT | Email |
| phone | TEXT | Phone |
| address | JSONB | Address object |
| notes | TEXT | Notes |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `orders`

Sales orders.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| customer_id | UUID | FK to customers |
| order_number | TEXT | Order number |
| status | TEXT | Status: draft, confirmed, scheduled, picking, packed, fulfilled, cancelled |
| order_date | DATE | Order date |
| requested_date | DATE | Requested delivery date |
| scheduled_date | DATE | Scheduled delivery date |
| fulfilled_date | DATE | Actual fulfillment date |
| shipping_address | JSONB | Shipping address |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `order_items`

Order line items.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| order_id | UUID | FK to orders |
| brand_id | UUID | FK to brands |
| package_type_id | UUID | FK to package_types |
| keg_type_id | UUID | FK to keg_types (for keg formats) |
| quantity | INTEGER | Quantity |
| unit_price | DECIMAL(10,2) | Unit price (resolved or manually set) |
| price_source | TEXT | How price was determined: tier, style_tier, manual, promotional |
| line_total | DECIMAL(10,2) | Line total (calculated: quantity × unit_price) |
| allocation_id | UUID | FK to allocations (where source_type='finished_good') |
| allocation_warning | TEXT | Warning: unallocated, over_committed |
| bin_assignments | JSONB | Bin assignments at picking |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |

**price_source values:**
| Value | Description |
|-------|-------------|
| tier | Resolved from brand + package + tier match |
| style_tier | Resolved from style + package + tier fallback |
| manual | Manually entered (no tier match found) |
| promotional | Special promotional pricing |

**bin_assignments schema:**
```json
[
  { "bin_id": "uuid", "quantity": 10 }
]
```

---

## `sales_channels`

Sales channel definitions.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Channel name |
| slug | TEXT | URL-safe slug |
| description | TEXT | Description |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Default channels:** distributor, retailer, taproom, direct, export

---

## `price_tiers`

Price tier definitions.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Tier name (Wholesale, Retail, Premium, etc.) |
| description | TEXT | Description |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `price_tier_channels`

Map price tiers to sales channels (many-to-many).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tier_id | UUID | FK to price_tiers |
| channel_id | UUID | FK to sales_channels |
| created_at | TIMESTAMPTZ | Created timestamp |

**Unique constraint:** (tier_id, channel_id)

---

## `tier_prices`

Prices by tier, product, and package type. Supports temporal pricing with valid date ranges.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tier_id | UUID | FK to price_tiers |
| style_id | UUID | FK to beer_styles (fallback pricing) |
| brand_id | UUID | FK to brands (overrides style) |
| package_type_id | UUID | FK to package_types |
| price | DECIMAL(10,2) | Price |
| valid_from | DATE | Price effective from (defaults to creation date) |
| valid_to | DATE | Price effective until (NULL = current/no end) |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Constraint:** Either style_id or brand_id must be set.

**Price resolution order** (for a given order date):
1. Brand + Package Type + Tier (most specific, where date in valid range)
2. Style + Package Type + Tier (fallback, where date in valid range)
3. Flag for manual entry (no match found)

**Temporal query:**
```sql
SELECT * FROM tier_prices
WHERE tier_id = :tier
  AND package_type_id = :package
  AND (brand_id = :brand OR (brand_id IS NULL AND style_id = :style))
  AND valid_from <= :order_date
  AND (valid_to IS NULL OR valid_to >= :order_date)
ORDER BY brand_id NULLS LAST  -- prefer brand over style
LIMIT 1;
```

---

## State Machine: Order

```
draft -> confirmed -> scheduled -> picking -> packed -> fulfilled
   |         |            |           |          |
   v         v            v           v          v
cancelled  cancelled   cancelled  cancelled  (adjust only)
```

| Transition | Trigger |
|------------|---------|
| draft -> confirmed | Customer commits |
| confirmed -> scheduled | Delivery date set |
| scheduled -> picking | Start fulfillment |
| picking -> packed | All items picked, debit inventory |
| packed -> fulfilled | Shipped/picked up/served |

---

## Price Resolution Logic

Complete algorithm for resolving unit price when creating order items.

### Resolution Algorithm

```typescript
async function resolvePrice(
  customerId: string,
  brandId: string,
  packageTypeId: string,
  orderDate: Date
): Promise<{ price: number; source: 'tier' | 'style_tier' | 'manual' } | null> {

  // Step 1: Get customer's sales channel and tier
  const customer = await getCustomer(customerId);
  const channel = await getSalesChannel(customer.channel_id);
  const tierMapping = await getTierForChannel(channel.id);

  if (!tierMapping) {
    return { price: 0, source: 'manual' }; // No tier configured
  }

  const tierId = tierMapping.tier_id;

  // Step 2: Try brand-specific price (most specific)
  const brandPrice = await supabase
    .from('tier_prices')
    .select('price')
    .eq('tier_id', tierId)
    .eq('brand_id', brandId)
    .eq('package_type_id', packageTypeId)
    .lte('valid_from', orderDate)
    .or(`valid_to.is.null,valid_to.gte.${orderDate}`)
    .order('valid_from', { ascending: false })
    .limit(1)
    .single();

  if (brandPrice.data) {
    return { price: brandPrice.data.price, source: 'tier' };
  }

  // Step 3: Try style-level fallback
  const brand = await getBrand(brandId);
  const stylePrice = await supabase
    .from('tier_prices')
    .select('price')
    .eq('tier_id', tierId)
    .eq('style_id', brand.style_id)
    .is('brand_id', null)
    .eq('package_type_id', packageTypeId)
    .lte('valid_from', orderDate)
    .or(`valid_to.is.null,valid_to.gte.${orderDate}`)
    .order('valid_from', { ascending: false })
    .limit(1)
    .single();

  if (stylePrice.data) {
    return { price: stylePrice.data.price, source: 'style_tier' };
  }

  // Step 4: No match - manual entry required
  return { price: 0, source: 'manual' };
}
```

### Fallback Behavior

| Scenario | Result | price_source |
|----------|--------|--------------|
| Brand + Package + Tier found | Use that price | `tier` |
| Brand not found, Style + Package + Tier found | Use style price | `style_tier` |
| Neither found | Flag for manual entry, price = 0 | `manual` |
| Temporal gap (price expired, no current) | Flag for manual entry | `manual` |

### Date Range Edge Cases

```sql
-- Price effective during order date
WHERE valid_from <= :order_date
  AND (valid_to IS NULL OR valid_to >= :order_date)

-- If multiple prices match (shouldn't happen, but handle gracefully)
ORDER BY valid_from DESC  -- Most recent start date wins
LIMIT 1
```

### UI Behavior

When `price_source = 'manual'`:
1. Highlight order item row in orange/warning color
2. Require user to enter `unit_price` before order can be confirmed
3. Show tooltip: "No configured price found - enter manually"

When `price_source = 'style_tier'`:
1. Show info icon indicating fallback pricing used
2. Tooltip: "Using style-level pricing (no brand-specific price)"
