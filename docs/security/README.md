# Security — operating rules for RLS and write paths

This directory is the source of truth for how role-based access control is
enforced in mgr. Two documents work together:

- [`rls-policy-audit.md`](./rls-policy-audit.md) — the post-merge coverage
  table for every public-schema table and every documented permissive
  policy. Updated in the same PR that adds or changes a policy.
- This README — the **operating rule** for new code that touches the
  database, and how to add a permissive policy without breaking CI.

If you are reviewing or writing code that calls Supabase, start here.

---

## The user-session client rule

**Tool, route, and server-action writes must go through the user-session
Supabase client.** That client carries the user's JWT, so every query
runs under the user's role(s) and Row-Level Security applies.

The user-session client is created inside an authenticated handler — for
example:

```ts
// src/app/api/chat/route.ts (illustrative)
export const POST = withAuth(async (req, { supabase, user }) => {
  // supabase here is the user-session client.
  // Tool implementations receive this client, not a fresh service-role one.
  const tools = createChatTools(supabase);
  // ...
});
```

When a write goes through this client, RLS is the **single point of
authorization**. The check in the policy is the check that matters.

---

## When `createAdminClient` is acceptable

`createAdminClient` returns a service-role client that bypasses RLS. It is
the right tool for a narrow set of operations:

1. **Platform operations that have no user context.** Cron jobs,
   webhooks (e.g. Stripe/Square delivery), health checks.
2. **Auth-admin operations that must run as the platform.** Creating
   `auth.users` rows on invite/signup, reading `auth.users` for admin UIs.
3. **Reading a global secret on behalf of the user after the user has
   already passed an authentication boundary.** The narrow precedent here
   is `resolveApiKey` in `src/app/api/chat/route.ts`, which reads the
   shared Anthropic API key from `system_settings` after `withAuth` has
   already authenticated the request.

For every `createAdminClient` call site, the file must carry an inline
comment that names which of the three categories above the call falls
into, and explains why the user-session client cannot do the job. Reviewers
should reject service-role calls that don't have that justification.

There are **36 call sites today** (`grep -rln createAdminClient src/`).
Not all of them are currently audited; that audit is the next plan after
this one. Treat new call sites with extra scrutiny while that audit is
pending.

---

## Adding a new permissive policy

A policy is "permissive" at the row-filter level when its `USING` or
`WITH CHECK` clause is `true` or `auth.uid() IS NOT NULL` (either the
direct form or the Supabase init-plan form
`(( SELECT auth.uid() AS uid) IS NOT NULL)`). These bypass role-based
authorization wholesale.

When you introduce one — for example, a new catalog table that should be
readable by any authenticated user — the **same migration** must add a
`COMMENT ON POLICY`:

```sql
CREATE POLICY my_table_select ON my_table FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY my_table_write ON my_table FOR ALL
  USING      (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

COMMENT ON POLICY my_table_select ON my_table IS
  'RLS-EXCEPTION: catalog/reference data; any authenticated user may read.
   Write is gated by settings:manage on the companion _write policy.';
```

The integration test `src/__tests__/integration/rls-coverage.test.ts` fails
CI if any permissive policy in `public` lacks an `RLS-EXCEPTION:`-prefixed
comment. The comment is required to start with that exact prefix so the
guardrail finds it.

After adding the policy:

1. Add a row to the **Permissive policies retained** table in
   [`rls-policy-audit.md`](./rls-policy-audit.md).
2. If the new table introduces a fresh category of exception (i.e. the
   reason doesn't match an existing row), add a brief paragraph in this
   README so future reviewers know the precedent.

---

## Useful checks

Run locally before opening a PR:

```bash
# Type + lint
bun typecheck
bun lint

# Unit + RLS integration tests
bun run test
DATABASE_URL=postgresql://… bun run test:integration
```

The integration tests require a Postgres database with all migrations
applied and `src/__tests__/integration/_fixtures/seed-roles.sql` seeded.
CI provisions this automatically; locally, `make db-local` does the same —
it boots the local stack, replays the migration chain, and loads the role
fixtures plus demo data, then prints the `DATABASE_URL` to use. Any plain
Postgres 15/16 instance also works with the bootstrapping that
`.github/workflows/db-lint.yml` performs.

---

## What this directory does NOT cover

These surfaces have their own access models and need their own audits
(planned, not yet executed):

- **Supabase Storage** — avatar uploads, document uploads. Storage uses a
  separate RLS engine on the `storage.objects` table.
- **Supabase Realtime** — channel-level authorization. Notifications and
  any live-update features rely on Realtime's authorization rules, not on
  the policies tracked here.
- **`SECURITY DEFINER` functions** — 22 migrations define one. The audit
  for those is a separate follow-up plan; in the meantime, every new
  `SECURITY DEFINER` function must contain an internal
  `user_has_permission(...)` check or document why one is unnecessary.
