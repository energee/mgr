# Batch, Vessel & Transfer Fixes

## Problem

Six issues were identified during UI exploration of batches, vessels, and vessel transfers. After investigation, four are real bugs (two high severity, two low), plus one pre-existing bug discovered during spec review:

### High Severity

1. **Batches show no vessel** — The `batches_with_brew_info` view uses `DISTINCT ON (v.current_batch_id)` without an `ORDER BY` clause in the `current_vessels` CTE. PostgreSQL's behavior is non-deterministic without `ORDER BY`, causing the LEFT JOIN to fail silently. Every batch shows Vessel = "—" despite vessels correctly tracking `current_batch_id`.

2. **Duplicate vessel transfers** — The `vessel_transfers` table has no unique constraint. Combined with no idempotency in the `start_batch_fermentation` RPC or the `VesselTransferDialog` insert, double-submits create duplicate records. Example: batch `2025-10-07-068` has 3 identical FV6→BT6 transfers within 2 minutes. This same class of bug was previously fixed for `allocations` in migration `00147`.

3. **`batches_with_blend_info` view is missing** — Migration `00101` used `DROP VIEW IF EXISTS batches_with_brew_info CASCADE`, which silently dropped the dependent `batches_with_blend_info` view. It was never recreated. Two components (`batch-blend-history.tsx`, `batch-blend-dialog.tsx`) still reference it, meaning blend features are broken.

### Low Severity

4. **Batch create shows irrelevant sections** — The `cancellation` and `revision-history` sections in the batch entity config lack `hideOnCreate: true`, so they render on the create form where they serve no purpose.

5. **Kettle vessel typed as Fermenter** — The vessel named "Kettle" was created with `vessel_type = 'fermenter'` instead of `'kettle'`. This is a data issue, not a code bug; the enum and display map already support `kettle`.

### Not Bugs (dismissed)

6. **Vessel-batch year mismatch** — Test data from different time periods; not a code issue.
7. **Transfers tab didn't switch** — Works correctly; the tested batch simply had no transfers.

## Approach

Follow the proven pattern from migration `00147_allocation_unique_constraint.sql`: fix the views, clean up duplicates, add a unique index, and fix the data issue — all in one migration. Entity config changes go in a separate TypeScript edit.

## Changes

### Migration: `00153_vessel_transfer_fixes.sql`

#### Part 1: Fix `batches_with_brew_info` view and recreate `batches_with_blend_info`

Drop (with CASCADE) and recreate `batches_with_brew_info` with the `ORDER BY` fix in the `current_vessels` CTE. Then recreate the dependent `batches_with_blend_info` view (which was silently dropped by migration `00101` and never restored).

**File**: `supabase/migrations/00153_vessel_transfer_fixes.sql`
**Depends on**: Current view definition in `00101_view_correlated_subquery_fixes.sql`, blend view definition from `00086_refresh_views_for_variants.sql`

**View cascade order**:
1. `DROP VIEW IF EXISTS batches_with_blend_info` (may already be gone, but safe)
2. `DROP VIEW IF EXISTS batches_with_brew_info`
3. Recreate `batches_with_brew_info` with fixed CTE:
   ```sql
   current_vessels AS (
     SELECT DISTINCT ON (v.current_batch_id)
       v.current_batch_id AS batch_id,
       v.id AS current_vessel_id,
       v.name AS current_vessel_name
     FROM vessels v
     WHERE v.current_batch_id IS NOT NULL
     ORDER BY v.current_batch_id, v.name
   )
   ```
   Note: `ORDER BY` must begin with the `DISTINCT ON` expression (`v.current_batch_id`), then the tiebreaker (`v.name`).
4. Recreate `batches_with_blend_info` (identical to definition in `00086`, both with `security_invoker = true`)

#### Part 2: Clean up duplicate transfers + add unique index

1. **Audit**: Count duplicate groups and RAISE WARNING if any exist (same pattern as 00147).
2. **Delete duplicates**: Keep the row with the earliest `created_at` per group. The delete query must use `IS NOT DISTINCT FROM` for the nullable `from_vessel_id` comparison (not `=`, since `NULL = NULL` is false in SQL).
   ```sql
   DELETE FROM vessel_transfers vt
   WHERE vt.id NOT IN (
     SELECT DISTINCT ON (batch_id, from_vessel_id, to_vessel_id, transferred_at) id
     FROM vessel_transfers
     ORDER BY batch_id, from_vessel_id, to_vessel_id, transferred_at, created_at ASC
   );
   ```
   Note: `DISTINCT ON` groups NULLs together, so this correctly handles nullable `from_vessel_id`.
3. **Create unique index**: Use `COALESCE` to handle nullable `from_vessel_id`:
   ```sql
   CREATE UNIQUE INDEX idx_vessel_transfers_unique_per_batch
     ON vessel_transfers (
       batch_id,
       COALESCE(from_vessel_id, '00000000-0000-0000-0000-000000000000'),
       to_vessel_id,
       transferred_at
     );
   ```
   The nil UUID sentinel is safe because vessel IDs are generated via `gen_random_uuid()` and the probability of collision is negligible.
4. **Schema registry entry** for the new index.

**Note on constraint violations**: After this change, a duplicate insert will fail with a unique constraint violation at the database level. The frontend mutation's `isPending` check already disables submit buttons during requests, so double-submits from normal UI usage are already prevented. The database constraint serves as defense-in-depth. Unhandled constraint errors will surface as generic Supabase errors — acceptable for now since the UI already prevents the scenario.

#### Part 3: Fix Kettle vessel type

```sql
UPDATE vessels SET vessel_type = 'kettle' WHERE name = 'Kettle' AND vessel_type != 'kettle';
```

### Entity config: `src/entities/batch.tsx`

Add `hideOnCreate: true` to:
- `cancellation` section (line 282)
- `revision-history` section (line 287)

## Files Modified

| File | Change |
|------|--------|
| `supabase/migrations/00153_vessel_transfer_fixes.sql` | New migration (view fix + blend view restore, duplicate cleanup, unique index, data fix) |
| `src/entities/batch.tsx` | Add `hideOnCreate: true` to 2 sections |

## Validation

- `bun typecheck` — zero errors after entity config change
- Manual verification: batches list shows vessel names after migration
- Manual verification: batch create form hides Cancellation Details and Revision History
- Manual verification: Kettle vessel shows correct type badge
- Manual verification: blend history section on batch detail works (tests `batches_with_blend_info` view restoration)
