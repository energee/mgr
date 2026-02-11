# Customer Order Portal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a customer-facing order portal with magic link auth, read-only order views, and a change request workflow with admin approval.

**Architecture:** Reuses existing Supabase magic link auth (`signInWithOtp`). New `(portal)` route group with minimal layout. Change requests stored in new tables, applied atomically via DB function. Customer-scoped RLS on existing order tables. Per-sales-channel configurable cutoff state.

**Tech Stack:** Next.js, Supabase Auth (magic links), PostgreSQL (RLS, functions), React Query, shadcn/ui, Zod

**Design Doc:** `docs/plans/2026-02-08-customer-order-portal-design.md`

---

## Phase 1 — Schema

### Task 1: Migration — Customer user_id + Sales Channel Cutoff

**Files:**
- Create: `supabase/migrations/00088_customer_portal_schema.sql`

**Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration: Customer portal schema — user_id link + cutoff config
-- =============================================================================

-- Link customers to Supabase auth users (for portal access)
ALTER TABLE customers ADD COLUMN user_id UUID REFERENCES auth.users(id) UNIQUE;
CREATE INDEX idx_customers_user_id ON customers(user_id) WHERE user_id IS NOT NULL;

COMMENT ON COLUMN customers.user_id IS 'Links to auth.users for customer portal access. Set on first magic link login.';

-- Configurable cutoff state per sales channel
ALTER TABLE sales_channels ADD COLUMN change_request_cutoff_state TEXT NOT NULL DEFAULT 'confirmed';

