# Operations

## Unit System

### Base Units (Storage)

All quantities stored in consistent base units in the database:

| Measurement | Canonical Unit | Column Suffix | Example |
|-------------|----------------|---------------|---------|
| Production volume | BBL (barrels) | `_bbl` | `batches.volume_bbl` |
| Retail container | oz (fluid ounces) | `_oz` | `package_types.volume_oz` |
| Weight | lbs (pounds) | `_lbs` | `recipe_malts.weight_lbs` |
| Gravity | Plato | (no suffix) | `brew_logs.og` |
| Temperature | °F (Fahrenheit) | `_f` | `fermentation_temp_f` |

**Rationale**: BBL is the US brewing industry standard and required for TTB reporting. Using a single canonical unit eliminates conversion errors in calculations and reporting.

### User Preferences

Per-user display/input preferences stored in `user_preferences` table:

```typescript
interface UnitPreferences {
  volume_unit: 'bbl' | 'gal' | 'l' | 'hl';
  weight_unit: 'lbs' | 'kg';
  temperature_unit: 'f' | 'c';
  gravity_unit: 'plato' | 'sg';
  retail_volume_unit: 'oz' | 'ml';
}
```

**Defaults**: BBL, lbs, °F, Plato, oz (US brewing conventions)

### Display Modes

| Context | Unit Selection | Behavior |
|---------|----------------|----------|
| Most forms/lists | Global preference | Uses `user_preferences` setting |
| Recipe Builder | Inline switcher | Dropdown next to input field |
| Brew Log | Inline switcher | Dropdown next to input field |
| Reports/TTB | Always BBL | Canonical unit for compliance |

### Conversion Constants

```typescript
// Volume (base: BBL)
const VOLUME_CONVERSIONS = {
  bbl: 1,
  gal: 31,           // 1 BBL = 31 US gallons
  l: 117.348,        // 1 BBL = 117.348 liters
  hl: 1.17348,       // 1 BBL = 1.17348 hectoliters
};

// Retail volume (base: oz)
const RETAIL_VOLUME_CONVERSIONS = {
  oz: 1,
  ml: 29.5735,       // 1 oz = 29.5735 ml
};

// Weight (base: lbs)
const WEIGHT_CONVERSIONS = {
  lbs: 1,
  kg: 0.453592,      // 1 lb = 0.453592 kg
};

// Temperature: °F to °C = (°F - 32) × 5/9
// Gravity: Plato to SG = 1 + (Plato / (258.6 - 0.8796 × Plato))
```

### Conversion Rules

1. **Never round during conversion** - rounding only at display time
2. **Convert on input** - user enters in preferred unit, stored in canonical
3. **Convert on display** - stored in canonical, displayed in preferred
4. **Preserve precision** - use DECIMAL types with adequate precision

### Implementation

**Library**: `src/lib/units.ts` - pure conversion functions
**Hook**: `src/hooks/useUnitPreferences.ts` - React Query hook for preferences
**Component**: `src/components/ui/unit-input.tsx` - input with optional unit switcher

```typescript
// Example: UnitInput component usage
<UnitInput
  value={batch.volume_bbl}           // Canonical value
  onChange={(bbl) => update(bbl)}    // Receives canonical
  unitType="volume"
  allowSwitch={false}                // Use global preference
/>

// Recipe builder with inline switcher
<UnitInput
  value={recipe.batch_size_bbl}
  onChange={(bbl) => update(bbl)}
  unitType="volume"
  allowSwitch={true}                 // Show unit dropdown
/>
```

---

## Notifications

### Notification Types

| Type | Trigger | Default Channels |
|------|---------|------------------|
| low_inventory | Ingredient below reorder point | In-app, Email |
| batch_ready | Batch ready for next step | In-app, Slack |
| order_due | Order delivery date approaching | In-app, Email |
| po_delivery | PO expected delivery date | In-app |
| packaging_scheduled | Packaging session tomorrow | In-app, Slack |
| fg_expiring | FG approaching expiration | In-app, Email |

