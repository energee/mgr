# Customer Order Portal Design

## Overview

A customer-facing order portal accessed via magic link authentication. Customers view their orders and submit change requests (quantity adjustments, add/remove items) that require admin approval before taking effect. Availability is capped by unallocated finished goods. Each sales channel has a configurable cutoff state beyond which orders become read-only to customers.

## Decisions

- **Auth**: Reuse existing Supabase `signInWithOtp()` / `verifyOtp()` / `/api/auth/callback` flow. Short-lived magic link sets a 30-day session cookie.
- **Access model**: View + request changes. Customers cannot directly edit orders.
- **Availability ceiling**: Unallocated finished goods only (`finished_goods_with_availability` view). No speculative batches.
- **Change scope**: Quantity adjustments, add items, remove items. Not delivery dates or addresses.
- **Pending state**: Order shows proposed changes inline (diff view) until approved/rejected.
- **Cutoff**: Configurable per sales channel. Admin sets which order state is the point of no return.
- **One pending request at a time**: Customer must wait for resolution before submitting another.
- **Revision tracking**: Existing `entity_revisions` triggers automatically capture changes when a request is applied. Change request table adds customer-facing context (who requested, why).

## Data Model

### Modified Tables

**`customers`**
```sql
ALTER TABLE customers ADD COLUMN user_id UUID REFERENCES auth.users(id) UNIQUE;
```
Nullable. Set automatically on first magic link login by matching `auth.users.email` to `customers.email`.

**`sales_channels`**
```sql
ALTER TABLE sales_channels ADD COLUMN change_request_cutoff_state TEXT NOT NULL DEFAULT 'confirmed';
```
Picks from the order state machine states: `draft`, `confirmed`, `scheduled`, `picking`, `packed`, `fulfilled`. Orders at or beyond this state are read-only to customers.

### New Tables

**`order_change_requests`**
```sql
CREATE TABLE order_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  notes TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**`order_change_request_items`**
```sql
CREATE TABLE order_change_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_request_id UUID NOT NULL REFERENCES order_change_requests(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('add', 'modify', 'remove')),
  order_item_id UUID REFERENCES order_items(id),
  brand_id UUID REFERENCES brands(id),
  package_type_id UUID REFERENCES package_types(id),
  keg_type_id UUID REFERENCES keg_types(id),
  quantity INTEGER,
  original_quantity INTEGER
);
```

- `change_type = 'add'`: `order_item_id` is null, `brand_id`/`package_type_id`/`quantity` are the proposed new item.
- `change_type = 'modify'`: `order_item_id` references the existing item, `quantity` is the proposed new value, `original_quantity` snapshots the current value.
- `change_type = 'remove'`: `order_item_id` references the item to remove.

### Database Function

**`apply_change_request(p_change_request_id UUID, p_approved_by UUID)`**

Atomic transaction that:
1. Validates the request is still `pending` and the order hasn't passed its sales channel's cutoff state
2. For each `modify` item: updates `order_items.quantity`
3. For each `add` item: inserts a new `order_items` row (price resolved via `get_price_for_customer`)
4. For each `remove` item: deletes the `order_items` row, cancels its planned allocations
5. Sets `status = 'approved'`, `reviewed_by`, `reviewed_at`
6. Existing `tr_orders_revision` trigger captures the changes automatically

### RLS Policies

Customer-scoped read access on existing tables:
```sql
-- Customers see their own orders
CREATE POLICY customer_orders_select ON orders
  FOR SELECT USING (
    customer_id IN (
      SELECT id FROM customers WHERE user_id = (SELECT auth.uid())
    )
  );

-- Customers see items on their orders
CREATE POLICY customer_order_items_select ON order_items
  FOR SELECT USING (
    order_id IN (
      SELECT id FROM orders WHERE customer_id IN (
        SELECT id FROM customers WHERE user_id = (SELECT auth.uid())
      )
    )
  );
```

Change request policies:
```sql
-- Customers can insert change requests on their own orders
CREATE POLICY customer_change_requests_insert ON order_change_requests
  FOR INSERT WITH CHECK (
    requested_by = (SELECT auth.uid())
    AND order_id IN (
      SELECT id FROM orders WHERE customer_id IN (
        SELECT id FROM customers WHERE user_id = (SELECT auth.uid())
      )
    )
  );

-- Customers can view their own change requests
CREATE POLICY customer_change_requests_select ON order_change_requests
  FOR SELECT USING (
    requested_by = (SELECT auth.uid())
  );

-- Customers can insert items on their own pending change requests
CREATE POLICY customer_change_request_items_insert ON order_change_request_items
  FOR INSERT WITH CHECK (
    change_request_id IN (
      SELECT id FROM order_change_requests
      WHERE requested_by = (SELECT auth.uid()) AND status = 'pending'
    )
  );

-- Customers can view items on their own change requests
CREATE POLICY customer_change_request_items_select ON order_change_request_items
  FOR SELECT USING (
    change_request_id IN (
      SELECT id FROM order_change_requests
      WHERE requested_by = (SELECT auth.uid())
    )
  );
```

Admin policies (all authenticated staff) continue to grant full access via existing broad SELECT/UPDATE/DELETE policies.

## Portal Routes

```
src/app/(portal)/
  layout.tsx              → Auth check, customer lookup, branded shell
  login/page.tsx          → Email input → signInWithOtp(), reuses existing flow
  orders/
    page.tsx              → Customer's order list (status, dates, totals)
    [id]/page.tsx         → Order detail (items, status, change request history)
    [id]/change-request/
      new/page.tsx        → Change request builder (capped by availability)
```

### Portal Layout

- Checks `auth.getUser()`, then queries `customers` where `user_id = auth.uid()`
- If no linked customer: tries matching by email, sets `user_id` via admin client
- If still no match: shows "no account" message
- Minimal chrome: brewery logo, order nav, logout. No admin sidebar.

### Portal Order Detail

- Shows order status, items, totals
- If order is below the sales channel's cutoff state and no pending change request exists: shows "Request Changes" button
- If a pending change request exists: shows its status and items
- If change request was rejected: shows rejection reason

## Admin Integration

### Order Detail — Inline Diff

When a pending change request exists on an order, the admin order detail page shows:
- A banner: "Customer requested changes — Review"
- A diff table on the affected items (current vs proposed, with change type labels)
- Approve / Reject buttons (reject requires a reason)

### Sales Channel Settings

Add a "Customer Portal" section to the sales channel entity form:
- `change_request_cutoff_state`: Select dropdown populated from order state machine states
- Label: "Customers can request order changes until"

## Implementation Phases

### Phase 1 — Schema
Migrations for all database changes:
1. `user_id` on customers
2. `change_request_cutoff_state` on sales_channels
3. `order_change_requests` + `order_change_request_items` tables with RLS
4. Customer-scoped RLS on orders, order_items
5. `apply_change_request()` function
6. `_schema_registry` entries

### Phase 2 — Portal Shell
Frontend for customer auth and read-only access:
7. Portal layout with auth check and auto-linking
8. Portal login page (reuses `signInWithOtp`)
9. Portal order list and detail pages

### Phase 3 — Change Requests
The core feature:
10. Change request submission UI (item editor capped by availability)
11. Admin inline diff view on order detail
12. Approve/reject API routes calling `apply_change_request()`

### Phase 4 — Settings
13. Cutoff state config on sales channel entity form

## Future Considerations (Not in Scope)

- Email notifications on change request status changes
- Customer-initiated new orders (currently admin-only)
- Delivery date / address change requests
- Per-customer inventory holds or reservations
- Square POS integration for taproom orders
