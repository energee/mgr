---
name: verify
description: Drive a changed feature end-to-end in a real browser against the running app and observe behavior, before claiming it works. Use after implementing or fixing anything with a runtime surface — a page, a form, an API route, a state transition. Do NOT use for diffs that only touch tests, docs, or config.
allowed-tools: Bash, Read
---

# verify — drive the feature, don't just typecheck it

`bun run typecheck && bun run test` proves the code compiles and the units pass.
It does not prove the feature works. Exercise the flow and collect evidence.

## STOP — this app writes to production

`.env` points at the **hosted** Supabase project; there is no local stack
(`supabase/config.toml` does not exist). Every row you create is real, and writes
fan out:

| Flow | Fires |
|---|---|
| Packaging session / Square sale | Square bin-inventory debit (`debit_bin_inventory`, from the Square POS bin-sync work — migration numbering varies by branch) |
| Orders, invoices | QuickBooks sync |
| Customer-facing actions | Resend email |
| Various transitions | Slack notifications |

**Never exercise a flow that fires an external integration without the user
approving that specific flow in this session.** A test order stops being a test
order once QuickBooks has it.

Mutation protocol: ask before the first write, naming the records and the
integrations; prefix every label `VERIFY-<YYYY-MM-DD>-`; capture the id of every
row you create; delete them at the end, newest first, and say so loudly if a
delete fails. Never `--permission-mode bypassPermissions` against this app.

If a flow can't run without an irreversible side effect, say so and stop. An
honest "I could not verify the write path" beats a silent production mutation.

## Run it

Both the dev server and `agent-browser` need the **sandbox disabled** — Next
fails `listen EPERM`, `agent-browser` fails on `~/.agent-browser`. Both are
sandbox signatures, not tool bugs.

```bash
BASE=$(bash .claude/skills/verify/verify.sh up)   # ~20s cold, ~0s warm
# … drive the feature …
bash .claude/skills/verify/verify.sh down
```

`up` symlinks `.env` from the main checkout, boots `bun dev` in its own process
group, reads the port Next actually chose (never assume `:3000` — other
worktrees hold it), signs in via the dev-login button, and fails loud unless it
lands on `/dashboard`. Re-running reuses the server and the browser session.
`down` kills the server's process group, closes the current browser session,
removes the state dir, and removes the `.env` symlink it created (only when it
is still that symlink — a real `.env` you placed is never touched).

**`up` needs a loopback Supabase URL (issue #679).** `/api/auth/dev-login` mints
an admin session with no credentials, so since #679 it also checks which
database it is about to touch: under `NODE_ENV=development` it answers only when
`NEXT_PUBLIC_SUPABASE_URL` has a loopback hostname (`localhost`, `127.0.0.1`,
`[::1]`), or when the server has `DEV_LOGIN_ALLOW_REMOTE_DB=1`. The `.env` this
script symlinks from the main checkout is the usual culprit — if it points at a
hosted project, `up` fails and names #679 plus both fixes (point `.env` at the
local stack from `make db-local`, or set the opt-in). The login page says the
same thing next to the button; the HTTP response is a bare
`{"error":"Not found"}` by design.

One shared-daemon caveat: agent-browser sessions are daemon-wide. Without
`AGENT_BROWSER_SESSION` set, every worktree drives the same default session, so
parallel verify runs can steal each other's page (`up` guards against adopting
another worktree's dashboard, but mid-run interleaving is still possible) and
`down` closes that shared session. For real isolation, export a unique
`AGENT_BROWSER_SESSION` per worktree before `up`, the driving commands, and
`down` — verify.sh honors it transparently. See `verify.sh` for the other
agent-browser gotchas it encodes.

**First run on a fresh project writes an auth user.**
`src/app/api/auth/dev-login/route.ts` uses `createAdminClient()` to create
`dev@brewery.test` when absent. Idempotent afterward.

## Drive

`snapshot` + `@eN` refs are the fastest, most reliable path — agent-browser's own
docs say so. Snapshot once, act on refs, re-snapshot after the DOM changes.

```bash
agent-browser snapshot -i        # accessibility tree with @e1, @e2, …
agent-browser click @e7
agent-browser fill @e4 "VERIFY-2026-07-09-batch"
agent-browser get text @e12
```

Two traps: `find role button click "Save"` clicks the *first* button on the page,
because the trailing positional is the action's input, not a name filter — use
`--name "Save"` or `find text "Save" click`. And `get` is not a `find` action.
When unsure, read `agent-browser skills get core --full` instead of guessing.

## Evidence

A change is verified when you can show, not assert:

1. `agent-browser console` — no errors, no React key or hook-order warnings.
2. `agent-browser network requests` — nothing 4xx/5xx the flow didn't intend.
3. `agent-browser screenshot <path>`, then read it. For dark mode, toggle the
   app's own control; `set media dark` is a no-op here (the theme is class-based,
   not `prefers-color-scheme`).
4. Re-read the list or detail view and confirm the value you wrote is the value
   shown. A green toast is not evidence.
5. `agent-browser diff screenshot --baseline`, if a baseline exists.

Say what you observed. If step 4 couldn't run under the mutation protocol, say
that instead of implying the feature works.

## Where this sits

`bun run test` (1500+ vitest units) runs always. `e2e/*.spec.ts` are durable
regression guards. **This skill** is the one-off confirmation that *this* change
works, before you claim it does. If a flow keeps breaking, promote it into `e2e/`.

`gstack browse` is better for reading a docs page or poking a deployed URL — warm
daemon, one-shot verbs like `perf` and `responsive`. Not for authenticated,
mutating flows.

## Verified 2026-07-09

Driven live, read-only: cold `up` reaches `/dashboard` in ~20s, warm `up` reuses
server and session in ~0s. The authenticated dashboard renders with one console
error (a hydration mismatch, pre-existing). Teardown was hardened after that
run (process-group kill, `.env` symlink removal, session-scoped browser close)
and has not been re-driven live since.

## Running the Playwright suite

Fixed 2026-07-09: `auth.setup.ts` used to navigate to `/auth/login` (a 404 —
`src/app/(auth)/` is a route group) and `baseURL` was hardcoded to `:3000`. It
now signs in through `/api/auth/dev-login`, and `PLAYWRIGHT_BASE_URL` moves both
the server and the tests:

```bash
PLAYWRIGHT_BASE_URL=http://localhost:3007 npx playwright test --project=setup
```

Use a spare port whenever another worktree holds `:3000` — `reuseExistingServer`
is on locally and will silently adopt whatever already answers there.

**The six specs have not been run since the fix.** They drive packaging sessions
and customer orders against hosted Supabase, so they can write real rows and fire
Square, QuickBooks, and Resend. Read the mutation protocol above before running
anything beyond `--project=setup`.

If something here is wrong, correct it the same day. A skill that lies is worse
than no skill.
