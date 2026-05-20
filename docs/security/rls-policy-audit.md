# RLS Policy Audit

**Date:** 2026-02-26
**Auditor:** Automated migration analysis
**Scope:** All tables in `supabase/migrations/00001` through `00099`

---

## Executive Summary

MGR has **93 active tables** (excluding 3 dropped tables: `breweries`, `user_breweries`, `settings`). All 93 tables have RLS enabled.

The system underwent a major RLS overhaul in migration `00097_permission_based_roles.sql`, which replaced simple `auth.uid() IS NOT NULL` policies with permission-based policies using `user_has_permission()`. This migration covers the vast majority of tables.

However, **5 tables created before or concurrently with migration 00097 were excluded** from the permission-based system, and **2 tables created after 00097** have regressed to weaker policies.

### Severity Breakdown

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 2 | Tables with `USING (true)` / `WITH CHECK (true)` on write operations |
| HIGH | 1 | Table with `auth.uid() IS NOT NULL` instead of permission-based policies |
| MEDIUM | 2 | Tables excluded from permission migration but with reasonable custom policies |
| LOW | 2 | Audit log tables with intentional `WITH CHECK` for system inserts |
| INFO | 1 | Stale `role IN ('admin', 'owner')` references in migration 00094 |

---

## Policy Model Overview

### Permission-Based Policies (post-00097)

The current policy model uses a `user_has_permission(p_permission)` SQL function that checks `user_profiles.roles` against a hardcoded permission map. This mirrors the TypeScript `PERMISSION_MAP` in `src/lib/permissions.ts`.

**Pattern for domain tables:**
```sql
-- SELECT: read permission required
CREATE POLICY <table>_select ON <table> FOR SELECT
  USING (user_has_permission('<domain>:read'));

-- ALL (INSERT/UPDATE/DELETE): write permission required
CREATE POLICY <table>_write ON <table> FOR ALL
  USING (user_has_permission('<domain>:write'))
  WITH CHECK (user_has_permission('<domain>:write'));
```

**Pattern for catalog/shared tables:**
```sql
-- SELECT: any authenticated user
CREATE POLICY <table>_select ON <table> FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);

-- ALL: settings:manage permission required
CREATE POLICY <table>_write ON <table> FOR ALL
  USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));
```

### Initplan Optimization

Most post-00013 policies use `(SELECT auth.uid())` instead of `auth.uid()` directly. This is the "initplan" pattern that ensures `auth.uid()` is evaluated once per query rather than once per row, improving performance significantly.

---

## Table-by-Table Coverage

### A. Production Domain — Recipes

| Table | RLS Enabled | Policy Type | Read Policy | Write Policy | Notes |
|-------|:-----------:|-------------|-------------|--------------|-------|
| recipes | Yes | Permission | `recipes:read` | `recipes:write` | |
| recipe_yeasts | Yes | Permission | `recipes:read` | `recipes:write` | |
| recipe_malts | Yes | Permission | `recipes:read` | `recipes:write` | |
| recipe_hops | Yes | Permission | `recipes:read` | `recipes:write` | |
| recipe_adjuncts | Yes | Permission | `recipes:read` | `recipes:write` | |
| recipe_sugars | Yes | Permission | `recipes:read` | `recipes:write` | |
| recipe_spices | Yes | Permission | `recipes:read` | `recipes:write` | |
| recipe_fruits | Yes | Permission | `recipes:read` | `recipes:write` | |
| recipe_additions | Yes | Permission | `recipes:read` | `recipes:write` | |
| recipe_collaborators | Yes | Permission | `recipes:read` | `recipes:write` | |
| recipe_variants | Yes | Permission | `recipes:read` | `recipes:write` | |
| recipe_variant_hops | Yes | Permission | `recipes:read` | `recipes:write` | |
| recipe_variant_adjuncts | Yes | Permission | `recipes:read` | `recipes:write` | |
| recipe_variant_fruits | Yes | Permission | `recipes:read` | `recipes:write` | |
| recipe_variant_spices | Yes | Permission | `recipes:read` | `recipes:write` | |

### B. Production Domain — Batches

