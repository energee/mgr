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

## `customer_portal_users`

Many-to-many junction linking auth users to customers for portal access.

| Column | Type | Description |
|--------|------|-------------|
| customer_id | UUID | FK to customers (PK part 1) |
| user_id | UUID | FK to auth.users (PK part 2) |
| created_at | TIMESTAMPTZ | Created timestamp |

**Primary key:** (customer_id, user_id)

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
| delivery_id | UUID | FK to deliveries (nullable) |
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
| change_request_cutoff_state | TEXT | Order state at/beyond which customers cannot submit change requests (default: confirmed) |
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
| effective_from | DATE | Price effective from (defaults to creation date) |
| effective_to | DATE | Price effective until (NULL = current/no end) |
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
  AND effective_from <= :order_date
  AND (effective_to IS NULL OR effective_to >= :order_date)
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
    .lte('effective_from', orderDate)
    .or(`effective_to.is.null,effective_to.gte.${orderDate}`)
    .order('effective_from', { ascending: false })
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
    .lte('effective_from', orderDate)
    .or(`effective_to.is.null,effective_to.gte.${orderDate}`)
    .order('effective_from', { ascending: false })
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
WHERE effective_from <= :order_date
  AND (effective_to IS NULL OR effective_to >= :order_date)

-- If multiple prices match (shouldn't happen, but handle gracefully)
ORDER BY effective_from DESC  -- Most recent start date wins
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

---

## Indexes

Performance indexes for sales domain tables:

```sql
-- Order queries (critical for order management UI)
CREATE INDEX idx_orders_customer_status_date ON orders(customer_id, status, order_date DESC);
CREATE INDEX idx_orders_status_requested_date ON orders(status, requested_date);
CREATE INDEX idx_orders_order_number ON orders(order_number);

-- Order items (line item lookups and FG allocation)
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_brand_package ON order_items(brand_id, package_type_id);
CREATE INDEX idx_order_items_allocation ON order_items(allocation_id) WHERE allocation_id IS NOT NULL;

-- Price tier lookups (pricing resolution)
CREATE INDEX idx_tier_prices_tier ON tier_prices(price_tier_id, effective_from, effective_to);
CREATE INDEX idx_tier_prices_brand_package ON tier_prices(brand_id, package_type_id, effective_from, effective_to);
CREATE INDEX idx_tier_prices_style_package ON tier_prices(style_id, package_type_id, effective_from, effective_to) WHERE style_id IS NOT NULL;
CREATE INDEX idx_tier_prices_temporal ON tier_prices(effective_from, effective_to);

-- Customer lookups
CREATE INDEX idx_customers_type_active ON customers(customer_type, is_active);
CREATE INDEX idx_customers_name ON customers(name) WHERE is_active = true;
## `order_change_requests`

Customer-submitted change requests for orders. Requires admin approval.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| order_id | UUID | FK to orders |
| requested_by | UUID | FK to auth.users |
| status | TEXT | Status: pending, approved, rejected, cancelled |
| notes | TEXT | Customer notes |
| reviewed_by | UUID | FK to auth.users (admin who reviewed) |
| reviewed_at | TIMESTAMPTZ | Review timestamp |
| rejection_reason | TEXT | Reason for rejection |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `order_change_request_items`

Individual line-item changes within a change request.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| change_request_id | UUID | FK to order_change_requests |
| change_type | TEXT | Type: add, modify, remove |
| order_item_id | UUID | FK to order_items (null for 'add') |
| brand_id | UUID | FK to brands |
| package_type_id | UUID | FK to package_types |
| keg_type_id | UUID | FK to keg_types |
| quantity | INTEGER | Proposed quantity |
| original_quantity | INTEGER | Original quantity (snapshot) |

---

## Square Integration (Taproom POS)

Tables supporting Square POS integration for automatic taproom inventory debit. See `docs/MGR-SPECIFICATION.md` Section 12.3 for implementation details.

---

## `square_settings`

Square integration configuration (singleton table).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key (fixed, singleton) |
| access_token | TEXT | Square OAuth access token (encrypted or vault reference) |
| refresh_token | TEXT | Square OAuth refresh token (nullable for personal access tokens) |
| location_id | TEXT | Square location ID for the taproom |
| webhook_signature_key | TEXT | Key for validating webhook payloads |
| is_enabled | BOOLEAN | Whether sync is active |
| last_sync_at | TIMESTAMPTZ | Last successful sync timestamp |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Singleton constraint:**
```sql
CONSTRAINT square_settings_singleton CHECK (id = '00000000-0000-0000-0000-000000000002'::uuid)
```

---

## `square_item_mappings`

Map Square catalog items to MGR products.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| square_catalog_id | TEXT | Square catalog object ID |
| square_item_name | TEXT | Item name from Square (for display) |
| finished_good_id | UUID | FK to finished_goods (specific lot, nullable) |
| brand_id | UUID | FK to brands (fallback if no specific FG) |
| package_type_id | UUID | FK to package_types (required if brand_id set) |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Unique constraint:** `square_catalog_id`

**Validation:** Either `finished_good_id` is set, OR both `brand_id` and `package_type_id` are set.

### Mapping Resolution

```typescript
// When processing a Square sale:
// 1. If finished_good_id is set → use that specific FG
// 2. If brand_id + package_type_id set → find any available FG matching those
// 3. If no inventory available → log error, skip item
```

---

## `square_sync_log`

Successful sync records for deduplication and audit.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| square_order_id | TEXT | Square order ID |
| square_payment_id | TEXT | Square payment ID |
| items_synced | INTEGER | Number of items successfully processed |
| items_skipped | INTEGER | Number of items skipped (unmapped, no inventory) |
| synced_at | TIMESTAMPTZ | When sync occurred |

**Unique constraint:** `square_order_id`

---

## `square_sync_errors`

Failed/skipped items for manual review.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| square_order_id | TEXT | Square order ID |
| square_item_id | TEXT | Square catalog object ID |
| item_name | TEXT | Item name from Square |
| error | TEXT | Error type: unmapped_item, no_inventory_available, api_error |
| error_details | TEXT | Additional error context |
| resolved_at | TIMESTAMPTZ | When manually resolved (nullable) |
| resolved_by | UUID | FK to auth.users (nullable) |
| created_at | TIMESTAMPTZ | Created timestamp |

### Error Types

| error | Description | Resolution |
|-------|-------------|------------|
| `unmapped_item` | Square item not mapped to MGR product | Create mapping in `square_item_mappings` |
| `no_inventory_available` | Mapping exists but no FG in stock | Transfer inventory to taproom or adjust |
| `api_error` | Square API call failed | Retry or investigate |

### Query: Unresolved Errors

```sql
SELECT * FROM square_sync_errors
WHERE resolved_at IS NULL
ORDER BY created_at DESC;
```

## Dashboard RPC Functions

### `get_sales_trends(p_days integer DEFAULT 30)`

Returns daily sales metrics for dashboard trend charts. Returns `2 * p_days` rows (current + comparison period). `p_days` is clamped to max 365.

| Column | Type | Description |
|--------|------|-------------|
| date | DATE | Calendar date |
| order_count | INTEGER | Orders placed (`order_date`) on this day |
| revenue | NUMERIC | Sum of `order_items` (quantity * unit_price) for orders on this day |
| fulfilled_count | INTEGER | Orders in `fulfilled` status (approximated via `updated_at`) |

```sql
SELECT * FROM get_sales_trends(30);  -- last 30 days + 30-day comparison
```

**Known limitations:** `fulfilled_count` uses `updated_at` as an approximation — editing a fulfilled order shifts its fulfillment date. `avg_order_value` is computed client-side as `revenue / order_count`.