### Channels
- **In-app**: Real-time via Supabase Realtime
- **Email**: Via Resend or similar service
- **Slack**: Via webhook to brewery channel or user DM

### User Preferences
Each user can configure per notification type:
- Enable/disable each channel
- Brewery-wide Slack channel
- User-specific overrides

### Implementation
```typescript
async function sendNotification(
  type: NotificationType,
  data: NotificationData,
  userId?: string // optional, for user-specific
) {
  // Get preferences
  const prefs = await getNotificationPrefs(userId);
  const typePrefs = prefs[type] || defaultPrefs[type];

  // Create in-app notification
  if (typePrefs.in_app) {
    await supabase.from('notifications').insert({
      user_id: userId,
      type,
      title: formatTitle(type, data),
      message: formatMessage(type, data),
      data
    });
  }

  // Send email
  if (typePrefs.email) {
    await sendEmail(userId, type, data);
  }

  // Send Slack
  if (typePrefs.slack) {
    await sendSlack(type, data);
  }
}
```

---

## Reporting

### TTB Reporting
Monthly report matching TTB Form 5130.9:
- Line 1: Beginning inventory
- Line 2: Beer produced
- Line 3: Received in bond
- Line 4: Beer returned
- Line 5: Inventory overage
- Lines 6-9: Total/adjustments
- Line 10: Tax-paid removals
- Line 11: Tax-free removals
- Line 12: Consumed on premises
- Line 13: Destroyed
- Line 14: Losses
- Line 15: Inventory shortage
- Lines 16-17: Ending inventory

```typescript
async function generateTTBReport(
  month: Date
): Promise<TTBReport> {
  const startDate = startOfMonth(month);
  const endDate = endOfMonth(month);

  // Query allocations by destination_type and date
  const allocations = await getAllocationsForPeriod(
    startDate, endDate
  );

  // Map to TTB lines
  return {
    line1: await getBeginningInventory(startDate),
    line2: sumAllocations(allocations, 'finished_good'),
    line3: sumAllocations(allocations, 'bond_transfer_in'),
    line4: sumAllocations(allocations, 'external_return'),
    // ... etc
  };
}
```

### Projections Report
Based on planned batches:
- Ingredient needs (fixed vs variable)
- Hop projections by style
- Malt projections by style
- Expected finished goods
- Expected revenue

### COGS Report
- Ingredient costs per batch
- Yeast costs (spread across lineage)
- Landed costs
- Total COGS per brand/format

### Production Report
Daily/monthly:
- Batches completed
- Packaging sessions
- Finished goods created
- Volume produced

### Inventory Report
Current state:
- FG by brand/format/location
- Raw materials by ingredient
- Keg inventory by type/state

---

## File Storage

### Storage Buckets
- `avatars`: User profile pictures
- `documents`: General documents (future)

### Avatar Upload
```typescript
async function uploadAvatar(userId: string, file: File): Promise<string> {
  const path = `${userId}/${Date.now()}-${file.name}`;

  const { data, error } = await supabase.storage
    .from('avatars')
    .upload(path, file, {
      upsert: true,
      contentType: file.type
    });

  if (error) throw error;

  const { data: { publicUrl } } = supabase.storage
    .from('avatars')
    .getPublicUrl(path);

  await supabase
    .from('users')
    .update({ avatar_url: publicUrl })
    .eq('id', userId);

  return publicUrl;
}
```

### Storage Policies
```sql
-- Users can upload their own avatars
CREATE POLICY "Users can upload own avatar"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'avatars' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Public read for avatars
CREATE POLICY "Avatars are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');
```

---

## Related Documents

- [Workflows](./workflows.md) - State machines and allocations
- [Integrations](./integrations.md) - External system connections
- [Appendices](./appendices.md) - Enum values and constants
