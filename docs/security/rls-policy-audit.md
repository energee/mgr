# RLS Policy Audit

**Last updated:** 2026-05-20 (post-coverage-gap fixes, migrations 00193–00198)
**Original audit:** 2026-02-26 (migrations 00001–00099)
**Addendum:** 2026-05-19 (migrations 00100–00173)
**Plan:** [`docs/plans/2026-05-19-rls-single-source-of-truth-plan.md`](../plans/2026-05-19-rls-single-source-of-truth-plan.md)
**Companion:** [`docs/security/README.md`](./README.md) — operating rules for new schema and write paths.

> This document is the **post-merge state** of public-schema RLS coverage on
> branch `chore/rls-coverage-gaps`. The original 2026-02-26 audit text and the
> 2026-05-19 addendum have been collapsed into the single dated coverage table
> below; the resolution column records which migration closed each finding.
>
> Going forward, this table is updated **in the same PR** that introduces a
> new table or changes an RLS policy. The integration test
> `src/__tests__/integration/rls-coverage.test.ts` (Task 8) prevents
> undocumented permissive policies from silently regressing the model.

---

## Authorization model (current)

Role-based via `user_has_permission(p_permission TEXT)`, introduced in
`00097_permission_based_roles.sql`. The function checks `user_profiles.roles`
(a `TEXT[]`) against a hardcoded permission map that mirrors `PERMISSION_MAP`
in `src/lib/permissions.ts`.

**Domain pattern** (production, sales, inventory, customers, orders, …):

```sql
CREATE POLICY <table>_select ON <table> FOR SELECT
  USING (user_has_permission('<domain>:read'));

CREATE POLICY <table>_write ON <table> FOR ALL
  USING      (user_has_permission('<domain>:write'))
  WITH CHECK (user_has_permission('<domain>:write'));
```

**Catalog pattern** (shared reference data, e.g. `hops`, `malts`, `brands`):

```sql
-- read: any authenticated user
CREATE POLICY <table>_select ON <table> FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);

-- write: settings:manage required
CREATE POLICY <table>_write ON <table> FOR ALL
  USING      (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));
```

The `(SELECT auth.uid())` wrapper is Supabase's init-plan optimization: it
evaluates the function once per query instead of once per row.

**Documented permissive policies.** Catalog-pattern SELECTs and a handful of
metadata / audit / directory tables are intentionally readable by any
authenticated user. Every such policy carries an inline
`COMMENT ON POLICY ... IS 'RLS-EXCEPTION: <reason>'` marker added in migration
`00198_rls_exception_comments.sql`. The Task 8 integration test fails CI if a
new permissive policy is introduced without one.

---

## Coverage summary

| Status                | Count | Notes |
|-----------------------|------:|-------|
| Domain-pattern tables |  ~60  | Gated by `user_has_permission('<domain>:read/write')`. |
| Catalog-pattern tables|  ~20  | Read = any authenticated; write = `settings:manage`. All carry `RLS-EXCEPTION` comments. |
| Custom-policy tables  |   ~10 | `user_profiles`, `system_settings`, `notifications`, `customer_portal_users`, `entity_revisions`, portal/change-request tables, `allocations_legacy`. |
| Open findings         |     0 | All CRITICAL / HIGH / MEDIUM items from the 2026-02-26 audit and 2026-05-19 addendum are closed (see resolution table below). |

---

## Resolution table — original audit + addendum findings

This collapses the original audit's Critical/High/Medium findings and the
2026-05-19 addendum's regression list. Migrations `00193`–`00197` close the
RLS gaps; `00198` adds inline `RLS-EXCEPTION:` comments for the documented
permissive policies.

