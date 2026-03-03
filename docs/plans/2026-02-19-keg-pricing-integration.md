# Keg-Type Pricing Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable auto-pricing for keg-type order items by recreating the `get_price_for_customer` DB function for the new pricing schema and removing the keg-type guards in the order items editor.

**Architecture:** The pricing matrix already stores prices for keg formats (`pricing_tier_prices.format_id` accepts keg_type IDs, the `packaging_formats` view unifies both sources). The gap is the price *lookup* path: `get_price_for_customer()` was dropped when the old `price_tiers`/`tier_prices` tables were removed (migration 77), and the order items editor explicitly skips auto-pricing for keg-type formats. This plan recreates the function for the new schema and wires it through to the frontend.

**Tech Stack:** PostgreSQL (Supabase migration), React/TypeScript (Next.js), TanStack Query

---

## Current State

| Component | Status |
|-----------|--------|
| `pricing_tiers` table | Working — stores tier definitions |
| `pricing_tier_prices` table | Working — `format_id` accepts both package_type and keg_type UUIDs |
| `packaging_formats` view | Working — union of `package_types` + `keg_types` with `show_in_pricing` |
| Pricing matrix UI | Working — shows keg columns, inline editing works |
| `get_price_for_customer()` RPC | **Broken** — dropped in migration 77, never recreated for new schema |
| Order items editor auto-pricing | **Disabled for kegs** — hard-coded `format_source === "package_type"` guard |
| "Apply tier price" button | **Hidden for kegs** — checks `item.package_type_id` only |

## Price Resolution Logic (New)

```
Customer → price_tier_id (direct FK to pricing_tiers)
         → sales_channel_id (FK to sales_channels)

Lookup: pricing_tier_prices
  WHERE pricing_tier_id = customer.price_tier_id
    AND format_id = <selected format>  (package_type or keg_type UUID)
    AND sales_channel_id = customer.sales_channel_id
  → price
```

No brand/style specificity in the new model — pricing is purely tier × format × channel.

---

### Task 1: Migration — Recreate `get_price_for_customer` Function

**Files:**
- Create: `supabase/migrations/00097_recreate_price_lookup.sql`

**Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration: Recreate get_price_for_customer for new pricing schema
-- =============================================================================
-- The old function (migrations 25/28) referenced price_tiers/tier_prices which
-- were replaced by pricing_tiers/pricing_tier_prices in migration 77.
-- This version uses the new schema and works for both package_type and keg_type
-- format IDs.

-- Drop any remaining old versions
DROP FUNCTION IF EXISTS get_price_for_customer(UUID, UUID, UUID, UUID);
DROP FUNCTION IF EXISTS get_price_for_customer(UUID, UUID, UUID, UUID, DATE);

