# MGR Implementation Plan - Phases 6-15 Detailed Specs

> Continuation of IMPLEMENTATION-PLAN-EXPANDED.md

---

## Phase 6: Integrations & Notifications [PARTIAL]

### Overview
Connect to external systems and implement notification infrastructure.

### Dependencies
- Phase 3 (for inventory sync)
- Phase 4 (for order/invoice sync)

### Current Status
- [x] Square webhook endpoint exists (basic)
- [ ] Square reconciliation UI
- [ ] Slack integration
- [ ] QuickBooks integration
- [ ] In-app notifications
- [ ] Email notifications

---

### 6.1 Square POS Integration

#### Database Tables
Already exists in schema:
- `square_sync_log` - Track sync operations
- `square_item_mapping` - Map Square items to MGR products

If not exists, create migration:
```sql
CREATE TABLE square_item_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  square_item_id TEXT NOT NULL UNIQUE,
  square_item_name TEXT NOT NULL,
  finished_good_id UUID REFERENCES finished_goods(id),
  brand_id UUID REFERENCES brands(id),
  package_type_id UUID REFERENCES package_types(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE square_sync_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  square_order_id TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_data JSONB,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### Implementation Steps

**Step 1: Create Item Mapping UI**
File: `src/app/(app)/settings/integrations/square/mappings/page.tsx`

Features:
- List unmapped Square items
- Search/filter Square items
- Map to MGR brand + package format
- Bulk mapping support

**Step 2: Create Sync Error Viewer**
File: `src/app/(app)/settings/integrations/square/errors/page.tsx`

Features:
- List sync errors
- View error details
- Mark as resolved
- Retry failed syncs

**Step 3: Manual Adjustment UI**
File: `src/components/domain/square-adjustment.tsx`

For missed sales or corrections:
- Select date range
- Enter product and quantity
- Create allocation records
- Debit inventory

**Step 4: Reconciliation Report**
File: `src/app/(app)/reports/square-reconciliation/page.tsx`

Compare:
- Square sales quantities
- MGR inventory movements
- Highlight discrepancies

#### Completion Criteria
- [ ] Item mapping page exists
- [ ] Can map Square items to MGR products
- [ ] Sync errors visible and resolvable
- [ ] Manual adjustment for missed sales
- [ ] Reconciliation report shows discrepancies

---

### 6.2 Slack Notifications

#### Database Tables
```sql
CREATE TABLE notification_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_type TEXT NOT NULL,  -- 'slack', 'email'
  channel_name TEXT NOT NULL,
  config JSONB NOT NULL,  -- { webhook_url, channel_id }
  notification_types TEXT[] NOT NULL,  -- ['low_inventory', 'batch_ready']
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### Implementation Steps

**Step 1: Create Slack Edge Function**
File: `supabase/functions/send-slack-notification/index.ts`

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

interface SlackMessage {
  channel: string;
  text: string;
  blocks?: any[];
}

serve(async (req) => {
  const { notification_type, data, webhook_url } = await req.json();

  // Format message based on type
  const message = formatMessage(notification_type, data);

  // Send to Slack
  const response = await fetch(webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });

  return new Response(JSON.stringify({ success: response.ok }));
});