| Table | RLS Enabled | Policy Type | Read Policy | Write Policy | Notes |
|-------|:-----------:|-------------|-------------|--------------|-------|
| batches | Yes | Permission | `batches:read` | `batches:write` | |
| batch_logs | Yes | Permission | `batches:read` | `batches:write` | |
| brew_logs | Yes | Permission | `batches:read` | `batches:write` | |
| brew_log_batches | Yes | Permission | `batches:read` | `batches:write` | |
| batch_additions | Yes | Permission | `batches:read` | `batches:write` | |
| batch_blends | Yes | Permission | `batches:read` | `batches:write` | |
| yeast_pitches | Yes | Permission | `batches:read` | `batches:write` | |
| packaging_sessions | Yes | Permission | `batches:read` | `batches:write` | |
| session_line_items | Yes | Permission | `batches:read` | `batches:write` | |
| packages | Yes | Permission | `batches:read` | `batches:write` | |

### C. Production Domain — Vessels

| Table | RLS Enabled | Policy Type | Read Policy | Write Policy | Notes |
|-------|:-----------:|-------------|-------------|--------------|-------|
| locations | Yes | Permission | `vessels:read` | `vessels:write` | |
| vessels | Yes | Permission | `vessels:read` | `vessels:write` | |
| vessel_transfers | Yes | Permission | `vessels:read` | `vessels:write` | |
| vessel_cleanings | Yes | Permission | `vessels:read` | `vessels:write` | |
| location_transfers | Yes | Permission | `vessels:read` | `vessels:write` | |
| transfer_lines | Yes | Permission | `vessels:read` | `vessels:write` | |

### D. Sales Domain

| Table | RLS Enabled | Policy Type | Read Policy | Write Policy | Notes |
|-------|:-----------:|-------------|-------------|--------------|-------|
| orders | Yes | Permission + Customer | `orders:read` | `orders:write` | Also has `customer_orders_select` for portal |
| order_items | Yes | Permission + Customer | `orders:read` | `orders:write` | Also has `customer_order_items_select` for portal |
| customers | Yes | Permission | `customers:read` | `customers:write` | |
| pick_lists | Yes | Permission | `orders:read` | `orders:write` | |
| pick_list_items | Yes | Permission | `orders:read` | `orders:write` | |
| deliveries | Yes | Permission | `orders:read` | `orders:write` | |

### E. Inventory Domain

| Table | RLS Enabled | Policy Type | Read Policy | Write Policy | Notes |
|-------|:-----------:|-------------|-------------|--------------|-------|
| inventory_items | Yes | Permission | `inventory:read` | `inventory:write` | |
| inventory_lots | Yes | Permission | `inventory:read` | `inventory:write` | |
| finished_goods | Yes | Permission | `inventory:read` | `inventory:write` | |
| allocations | Yes | Permission | `inventory:read` | `inventory:write` | |
| bins | Yes | Permission | `inventory:read` | `inventory:write` | |
| bin_inventory | Yes | Permission | `inventory:read` | `inventory:write` | |
| bin_inventory_items | Yes | Permission | `inventory:read` | `inventory:write` | |
| keg_types | Yes | Permission | `inventory:read` | `inventory:write` | |
| keg_owners | Yes | Permission | `inventory:read` | `inventory:write` | |
| keg_owner_deposits | Yes | Permission | `inventory:read` | `inventory:write` | |
| keg_inventory | Yes | Catalog (pre-097) | `USING (true)` | `WITH CHECK (true)` | **CRITICAL: Not in 00097** |
| keg_transactions | Yes | Catalog (pre-097) | `USING (true)` | `WITH CHECK (true)` (insert only) | **See note below** |

### F. Purchasing Domain

| Table | RLS Enabled | Policy Type | Read Policy | Write Policy | Notes |
|-------|:-----------:|-------------|-------------|--------------|-------|
| suppliers | Yes | Permission | `purchasing:read` | `purchasing:write` | |
| supplier_catalog | Yes | Permission | `purchasing:read` | `purchasing:write` | |
| purchase_orders | Yes | Permission | `purchasing:read` | `purchasing:write` | |
| po_line_items | Yes | Permission | `purchasing:read` | `purchasing:write` | |
| po_receives | Yes | Permission | `purchasing:read` | `purchasing:write` | |

### G. Integration Tables

