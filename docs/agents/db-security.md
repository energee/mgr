# Database security rules (MUST FOLLOW)

When writing SQL migrations, follow every rule below. Full rationale in
[`docs/spec/architecture.md`](../spec/architecture.md) (DEC-SEC-001 through
DEC-SEC-003).

## The RLS model in one paragraph

MGR is **single-tenant**: there is no `org_id`/tenancy column anywhere. RLS is
**role-based**, enforced through `user_has_permission()` (since migration
00092) against roles cached on `user_profiles`. Do not conflate "no
multi-tenancy" with "no RLS" — every policied table still needs RLS enabled,
and new tables get permission-checked policies, not `USING (true)` (documented
exceptions carry a `check-permissive-rls: skip` comment).

## Views: use `security_invoker = true`

```sql
-- CORRECT
CREATE VIEW my_view
WITH (security_invoker = true)
AS SELECT ...;
```

Without `security_invoker`, views run as the view owner and bypass RLS.

## Never expose `auth.users`

```sql
-- WRONG
SELECT u.email FROM auth.users u
JOIN allocations a ON a.user_id = u.id;

-- CORRECT — cache user info in the table itself
ALTER TABLE my_table ADD COLUMN user_name TEXT;
```

`auth.users` contains sensitive auth data. Joining it through PostgREST views
can leak emails and metadata.

## Enable RLS on every table

```sql
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY my_policy ON my_table
  FOR SELECT
  USING (auth.uid() = user_id);
```

A policy without RLS enabled does nothing. A table with RLS enabled but no
policies blocks everything.

## Functions: set `search_path = public`

```sql
CREATE FUNCTION my_func()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public      -- always set this
AS $$ ... $$;
```

Without an explicit `search_path`, callers can shadow public-schema objects in
their own schema and hijack the function.

## Restrictive `WITH CHECK`

```sql
-- WRONG — too permissive
WITH CHECK (true)

-- CORRECT — specific conditions
WITH CHECK (auth.uid() = user_id)
```

## Enum values gated by `validate_enum_value()`

Some enum-shaped columns are policed by a trigger (`validate_enum_value()`,
since migration 00040) against value lists seeded into the `enum_values`
table — a separate object from the Postgres `enum` type itself, and nothing
keeps the two in sync automatically. Any migration that adds, renames, or
removes a value on an enum type gated by this trigger **MUST** update the
matching `enum_values` rows in the same migration, and verify with
`SELECT enum_range(NULL::the_enum_type)` compared against
`SELECT value FROM enum_values WHERE column_name = '...'`. #917 found a
`keg_transaction_type` registry that never matched its Postgres enum since
the initial seed (00037) — five of eight legal values were silently rejected
on every from-scratch database until integration tests exercised them.

## After applying migrations

If you hit `column not found` or stale enum errors, refresh the PostgREST
cache:

```sql
NOTIFY pgrst, 'reload schema';
```

If the same enum value is still rejected after a reload, it may not be a
cache problem at all — check whether the value is gated by
`validate_enum_value()` (above). A bad `enum_values` seed reads identically
to a stale cache, but a schema reload will never fix it (#917).

See [`debugging.md`](./debugging.md) for the full database-debugging order of
operations.