function formatMessage(type: string, data: any): SlackMessage {
  switch (type) {
    case 'low_inventory':
      return {
        channel: '#inventory',
        text: `Low inventory alert: ${data.item_name}`,
        blocks: [/* rich formatting */],
      };
    case 'batch_ready':
      return {
        channel: '#production',
        text: `Batch ${data.batch_number} ready for packaging`,
      };
    // ... more types
  }
}
```

**Step 2: Create Notification Triggers**
Database triggers or application-level hooks to fire notifications:

```sql
CREATE OR REPLACE FUNCTION notify_low_inventory()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.quantity < (SELECT reorder_point FROM inventory_items WHERE id = NEW.item_id) THEN
    PERFORM net.http_post(
      url := current_setting('app.edge_function_url') || '/send-slack-notification',
      body := jsonb_build_object('notification_type', 'low_inventory', 'data', row_to_json(NEW))
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Step 3: Channel Configuration UI**
File: `src/app/(app)/settings/integrations/slack/page.tsx`

Features:
- Add Slack webhook URL
- Select notification types per channel
- Test notification button

#### Completion Criteria
- [ ] Edge function sends Slack messages
- [ ] Triggers fire on relevant events
- [ ] Channel configuration UI works
- [ ] Can test notifications
- [ ] Notifications include actionable links

---

### 6.3 QuickBooks Integration

#### Implementation Steps

**Step 1: OAuth Flow**
File: `src/app/api/integrations/qbo/callback/route.ts`

```typescript
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(code);

  // Store encrypted tokens
  await storeTokens(realmId, tokens);

  return redirect('/settings/integrations/quickbooks?success=true');
}
```

**Step 2: Token Refresh Handler**
File: `src/lib/integrations/quickbooks.ts`

```typescript
export class QuickBooksClient {
  private accessToken: string;
  private refreshToken: string;
  private realmId: string;

  async refreshIfNeeded() {
    // Check expiry, refresh if needed
  }

  async createInvoice(order: Order): Promise<Invoice> {
    // Map order to QBO invoice format
    // POST to QBO API
  }

  async syncCustomer(customer: Customer): Promise<void> {
    // Create or update customer in QBO
  }
}
```

**Step 3: Invoice Sync**
When order status = 'out_the_door':
- Create QBO invoice from order
- Store `qbo_invoice_id` on order
- Handle line item mapping

**Step 4: Account Mapping UI**
File: `src/app/(app)/settings/integrations/quickbooks/accounts/page.tsx`

Map MGR concepts to QBO accounts:
- Revenue account for sales
- COGS account
- Asset account for inventory

#### Completion Criteria
- [ ] OAuth flow works
- [ ] Token refresh automatic
- [ ] Invoice created when order ships
- [ ] Line items mapped correctly
- [ ] Account mapping configurable
- [ ] Sync status visible

---

### 6.4 In-App Notifications

#### Database Tables
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read_at)
WHERE read_at IS NULL;
```

#### Implementation Steps

**Step 1: Create Notification Bell Component**
File: `src/components/domain/notification-bell.tsx`

```typescript
"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function NotificationBell() {
  const supabase = createClient();

  // Query unread count
  const { data: unreadCount } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .is('read_at', null);
      return count;
    },
  });

  // Subscribe to realtime updates
  useEffect(() => {
    const channel = supabase
      .channel('notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        // Refresh count and show toast
        queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
        toast(payload.new.title);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  return (
    <button className="relative">
      <Bell className="h-5 w-5" />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
          {unreadCount}
        </span>
      )}
    </button>
  );
}
```

**Step 2: Create Notification Dropdown**
File: `src/components/domain/notification-dropdown.tsx`

Features:
- Show recent notifications
- Mark as read on click
- "Mark all read" action
- Link to full list

**Step 3: Create Notifications Page**
File: `src/app/(app)/notifications/page.tsx`

Full notification history with filtering.

**Step 4: Add to Header**
Include `NotificationBell` in `app-header.tsx`.

#### Completion Criteria
- [ ] Notification bell in header
- [ ] Real-time updates via Supabase Realtime
- [ ] Dropdown shows recent notifications
- [ ] Mark as read works
- [ ] Full notification history page

---

### 6.5 Email Notifications

#### Implementation Steps

**Step 1: Set Up Resend (or alternative)**
```typescript
// src/lib/email.ts
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(options: EmailOptions) {
  await resend.emails.send({
    from: 'MGR <notifications@brewery.com>',
    ...options,
  });
}
```

**Step 2: Create Email Templates**
File: `src/lib/email-templates/`

- `low-inventory.tsx` - React Email component
- `order-confirmation.tsx`
- `weekly-summary.tsx`

**Step 3: User Preferences**
Add email preference toggles to notification preferences page.

#### Completion Criteria
- [ ] Email service configured
- [ ] Templates for key notifications
- [ ] User can toggle email per type
- [ ] Unsubscribe link works

---

## Phase 7: Reporting & Compliance [NOT STARTED]

### Overview
Business intelligence and regulatory compliance.

### Dependencies
- Phase 3 (allocations for TTB)

---

### 7.1 TTB Form 5130.9

#### Purpose
Brewer's Report of Operations - required monthly.

#### Implementation Steps

**Step 1: Create TTB Calculation Functions**
File: `src/lib/ttb-calculations.ts`

```typescript
interface TTBReportData {
  period: { year: number; month: number };
  beginning_inventory: TaxClassVolumes;
  production: TaxClassVolumes;
  removals: {
    taxable: TaxClassVolumes;
    tax_free: TaxClassVolumes;
    export: TaxClassVolumes;
  };
  ending_inventory: TaxClassVolumes;
  losses: TaxClassVolumes;
}