| Table | RLS Enabled | Policy Type | Read Policy | Write Policy | Notes |
|-------|:-----------:|-------------|-------------|--------------|-------|
| square_settings | Yes | Permission | `integrations:manage` | `integrations:manage` | |
| square_catalog_map | Yes | Permission | `integrations:manage` | `integrations:manage` | |
| square_sync_log | Yes | Permission | `integrations:manage` | `integrations:manage` | |
| square_draft_sales | Yes | Permission | `integrations:manage` | `integrations:manage` | |
| slack_settings | Yes | Permission | `integrations:manage` | `integrations:manage` | |
| slack_notification_log | Yes | Permission | `integrations:manage` | `integrations:manage` | |
| qbo_sync_mappings | Yes | Permission | `integrations:manage` | `integrations:manage` | |
| qbo_sync_log | Yes | Permission | `integrations:manage` | `integrations:manage` | |
| qbo_account_mappings | Yes | Permission | `integrations:manage` | `integrations:manage` | |

### H. Catalog / Shared Reference Tables

| Table | RLS Enabled | Policy Type | Read Policy | Write Policy | Notes |
|-------|:-----------:|-------------|-------------|--------------|-------|
| brands | Yes | Catalog | Any authenticated | `settings:manage` | |
| enum_values | Yes | Catalog | Any authenticated | `settings:manage` | |
| package_types | Yes | Catalog | Any authenticated | `settings:manage` | |
| sales_channels | Yes | Catalog | Any authenticated | `settings:manage` | |
| pricing_tiers | Yes | Catalog | Any authenticated | `settings:manage` | |
| pricing_tier_prices | Yes | Catalog | Any authenticated | `settings:manage` | |
| pricing_history | Yes | Catalog | Any authenticated | `settings:manage` | |
| hops | Yes | Catalog | Any authenticated | `settings:manage` | |
| malts | Yes | Catalog | Any authenticated | `settings:manage` | |
| adjuncts | Yes | Catalog | Any authenticated | `settings:manage` | |
| fruits | Yes | Catalog | Any authenticated | `settings:manage` | |
| spices | Yes | Catalog | Any authenticated | `settings:manage` | |
| sugars | Yes | Catalog | Any authenticated | `settings:manage` | |
| yeasts | Yes | Catalog | Any authenticated | `settings:manage` | |
| additives | Yes | Catalog | Any authenticated | `settings:manage` | |
| water_profiles | Yes | Catalog | Any authenticated | `settings:manage` | |
| beer_styles | Yes | Catalog | Any authenticated | `settings:manage` | |
| price_tiers | Yes | Catalog | Any authenticated | `settings:manage` | (legacy, from 00025) |
| tier_prices | Yes | Catalog | Any authenticated | `settings:manage` | (legacy, from 00025) |

### I. System / Settings Tables

| Table | RLS Enabled | Policy Type | Read Policy | Write Policy | Notes |
|-------|:-----------:|-------------|-------------|--------------|-------|
| system_settings | Yes | Custom | Any authenticated (excludes `%api_key%`) | `settings:manage` | Has RESTRICTIVE `system_settings_hide_sensitive` policy for QBO tokens |

### J. User Management Tables

| Table | RLS Enabled | Policy Type | Read Policy | Write Policy | Notes |
|-------|:-----------:|-------------|-------------|--------------|-------|
| user_profiles | Yes | Custom | Any authenticated | Own profile OR admin | Proper `is_admin_rls()` check; admin can insert/delete |
| user_preferences | Yes | Custom | Own only (`auth.uid() = user_id`) | Own only | Correct per-user scoping |
| notification_preferences | Yes | Custom | Own only (`user_id = auth.uid()`) | Own only | `FOR ALL USING` scoped to user |

### K. Notification / Audit Tables

| Table | RLS Enabled | Policy Type | Read Policy | Write Policy | Notes |
|-------|:-----------:|-------------|-------------|--------------|-------|
| notifications | Yes | Custom | Own only (`user_id = auth.uid()`) | Insert: own only; Update/Delete: own only | Tightened in 00094 |
| entity_revisions | Yes | Custom | Any authenticated | Insert: `changed_by = auth.uid()` | Immutable audit log, no UPDATE/DELETE |

### L. Customer Portal Tables

