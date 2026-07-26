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
