# Purchasing Domain

## `suppliers`

Ingredient and material suppliers.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Supplier name |
| contact_name | TEXT | Primary contact |
| contact_email | TEXT | Email |
| contact_phone | TEXT | Phone |
| address | JSONB | Address object |
| default_lead_time_days | INTEGER | Default lead time |
| payment_terms | TEXT | Payment terms (Net 30, etc.) |
| notes | TEXT | Notes |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `supplier_catalog`

What each supplier offers (links suppliers to catalog items).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| supplier_id | UUID | FK to suppliers |
| catalog_type | TEXT | Catalog type: malt, hop, yeast, adjunct, sugar, spice, fruit, additive |
| catalog_id | UUID | FK to catalog item (polymorphic) |
| supplier_sku | TEXT | Supplier's SKU/product code |
| price | DECIMAL(10,4) | Current price |
| unit | TEXT | Price unit |
| min_order_qty | DECIMAL(10,2) | Minimum order quantity |
| lead_time_days | INTEGER | Lead time override |
| notes | TEXT | Notes |
| is_preferred | BOOLEAN | Is this the preferred supplier for this item? |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Unique constraint:** (supplier_id, catalog_type, catalog_id)

---

## `purchase_orders`

Purchase orders to suppliers.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| supplier_id | UUID | FK to suppliers |
| po_number | TEXT | PO number |
| status | TEXT | Status: draft, submitted, confirmed, partial, fulfilled, cancelled |
| order_date | DATE | Order date |
| expected_date | DATE | Expected delivery date |
| shipping_cost | DECIMAL(10,2) | Shipping cost |
| tax | DECIMAL(10,2) | Tax amount |
| notes | TEXT | Notes |
| submitted_at | TIMESTAMPTZ | When submitted to supplier |
| created_by | UUID | FK to auth.users |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `po_line_items`

Purchase order line items.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| po_id | UUID | FK to purchase_orders |
| catalog_type | TEXT | Catalog type: malt, hop, yeast, etc. |
| catalog_id | UUID | FK to catalog item |
| quantity | DECIMAL(10,4) | Ordered quantity |
| unit | TEXT | Unit |
| unit_price | DECIMAL(10,4) | Unit price |
| created_at | TIMESTAMPTZ | Created timestamp |

**Note:** `received_quantity` is calculated, not stored. Use `po_line_items_with_quantities` view.

### `po_line_items_with_quantities` (View)

```sql
CREATE VIEW po_line_items_with_quantities AS
SELECT
  pli.*,
  pli.quantity as ordered_quantity,
  COALESCE(SUM(por.quantity), 0) as received_quantity,
  pli.quantity - COALESCE(SUM(por.quantity), 0) as outstanding_quantity
FROM po_line_items pli
LEFT JOIN po_receives por ON por.po_line_item_id = pli.id
GROUP BY pli.id;
```

---

## `po_receives`

Partial receives against PO line items.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| po_line_item_id | UUID | FK to po_line_items |
| quantity | DECIMAL(10,4) | Quantity received |
| lot_number | TEXT | Lot number |
| expiration_date | DATE | Expiration date |
| received_date | DATE | Date received |
| received_by | UUID | FK to auth.users |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |

---

## `inventory_lots`

Inventory lots from received POs. Tracks lot-level inventory for FIFO costing.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| inventory_item_id | UUID | FK to inventory_items |
| po_receive_id | UUID | FK to po_receives (optional) |
| lot_number | TEXT | Lot number |
| quantity | DECIMAL(10,4) | Original received quantity |
| unit | TEXT | Unit |
| unit_cost | DECIMAL(10,4) | Unit cost before shipping |
| landed_cost | DECIMAL(10,4) | Unit cost including shipping allocation |
| received_date | DATE | Date received |
| expiration_date | DATE | Expiration date |
| location | TEXT | Storage location |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Note:** `remaining_quantity` is calculated from allocations, not stored. Use `inventory_lots_with_quantities` view.

### `inventory_lots_with_quantities` (View)

```sql
CREATE VIEW inventory_lots_with_quantities AS
SELECT
  il.*,
  il.quantity as received_quantity,
  COALESCE(SUM(CASE WHEN a.status IN ('planned', 'completed')
    THEN a.quantity ELSE 0 END), 0) as allocated_quantity,
  il.quantity - COALESCE(SUM(CASE WHEN a.status IN ('planned', 'completed')
    THEN a.quantity ELSE 0 END), 0) as remaining_quantity
FROM inventory_lots il
LEFT JOIN allocations a
  ON a.source_type = 'inventory_lot' AND a.source_id = il.id
GROUP BY il.id;
```

**FIFO Usage Query:**
```sql
-- Get available lots for an inventory item, oldest first
SELECT * FROM inventory_lots_with_quantities
WHERE inventory_item_id = :item_id
  AND remaining_quantity > 0
ORDER BY received_date ASC, expiration_date ASC NULLS LAST;
```

---

## State Machine: Purchase Order

```
draft -> submitted -> confirmed -> partial -> fulfilled
  |          |            |           |
  v          v            v           v
cancelled  cancelled   cancelled   cancelled
```

| Transition | Trigger |
|------------|---------|
| draft -> submitted | Send to supplier |
| submitted -> confirmed | Supplier confirms |
| confirmed -> partial | Some items received |
| partial -> fulfilled | All items received |
| confirmed -> fulfilled | All received at once |
