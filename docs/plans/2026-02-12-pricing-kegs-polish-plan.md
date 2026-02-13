# Pricing Matrix & Kegs/Formats Polish — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify keg and package format pricing in a single matrix with a format management tab and visual polish.

**Architecture:** Add `show_in_pricing` to `keg_types`, relax the FK on `pricing_tier_prices` to accept both package_type and keg_type IDs, rebuild `packaging_formats` view to include pricing flag, then update the pricing matrix UI to use the unified view with grouped columns and better visual treatment.

**Tech Stack:** PostgreSQL migrations, React (Next.js), TanStack Query, Supabase client, shadcn/ui

**Design doc:** `docs/plans/2026-02-12-pricing-kegs-polish-design.md`

---

### Task 1: Migration — Extend Schema for Unified Pricing Formats

**Files:**
- Create: `supabase/migrations/00092_pricing_keg_formats.sql`

**Step 1: Write the migration**

```sql
-- Migration: Unify keg and package formats in pricing matrix
--
-- 1. Add show_in_pricing to keg_types
-- 2. Rename package_format_id → format_id in pricing_tier_prices
-- 3. Drop hard FK to package_types (keg UUIDs can't reference package_types)
-- 4. Rebuild packaging_formats view with show_in_pricing + pricing-useful columns
-- 5. Update pricing_history column name to match
-- 6. Update audit trigger to use new column name

-- =============================================================================
-- 1. Add show_in_pricing to keg_types
-- =============================================================================

ALTER TABLE keg_types
  ADD COLUMN IF NOT EXISTS show_in_pricing BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN keg_types.show_in_pricing
  IS 'Controls which keg formats appear as columns in the pricing matrix';

-- =============================================================================
-- 2. Rename column in pricing_tier_prices
-- =============================================================================

ALTER TABLE pricing_tier_prices
  RENAME COLUMN package_format_id TO format_id;

-- Drop the FK constraint (references package_types only, but we now need keg_type IDs too)
ALTER TABLE pricing_tier_prices
  DROP CONSTRAINT IF EXISTS pricing_tier_prices_package_format_id_fkey;

-- Recreate unique constraint with new column name
ALTER TABLE pricing_tier_prices
  DROP CONSTRAINT IF EXISTS pricing_tier_prices_pricing_tier_id_package_format_id_sales__key;

ALTER TABLE pricing_tier_prices
  ADD CONSTRAINT pricing_tier_prices_tier_format_channel_key
  UNIQUE(pricing_tier_id, format_id, sales_channel_id);

-- Recreate index with new name
DROP INDEX IF EXISTS idx_pricing_tier_prices_format;
CREATE INDEX idx_pricing_tier_prices_format ON pricing_tier_prices(format_id);

-- =============================================================================
-- 3. Rename column in pricing_history to match
-- =============================================================================

ALTER TABLE pricing_history
  RENAME COLUMN package_format_id TO format_id;

-- =============================================================================
-- 4. Update audit trigger to use new column name
-- =============================================================================

CREATE OR REPLACE FUNCTION log_pricing_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.price IS DISTINCT FROM NEW.price THEN
    INSERT INTO pricing_history (
      pricing_tier_price_id, pricing_tier_id, format_id,
      sales_channel_id, old_price, new_price, changed_by
    ) VALUES (
      NEW.id, NEW.pricing_tier_id, NEW.format_id,
      NEW.sales_channel_id, OLD.price, NEW.price, auth.uid()
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO pricing_history (
      pricing_tier_price_id, pricing_tier_id, format_id,
      sales_channel_id, old_price, new_price, changed_by
    ) VALUES (
      OLD.id, OLD.pricing_tier_id, OLD.format_id,
      OLD.sales_channel_id, OLD.price, NULL, auth.uid()
    );
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 5. Rebuild packaging_formats view with pricing columns
-- =============================================================================

DROP VIEW IF EXISTS packaging_formats;

CREATE VIEW packaging_formats
WITH (security_invoker = true)
AS
SELECT
  id,
  name,
  'package_type'::text AS format_source,
  container_type,
  volume_oz,
  units_per_case,
  is_active,
  show_in_pricing
FROM package_types
WHERE container_type != 'keg'

UNION ALL

SELECT
  id,
  name,
  'keg_type'::text AS format_source,
  'keg'::text AS container_type,
  NULL::numeric AS volume_oz,
  NULL::integer AS units_per_case,
  is_active,
  show_in_pricing
FROM keg_types;

COMMENT ON VIEW packaging_formats IS
  'Union view of non-keg package_types and keg_types. Includes show_in_pricing for pricing matrix column control.';

-- =============================================================================
-- 6. Schema registry update
-- =============================================================================

UPDATE _schema_registry
SET description = 'Union view of package types and keg types with pricing visibility flag'
WHERE table_name = 'packaging_formats';
```