| Severity | Table | Original status | Required | Resolved by | Notes |
|----------|-------|-----------------|----------|-------------|-------|
| CRITICAL | `water_addition_profiles` | `USING (true)` / `WITH CHECK (true)` (00096) | Catalog pattern (read: any auth; write: `settings:manage`) | `00197` | Original audit CRITICAL-1. Tightened plus permissive SELECT documented in 00198. Live-DB-only table (no `CREATE TABLE` in any migration), so 00197 guards it with `to_regclass` and migrations-built databases skip it. |
| CRITICAL | `keg_inventory` | `USING (true)` / `WITH CHECK (true)` (00031) | n/a — view, not a table | `00191` | Original audit CRITICAL-2. `keg_inventory` has been a VIEW since 00032 (recreated in 00079); 00191 re-captures it `WITH (security_invoker = true)`, so the underlying `kegs`/`keg_transactions` RLS applies. Views cannot carry policies. |
| CRITICAL | `yeast_pitch_events` | `auth.uid() IS NOT NULL` (00095, regressed by 00158) | `batches:read` / `batches:write` | `00193` | Original audit HIGH-1; reopened by 00158 then closed by 00193. |
| CRITICAL | `selling_format_materials` | `USING (true)` / `WITH CHECK (true)` (00160) | Catalog read; `settings:manage` write | `00194` | 2026-05-19 addendum. SELECT documented in 00198. |
| CRITICAL | `brewery_shipping_defaults` | `USING (true)` / `WITH CHECK (true)` (00162) | Catalog read; `settings:manage` write | `00195` | 2026-05-19 addendum. SELECT documented in 00198. |
| CRITICAL | `customer_shipping_materials` | `USING (true)` / `WITH CHECK (true)` (00162) | `customers:read` / `customers:write` | `00195` | 2026-05-19 addendum. |
| CRITICAL | `customer_pallet_configs` | `USING (true)` / `WITH CHECK (true)` (00162) | `customers:read` / `customers:write` | `00195` | 2026-05-19 addendum. |
| CRITICAL | `order_materials` | `USING (true)` / `WITH CHECK (true)` (00162) | `orders:read` / `orders:write` | `00195` | 2026-05-19 addendum. |
| MEDIUM   | `customer_portal_users` | Staff: profile-exists only | Staff: `customers:read/write` | `00197` | Original audit MEDIUM-1. Staff policies replaced; customer self-read policy retained. |
| MEDIUM   | `order_change_requests` | Staff: profile-exists only | Staff: `orders:read/write` | `00197` | Original audit MEDIUM-2. |
| MEDIUM   | `order_change_request_items` | Staff: profile-exists only | Staff: `orders:read/write` | `00197` | Original audit MEDIUM-2. |
| MEDIUM   | `mongodb_sync_log` | `FOR SELECT USING (true)` (00165) | `settings:manage` | `00196` | 2026-05-19 addendum. |
| MEDIUM   | `mongodb_sync_mappings` | `FOR SELECT USING (true)` (00165) | `settings:manage` | `00196` | 2026-05-19 addendum. |
| INFO     | `00130` / `00137` duplicate keg-owner-deposits | Byte-identical migration | Document the duplicate | `00130`/`00137` | Explanatory header comments added to both files; bodies retained because both are already applied to existing databases (re-application is idempotent via `DROP POLICY IF EXISTS`) (Task 7). |

---

## Permissive policies retained (with `RLS-EXCEPTION` markers in 00198)

Each of the policies below is deliberately permissive at the row-filter level
because the table itself is non-sensitive or because a separate boundary
protects writes. All carry `COMMENT ON POLICY ... IS 'RLS-EXCEPTION: …'`
added in `00198_rls_exception_comments.sql`.

| Table | Policy | Why permissive |
|-------|--------|----------------|
| `_schema_registry` | `schema_registry_read` | Self-documenting metadata for AI agents; seeded only by migrations. |
| `additives`, `adjuncts`, `beer_styles`, `brands`, `enum_values`, `fruits`, `hops`, `malts`, `package_types`, `pricing_history`, `pricing_tier_prices`, `pricing_tiers`, `sales_channels`, `spices`, `sugars`, `water_profiles`, `yeasts` | `<table>_select` | Catalog reference data; companion `_write` policy gates writes by `settings:manage`. |
| `selling_format_materials` | `selling_format_materials_select` | BOM reference data; companion `_write` gates writes by `settings:manage` (00194). |
| `brewery_shipping_defaults` | `brewery_shipping_defaults_select` | Brewery-wide config; companion `_write` gates writes by `settings:manage` (00195). |
| `water_addition_profiles` | `water_addition_profiles_select` | Catalog reference data; companion `_write` gates writes by `settings:manage` (00197, guarded — live-DB-only table). |
| `entity_revisions` | `entity_revisions_select` | Immutable audit log; rows reference RLS-protected domain rows, so the audit row alone does not leak. Inserts constrained by `changed_by = auth.uid()` in 00102. |
| `allocations_legacy` | `allocations_legacy_select` | Frozen legacy table (renamed in 00010); no write policy. |
| `system_settings` | `system_settings_select` | RESTRICTIVE companion `system_settings_hide_sensitive` hides `is_sensitive_setting(key)` rows (API keys, OAuth tokens). |
| `user_profiles` | `user_profiles_select` | Directory rows used for display-name rendering / audit attribution; PII columns are not stored. Writes restricted by `user_profiles_insert_admin`, `user_profiles_update`, `user_profiles_delete_admin`. |
| `containers`, `selling_formats` | `<table>_select` | Catalog reference data (out-of-band tables captured in 00199); companion `_write` gates writes by `settings:manage`. Comments added in 00199. |
| `email_settings` | `email_settings_select` | Singleton app-settings row read by the settings UI; no secrets stored. Companion `_write` gates writes by `settings:manage` (00199). |

