# Pricing Matrix & Kegs/Formats Polish

## Problem

The pricing matrix only shows `package_types` — kegs live in `keg_types` and can't appear as columns. The `show_in_pricing` flag is buried per-format with no overview. The matrix itself has rough visual treatment and sparse data is hard to read.

## Design

### 1. Schema: Unify Pricing Format References

**Current:** `pricing_tier_prices.package_format_id` has a hard FK to `package_types(id)`. Keg IDs cannot be stored.

**Change (Migration 00092):**
- Add `show_in_pricing BOOLEAN DEFAULT false` to `keg_types`
- Rename `pricing_tier_prices.package_format_id` → `format_id`
- Drop the FK constraint to `package_types`
- Recreate the `packaging_formats` view to include `show_in_pricing`
- Add a CHECK constraint via trigger: `format_id` must exist in `packaging_formats`
- Update `pricing_tier_prices` unique constraint to use `format_id`

The `packaging_formats` view becomes:
```sql
SELECT id, name, 'package_type' AS format_source, container_type,
       volume_oz, units_per_case, is_active, show_in_pricing
FROM package_types WHERE container_type != 'keg'
UNION ALL
SELECT id, name, 'keg_type' AS format_source, 'keg',
       NULL, NULL, is_active, show_in_pricing
FROM keg_types;
```

### 2. Pricing Matrix: Use Unified View

**Current:** Formats query hits `package_types` directly with `show_in_pricing = true`.

**Change:** Query `packaging_formats` view instead. The format list includes both packages and kegs.

Column headers show unit context:
- Packaged: `16oz 4pk` (units_per_case visible on hover or subtitle)
- Kegs: `1/2 BBL (keg)`

Column grouping: split columns into "Packaged" and "Draft" groups with spanning headers when both types are present.

### 3. Format Management in Pricing Page

**New:** A "Formats" tab alongside "Matrix" and "Tier Settings" in the pricing page header.

Shows a simple checklist table:
| Format | Type | Unit | In Pricing |
|--------|------|------|------------|
| 16oz 4-Pack | Can | Case/24 | [toggle] |
| 12oz 6-Pack | Can | Case/24 | [toggle] |
| 1/2 BBL | Keg | Per keg | [toggle] |
| 1/6 BBL | Keg | Per keg | [toggle] |

Two sections: "Packaged Formats" and "Keg Formats". Toggles update `show_in_pricing` on the respective table. This replaces the need to navigate to each format's detail page.

### 4. Matrix Visual Polish

- **Empty cells:** Subtle dashed border or `·` placeholder instead of `—`. Distinguish "not set" from "$0.00".
- **Tier rows:** Show COGS threshold as muted text: `Tier 1` / `≤ $2.50/unit`
- **Column headers:** Sticky when scrolling horizontally. Format name + unit subtitle.
- **Group headers:** "Packaged" | "Draft/Kegs" spanning row above format columns.
- **Zebra striping:** Subtle alternating row backgrounds (already partially there, refine).

### 5. Deposits

Deposits stay in `keg_types` settings — not shown in the pricing matrix. The matrix is purely product pricing. Deposits are an operational/logistics concern applied at order time.

## Files Affected

- **New migration:** `supabase/migrations/00092_pricing_keg_formats.sql`
- **Modified:** `src/app/(app)/settings/pricing/page.tsx` (matrix + new formats tab + visual polish)
- **Modified:** `src/entities/pricing-tier-price.tsx` (rename package_format_id → format_id)
- **Modified:** `src/lib/query-keys.ts` (if new query keys needed for format toggles)

## Out of Scope

- Keg deposit display in matrix
- Per-keg-owner pricing (one price per keg type, regardless of fleet owner)
- Reworking order line item pricing resolution (existing logic stays)
