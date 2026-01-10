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
| tier_price_id | UUID | FK to tier_prices (default price) |
| unit_price | DECIMAL(10,2) | Unit price |
| price_override | DECIMAL(10,2) | Manual price override |
| line_total | DECIMAL(10,2) | Line total |
| allocation_id | UUID | FK to fg_allocations |
| allocation_warning | TEXT | Warning: unallocated, over_committed |
| bin_assignments | JSONB | Bin assignments at picking |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |

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

Prices by tier, product, and package type.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tier_id | UUID | FK to price_tiers |
| style_id | UUID | FK to beer_styles (fallback pricing) |
| brand_id | UUID | FK to brands (overrides style) |
| package_type_id | UUID | FK to package_types |
| price | DECIMAL(10,2) | Price |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Price resolution:** Brand-specific price takes precedence over style price.

**Constraint:** Either style_id or brand_id must be set.

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

```
1. Get customer's sales channel
2. Find price tier mapped to that channel
3. Look for tier_price with (tier_id, brand_id, package_type_id)
4. If not found, look for tier_price with (tier_id, brand.style_id, package_type_id)
5. If not found, return null (manual pricing required)
```