**Step 2: Apply the migration**

Apply via Supabase MCP `apply_migration` tool with name `pricing_keg_formats`.

**Step 3: Verify**

Run SQL to confirm:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'pricing_tier_prices' AND column_name = 'format_id';

SELECT * FROM packaging_formats WHERE show_in_pricing = true LIMIT 5;
```

**Step 4: Commit**

```
git add supabase/migrations/00092_pricing_keg_formats.sql
git commit -m "feat: unify keg and package formats in pricing schema"
```

---

### Task 2: Update Entity Config — pricing-tier-price.tsx

**Files:**
- Modify: `src/entities/pricing-tier-price.tsx`

**Step 1: Rename all `package_format_id` references to `format_id`**

Changes needed:
- Interface `PricingTierPrice` (line 14): `package_format_id` → `format_id`
- Zod schema (line 27): `package_format_id` → `format_id`
- `listColumns` (line 60): `accessorKey: "package_format_id"` → `"format_id"`
- `listColumns` relation (line 63-66): keep `entity: "package_type"` for now (format display)
- `detailSections` (line 101): `field: "package_format_id"` → `"format_id"`
- `formFields` (line 129): `name: "package_format_id"` → `"format_id"`
- `formFields` dynamicOptions (line 135-141): change `table` to `"packaging_formats"`, remove `show_in_pricing` filter (view already provides it), add filter `{ is_active: true, show_in_pricing: true }`
- `relations` (lines 178-183): `foreignKey: "package_format_id"` → `"format_id"`
- `keyFields` (line 201): `"package_format_id"` → `"format_id"`

**Step 2: Commit**

```
git add src/entities/pricing-tier-price.tsx
git commit -m "refactor: rename package_format_id to format_id in pricing entity"
```

---

### Task 3: Update Pricing Matrix — Unified Format Query

**Files:**
- Modify: `src/app/(app)/settings/pricing/page.tsx:60-77` (types)
- Modify: `src/app/(app)/settings/pricing/page.tsx:260-272` (formats query)
- Modify: `src/app/(app)/settings/pricing/page.tsx:274-295` (prices query + priceMap)

**Step 1: Update types**

Replace the `PackageFormat` interface (line 74-77):
```typescript
interface PackageFormat {
  id: string;
  name: string;
  format_source: "package_type" | "keg_type";
  container_type: string;
  volume_oz: number | null;
  units_per_case: number | null;
}
```

Update `PricingTierPrice` interface (line 79-85):
```typescript
interface PricingTierPrice {
  id: string;
  pricing_tier_id: string;
  format_id: string;
  sales_channel_id: string;
  price: number;
}
```

**Step 2: Update formats query**

Replace the formats query (lines 260-272) to use `packaging_formats` view:
```typescript
const { data: formats, isLoading: formatsLoading } = useQuery({
  queryKey: settingsKeys.pricingFormats(),
  queryFn: async () => {
    const { data, error } = await db
      .from("packaging_formats")
      .select("id, name, format_source, container_type, volume_oz, units_per_case")
      .eq("is_active", true)
      .eq("show_in_pricing", true)
      .order("name");
    if (error) throw error;
    return data as PackageFormat[];
  },
});
```

**Step 3: Update priceMap and save handler**

Update priceMap building (lines 289-295) to use `format_id`:
```typescript
const priceMap = new Map<string, Map<string, PricingTierPrice>>();
prices?.forEach((p) => {
  if (!priceMap.has(p.pricing_tier_id)) {
    priceMap.set(p.pricing_tier_id, new Map());
  }
  priceMap.get(p.pricing_tier_id)!.set(p.format_id, p);
});
```

Update `saveMutation` and all references from `package_format_id` to `format_id`.

Update `PriceCell` prop name from `formatId` to match (internal only, no rename needed — just ensure the `priceMap.get(tier.id)?.get(fmt.id)` lookup works).

**Step 4: Commit**

```
git add src/app/(app)/settings/pricing/page.tsx
git commit -m "feat: pricing matrix uses unified packaging_formats view"
```

---

### Task 4: Column Grouping and Unit Labels

**Files:**
- Modify: `src/app/(app)/settings/pricing/page.tsx:720-773` (table render)

**Step 1: Split formats into groups**

Add derived data above the table render:
```typescript
const packagedFormats = formats?.filter(f => f.format_source === "package_type") ?? [];
const kegFormats = formats?.filter(f => f.format_source === "keg_type") ?? [];
const allFormats = [...packagedFormats, ...kegFormats]; // packaged first, then kegs
```

**Step 2: Add group header row**

Above the format name headers, add a spanning row:
```tsx
<TableRow className="bg-muted/50 hover:bg-muted/50 border-b-0">
  <TableHead className="sticky left-0 z-10 bg-muted/50" />
  {packagedFormats.length > 0 && (
    <TableHead
      colSpan={packagedFormats.length}
      className="text-center text-xs font-medium text-muted-foreground border-b-0"
    >
      Packaged
    </TableHead>
  )}
  {kegFormats.length > 0 && (
    <TableHead
      colSpan={kegFormats.length}
      className="text-center text-xs font-medium text-muted-foreground border-l border-b-0"
    >
      Draft / Kegs
    </TableHead>
  )}