interface TaxClassVolumes {
  under_60k: number;  // BBL at reduced rate
  over_60k: number;   // BBL at regular rate
}

export async function generateTTBReport(year: number, month: number): Promise<TTBReportData> {
  // Calculate beginning inventory (ending from previous month)
  // Calculate production from batches completed
  // Calculate removals from allocations (by destination type)
  // Calculate losses from loss allocations
  // Calculate ending inventory
}
```

**Step 2: Create Database View**
Migration: `00XXX_ttb_reporting.sql`

```sql
CREATE VIEW ttb_monthly_summary AS
SELECT
  date_trunc('month', a.completed_at) as period,
  a.destination_type,
  SUM(a.volume_bbl) as total_volume_bbl,
  -- Tax class determination based on cumulative production
  -- (simplified - actual logic is more complex)
FROM allocations a
WHERE a.status = 'completed'
GROUP BY 1, 2;
```

**Step 3: Create TTB Report Page**
File: `src/app/(app)/reports/ttb/page.tsx`

Features:
- Month/year selector
- Display report data in TTB format
- Export to PDF/CSV
- Print-friendly layout

#### Completion Criteria
- [ ] TTB calculations accurate
- [ ] Beginning/ending inventory correct
- [ ] Production by tax class
- [ ] Removals categorized correctly
- [ ] Losses tracked
- [ ] Export to PDF works

---

### 7.2-7.4 Dashboards

#### Production Dashboard
File: `src/app/(app)/reports/production/page.tsx`

Components:
- Vessel utilization chart (% time in use)
- Batch status pie chart
- Upcoming brew schedule (next 2 weeks)
- Fermentation tracker (active batches with progress)

#### Inventory Dashboard
File: `src/app/(app)/reports/inventory/page.tsx`

Components:
- Low stock alerts table
- Expiring lots (next 30 days)
- Ingredient usage trend charts
- Reorder recommendations

#### Sales Dashboard
File: `src/app/(app)/reports/sales/page.tsx`

Components:
- Order pipeline (by status)
- Revenue by customer/channel
- Product mix analysis
- Week-over-week comparison

#### Completion Criteria
- [ ] All three dashboards exist
- [ ] Real data displayed
- [ ] Date range filtering
- [ ] Charts render correctly
- [ ] Export/print options

---

## Phase 8: Settings & Administration [NOT STARTED]

### Overview
Complete system configuration, user management, and administrative functions.

### Dependencies
- None (can run in parallel)

---

### 8.1 System Settings

#### Database Tables
```sql
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

