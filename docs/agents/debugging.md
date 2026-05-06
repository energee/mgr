# Debugging guide

Before assuming an application-level bug, work through this order.

## Database debugging order

1. **PostgREST schema cache** — after migrations, run `NOTIFY pgrst, 'reload schema';`. Stale cache produces `column not found` errors against columns that exist.
2. **Stale enum / lookup data** — if a check constraint or enum errors fire on values that look valid, the cached enum may be out of date.
3. **Check constraints and triggers** — read the migration file; the constraint may be intentional.

Only after these check out, look at application code.

## Bug-fix process

Before implementing any fix:

1. State what you believe the **root cause** is.
2. Explain **why** you believe this — what evidence in the code or stack trace supports it.
3. List **two alternative approaches**, ranked by likelihood of success.
4. Wait for confirmation before writing code.

## When the first fix doesn't work

**Stop.** Do not iterate on the same patch. Re-analyze:

- Does the original root-cause hypothesis still hold?
- Is the bug in a different layer than you assumed (DB vs API vs frontend)?
- Is there a stale cache or fixture you missed?

Present 2–3 alternative approaches with tradeoffs before trying again.

## Cross-stack bugs: parallel investigation

For bugs that span database, API, and frontend, dispatch parallel sub-agents
rather than serializing the investigation:

- **Agent 1** — schema, constraints, recent migrations
- **Agent 2** — API request / response flow
- **Agent 3** — frontend form submission and state management

Then synthesize findings into a single root-cause explanation.

## Test-driven fixes

When feasible:

1. Write a failing test that reproduces the bug.
2. Run it — confirm it fails for the right reason (not a typo).
3. Fix the underlying code.
4. Re-run — if still failing, analyze why and iterate.
5. Run the full suite — confirm nothing else broke.
6. Summarize what caused the bug and what changed.

## Systematic debugging checklist

1. Reproduce the exact error (capture the message verbatim).
2. Identify which layer holds the bug (DB / API / frontend).
3. Check for stale caches or data.
4. Propose the **minimal** fix.
5. Verify the fix resolves the original error and the failing test.

Show each step. Do not skip ahead.