CREATE FUNCTION get_price_for_customer(
  p_customer_id UUID,
  p_format_id UUID,
  p_brand_id UUID DEFAULT NULL,
  p_style_id UUID DEFAULT NULL,
  p_effective_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  price NUMERIC(10,2),
  tier_name TEXT,
  is_brand_specific BOOLEAN,
  is_style_specific BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_pricing_tier_id UUID;
  v_sales_channel_id UUID;
BEGIN
  -- Get customer's pricing tier and sales channel
  SELECT c.price_tier_id, c.sales_channel_id
  INTO v_pricing_tier_id, v_sales_channel_id
  FROM customers c
  WHERE c.id = p_customer_id;

  IF v_pricing_tier_id IS NULL OR v_sales_channel_id IS NULL THEN
    RETURN;  -- No pricing available without both tier and channel
  END IF;

  -- Look up price from pricing_tier_prices matrix
  -- In the new schema, pricing is tier × format × channel (no brand/style dimension)
  RETURN QUERY
  SELECT
    ptp.price,
    pt.name AS tier_name,
    false AS is_brand_specific,
    false AS is_style_specific
  FROM pricing_tier_prices ptp
  JOIN pricing_tiers pt ON pt.id = ptp.pricing_tier_id
  WHERE ptp.pricing_tier_id = v_pricing_tier_id
    AND ptp.format_id = p_format_id
    AND ptp.sales_channel_id = v_sales_channel_id
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION get_price_for_customer IS
  'Resolves the tier price for a customer/format combination using the new pricing_tiers/pricing_tier_prices schema. '
  'Works for both package_type and keg_type format IDs. '
  'p_brand_id, p_style_id, and p_effective_date are retained for API compatibility but unused in the new model.';
```

**Step 2: Run the migration**

Run: `supabase migration up` or apply via Supabase MCP

**Step 3: Regenerate Supabase types**

Run: `pnpm supabase gen types typescript --local > src/types/supabase.ts`

**Step 4: Commit**

```bash
git add supabase/migrations/00097_recreate_price_lookup.sql src/types/supabase.ts
git commit -m "feat: recreate get_price_for_customer for new pricing schema"
```

---

### Task 2: Enable Auto-Pricing for Keg Types in Order Items Editor

**Files:**
- Modify: `src/components/domain/order-items-editor.tsx`

**Step 1: Remove keg-type guard from auto-pricing effect**

In the `useEffect` at line ~262, the current code skips keg types:

```typescript
// CURRENT (line 264):
if (newItem.brand_id && newItem.format_id && newItem.format_source === "package_type") {
```

Change to include keg types:

```typescript
// NEW:
if (newItem.brand_id && newItem.format_id) {
```

And remove the `else if (newItem.format_source === "keg_type")` block (lines 280-286) that explicitly sets `suggestedPrice: null`.

**Step 2: Update the lookupTierPrice call for new item**

The `lookupTierPrice` function at line 232 already accepts any `formatId`. The format_id in `pricing_tier_prices` can be a keg_type UUID, so the RPC call works identically. No changes needed to the function itself.

However, the `useEffect` dependency at line 290 includes `newItem.format_source` — remove it since we no longer branch on it:

```typescript
// CURRENT (line 290):
}, [newItem.brand_id, newItem.format_id, newItem.format_source, lookupTierPrice]);

// NEW:
}, [newItem.brand_id, newItem.format_id, lookupTierPrice]);
```

**Step 3: Enable "Apply tier price" button for keg items**

At line ~622, the refresh button only shows for package_type items:

```typescript
// CURRENT (line 622):
{effectiveCustomerId && item.brand_id && item.package_type_id && (
```

Change to support both format types:

```typescript
// NEW:
{effectiveCustomerId && item.brand_id && (item.package_type_id || item.keg_type_id) && (
```

And update the `onClick` handler (line 630) to pass the correct format ID:

```typescript
// CURRENT (line 630):
onClick={() => applyTierPrice(item.id, item.brand_id, item.package_type_id)}

// NEW:
onClick={() => applyTierPrice(item.id, item.brand_id, item.keg_type_id ?? item.package_type_id)}
```

**Step 4: Commit**

```bash
git add src/components/domain/order-items-editor.tsx
git commit -m "feat: enable auto-pricing for keg-type order items"
```

---

### Task 3: Lint and Type-Check

**Step 1: Run type check**

Run: `pnpm typecheck`

Expected: 0 errors. The function signature is unchanged (same params, same return type), so TypeScript types are compatible.

**Step 2: Run lint**

Run: `pnpm lint`

Fix any errors introduced by the changes.

**Step 3: Commit fixes if needed**

```bash
git add -A
git commit -m "chore: lint and type-check fixes for keg pricing integration"
```

---

### Task 4: Update Documentation

**Files:**
- Modify: `docs/data-model/pricing.md` (if it exists) or relevant docs
- Modify: `CLAUDE.md` migration numbering if needed

**Step 1: Update inline comments**

The order-items-editor.tsx header comment (line 11) says:
```
* - Auto-pricing from customer's price tier when brand/format selected
```

This is still accurate. Update the comment at line 4 to remove the exclusion language:

```typescript
// CURRENT (line 11):
// * - Auto-pricing from customer's price tier when brand/format selected

// Already accurate — just remove the old "package_type only" references if any remain
```

**Step 2: Update CLAUDE.md migration numbering**

In `/Users/tedslesinski/Repos/mgr/.worktrees/keg-pricing/CLAUDE.md`, update:
```
Current highest: 00097
Next available: 00098
```

**Step 3: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs: update migration numbering and pricing docs"
```