| Table | RLS Enabled | Policy Type | Read Policy | Write Policy | Notes |
|-------|:-----------:|-------------|-------------|--------------|-------|
| customer_portal_users | Yes | Custom | Staff: has user_profile; Customer: own links | Staff: full; Customer: read only | **MEDIUM: Not in 00097** |
| order_change_requests | Yes | Custom | Staff: has user_profile; Customer: own requests | Staff: insert/update; Customer: insert own | **MEDIUM: Not in 00097** |
| order_change_request_items | Yes | Custom | Staff/Customer: scoped to parent CR | Staff/Customer: scoped to parent CR | **MEDIUM: Not in 00097** |

### M. Tables NOT in 00097 Permission Migration (Post-00097 Creation)

| Table | RLS Enabled | Policy Type | Read Policy | Write Policy | Notes |
|-------|:-----------:|-------------|-------------|--------------|-------|
| yeast_pitch_events | Yes | Simple auth | `auth.uid() IS NOT NULL` | `auth.uid() IS NOT NULL` | **HIGH: Should use `batches:read/write`** |
| water_addition_profiles | Yes | Simple auth | `USING (true)` TO authenticated | `WITH CHECK (true)` TO authenticated | **CRITICAL: Should use catalog pattern** |

### N. Legacy / Dropped Tables

| Table | Status | Notes |
|-------|--------|-------|
| breweries | DROPPED (00002) | N/A |
| user_breweries | DROPPED (00002) | N/A |
| settings | DROPPED (00044) | N/A |
| allocations_legacy | RENAMED (00010) | Read-only policy, no write |

### O. Meta Tables

| Table | RLS Enabled | Policy Type | Notes |
|-------|:-----------:|-------------|-------|
| _schema_registry | Yes | Read-only | `FOR SELECT USING (auth.uid() IS NOT NULL)` -- correct for metadata |

---

## Critical Findings

### CRITICAL-1: `water_addition_profiles` has `WITH CHECK (true)` on all write operations

**Migration:** `00096_water_addition_profiles.sql`
**Current Policies:**
```sql
CREATE POLICY "Authenticated users can read water addition profiles"
  ON water_addition_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert water addition profiles"
  ON water_addition_profiles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update water addition profiles"
  ON water_addition_profiles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete water addition profiles"
  ON water_addition_profiles FOR DELETE TO authenticated USING (true);
```

**Issue:** This table was created after the 00097 permission migration and uses the old `USING (true)` / `WITH CHECK (true)` pattern restricted only to the `authenticated` role. Any authenticated user can read, insert, update, and delete water addition profiles regardless of their roles.

**Recommendation:** Replace with catalog-pattern policies:
- SELECT: `(SELECT auth.uid()) IS NOT NULL`
- ALL (write): `user_has_permission('settings:manage')`

### CRITICAL-2: `keg_inventory` still has old-style permissive policies

**Context:** `keg_inventory` was created in `00031_keg_inventory.sql` and was included in the 00097 migration's DROP/CREATE cycle as part of the INVENTORY domain. However, reviewing the 00097 migration more carefully, `keg_inventory` is **listed in the inventory domain array** in Section 5f.

**Wait -- let me re-examine.** The 00097 migration lists:
```sql
'inventory_items','inventory_lots','finished_goods','allocations',
'bins','bin_inventory','bin_inventory_items',
'keg_types','keg_owners','keg_owner_deposits','keg_transactions'
```

`keg_inventory` is **NOT in this list**. It was missed from the permission migration.

**Current effective policies (from 00060 fix or 00031 original):**
```sql
CREATE POLICY "keg_inventory_select" ON keg_inventory
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "keg_inventory_insert" ON keg_inventory
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "keg_inventory_update" ON keg_inventory
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "keg_inventory_delete" ON keg_inventory
  FOR DELETE TO authenticated USING (true);
```

**Recommendation:** Add to inventory domain with `inventory:read` / `inventory:write` policies.

### HIGH-1: `yeast_pitch_events` uses `auth.uid() IS NOT NULL` instead of permission-based

**Migration:** `00095_yeast_workflow_unification.sql`
**Current Policy:**
```sql
CREATE POLICY yeast_pitch_events_access ON yeast_pitch_events
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
```

