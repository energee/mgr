---
name: verify
description: Drive a changed feature end-to-end in a real browser against the running app and observe behavior, before claiming it works. Use after implementing or fixing anything with a runtime surface — a page, a form, an API route, a state transition. Do NOT use for diffs that only touch tests, docs, or config.
allowed-tools:
  - Bash
  - Read
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
| Packaging session / Square sale | Square bin-inventory debit (`00223`, PR #361) |
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

`up` symlinks `.env`, boots `bun dev`, reads the port Next actually chose (never
assume `:3000` — other worktrees hold it), signs in via the dev-login button, and
fails loud unless it lands on `/dashboard`. Re-running reuses the server and the
browser session. See `verify.sh` for the agent-browser gotchas it encodes.

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
server and session in ~0s, `down` leaves nothing behind. The authenticated
dashboard renders with one console error (a hydration mismatch, pre-existing).

## Known broken, not fixed here

`e2e/auth.setup.ts:16` navigates to `/auth/login`, which 404s — `src/app/(auth)/`
is a route group, so the real route is `/login`. Every spec in the `chromium`
project depends on that setup, and `playwright.config.ts:22` hardcodes
`baseURL: "http://localhost:3000"`, a port other worktrees routinely occupy. The
Playwright suite cannot be green until both are fixed.

If something here is wrong, correct it the same day. A skill that lies is worse
than no skill.