-- Initial settings
INSERT INTO system_settings (key, value, description) VALUES
('brewery_info', '{"name": "", "address": "", "phone": "", "email": ""}', 'Brewery contact information'),
('default_units', '{"volume": "bbl", "weight": "lbs", "temperature": "f", "gravity": "plato"}', 'Default display units'),
('timezone', '"America/New_York"', 'Brewery timezone'),
('tax_rates', '{"federal": 3.50, "state": 0}', 'Tax rates per BBL'),
('fiscal_year', '{"start_month": 1}', 'Fiscal year settings');
```

#### Implementation Steps

**Step 1: Create Settings Page**
File: `src/app/(app)/settings/system/page.tsx`

Sections:
- Brewery Information
- Default Units
- Timezone
- Tax Rates
- Fiscal Year

**Step 2: Create Settings Hook**
File: `src/hooks/useSystemSettings.ts`

```typescript
export function useSystemSetting(key: string) {
  const supabase = createClient();

  return useQuery({
    queryKey: ['system-settings', key],
    queryFn: async () => {
      const { data } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', key)
        .single();
      return data?.value;
    },
    staleTime: 5 * 60 * 1000,  // Cache for 5 minutes
  });
}
```

#### Completion Criteria
- [ ] System settings table exists
- [ ] Settings page with forms
- [ ] Hook for reading settings
- [ ] Settings cached appropriately

---

### 8.2 User Management

#### Implementation Steps

**Step 1: Create User Entity**
File: `src/entities/user.tsx`

Note: Users are in `auth.users` (Supabase managed). Create a view for safe access:

```sql
CREATE VIEW user_profiles AS
SELECT
  u.id,
  u.email,
  u.raw_user_meta_data->>'name' as name,
  u.raw_user_meta_data->>'avatar_url' as avatar_url,
  u.created_at,
  u.last_sign_in_at,
  array_agg(ur.role) as roles
FROM auth.users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
GROUP BY u.id;
```

**Step 2: Create User Roles Table**
```sql
CREATE TABLE user_roles (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'production_manager', 'brewer', 'sales')),
  granted_at TIMESTAMPTZ DEFAULT now(),
  granted_by UUID REFERENCES auth.users(id),
  PRIMARY KEY (user_id, role)
);
```

**Step 3: Create User Management Pages**
Directory: `src/app/(app)/settings/users/`

Features:
- List users with roles
- Invite new user (sends email)
- Edit roles
- Deactivate user

**Step 4: User Invitation Flow**
Use Supabase Auth admin functions:
```typescript
const { data, error } = await supabase.auth.admin.inviteUserByEmail(email);
```

#### Completion Criteria
- [ ] User list with roles
- [ ] Can invite new users
- [ ] Can assign/remove roles
- [ ] Can deactivate users
- [ ] Role changes take effect immediately

---

### 8.3-8.6 Other Settings

#### Location Management
- `locations` table exists (migration 00006)
- Create CRUD pages under `/settings/locations/`

#### Integration Settings
- Hub page at `/settings/integrations/`
- Sub-pages for Square, QuickBooks, Slack

#### Notification Preferences
- Per-user settings for each notification type
- Toggle for in-app, email, Slack per type

#### Reference Data
- Package formats: `/settings/formats/`
- Keg types: `/settings/keg-types/`
- Sales channels: `/settings/sales-channels/`

---

## Phase 9: Yeast Management [NOT STARTED]

### Overview
Track yeast inventory, pitches, harvests, and lineage.

### Dependencies
- Phase 2 (batches)

---

### 9.1-9.5 Yeast Implementation

#### Database Tables
```sql
CREATE TABLE yeast_pitches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strain_id UUID REFERENCES yeasts(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('purchase', 'harvest')),
  parent_pitch_id UUID REFERENCES yeast_pitches(id),
  generation INTEGER NOT NULL DEFAULT 1,
  cell_count_billions NUMERIC,
  viability_percent NUMERIC,
  harvest_date DATE,
  received_date DATE,
  cost NUMERIC,
  status TEXT DEFAULT 'available' CHECK (status IN ('available', 'pitched', 'discarded')),
  batch_id UUID REFERENCES batches(id),  -- Batch it was pitched into
  source_batch_id UUID REFERENCES batches(id),  -- Batch it was harvested from
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### Viability Calculation
File: `src/lib/yeast-calculations.ts`