### Live gap found and closed during CI-harness work (00199)

`email_settings` — an out-of-band table with no CREATE TABLE migration —
carried two live policies `USING (true)` / `WITH CHECK (true)`, including
**UPDATE**: any authenticated user could rewrite `supabase_project_url` /
`app_url` and redirect notification email delivery. Invisible to earlier
audits because they scanned migration-defined tables. `00199` drops both and
installs the settings pattern (any-auth read, `settings:manage` write); the
notification path is unaffected because its reader is `SECURITY DEFINER`.

---

## What's still out of scope

The plan deliberately deferred three surfaces (each needs its own follow-up
plan):

1. **`createAdminClient` audit across non-chat call sites.** 36 files in `src/`
   call `createAdminClient`. Some are legitimate platform ops; others write
   user-initiated data under service-role and bypass RLS. Until classified,
   the SSoT claim is incomplete.
2. **`SECURITY DEFINER` function audit.** 22 migrations contain
   `SECURITY DEFINER`. Some are intentional bypasses; others may not contain
   internal `user_has_permission(...)` checks.
3. **Supabase Storage RLS** (avatar uploads via
   `src/components/domain/shared/avatar-upload.tsx`) and **Realtime
   authorization** (`src/contexts/notifications.tsx`). Separate access
   models; separate audit.

---

## Methodology (this audit)

1. Traced the final effective policy for every table in `public` by applying
   migrations sequentially and recording each `DROP POLICY … / CREATE POLICY`
   pair to compute the final state.
2. Cross-referenced with `src/lib/permissions.ts` so the SQL permission
   strings match the TypeScript permission map.
3. Verified the catalog/domain assignment for every previously-permissive
   table by inspecting the relevant `src/entities/*.tsx` config (the file
   that drives the UI for that table).
4. Confirmed coverage with two integration test suites:
   - `rls-fail-closed.test.ts` — empty `roles[]` and missing
     `user_profiles` row are denied across a representative sample of
     domain tables.
   - `rls-coverage.test.ts` — every permissive policy in `public` carries
     a `COMMENT ON POLICY ... IS 'RLS-EXCEPTION: <reason>'` marker.

---

## Migration index for RLS-related work

| Migration | What it does |
|-----------|--------------|
| `00097_permission_based_roles.sql` | Introduces `user_has_permission()` and rewrites most policies to the role-based pattern. |
| `00102_audit_fixes.sql` | Tightens `entity_revisions_insert` to `changed_by = auth.uid()`. |
| `00130_tighten_keg_owner_deposits_rls.sql` | Replaces `WITH CHECK (true)` on `keg_owner_deposits` with `inventory:read`/`inventory:write`. |
| `00137_tighten_keg_owner_deposits_rls.sql` | No-op (byte-identical duplicate of 00130; retained to avoid migration-history rewrites). |
| `00193_fix_yeast_pitch_events_rls.sql` | `batches:read` / `batches:write`. |
| `00194_fix_selling_format_materials_rls.sql` | Catalog read; `settings:manage` write. |
| `00195_fix_order_shipping_rls.sql` | Closes the four 00162 regressions. |
| `00196_fix_mongodb_sync_rls.sql` | `settings:manage` for both `mongodb_sync_*` tables. |
| `00197_fix_legacy_audit_findings_rls.sql` | Closes the remaining original-audit findings (`water_addition_profiles` — guarded, live-DB-only — and portal staff tightening; `keg_inventory` needs none, see resolution table). |
| `00198_rls_exception_comments.sql` | Adds `RLS-EXCEPTION:` comments on every documented permissive policy. |
| `00199_capture_selling_formats_containers.sql` | Captures the out-of-band `containers`/`selling_formats`/`email_settings` tables (RLS, policies, triggers), re-states the live qbo policy pairs, and closes the live `email_settings` UPDATE-`(true)` gap. |