COMMENT ON COLUMN sales_channels.change_request_cutoff_state IS 'Order state at/beyond which customers cannot submit change requests. Picks from order states: draft, confirmed, scheduled, picking, packed, fulfilled.';
```

**Step 2: Apply migration**

Run: `cd /Users/tedslesinski/Repos/mgr/.worktrees/workstream-1 && npx supabase migration up --linked` or use the Supabase MCP `apply_migration` tool.

**Step 3: Commit**

```bash
git add supabase/migrations/00088_customer_portal_schema.sql
git commit -m "feat: add customer user_id and sales channel cutoff state columns"
```

---

### Task 2: Migration — Change Request Tables + RLS

**Files:**
- Create: `supabase/migrations/00089_change_request_tables.sql`

**Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration: Order change request tables with RLS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- order_change_requests — one per customer submission
-- -----------------------------------------------------------------------------
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

CREATE INDEX idx_change_requests_order ON order_change_requests(order_id);
CREATE INDEX idx_change_requests_status ON order_change_requests(status) WHERE status = 'pending';
CREATE INDEX idx_change_requests_requested_by ON order_change_requests(requested_by);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON order_change_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE order_change_requests ENABLE ROW LEVEL SECURITY;

-- Staff: full access (matches existing pattern for authenticated internal users)
CREATE POLICY change_requests_staff_select ON order_change_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = (SELECT auth.uid()))
  );

CREATE POLICY change_requests_staff_insert ON order_change_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = (SELECT auth.uid()))
    OR requested_by = (SELECT auth.uid())
  );

CREATE POLICY change_requests_staff_update ON order_change_requests
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = (SELECT auth.uid()))
  );

-- Customer: can view own requests
CREATE POLICY change_requests_customer_select ON order_change_requests
  FOR SELECT TO authenticated
  USING (
    requested_by = (SELECT auth.uid())
  );

-- Customer: can insert requests on own orders
CREATE POLICY change_requests_customer_insert ON order_change_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = (SELECT auth.uid())
    AND order_id IN (
      SELECT id FROM orders WHERE customer_id IN (
        SELECT id FROM customers WHERE user_id = (SELECT auth.uid())
      )
    )
  );

-- -----------------------------------------------------------------------------
-- order_change_request_items — line-item changes within a request
-- -----------------------------------------------------------------------------
CREATE TABLE order_change_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_request_id UUID NOT NULL REFERENCES order_change_requests(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('add', 'modify', 'remove')),
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  brand_id UUID REFERENCES brands(id),
  package_type_id UUID REFERENCES package_types(id),
  keg_type_id UUID REFERENCES keg_types(id),
  quantity INTEGER,
  original_quantity INTEGER
);

CREATE INDEX idx_change_request_items_request ON order_change_request_items(change_request_id);

-- RLS
ALTER TABLE order_change_request_items ENABLE ROW LEVEL SECURITY;

-- Staff: full access
CREATE POLICY change_request_items_staff_select ON order_change_request_items
  FOR SELECT TO authenticated
  USING (
    change_request_id IN (
      SELECT id FROM order_change_requests WHERE
        EXISTS (SELECT 1 FROM user_profiles WHERE id = (SELECT auth.uid()))
    )
  );

CREATE POLICY change_request_items_staff_insert ON order_change_request_items
  FOR INSERT TO authenticated
  WITH CHECK (
    change_request_id IN (
      SELECT id FROM order_change_requests WHERE
        EXISTS (SELECT 1 FROM user_profiles WHERE id = (SELECT auth.uid()))
        OR requested_by = (SELECT auth.uid())
    )
  );

-- Customer: can view items on own requests
CREATE POLICY change_request_items_customer_select ON order_change_request_items
  FOR SELECT TO authenticated
  USING (
    change_request_id IN (
      SELECT id FROM order_change_requests
      WHERE requested_by = (SELECT auth.uid())
    )
  );

-- Customer: can insert items on own pending requests
CREATE POLICY change_request_items_customer_insert ON order_change_request_items
  FOR INSERT TO authenticated
  WITH CHECK (
    change_request_id IN (
      SELECT id FROM order_change_requests
      WHERE requested_by = (SELECT auth.uid()) AND status = 'pending'
    )
  );

-- -----------------------------------------------------------------------------
-- Customer-scoped RLS on orders + order_items (additive — existing staff policies remain)
-- -----------------------------------------------------------------------------
CREATE POLICY customer_orders_select ON orders
  FOR SELECT TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM customers WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY customer_order_items_select ON order_items
  FOR SELECT TO authenticated
  USING (
    order_id IN (
      SELECT id FROM orders WHERE customer_id IN (
        SELECT id FROM customers WHERE user_id = (SELECT auth.uid())
      )
    )
  );

-- -----------------------------------------------------------------------------
-- Schema registry entries
-- -----------------------------------------------------------------------------
INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, state_machine, query_examples)
VALUES
  ('order_change_requests', 'Customer-submitted change requests for orders. Requires admin approval.', 'sales',
   '["belongs_to: orders", "belongs_to: auth.users (requested_by)", "has_many: order_change_request_items"]'::jsonb,
   '["order_id", "status", "requested_by"]'::jsonb,
   '{"stateField": "status", "states": ["pending", "approved", "rejected", "cancelled"]}'::jsonb,
   '["Show pending change requests", "Show change requests for order X"]'::jsonb),
  ('order_change_request_items', 'Individual line-item changes within a change request (add/modify/remove).', 'sales',
   '["belongs_to: order_change_requests", "references: order_items", "references: brands", "references: package_types"]'::jsonb,
   '["change_request_id", "change_type", "order_item_id"]'::jsonb,
   NULL,
   '["Show items in change request X"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  state_machine = EXCLUDED.state_machine,
  query_examples = EXCLUDED.query_examples;
```

**Step 2: Apply migration**

**Step 3: Commit**

```bash
git add supabase/migrations/00089_change_request_tables.sql
git commit -m "feat: add order change request tables with customer-scoped RLS"
```

---

### Task 3: Migration — apply_change_request() Function

**Files:**
- Create: `supabase/migrations/00090_apply_change_request_function.sql`

**Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration: apply_change_request() — atomic approval function
-- =============================================================================

