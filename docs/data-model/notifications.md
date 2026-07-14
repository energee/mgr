# Notifications Domain

In-app notifications and integration settings for external channels (Slack, email).

## `notifications`

In-app notification records.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | FK to auth.users (NULL for brewery-wide) |
| type | TEXT | Notification type (see types below) |
| title | TEXT | Notification title |
| message | TEXT | Notification message |
| data | JSONB | Type-specific data |
| is_read | BOOLEAN | Read flag |
| read_at | TIMESTAMPTZ | When read |
| created_at | TIMESTAMPTZ | Created timestamp |

---

## `notification_preferences`

User preferences for notification channels per type.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | FK to auth.users |
| preferences | JSONB | Channel preferences per type |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**preferences schema:**
```json
{
  "low_inventory": { "in_app": true, "email": true, "slack": false },
  "batch_ready": { "in_app": true, "email": false, "slack": true },
  "order_due": { "in_app": true, "email": true, "slack": false },
  "po_delivery": { "in_app": true, "email": false, "slack": false }
}
```

---

## `slack_settings`

Slack integration settings (brewery-wide, singleton — enforced by unique index on `(true)`).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| webhook_url | TEXT | Slack Incoming Webhook URL |
| default_channel | TEXT | Default Slack channel (overrides webhook default) |
| is_enabled | BOOLEAN | Master toggle for Slack notifications |
| channel_overrides | JSONB | Per notification-type channel routing |
| internal_secret | TEXT | Auto-generated secret for pg_net → API route authentication |
| app_url | TEXT | App URL for pg_net callbacks (auto-set from request headers) |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**channel_overrides schema:**
```json
{
  "batch_status": "#production",
  "order_received": "#sales"
}
```

---

## `slack_notification_log`

Audit log of Slack notification delivery attempts. Created by `notify_all_users()` when Slack is enabled, updated by the `/api/slack/send` route after delivery.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| notification_type | TEXT | Notification type (e.g. `batch_status`, `order_received`) |
| title | TEXT | Notification title |
| message | TEXT | Notification message body |
| priority | TEXT | Priority level (default: `normal`) |
| action_url | TEXT | Deep link URL for the notification |
| metadata | JSONB | Type-specific data |
| channel | TEXT | Target Slack channel |
| status | TEXT | Delivery status: `pending`, `sent`, `failed`, `skipped` |
| error_message | TEXT | Error details (when status is `failed` or `skipped`) |
| sent_at | TIMESTAMPTZ | When the message was sent to Slack |
| created_at | TIMESTAMPTZ | Created timestamp |

**Indexes:**
- `idx_slack_notification_log_status` — Filter by delivery status
- `idx_slack_notification_log_created` — Sort by creation time (descending)

---

## Notification Types

| Type | Trigger | Default Channels |
|------|---------|------------------|
| low_inventory | Ingredient below reorder point | in_app, email |
| batch_ready | Batch ready for next stage | in_app, slack |
| order_due | Order delivery date approaching | in_app, email |
| po_delivery | PO expected delivery date | in_app |
| packaging_scheduled | Packaging session tomorrow | in_app, slack |
| fg_expiring | Finished goods approaching expiration | in_app, email |
| batch_reading_due | Scheduled reading reminder | in_app |

---

## Future: Email Settings

Email integration settings will be added when email notifications are implemented.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| provider | TEXT | Email provider (resend, sendgrid, etc.) |
| api_key | TEXT | API key (encrypted) |
| from_email | TEXT | From email address |
| from_name | TEXT | From name |
| is_enabled | BOOLEAN | Integration enabled |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

## email_settings

Single-row configuration for outbound notification email. Read by
`dispatch_email_notification` (SECURITY DEFINER, EXECUTE locked to `service_role`
in 00245); writes gated on `settings:manage`. Introduced live and captured into the
chain by 00199.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| is_enabled | BOOLEAN | Master on/off switch for notification email |
| supabase_project_url | TEXT | Project URL used to reach the send-email edge function |
| app_url | TEXT | Base URL used to build action links in the email body |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |
