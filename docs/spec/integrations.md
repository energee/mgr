# Integrations

## QuickBooks Online

### Sync Direction
One-way: MGR → QuickBooks

### Data Pushed
- **Customers**: Create/update in QBO when created in MGR
- **Invoices**: Create from orders when status = out_the_door
- **Bills**: Create from POs when status = fulfilled

### Implementation
```typescript
// Supabase Edge Function triggered by database webhook
export async function syncOrderToQBO(order: Order) {
  if (order.status !== 'out_the_door') return;
  if (order.qb_invoice_id) return; // Already synced

  const customer = await getCustomer(order.customer_id);

  // Ensure customer exists in QBO
  if (!customer.qb_customer_id) {
    const qbCustomer = await qbo.createCustomer({
      DisplayName: customer.name,
      // ... other fields
    });
    await updateCustomer(customer.id, { qb_customer_id: qbCustomer.Id });
  }

  // Create invoice
  const invoice = await qbo.createInvoice({
    CustomerRef: { value: customer.qb_customer_id },
    Line: order.line_items.map(li => ({
      Amount: li.line_total,
      Description: formatLineDescription(li),
      // ...
    })),
    // ...
  });

  await updateOrder(order.id, { qb_invoice_id: invoice.Id });
}
```

### Settings
System-wide QBO connection:
- OAuth tokens (encrypted)
- Company ID
- Sync preferences

---

## Slack

### Setup
- Webhook URL (system-wide)
- Default channel
- Per-notification-type channel overrides

### Message Format
```typescript
async function sendSlackNotification(
  type: NotificationType,
  data: any
) {
  const settings = await getSlackSettings();
  if (!settings.enabled) return;

  const channel = settings.notification_channels[type] || settings.channel;

  await fetch(settings.webhook_url, {
    method: 'POST',
    body: JSON.stringify({
      channel,
      text: formatSlackMessage(type, data),
      attachments: formatSlackAttachments(type, data)
    })
  });
}
```

---

## Square (Taproom POS)

### Purpose
Sync taproom point-of-sale transactions from Square to debit finished goods inventory automatically. Eliminates manual inventory reconciliation for on-premise sales.

### Sync Direction
One-way: Square → MGR

### Authentication
Square uses OAuth 2.0 for production applications. For single-tenant deployments, a personal access token may be used.

**Required credentials:**
- `access_token` - OAuth access token or personal access token
- `location_id` - Square location ID (taproom)
- `webhook_signature_key` - For validating webhook payloads

### Data Flow

```
Square Payment → Webhook → MGR API → Validate → Map Items → Create Allocations
```

**Webhook events subscribed:**
- `payment.completed` - Primary trigger for inventory debit

### Item Mapping
Square catalog items must be mapped to MGR finished goods before sync works. Unmapped items are logged but skipped.

```typescript
// Mapping resolution order:
// 1. Exact finished_good_id match (specific FG/lot)
// 2. brand_id + package_type_id match (any available FG)
```

### Implementation

```typescript
// Supabase Edge Function: POST /functions/v1/square-webhook
import { createClient } from '@supabase/supabase-js';
import { verifySquareSignature } from './square-utils';

export async function handleSquareWebhook(req: Request) {
  const supabase = createClient(/* ... */);

  // 1. Validate webhook signature
  const signature = req.headers.get('x-square-hmacsha256-signature');
  const body = await req.text();

  const { data: settings } = await supabase
    .from('square_settings')
    .select('webhook_signature_key')
    .single();

  if (!verifySquareSignature(body, signature, settings.webhook_signature_key)) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = JSON.parse(body);

  // 2. Only process completed payments
  if (event.type !== 'payment.completed') {
    return new Response('OK', { status: 200 });
  }

  const payment = event.data.object.payment;
  const orderId = payment.order_id;

  // 3. Fetch order details from Square API
  const orderDetails = await fetchSquareOrder(orderId, settings.access_token);

  // 4. Process each line item
  for (const item of orderDetails.line_items || []) {
    // Skip non-inventory items (services, tips, etc.)
    if (!item.catalog_object_id) continue;

    // Look up mapping
    const { data: mapping } = await supabase
      .from('square_item_mappings')
      .select('finished_good_id, brand_id, package_type_id')
      .eq('square_catalog_id', item.catalog_object_id)
      .single();

    if (!mapping) {
      // Log unmapped item for manual review
      await supabase.from('square_sync_errors').insert({
        square_order_id: orderId,
        square_item_id: item.catalog_object_id,
        item_name: item.name,
        error: 'unmapped_item'
      });
      continue;
    }

    // Resolve finished good (specific or find available)
    const finishedGoodId = mapping.finished_good_id
      ?? await findAvailableFG(mapping.brand_id, mapping.package_type_id);

    if (!finishedGoodId) {
      await supabase.from('square_sync_errors').insert({
        square_order_id: orderId,
        square_item_id: item.catalog_object_id,
        error: 'no_inventory_available'
      });
      continue;
    }

    // Create allocation to debit inventory
    await supabase.from('allocations').insert({
      source_type: 'finished_good',
      source_id: finishedGoodId,
      destination_type: 'taproom_sale',
      destination_id: null,  // No order record for POS sales
      quantity: parseInt(item.quantity),
      status: 'completed',
      notes: `Square order ${orderId}`,
      completed_at: new Date().toISOString()
    });
  }

  // 5. Record successful sync
  await supabase.from('square_sync_log').insert({
    square_order_id: orderId,
    square_payment_id: payment.id,
    synced_at: new Date().toISOString()
  });

  return new Response('OK', { status: 200 });
}
```

### Settings Schema

See `docs/data-model/sales.md` for full schema:
- `square_settings` - Credentials and configuration
- `square_item_mappings` - Map Square items to MGR products
- `square_sync_log` - Successful sync records
- `square_sync_errors` - Failed/skipped items for review

### Allocation Destination Type

Square sales use `destination_type = 'taproom_sale'` to distinguish from wholesale orders. This:
- Skips the order workflow (no picking, packing states)
- Still flows through allocations for inventory and TTB reporting
- Appears on TTB Line 10 (taxable removals - domestic)

### Error Handling

| Error | Handling |
|-------|----------|
| Invalid signature | Reject webhook (401) |
| Unmapped item | Log to `square_sync_errors`, skip item |
| No inventory available | Log error, skip item |
| Duplicate webhook | Check `square_sync_log`, skip if exists |

### Manual Reconciliation UI

Admin interface for:
- Viewing unmapped items and creating mappings
- Reviewing sync errors
- Manual inventory adjustment for missed sales
- Viewing sync history

---

## Related Documents

- [Operations](./operations.md) - Notifications
- [Workflows](./workflows.md) - Order and allocation states
- [Data Model: Sales](../data-model/sales.md) - Square schema details
