# Per-Channel Format Visibility Design

**Goal:** Allow each sales channel to have its own set of visible pricing formats, controlled via toggle switches in the Formats tab.

**Architecture:** New junction table `pricing_channel_formats` (channel × format). Presence of a row = format visible for that channel. The existing `show_in_pricing` boolean on `package_types`/`keg_types` becomes the master "available for pricing" toggle. The Formats tab respects the active channel tab and toggles per-channel visibility.

## Schema

```sql
CREATE TABLE pricing_channel_formats (
  sales_channel_id UUID NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  format_id UUID NOT NULL,
  PRIMARY KEY (sales_channel_id, format_id)
);
```

## Data Migration

Seed rows for every (active_channel, format) where `show_in_pricing = true`, preserving current visibility.

## UI

- Formats tab shows the same toggle list, but scoped to the active channel
- Channel tabs visible in Formats view (same as matrix view)
- Toggle ON → insert row into `pricing_channel_formats`
- Toggle OFF → delete row from `pricing_channel_formats`
- Global `show_in_pricing` kept as master availability toggle

## Matrix Query

Filter format columns by: `format_id IN (SELECT format_id FROM pricing_channel_formats WHERE sales_channel_id = :activeChannel)`