CREATE OR REPLACE FUNCTION apply_change_request(
  p_change_request_id UUID,
  p_approved_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_request RECORD;
  v_order RECORD;
  v_cutoff_state TEXT;
  v_order_state_rank INTEGER;
  v_cutoff_rank INTEGER;
  v_item RECORD;
  v_format_id UUID;
  v_price DECIMAL(10,2);
  -- Order state ranking for cutoff comparison
  v_state_ranks CONSTANT TEXT[] := ARRAY['draft','confirmed','scheduled','picking','packed','fulfilled'];
BEGIN
  -- 1. Validate the change request
  SELECT * INTO v_request
  FROM order_change_requests
  WHERE id = p_change_request_id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change request not found or not pending';
  END IF;

  -- 2. Get the order and its customer's sales channel cutoff
  SELECT o.*, c.sales_channel_id INTO v_order
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  WHERE o.id = v_request.order_id;

  SELECT COALESCE(sc.change_request_cutoff_state, 'confirmed') INTO v_cutoff_state
  FROM sales_channels sc
  WHERE sc.id = v_order.sales_channel_id;

  -- Default cutoff if no sales channel
  IF v_cutoff_state IS NULL THEN
    v_cutoff_state := 'confirmed';
  END IF;

  -- 3. Check if order has passed the cutoff state
  v_order_state_rank := array_position(v_state_ranks, v_order.status);
  v_cutoff_rank := array_position(v_state_ranks, v_cutoff_state);

  IF v_order_state_rank IS NOT NULL AND v_cutoff_rank IS NOT NULL
     AND v_order_state_rank >= v_cutoff_rank THEN
    RAISE EXCEPTION 'Order has passed the change request cutoff state (%)' , v_cutoff_state;
  END IF;

  -- 4. Apply each item change
  FOR v_item IN
    SELECT * FROM order_change_request_items
    WHERE change_request_id = p_change_request_id
  LOOP
    CASE v_item.change_type
      WHEN 'modify' THEN
        UPDATE order_items
        SET quantity = v_item.quantity
        WHERE id = v_item.order_item_id;

      WHEN 'remove' THEN
        -- Cancel planned allocations for this item
        UPDATE allocations
        SET status = 'cancelled'
        WHERE destination_type = 'order'
          AND destination_id = v_request.order_id
          AND status = 'planned'
          AND source_id IN (
            SELECT fg.id FROM finished_goods fg
            JOIN order_items oi ON oi.id = v_item.order_item_id
            WHERE fg.brand_id = oi.brand_id
              AND (fg.package_type_id = oi.package_type_id OR fg.keg_type_id = oi.keg_type_id)
          );

        DELETE FROM order_items WHERE id = v_item.order_item_id;

      WHEN 'add' THEN
        -- Resolve format_id for pricing (use package_type_id or keg_type_id)
        v_format_id := COALESCE(v_item.package_type_id, v_item.keg_type_id);

        -- Get price from tier
        SELECT price INTO v_price
        FROM get_price_for_customer(
          v_order.customer_id,
          v_format_id,
          v_item.brand_id
        );

        INSERT INTO order_items (
          order_id, brand_id, package_type_id, keg_type_id, quantity, unit_price
        ) VALUES (
          v_request.order_id,
          v_item.brand_id,
          v_item.package_type_id,
          v_item.keg_type_id,
          v_item.quantity,
          v_price
        );
    END CASE;
  END LOOP;

  -- 5. Mark the request as approved
  UPDATE order_change_requests
  SET status = 'approved',
      reviewed_by = p_approved_by,
      reviewed_at = now()
  WHERE id = p_change_request_id;

  -- 6. Touch the order so entity_revisions trigger fires
  UPDATE orders
  SET updated_at = now()
  WHERE id = v_request.order_id;
END;
$$;

COMMENT ON FUNCTION apply_change_request(UUID, UUID) IS
  'Atomically applies an approved change request to an order. Validates cutoff state, applies item changes, resolves pricing, and cancels stale allocations.';
```

**Step 2: Apply migration**

**Step 3: Commit**

```bash
git add supabase/migrations/00090_apply_change_request_function.sql
git commit -m "feat: add apply_change_request() atomic approval function"
```

---

### Task 4: Update CLAUDE.md Migration Counter

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update the migration counter**

Change `Current highest: \`00087\`` → `Current highest: \`00090\``
Change `Next available: \`00088\`` → `Next available: \`00091\``

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "chore: update migration counter to 00090"
```

---

## Phase 2 — Portal Shell

### Task 5: Add Query Keys for Change Requests

**Files:**
- Modify: `src/lib/query-keys.ts`

**Step 1: Add changeRequestKeys factory**

Add after the `orderKeys` section (~line 135):

```typescript
// =============================================================================
// Change Request Keys
// =============================================================================

export const changeRequestKeys = {
  all: () => ["change-requests"] as const,
  forOrder: (orderId: string) => ["change-requests", "for-order", orderId] as const,
  detail: (id: string) => ["change-requests", id] as const,
  items: (id: string) => ["change-requests", id, "items"] as const,
  pendingForOrder: (orderId: string) => ["change-requests", "pending", orderId] as const,
};
```

**Step 2: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat: add changeRequestKeys to centralized query key factory"
```

---

### Task 6: Portal Layout

**Files:**
- Create: `src/app/(portal)/layout.tsx`

**Step 1: Write the portal layout**

This is a server component that:
1. Checks `auth.getUser()` — if not authenticated, redirects to `/portal/login`
2. Queries `customers` where `user_id = auth.uid()` — if no match, tries email match and sets `user_id`
3. Renders minimal shell: brewery logo (from `system_settings`), nav, logout button
4. Passes `customerId` to children via React context (create a simple context provider)

Reference patterns:
- Auth check: `src/app/(app)/layout.tsx` (lines 1-30)
- Branded shell: `src/app/(app)/layout.tsx` (system_settings query for brewery name/logo)
- Redirect: Next.js `redirect()` from `next/navigation`

**Key code structure:**

```tsx
// Server component
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal/portal-shell";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/portal/login");
  }

  // Find linked customer
  let { data: customer } = await supabase
    .from("customers")
    .select("id, name, email")
    .eq("user_id", user.id)
    .single();

  // Auto-link by email on first login
  if (!customer && user.email) {
    const adminDb = await createAdminClient();
    const { data: matched } = await adminDb
      .from("customers")
      .select("id, name, email")
      .eq("email", user.email)
      .is("user_id", null)
      .single();

    if (matched) {
      await adminDb
        .from("customers")
        .update({ user_id: user.id })
        .eq("id", matched.id);
      customer = matched;
    }
  }

  if (!customer) {
    // No customer account — show message
    return <PortalShell customer={null}>{children}</PortalShell>;
  }

  // Get brewery branding
  const { data: settings } = await supabase
    .from("system_settings")
    .select("brewery_name, brewery_logo_svg")
    .single();

  return (
    <PortalShell
      customer={{ id: customer.id, name: customer.name }}
      breweryName={settings?.brewery_name}
      breweryLogo={settings?.brewery_logo_svg}
    >
      {children}
    </PortalShell>
  );
}
```

**Step 2: Create the PortalShell client component**

- Create: `src/components/portal/portal-shell.tsx`

A client component providing:
- Brewery logo/name in header
- Customer name display
- Simple nav: "Orders" link
- Logout button (calls `supabase.auth.signOut()`, redirects to `/portal/login`)
- `PortalContext` provider with `customerId`

**Step 3: Create the PortalContext**

- Create: `src/lib/portal-context.tsx`

```tsx
"use client";
import { createContext, useContext } from "react";

interface PortalContextValue {
  customerId: string;
  customerName: string;
}

const PortalContext = createContext<PortalContextValue | null>(null);

export function PortalProvider({ children, value }: { children: React.ReactNode; value: PortalContextValue }) {
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortalCustomer() {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error("usePortalCustomer must be used within PortalProvider");
  return ctx;
}
```

**Step 4: Lint and commit**

```bash
pnpm lint
git add src/app/\(portal\)/layout.tsx src/components/portal/portal-shell.tsx src/lib/portal-context.tsx
git commit -m "feat: add portal layout with customer auth and auto-linking"
```

---

### Task 7: Portal Login Page

**Files:**
- Create: `src/app/(portal)/login/page.tsx`

**Step 1: Write the login page**

Reuse the existing magic link pattern from `src/app/(auth)/login/login-form.tsx`:
- Email input field
- "Send Magic Link" button → calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: '<origin>/api/auth/callback?redirect=/portal/orders' } })`
- Success state: "Check your email for a login link"
- Error state: show error message

This is a simpler version of the existing login form — no password field, no OTP entry (magic link only).

Reference: `src/app/(auth)/login/login-form.tsx` for the `signInWithOtp` call pattern and redirect URL construction.

**Step 2: Lint and commit**

```bash
pnpm lint
git add src/app/\(portal\)/login/page.tsx
git commit -m "feat: add portal magic link login page"
```

---

### Task 8: Portal Order List Page

**Files:**
- Create: `src/app/(portal)/orders/page.tsx`

**Step 1: Write the order list page**

A client component that:
1. Gets `customerId` from `usePortalCustomer()`
2. Queries `orders` filtered by the current customer (RLS handles scoping, but also filter client-side for clarity)
3. Displays a table with columns: Order Number, Status (badge), Order Date, Requested Date, Items count
4. Each row links to `/portal/orders/[id]`

Use `useQuery` with `entityKeys.list("orders")` — RLS ensures only this customer's orders are returned.

Use existing UI components: `Table`, `Badge`, `Card` from shadcn/ui. Reference order entity's `stateDisplay` for badge colors.

**Step 2: Lint and commit**

```bash
pnpm lint
git add src/app/\(portal\)/orders/page.tsx
git commit -m "feat: add portal order list page"
```

---

### Task 9: Portal Order Detail Page

**Files:**
- Create: `src/app/(portal)/orders/[id]/page.tsx`

**Step 1: Write the order detail page**

A client component that:
1. Fetches the order by ID (RLS ensures customer can only see their own)
2. Fetches order items for this order
3. Fetches any change requests for this order via `changeRequestKeys.forOrder(id)`
4. Displays:
   - Order header: number, status badge, dates
   - Items table: brand, format, quantity, unit price, total
   - Change request section:
     - If pending: show status with items diff
     - If no pending + order below cutoff: show "Request Changes" button → links to `/portal/orders/[id]/change-request/new`
     - If past cutoff: no button, just read-only
   - Change request history (list of past requests with status)

5. To determine cutoff: fetch the customer's sales channel's `change_request_cutoff_state`, compare against current order status using state ordering.

Reference: Order state ordering from entity config: `["draft", "confirmed", "scheduled", "picking", "packed", "fulfilled", "cancelled"]`

**Step 2: Lint and commit**

```bash
pnpm lint
git add src/app/\(portal\)/orders/\[id\]/page.tsx
git commit -m "feat: add portal order detail page with change request status"
```

---

## Phase 3 — Change Requests

### Task 10: Change Request Submission Page

**Files:**
- Create: `src/app/(portal)/orders/[id]/change-request/new/page.tsx`
- Create: `src/components/portal/change-request-builder.tsx`

**Step 1: Write the change request builder component**

A client component that:
1. Fetches current order items
2. Fetches available finished goods via `finished_goods_with_availability` view (for availability ceiling)
3. Shows current items in an editable table:
   - Each row shows: brand, format, current qty, proposed qty (editable input)
   - "Remove" button per row (marks as `remove`)
   - Quantity input capped at: current qty + available unallocated for that brand/format
4. "Add Item" button at bottom:
   - Brand selector (from brands where finished goods exist with available_quantity > 0)
   - Format selector (package_type or keg_type)
   - Quantity input (capped by available_quantity)
5. Notes textarea for customer to explain the change
6. "Submit Change Request" button

On submit:
1. Create `order_change_request` row (status=pending, notes)
2. Create `order_change_request_items` rows for each change (only items that actually changed)
3. Redirect to order detail showing the pending request

Use React Query mutations with `changeRequestKeys` for cache invalidation.

**Step 2: Write the page wrapper**

```tsx
"use client";
import { use } from "react";
import { ChangeRequestBuilder } from "@/components/portal/change-request-builder";

