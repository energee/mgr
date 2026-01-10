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

Slack integration settings (brewery-wide).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| webhook_url | TEXT | Slack webhook URL |
| default_channel | TEXT | Default channel |
| is_enabled | BOOLEAN | Integration enabled |
| channel_overrides | JSONB | Per-notification-type channel overrides |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**channel_overrides schema:**
```json
{
  "batch_ready": "#production",
  "order_due": "#sales"
}
```

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
