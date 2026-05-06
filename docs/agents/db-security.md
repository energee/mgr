# Database security rules (MUST FOLLOW)

When writing SQL migrations, follow every rule below. Full rationale in
[`docs/spec/architecture.md`](../spec/architecture.md) (DEC-SEC-001 through
DEC-SEC-003).

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

## After applying migrations

If you hit `column not found` or stale enum errors, refresh the PostgREST
cache:

```sql
NOTIFY pgrst, 'reload schema';
```

See [`debugging.md`](./debugging.md) for the full database-debugging order of
operations.