export default function NewChangeRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ChangeRequestBuilder orderId={id} />;
}
```

**Step 3: Lint and commit**

```bash
pnpm lint
git add src/app/\(portal\)/orders/\[id\]/change-request/new/page.tsx src/components/portal/change-request-builder.tsx
git commit -m "feat: add change request builder for customer portal"
```

---

### Task 11: Admin Change Request Diff on Order Detail

**Files:**
- Create: `src/components/domain/change-request-review.tsx`
- Modify: `src/entities/order.tsx` — add a section for change request review

**Step 1: Write the ChangeRequestReview component**

A domain component that:
1. Takes `orderId` as prop
2. Fetches pending change request (if any) via `changeRequestKeys.pendingForOrder(orderId)`
3. Fetches change request items
4. Renders a diff table:
   - Columns: Product, Format, Current Qty, Proposed Qty, Change Type
   - `modify` rows: show both quantities with visual diff (green for increase, red for decrease)
   - `add` rows: highlighted in green, no "current" column
   - `remove` rows: highlighted in red, strikethrough
5. Customer's notes
6. Approve button → calls API route
7. Reject button → opens dialog for rejection reason → calls API route

**Step 2: Add to order entity config**

In `src/entities/order.tsx`, add a section to `sections` array (or as a custom component in detailSections):

```typescript
{
  id: "change-requests",
  title: "Change Requests",
  component: createChangeRequestReviewDisplay(),
  collapsible: true,
},
```

Pattern reference: `revision-history` section in same file (lines 175-179).

**Step 3: Lint and commit**

```bash
pnpm lint
git add src/components/domain/change-request-review.tsx src/entities/order.tsx
git commit -m "feat: add change request inline diff review on admin order detail"
```

---

### Task 12: Approve/Reject API Routes

**Files:**
- Create: `src/app/api/orders/[id]/change-requests/[requestId]/approve/route.ts`
- Create: `src/app/api/orders/[id]/change-requests/[requestId]/reject/route.ts`

**Step 1: Write the approve route**

```typescript
import { withRoles } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/responses";