```typescript
// Viability decays approximately 2-4% per day at refrigerator temps
export function calculateCurrentViability(
  initialViability: number,
  harvestDate: Date,
  now: Date = new Date()
): number {
  const daysDiff = differenceInDays(now, harvestDate);
  const decayRate = 0.03;  // 3% per day
  return Math.max(0, initialViability * Math.pow(1 - decayRate, daysDiff));
}

// Pitching rate calculator
export function calculatePitchingRate(
  cellCount: number,  // billions
  volumeLiters: number,
  gravityPlato: number
): number {
  // cells/mL/°P
  const cellsPerML = (cellCount * 1e9) / (volumeLiters * 1000);
  return cellsPerML / gravityPlato;
}
```

#### Entity and Pages
- `src/entities/yeast-pitch.tsx`
- Pages under `/production/yeast/`

#### Completion Criteria
- [ ] Yeast pitch tracking with generations
- [ ] Lineage tree visualization
- [ ] Viability auto-calculated
- [ ] Cost spreading across batches
- [ ] Harvest recording from batch
- [ ] Pitch recording to batch

---

## Phase 10: Keg Management [NOT STARTED]

### Overview
Track keg inventory, lifecycle, and customer balances.

### Dependencies
- Phase 4 (customers, orders)

---

### 10.1-10.5 Keg Implementation

#### Database Tables
```sql
CREATE TABLE keg_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  size_bbl NUMERIC NOT NULL,
  deposit_amount NUMERIC DEFAULT 0,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE keg_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('fill', 'ship', 'return', 'clean', 'adjust')),
  keg_type_id UUID REFERENCES keg_types(id),
  quantity INTEGER NOT NULL,
  from_state TEXT,
  to_state TEXT,
  batch_id UUID REFERENCES batches(id),
  order_id UUID REFERENCES orders(id),
  customer_id UUID REFERENCES customers(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE VIEW keg_inventory AS
SELECT
  kt.id as keg_type_id,
  kt.name as keg_type_name,
  kt.size_bbl,
  -- Calculate current quantities by state from transactions
  -- ...
FROM keg_types kt;

CREATE VIEW customer_keg_balances AS
SELECT
  c.id as customer_id,
  c.name as customer_name,
  kt.id as keg_type_id,
  kt.name as keg_type_name,
  -- Shipped minus returned
  SUM(CASE WHEN transaction_type = 'ship' THEN quantity ELSE 0 END) -
  SUM(CASE WHEN transaction_type = 'return' THEN quantity ELSE 0 END) as balance
FROM customers c
CROSS JOIN keg_types kt
LEFT JOIN keg_transactions t ON t.customer_id = c.id AND t.keg_type_id = kt.id
GROUP BY c.id, c.name, kt.id, kt.name;
```

#### Pages
- `/inventory/kegs/` - Keg inventory by type/state
- `/sales/customers/[id]/kegs` - Customer keg balance tab

#### Completion Criteria
- [ ] Keg types configurable
- [ ] Track fill/ship/return transactions
- [ ] Inventory by state visible
- [ ] Customer keg balance accurate
- [ ] Keg return recording
- [ ] Aging kegs report

---

## Phase 11: Unit System & Preferences [PARTIAL]

### Overview
User-configurable unit display and conversion.

### Current Status
- [x] `src/lib/units.ts` - Complete with all conversions
- [x] `src/components/ui/unit-input.tsx` - Exists
- [x] `user_preferences` table exists (migration 00009)
- [ ] Forms don't consistently use UnitInput
- [ ] User preferences not linked to all forms

### Remaining Work

**Step 1: Create useUnitPreferences Hook**
File: `src/hooks/useUnitPreferences.ts`

