# Integrations

## QuickBooks Online

### Sync Direction
One-way: MGR → QuickBooks

### Data Pushed
- **Customers**: Create/update in QBO when created in MGR
- **Invoices**: Create from orders when status = out_the_door
- **Bills**: Create from POs when status = fulfilled

### Implementation

Server-side sync routes call `src/integrations/quickbooks/` and track remote
identity in `qbo_sync_mappings`. Customers and suppliers resolve by their
mapping, then by exact QBO display name. Orders and purchase orders map to
Invoices and Bills.

Invoice and Bill creation uses a durable intent:

1. Write a pending `qbo_sync_log` row containing the exact outbound payload and
   deterministic per-entity QuickBooks `requestid`.
2. POST the document with that request ID. QuickBooks returns the original
   result when the same create is retried.
3. Persist `qbo_sync_mappings`, then mark the log successful. Every mapping and
   log write checks and propagates its database error.
4. If QuickBooks accepted the document but the mapping write failed, record the
   remote response as an error and tell the operator to retry. The retry reuses
   the same request ID, receives the same remote document, and restores the
   local mapping without creating another accounting document.

See the [Intuit request ID guidance](https://developer.intuit.com/app/developer/qbpayments/docs/learn/learn-basic-field-definitions).

### Settings
System-wide QBO connection:
- OAuth tokens and company realm ID in sensitive `system_settings` rows
- Sandbox or production environment per connection
- Sync preferences and account-category mappings

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
// 1. brand_id + selling_format_id match → find available FG
// 2. If no inventory available → log error, skip item
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
      .from('square_catalog_map')
      .select('brand_id, selling_format_id')
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
    const finishedGoodId = await findAvailableFG(mapping.brand_id, mapping.selling_format_id);

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
