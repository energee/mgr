## RLS Posture Audits

Read-only SQL scripts to detect regressions in row-level security.

### When to run

- Manually after any migration that touches `CREATE POLICY`, `ALTER POLICY`, or `CREATE VIEW`.
- Periodically (recommended: monthly via CI on a staging snapshot).
- Before any TTB / compliance / vendor-security review.

### Scripts

#### `rls-posture-audit.sql`

Three checks in one file. Each check emits a `check_id` column so output can be filtered.

| Check ID | What it catches | Audit finding |
|---|---|---|
| `01-auth-uid-regression` | Policies using bare `auth.uid()` instead of `(SELECT auth.uid())`. The bare form re-evaluates the function per row, defeats index use, and was the explicit subject of migration 00013. | **F-125** |
| `02-view-base-rls-gap` | Views with `security_invoker = true` whose underlying base tables lack RLS or lack a `brewery_id`-scoped policy. The view inherits the gap and may leak cross-tenant rows. | **F-129** |
| `03-public-table-no-rls` | Any public-schema base table where RLS is not enabled. Allow-list exceptions live inline in the script and must be justified. | — |

Run via the Supabase SQL editor, or via psql:

```bash
psql "$DATABASE_URL" -f supabase/audits/rls-posture-audit.sql
```

Expected output: **empty result sets** for all three checks. Any rows that come back are findings to triage.

### Adding new audits

Place additional read-only SQL files in this directory. Each file should:

- Use only `SELECT` (no DDL, no DML).
- Open with a header describing the audit class and the linked finding ID.
- Emit a `check_id` column on every result row so multi-script runs can be merged.
- Be safe to run against production (no row locks, bounded queries).