```typescript
export function useUnitPreferences() {
  const supabase = createClient();
  const { data: user } = useUser();

  return useQuery({
    queryKey: ['user-preferences', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', user?.id)
        .single();
      return data;
    },
    enabled: !!user?.id,
  });
}
```

**Step 2: Update Forms to Use UnitInput**
Replace number inputs for volume/weight/temp with UnitInput:
- Recipe form
- Batch form
- Brew log form

**Step 3: Add Unit Preferences to Settings**
File: `src/app/(app)/settings/preferences/page.tsx`

#### Completion Criteria
- [ ] useUnitPreferences hook works
- [ ] Recipe form uses UnitInput for volumes
- [ ] Batch form uses UnitInput for volume
- [ ] User can change unit preferences
- [ ] Changes reflect immediately

---

## Phase 12: API Routes & Backend [NOT STARTED]

### Overview
REST API endpoints for all entities with auth, validation, error handling.

### Dependencies
- Phase 5.5 (Error handling patterns)

---

### 12.1 API Infrastructure

#### Implementation Steps

**Step 1: Response Helpers**
File: `src/lib/api/response.ts`

```typescript
import { NextResponse } from 'next/server';

export function success<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function error(code: string, message: string, status = 400) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function paginated<T>(data: T[], page: number, perPage: number, total: number) {
  return NextResponse.json({
    data,
    meta: { page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) },
  });
}
```

**Step 2: Auth Middleware**
File: `src/lib/api/auth.ts`

```typescript
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export async function withAuth(handler: (user: User, request: Request) => Promise<Response>) {
  return async (request: Request) => {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return error('UNAUTHORIZED', 'Authentication required', 401);
    }

    return handler(user, request);
  };
}

export async function withRoles(roles: string[], handler: Function) {
  // Check user has required role
}
```

**Step 3: Validation Helpers**
File: `src/lib/api/validation.ts`

```typescript
import { z } from 'zod';

export async function parseBody<T>(request: Request, schema: z.ZodSchema<T>): Promise<T> {
  const body = await request.json();
  return schema.parse(body);
}

export function parseQuery<T>(request: Request, schema: z.ZodSchema<T>): T {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams);
  return schema.parse(params);
}
```

---

### 12.2-12.7 API Routes

Create routes following this pattern:

File: `src/app/api/batches/route.ts`
```typescript
import { withAuth } from '@/lib/api/auth';
import { success, error, paginated } from '@/lib/api/response';
import { parseQuery, parseBody } from '@/lib/api/validation';
import { batchSchema } from '@/entities/batch';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export const GET = withAuth(async (user, request) => {
  const supabase = createRouteHandlerClient({ cookies });
  const query = parseQuery(request, z.object({
    page: z.coerce.number().default(1),
    per_page: z.coerce.number().default(20),
    status: z.string().optional(),
  }));

  const { data, count } = await supabase
    .from('batches')
    .select('*', { count: 'exact' })
    .range((query.page - 1) * query.per_page, query.page * query.per_page - 1);

  return paginated(data, query.page, query.per_page, count);
});

export const POST = withAuth(async (user, request) => {
  const body = await parseBody(request, batchSchema);
  const supabase = createRouteHandlerClient({ cookies });

  const { data, error: dbError } = await supabase
    .from('batches')
    .insert(body)
    .select()
    .single();

  if (dbError) return error('DB_ERROR', dbError.message);
  return success(data, 201);
});
```

#### Routes to Create
- Production: batches, recipes, brew-logs, vessels
- Packaging: sessions
- Inventory: finished-goods, bins
- Sales: orders, customers
- Purchasing: pos, suppliers
- Reports: ttb, projections, cogs, inventory

#### Completion Criteria
- [ ] All entity CRUD endpoints exist
- [ ] Auth middleware on all routes
- [ ] Zod validation on request bodies
- [ ] Consistent error responses
- [ ] Pagination on list endpoints

---

## Phase 13: AI Integration [PARTIAL]