export const POST = withRoles(
  ["admin", "sales"],
  async (_request, { user, supabase, params }) => {
    const requestId = params?.requestId;
    if (!requestId) return errorResponse("BAD_REQUEST", "Missing request ID", undefined, 400);

    const { error } = await supabase.rpc("apply_change_request", {
      p_change_request_id: requestId,
      p_approved_by: user.id,
    });

    if (error) throw error;

    return successResponse({ approved: true });
  }
);
```

**Step 2: Write the reject route**

```typescript
import { withRoles } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/responses";

export const POST = withRoles(
  ["admin", "sales"],
  async (request, { user, supabase, params }) => {
    const requestId = params?.requestId;
    if (!requestId) return errorResponse("BAD_REQUEST", "Missing request ID", undefined, 400);

    const body = await request.json();
    const reason = body.reason;
    if (!reason) return errorResponse("BAD_REQUEST", "Rejection reason is required", undefined, 400);

    const { error } = await supabase
      .from("order_change_requests")
      .update({
        status: "rejected",
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason,
      })
      .eq("id", requestId)
      .eq("status", "pending");

    if (error) throw error;

    return successResponse({ rejected: true });
  }
);
```

**Step 3: Lint and commit**

```bash
pnpm lint
git add src/app/api/orders/\[id\]/change-requests/
git commit -m "feat: add approve/reject API routes for change requests"
```

---

## Phase 4 — Settings

### Task 13: Sales Channel Cutoff Config

**Files:**
- Modify: `src/entities/sales-channel.tsx`

**Step 1: Add cutoff field to entity config**

Add to the Zod schema:

```typescript
change_request_cutoff_state: z.string().default("confirmed"),
```

Add to the `sections` array (in the "Overview" section or as a new "Customer Portal" section):

```typescript
{
  id: "customer-portal",
  title: "Customer Portal",
  fields: [
    {
      name: "change_request_cutoff_state",
      label: "Change request cutoff",
      type: "select",
      description: "Customers can request order changes until this state",
      options: [
        { value: "draft", label: "Draft" },
        { value: "confirmed", label: "Confirmed" },
        { value: "scheduled", label: "Scheduled" },
        { value: "picking", label: "Picking" },
        { value: "packed", label: "Packed" },
        { value: "fulfilled", label: "Fulfilled" },
      ],
      colSpan: 6,
    },
  ],
},
```

Also add to `formFields` for the legacy form (if still used).

**Step 2: Lint and commit**

```bash
pnpm lint
git add src/entities/sales-channel.tsx
git commit -m "feat: add change request cutoff state config to sales channel entity"
```

---

### Task 14: Regenerate TypeScript Types

**Step 1: Regenerate types**

After all migrations are applied, regenerate the Supabase TypeScript types to include the new tables and columns:

```bash
npx supabase gen types typescript --linked > src/types/supabase.ts
```

Or use the Supabase MCP `generate_typescript_types` tool.

**Step 2: Fix any type errors from the new schema**

Run `pnpm lint` and fix any issues.

**Step 3: Commit**

```bash
git add src/types/supabase.ts
git commit -m "chore: regenerate TypeScript types for customer portal schema"
```

---

### Task 15: Final Integration Test + Cleanup

**Step 1: Verify the full flow manually**

1. Confirm migrations apply cleanly
2. Confirm portal login page renders at `/portal/login`
3. Confirm portal layout redirects unauthenticated users
4. Confirm order list shows customer's orders (with test data)
5. Confirm order detail shows items and change request status
6. Confirm change request submission creates records
7. Confirm admin sees inline diff on order detail
8. Confirm approve/reject routes work
9. Confirm cutoff state config appears on sales channel edit

**Step 2: Run lint**

```bash
pnpm lint
```

**Step 3: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: portal integration cleanup"
```