**Issue:** Any authenticated user can perform any operation. This should be scoped to the batches domain since yeast_pitch_events relates to batch operations via yeast_pitches.

**Recommendation:** Replace with:
- SELECT: `user_has_permission('batches:read')`
- ALL (write): `user_has_permission('batches:write')`

---

## Medium Findings

### MEDIUM-1: `customer_portal_users` not in 00097 migration

This table was created in `00091_customer_portal_many_to_many.sql` and has custom policies that differentiate staff vs. customer access. These policies are reasonable for the portal use case but use the pattern `EXISTS (SELECT 1 FROM user_profiles WHERE id = (SELECT auth.uid()))` for staff checks, which only verifies the user has a profile (any role), not a specific permission.

**Current policies are functionally acceptable** since portal user management is a staff operation, but ideally the write policies should check `user_has_permission('customers:write')`.

### MEDIUM-2: `order_change_requests` and `order_change_request_items` not in 00097 migration

These tables from `00089_change_request_tables.sql` (updated in 00091) have custom policies for both staff and customer access. Staff policies check `EXISTS (SELECT 1 FROM user_profiles ...)` which permits any staff user regardless of role. Customer policies are properly scoped to own requests.

**Recommendation:** Staff policies should check `user_has_permission('orders:read')` / `user_has_permission('orders:write')` instead of just checking profile existence.

---

## Low Findings

### LOW-1: `notifications` INSERT was tightened but uses different pattern

Migration 00094 changed notifications INSERT to `WITH CHECK (user_id = (SELECT auth.uid()))`. This is correct and more restrictive than the previous `WITH CHECK (true)`.

### LOW-2: `entity_revisions` INSERT uses `changed_by = (SELECT auth.uid())`

Migration 00094 tightened this. Correct behavior for an audit log.

---

## Informational Findings

### INFO-1: Migration 00094 references `role IN ('admin', 'owner')` which is stale

Migration `00094_audit_fixes.sql` was written before the 00097 multi-role migration and references `user_profiles.role IN ('admin', 'owner')`. After 00097, the `role` column was replaced by `roles TEXT[]`. However, since 00097 completely replaces these QBO policies with `user_has_permission('integrations:manage')`, the 00094 policies are effectively overwritten and this is not a runtime issue -- it only matters if migrations are replayed from scratch, where 00094 runs before 00097.

**Note:** If migrations are replayed sequentially, 00094's reference to `role` would fail since 00097 drops the `role` column. This would only be an issue in a fresh database setup.

### INFO-2: `keg_transactions` is an immutable audit log

`keg_transactions` was included in the 00097 inventory domain, so it has `inventory:read` SELECT and `inventory:write` ALL policies. The original migration (00032) intentionally had no UPDATE/DELETE policies. The 00097 migration added a `_write` ALL policy which technically allows updates/deletes for users with `inventory:write`. If immutability is important, consider adding a trigger or removing the write policy for UPDATE/DELETE.

### INFO-3: `allocations_legacy` is read-only

The legacy allocations table only has a SELECT policy (`(SELECT auth.uid()) IS NOT NULL`). This is correct since it should only be used for historical reference.

---

## Summary of Required Fixes

### Priority 1 (Critical) -- Tables missing permission-based policies

| Table | Current | Required | Domain |
|-------|---------|----------|--------|
| `water_addition_profiles` | `USING (true)` / `WITH CHECK (true)` | Catalog pattern (read: any auth, write: `settings:manage`) | catalog |
| `keg_inventory` | `USING (true)` / `WITH CHECK (true)` | `inventory:read` / `inventory:write` | inventory |

### Priority 2 (High) -- Tables with auth-only instead of permission-based

| Table | Current | Required | Domain |
|-------|---------|----------|--------|
| `yeast_pitch_events` | `auth.uid() IS NOT NULL` (FOR ALL) | `batches:read` / `batches:write` | production |

### Priority 3 (Medium) -- Custom policies that could be tighter

| Table | Current | Suggested |
|-------|---------|-----------|
| `customer_portal_users` | Staff: profile exists | Staff write: `user_has_permission('customers:write')` |
| `order_change_requests` | Staff: profile exists | Staff: `user_has_permission('orders:read/write')` |
| `order_change_request_items` | Staff: profile exists | Staff: `user_has_permission('orders:read/write')` |