</TableRow>
```

**Step 3: Format column headers with unit context**

Replace format header text with unit-aware labels:
```tsx
function formatColumnLabel(f: PackageFormat): { name: string; unit: string } {
  if (f.format_source === "keg_type") {
    return { name: f.name, unit: "per keg" };
  }
  if (f.units_per_case) {
    return { name: f.name, unit: `case/${f.units_per_case}` };
  }
  return { name: f.name, unit: "each" };
}
```

Column header render:
```tsx
{allFormats.map((f, i) => {
  const label = formatColumnLabel(f);
  const isFirstKeg = kegFormats.length > 0 && f.id === kegFormats[0].id;
  return (
    <TableHead
      key={f.id}
      className={cn("text-right w-[120px]", isFirstKeg && "border-l")}
    >
      <div className="leading-tight">
        <div className="text-xs font-medium">{label.name}</div>
        <div className="text-[10px] text-muted-foreground font-normal">{label.unit}</div>
      </div>
    </TableHead>
  );
})}
```

**Step 4: Update cell iteration to use `allFormats`**

Replace `formats.map(...)` in body rows with `allFormats.map(...)`. Add border-left class on first keg column cells to match header grouping.

**Step 5: Commit**

```
git add src/app/(app)/settings/pricing/page.tsx
git commit -m "feat: grouped column headers with unit labels in pricing matrix"
```

---

### Task 5: Format Management Tab

**Files:**
- Modify: `src/app/(app)/settings/pricing/page.tsx` (add "Formats" view toggle + format checklist)

**Step 1: Add "Formats" to view toggle**

Extend the view state type: `"matrix" | "tiers" | "formats"`. Add a third button in the header toggle group:
```tsx
<Button
  variant={view === "formats" ? "default" : "outline"}
  size="sm"
  onClick={() => setView("formats")}
>
  <Package className="h-4 w-4 mr-1" />
  Formats