### Overview
AI-first features including database functions, TypeScript utilities, and schema context.

### Current Status
- [x] Database functions exist (migration 00008)
- [x] `src/lib/ai/` exists with utilities
- [ ] AI-enhanced UI components

### Remaining Work

**Step 1: Audit Schema Registry**
Verify all tables have `_schema_registry` entries with:
- `key_fields`
- `query_examples`
- `ai_context`

**Step 2: Create AI UI Components**

File: `src/components/ai/recipe-analyzer.tsx`
- Display style compliance results
- Show improvement suggestions
- Interactive "what-if" adjustments

File: `src/components/ai/batch-insights.tsx`
- Performance vs target visualization
- Fermentation predictions

File: `src/components/ai/inventory-alerts.tsx`
- Smart reorder recommendations
- Demand forecasting

**Step 3: Add AI Context to Entities**
Ensure all entity configs have:
- `queryExamples: [...]`
- `keyFields: [...]`
- `aiActions: [...]` (where applicable)

#### Completion Criteria
- [ ] Schema registry complete for all tables
- [ ] Recipe analyzer component works
- [ ] Batch insights component works
- [ ] Entity configs have AI context

---

## Phase 14: Advanced Workflows [NOT STARTED]

### Overview
Complex business workflows spanning multiple entities.

### Dependencies
- Phases 3-4 (inventory, orders)

---

### 14.1 Batch Blending

Create `blend_batches` junction table and UI for:
- Selecting source batches
- Specifying volumes
- Calculating blended characteristics

### 14.2 PO Generation from Demand

Create demand calculator that:
- Looks at planned batches
- Calculates ingredient needs
- Compares to current inventory
- Suggests PO quantities

### 14.3 Pick List Generation

Implement FIFO allocation and path optimization.

### 14.4 Landed Cost Calculation

Add shipping cost to PO receives and allocate across items.

### 14.5 Batch Cancellation

Workflow for handling batch losses with proper cleanup.

---

## Phase 15: Testing & Quality [NOT STARTED]

### Overview
Comprehensive testing strategy with automated CI/CD.

---

### 15.1 Unit Testing

File: `vitest.config.ts`
```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

Tests to write:
- `src/lib/__tests__/units.test.ts` - All conversions
- `src/lib/__tests__/brewing-calculations.test.ts` - OG, FG, ABV, IBU, SRM
- `src/lib/__tests__/water-chemistry.test.ts` - Ion calculations

### 15.2 Integration Testing

Test database operations with test database.

### 15.3 E2E Testing

Playwright tests for critical workflows:
- Recipe → Batch → Brew → Package
- Order → Allocate → Pick → Fulfill
- PO → Receive → Inventory

### 15.4 CI/CD Pipeline

File: `.github/workflows/test.yml`
```yaml
name: Test
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
```

#### Completion Criteria
- [ ] Vitest configured
- [ ] Unit tests for lib functions (90%+ coverage)
- [ ] Integration tests for state machines
- [ ] E2E tests for critical workflows
- [ ] CI runs tests on every PR

---

## Summary: Implementation Order

Recommended sequence based on dependencies:

1. **Phase 2 completion** (in progress) - Finish production workflow
2. **Phase 2.5** - Complete recipe builder
3. **Phase 3** - Packaging and finished goods
4. **Phase 4** - Sales and purchasing
5. **Phase 5** - Data integrity (parallel)
6. **Phase 8** - Settings (parallel)
7. **Phase 6** - Integrations (after 3-4)
8. **Phase 7** - Reporting (after 3-4)
9. **Phase 9-10** - Yeast/Keg (after 2-4)
10. **Phase 11** - Complete unit integration
11. **Phase 12** - API routes
12. **Phase 13** - Complete AI integration
13. **Phase 14** - Advanced workflows
14. **Phase 15** - Testing (ongoing)

---

*Document continues from IMPLEMENTATION-PLAN-EXPANDED.md*
