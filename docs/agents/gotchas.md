# Gotchas

Non-obvious failure modes that have each cost a session at least once. They
are here because they are *not* derivable from the code — reading the file
you are editing will not warn you.

Load this at session start alongside [`PROGRESS.md`](../../PROGRESS.md), and
when a command fails in a way that makes no sense.

Adding one: it belongs here only if it (a) already bit someone, (b) is not
enforced by a gate, and (c) is not obvious from the source. If a gate *can*
enforce it, write the gate instead and delete the entry — see
[`improvement-loop.md`](improvement-loop.md).

## Tests

**`bun test` is not this repo's suite.** `bun test` is Bun's own runner; the
suite is vitest via `bun run test` (AGENTS.md hard constraint 14). Now
guarded: `bunfig.toml` preloads `scripts/bun-test-guard.ts`, which throws with
a pointer to the right command. If you see that error, you used the wrong one.

**Integration tests need seeded role users.** `bun run test:integration`
authenticates as the role-tier users in
`src/__tests__/integration/_fixtures/seed-roles.sql`. CI applies that file
explicitly (`db-lint.yml`); a local `supabase db reset` does not, and the
resulting failure reads like a broken test rather than a missing fixture. Use
`make db-local`, which replays migrations and loads both fixture sets.

**`make db-local` now fails hard if `supabase/seed.sql` does not apply.** The
demo seed used to be best-effort (warn and continue), which is how it silently
rotted through several schema changes until nothing after its first statement
ran (#581). It is strict now, so a schema change that breaks the seed shows up
on the next bootstrap instead of months later. Three things follow. First, the
failure is not fatal — migrations and the role fixtures are applied *before* the
seed, so the database still works for `bun run test:integration` and `make dev`;
only demo data is missing, and `MGR_SKIP_DEMO_SEED=1` skips the step outright if
you need a working database before you can repair it. Second, repair the seed
against **the migration chain**, not against the live database: `db-local`
replays `supabase/migrations/`, and the two have known drift (live dropped
`batches.fermenter`, `inventory_items.supplier`, `packages.package_type_id`,
and the whole `package_types` table out-of-band; the chain still creates them).
`src/types/supabase.ts` is generated from live, so it is a cross-check for
column names, never the authority for a local reset. Third, the seed is only
re-runnable against a *freshly reset* database, not idempotent: eight catalog
inserts end in a bare `ON CONFLICT DO NOTHING` on tables with no unique
constraint, so a second run duplicates every row, and `ON CONFLICT (id)` cannot
absorb a natural-key collision (`vessels.name`, `containers.name`,
`suppliers` `lower(name)`, `batches.batch_code`, `orders.order_number`). Reset
first; do not re-point the seed at a database that already has data.

## Database

**Never pick a migration number from the local checkout alone.** `ls
supabase/migrations | tail -1` shows only what *this* branch knows. Sibling
worktrees, unmerged remote branches, and the live project each may hold a
number you are about to reuse. Duplicate prefixes have happened twice — the
PR #213 cleanup left `supabase/repair-migration-renumbering.sql` behind, and
a 00260 collision had to be renumbered to 00266 in #545. Take the max across
worktrees, remote branches, and `supabase migration list` before naming a
file. The `preflight` skill does this check.

**Push migrations with `scripts/db-push.sh`, never bare `supabase db push`.**
The wrapper always passes `--include-all` (required here) and refreshes
`supabase/live-catalog.snapshot.txt`, which the live-drift watchdog compares
against. A bare push leaves the snapshot stale and the watchdog warning about
the new objects forever. See [`ci.md`](ci.md) for the live-apply rules.

**PostgREST caches the schema.** After a migration that adds or changes an
enum value, a constraint, or a column, the API can keep serving the old shape
— errors mention an enum value or column that plainly exists. It is a stale
cache, not your migration. Reload the schema cache (`NOTIFY pgrst,
'reload schema'`, or restart the local stack) before debugging further.

**`Unregistered API key` is a credential rejected upstream of Postgres — work
out *which instance* before anything else.** Every route that calls
`createAdminClient()` — `/api/settings/api-key`, `/api/slack/settings`, any
server-side write — starts failing at once with a 500 whose `error.message` is
literally `Unregistered API key`. **The tell** is that the payload carries no
Postgres error code and no stack trace — no `42501`, no `42883`, no `PGRST…`
— which is how you separate it from a policy, GRANT, or migration problem:
the request was rejected before PostgREST, RLS, or your table was reached. The
mismatch it reports lives in `createAdminClient()`
(`src/lib/supabase/server.ts`), which pairs `NEXT_PUBLIC_SUPABASE_URL` with
`SUPABASE_SERVICE_ROLE_KEY` from two independent env vars; `src/lib/env.ts`
only checks "is a URL" and "is non-empty", never that the key belongs to that
URL.

Diagnose it, don't assume a cause:

1. Read `NEXT_PUBLIC_SUPABASE_URL`. `127.0.0.1` is the CLI stack;
   `https://<ref>.supabase.co` is the hosted project — and `.env.example`
   ships the hosted form, so "it must be local" is not a safe default.
2. Compare the presented key against *that* instance's current keys —
   `supabase status` for local, the dashboard API-keys page for hosted. For
   hosted, also check whether the legacy JWT `anon`/`service_role` pair is
   still enabled: the newer `sb_publishable_…`/`sb_secret_…` format can be
   rolled out with the legacy pair disabled, which rejects a key that is still
   structurally valid.
3. Reproduce it and read the answer instead of inferring it:
   `curl -sD- -H "apikey: $KEY" "$URL/rest/v1/"`.

Two claims were checked and did *not* hold, so don't re-derive them. Restarting
the local stack does **not** invalidate local keys: `supabase/config.toml` sets
no `[auth]`/JWT override, so the CLI signs local keys with its own hardcoded
default secret, and a key minted by an earlier local stack still verifies
against a later one. And the emitter of this exact string is **unidentified** —
it is in neither this repo nor `@supabase/supabase-js`, so it comes from the
endpoint, but as of 2026-07-30 this project's hosted gateway rejects an
unregistered key with `Invalid API key` (`sb-error-code:
UNAUTHORIZED_INVALID_API_KEY`) and Kong 2.8.1, the image the CLI pins for the
local gateway, with `Invalid authentication credentials`. Neither emits
`Unregistered API key`, so the "local Kong gateway says this" attribution in
#636–#642 is unsupported. Use step 3 rather than inheriting it.

Expect a *burst*, not one error: the settings page probes each integration id
in a single page load, so one bad credential filed five near-identical Sentry
issues (#636, #637, #638, #641, #642) for one machine in one minute. Sentry's
`environment` is **not** a discriminator here — `src/lib/sentry-config.ts`
sets it from `NODE_ENV`, so `next dev` against the *hosted* project still
reports `development`. Judge severity by the instance step 1 names, not by the
environment tag.

**`/api/auth/dev-login` 404s — or `bun e2e` / `verify.sh` / `smoke-test.sh`
fails to authenticate — when your dev server points at a hosted project.**
Since #679 that route requires a loopback `NEXT_PUBLIC_SUPABASE_URL` even under
`NODE_ENV=development`; against anything else it 404s unless
`DEV_LOGIN_ALLOW_REMOTE_DB=1` is set. **The tells**, in the order you will meet
them: the `/login` page prints the required variable next to the Dev Login
button, and the `bun dev` terminal logs a warning naming it. The HTTP response
is a bare `{"error":"Not found"}` on purpose and says nothing. (The log is a
`logger.warn`, so `LOG_LEVEL=error`/`silent` suppresses it — the on-page note
does not depend on the log level.) Two fixes, pick by intent: point `.env.local`
at `supabase status`'s local API URL (what `make db-local` tells you to do, and
the better answer), or set the opt-in and accept that anyone who can reach the
port gets uncredentialed admin on that hosted project. `E2E_DEV_LOGIN` does
**not** accept the opt-in, and neither variable affects a production build.

A URL that names **no host at all** — `localhost:54321` without a scheme,
which `new URL()` happily parses as scheme `localhost:` plus path `54321` — is
an `unknown` target, not a remote one. The opt-in does not open it and the Dev
Login button disappears entirely. If the button is missing on a dev server,
check the scheme on `NEXT_PUBLIC_SUPABASE_URL` before anything else.

## Build and tooling

**Stale caches masquerade as type errors.** `tsc`/eslint failures that
contradict the file in front of you usually mean a stale
`tsconfig.tsbuildinfo` or `.next/`. Run `make clean` before investigating a
type error you cannot reproduce by reading the code.

~~Two lockfiles, one warning~~ — removed 2026-07-26. Fixed 2026-07-24 by
pinning `turbopack.root` to `__dirname` in `next.config.ts` (PR #585,
`docs/progress/2026-07-24-turbopack-root.md`); the workspace-root warning no
longer fires in main or any worktree. The failure mode is gone, not just
worked around, so the entry goes with it per the rule above (b).

**knip and depcheck produce false positives here.** The entity registry and
`z.infer` types keep symbols alive in ways static analysis misses. AGENTS.md
hard constraint 17: verify before deleting anything they flag.

## Agent sandboxes

Harness-environment failures, not repo bugs — but they read like repo bugs.

**`bun -e` and `bun run <file>.ts` can exit 1 silently under a sandboxed
shell.** Probe with `bun -e 'console.log("hi")'`; if that fails, rerun the
command with the sandbox disabled rather than debugging the script.

**Too many worktrees overflow the sandbox argv.** Around ~50 worktrees the
allow-list argument list exceeds `ARG_MAX` and every sandboxed command fails
with E2BIG. Prune with `make worktree-doctor` / `scripts/agent-worktree`;
bypass per-command in the meantime.