</Button>
```

Import `Package` from lucide-react.

**Step 2: Build FormatManagement component**

Create a `FormatManagement` function component within the pricing page file. It fetches ALL active formats from `packaging_formats` (no `show_in_pricing` filter) and renders a toggle table:

```tsx
function FormatManagement() {
  const supabase = createClient();
  const db = supabase as any;
  const queryClient = useQueryClient();

  const { data: formats, isLoading } = useQuery({
    queryKey: settingsKeys.pricingFormatsAll(),
    queryFn: async () => {
      const { data, error } = await db
        .from("packaging_formats")
        .select("id, name, format_source, container_type, volume_oz, units_per_case, show_in_pricing")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as (PackageFormat & { show_in_pricing: boolean })[];
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, format_source, show_in_pricing }: {
      id: string;
      format_source: string;
      show_in_pricing: boolean;
    }) => {
      const table = format_source === "keg_type" ? "keg_types" : "package_types";
      const { error } = await db
        .from(table)
        .update({ show_in_pricing })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.pricingFormatsAll() });
      queryClient.invalidateQueries({ queryKey: settingsKeys.pricingFormats() });
    },
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const packaged = formats?.filter(f => f.format_source === "package_type") ?? [];
  const kegs = formats?.filter(f => f.format_source === "keg_type") ?? [];

  const renderSection = (title: string, items: typeof packaged) => (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Format</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead className="w-[100px] text-right">In Pricing</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(f => (
            <TableRow key={f.id}>
              <TableCell className="font-medium">{f.name}</TableCell>
              <TableCell className="text-muted-foreground capitalize">{f.container_type}</TableCell>
              <TableCell className="text-muted-foreground">
                {f.format_source === "keg_type" ? "Per keg" : f.units_per_case ? `Case/${f.units_per_case}` : "Each"}
              </TableCell>
              <TableCell className="text-right">
                <Switch
                  checked={f.show_in_pricing}
                  onCheckedChange={(checked) =>
                    toggleMutation.mutate({
                      id: f.id,
                      format_source: f.format_source,
                      show_in_pricing: checked,
                    })
                  }
                  disabled={toggleMutation.isPending}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Toggle which formats appear as columns in the pricing matrix.
      </p>
      {renderSection("Packaged Formats", packaged)}
      {renderSection("Keg Formats", kegs)}
    </div>
  );
}
```

**Step 3: Add query key**

In `src/lib/query-keys.ts`, add to `settingsKeys` (line 201):
```typescript
pricingFormatsAll: () => ["pricing-formats-all"] as const,
```

**Step 4: Wire into view toggle**

In the main return, add:
```tsx
{view === "formats" && <FormatManagement />}
```

**Step 5: Commit**

```
git add src/app/(app)/settings/pricing/page.tsx src/lib/query-keys.ts
git commit -m "feat: format management tab in pricing settings"
```

---

### Task 6: Matrix Visual Polish

**Files:**
- Modify: `src/app/(app)/settings/pricing/page.tsx` (table styling)

**Step 1: Tier row COGS subtitle**

In tier name cell, show COGS threshold:
```tsx
<TableCell className="sticky left-0 z-10 bg-inherit border-r px-3 py-1">
  <div>
    <div className="font-medium">{tier.name}</div>
    {tier.cogs_max != null && (
      <div className="text-[10px] text-muted-foreground">
        &le; ${Number(tier.cogs_max).toFixed(2)}/unit
      </div>
    )}
  </div>
</TableCell>
```

**Step 2: Empty cell treatment**

In `PriceCell`, change the empty state from `"—"` to a subtler indicator:
```tsx
<button
  ref={buttonRef}
  onClick={startEditing}
  className={cn(
    "w-full h-8 text-right text-sm px-2 rounded transition-colors cursor-text tabular-nums",
    price != null
      ? "hover:bg-muted/50"
      : "text-muted-foreground/30 hover:bg-muted/30"
  )}
>
  {price != null ? `$${price.toFixed(2)}` : "·"}
</button>
```

**Step 3: Sticky column headers**

Add `sticky top-0 z-20` to the `<TableHeader>` row for horizontal scroll stickiness (already have sticky left for tier column).

**Step 4: Commit**

```
git add src/app/(app)/settings/pricing/page.tsx
git commit -m "feat: pricing matrix visual polish — COGS subtitles, empty cells, sticky headers"
```

---

### Task 7: Lint, Test, and Final Commit

**Step 1: Run lint**

```bash
pnpm lint
```

Fix any errors.

**Step 2: Verify Supabase advisors**

Check for security/performance advisors after schema changes.

**Step 3: Final commit if needed**

```
git add -A
git commit -m "chore: lint fixes for pricing matrix changes"
```