---

## Methodology

This audit was performed by:
1. Extracting all `CREATE TABLE`, `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`, and `DROP POLICY` statements from all migration files (00001-00099).
2. Tracing the final effective policy for each table by applying migrations in order, accounting for `DROP POLICY IF EXISTS` followed by `CREATE POLICY`.
3. Cross-referencing with the permission model in `src/lib/permissions.ts`.
4. Identifying tables created after the comprehensive 00097 permission migration that were not included in its scope.
5. Checking for `WITH CHECK (true)`, `USING (true)`, and missing `(SELECT auth.uid())` initplan patterns.

---

## Addendum — 2026-05-19 (Migrations 00100–00173)

The original audit (2026-02-26) covered migrations `00001–00099`. This addendum extends coverage through `00173` (latest applied migration on the `refactor/phase-3-tail` branch). It does **not** re-verify any of the original audit findings except where a later migration touched the same table.

### Regressions and new gaps introduced after 00094

| Severity | Migration | Table | Current policy | Required |
|----------|-----------|-------|----------------|----------|
| CRITICAL | `00158_yeast_pitch_events_and_remaining_view.sql` | `yeast_pitch_events` | `FOR ALL USING (auth.uid() IS NOT NULL)` | `batches:read` / `batches:write` |
| CRITICAL | `00160_selling_format_materials.sql` | `selling_format_materials` | `FOR ALL USING (true) WITH CHECK (true)` | `inventory:read` / `inventory:write` (or `settings:manage` if catalog-shaped) |
| CRITICAL | `00162_order_shipping_materials.sql` | `brewery_shipping_defaults` | `FOR ALL USING (true) WITH CHECK (true)` | `settings:manage` (brewery-wide config) |
| CRITICAL | `00162_order_shipping_materials.sql` | `customer_shipping_materials` | `FOR ALL USING (true) WITH CHECK (true)` | `customers:read` / `customers:write` |
| CRITICAL | `00162_order_shipping_materials.sql` | `customer_pallet_configs` | `FOR ALL USING (true) WITH CHECK (true)` | `customers:read` / `customers:write` |
| CRITICAL | `00162_order_shipping_materials.sql` | `order_materials` | `FOR ALL USING (true) WITH CHECK (true)` | `orders:read` / `orders:write` |
| MEDIUM   | `00165_mongodb_sync_tables.sql` | `mongodb_sync_log` | `FOR SELECT USING (true)` | `(SELECT auth.uid()) IS NOT NULL` minimum; ideally `settings:manage` |
| MEDIUM   | `00165_mongodb_sync_tables.sql` | `mongodb_sync_mappings` | `FOR SELECT USING (true)` | Same as above |

Note: `00158` regressed `yeast_pitch_events` *after* the original audit had already flagged it as HIGH-1. The fix did not land between February and May.

### Migrations that *tightened* policies in this window (informational)

- `00102_audit_fixes.sql` — addressed several integration tables (`qbo_sync_mappings`, `qbo_sync_log`, `qbo_account_mappings`) with permission-based policies.
- `00130_tighten_keg_owner_deposits_rls.sql` / `00137_tighten_keg_owner_deposits_rls.sql` — replaced `WITH CHECK (true)` with `inventory:read` / `inventory:write` (the `00137` duplicate looks like a rebase artifact; review whether it should be removed).

### Single-source-of-truth verification

- `src/app/api/chat/route.ts` runs under `withAuth` and passes the user-session Supabase client to all tools (`createChatTools(supabase)`). This means RLS enforces every chat write today.
- The only `createAdminClient` usage in the chat path is the global API-key fallback in `resolveApiKey` (`src/app/api/chat/route.ts:170`), which reads `system_settings.value` for `anthropic_api_key`. This is documented inline and is the correct narrow exception.
- **Going forward (Phase 4-B/C):** new tool writes MUST keep using the user-session client. Any service-role write from a tool would silently bypass RLS and break the single-source-of-truth property the team is trying to preserve.

### Plan reference

Outstanding fixes are tracked in [`docs/plans/2026-05-19-rls-single-source-of-truth-plan.md`](../plans/2026-05-19-rls-single-source-of-truth-plan.md).
