---
name: verify
description: Drive a changed feature end-to-end in a real browser against the running app and observe behavior, before claiming it works. Use after implementing or fixing anything with a runtime surface — a page, a form, an API route, a state transition. Do NOT use for diffs that only touch tests, docs, or config.
allowed-tools:
  - Bash
  - Read
---

# verify — drive the feature, don't just typecheck it

`bun run typecheck && bun run test` proves the code compiles and the units pass.
It does not prove the feature works. This skill exercises the actual flow in a
real browser and collects evidence.

## STOP — this app writes to production

`.env` points `NEXT_PUBLIC_SUPABASE_URL` at the **hosted** Supabase project.
There is no local stack (`supabase/config.toml` does not exist). Every row you
create is real.

Worse, writes fan out to external systems:

| Flow | Fires |
|---|---|
| Packaging session / Square sale | Square bin-inventory debit (`00223`, PR #361) |
| Orders, invoices | QuickBooks sync (`src/integrations/quickbooks/`) |
| Customer-facing actions | Resend email (`src/integrations/email.ts`) |
| Various transitions | Slack notifications (`src/integrations/slack.ts`) |

**Never verify a flow that fires an external integration without the user
explicitly approving that specific flow in this session.** A test order is not
a test order once QuickBooks has it.

### Mutation protocol

1. **Ask first.** Before the first write, tell the user exactly which records
   will be created and which integrations may fire. Wait for approval.
2. **Mark everything.** Any user-supplied name/label gets the prefix
   `VERIFY-<YYYY-MM-DD>-`. Never reuse a real customer, order, or batch.
3. **Record IDs.** Capture the id of every row you create, as you create it.
4. **Clean up.** Delete them at the end, newest first. If a delete fails, say so
   loudly and list what remains. Do not report success with orphans behind you.
5. **Never** `--permission-mode bypassPermissions` against this app.

If the flow can't be exercised without an irreversible side effect, say that and
stop. A read-only render check plus an honest "I could not verify the write path"
beats a silent production mutation.

## Preflight

**Both the dev server and `agent-browser` require the sandbox disabled.** Next
fails with `listen EPERM: 0.0.0.0:3000`, and `agent-browser` with
`Socket directory '~/.agent-browser' is not writable`. Both are sandbox
signatures, not tool bugs. Use `dangerouslyDisableSandbox` for these commands.

```bash
# 1. Env. Worktrees only have .env.example; the real one lives in the main checkout.
ls .env 2>/dev/null || ln -s /Users/tedslesinski/Repos/mgr/.env .env

# 2. Start it (run_in_background). Turbopack; ~5s to ready.
bun dev
```

**Never assume port 3000.** Other worktrees leave dev servers running; Next
silently takes the next free port. Read the actual port from the server banner
(`- Local: http://localhost:3001`) rather than polling a guess. A `curl` to an
occupied `:3000` will cheerfully return someone else's app.

Do not write the poll as `curl … || echo 000` — `curl -w '%{http_code}'` already
prints `000` on failure, so the `||` concatenates into `000000` and every
"is it up?" test passes.

## Authenticate

**The login route is `/login`, not `/auth/login`.** `src/app/(auth)/login/` is a
Next.js *route group* — parentheses never appear in the URL. `/auth/login` renders
the 404 page, and nothing rewrites it (`src/proxy.ts`: "Auth redirects are handled
by layouts").

In dev the login page renders a **Dev Login** button (`dev@brewery.test`,
`src/app/(auth)/login/login-form.tsx:252`). Use it — one click, no credentials,
no dependency on whether `test@brewery.com` exists in the hosted project.

**It is not free.** `src/app/api/auth/dev-login/route.ts` uses
`createAdminClient()` to *create* `dev@brewery.test` if absent. `.env` points at
the hosted Supabase, so the first `verify.sh up` on a fresh project writes a real
auth user. Idempotent afterwards, and the route 404s unless
`NODE_ENV === "development"` — but confirm that user already exists before
running this against a project whose auth table you care about.

Don't do this by hand — `verify.sh up` does all of it and fails loud if login
didn't land on `/dashboard`. The equivalent by hand:

```bash
agent-browser open http://localhost:<port>/login
agent-browser find text "Dev Login (dev@brewery.test)" click
agent-browser wait 3000 && agent-browser get url    # expect /dashboard
```

## Drive

Use `agent-browser` (v0.31.x, Playwright-backed, auto-waiting).

**`snapshot` + `@eN` refs are the fastest and most reliable path** — its own docs
say so. Snapshot once, act on refs, re-snapshot after the DOM changes.

```bash
agent-browser snapshot -i          # accessibility tree with @e1, @e2, …
agent-browser click @e7
agent-browser fill @e4 "VERIFY-2026-07-09-batch"
agent-browser get text @e12
```

Two traps, both of which cost real time here:

- **`find role button click "Save"` does not click Save.** The trailing
  positional is the *action's input* (text to fill/type), not a name filter, so
  this clicks the first `role=button` on the page. Use
  `find role button click --name "Save"`, or `find text "Save" click`.
- **`get` is not a `find` action.** `find label Email get text` fails with
  `Unknown subaction: get`. Reads go through the separate `get` command.

`agent-browser skills get core --full` prints the version-matched command
reference. Read it rather than guessing flags — that is how both traps above
were found, after guessing wrong first.

## Evidence to collect

A change is verified when you can show, not assert:

1. **Console is clean.** `agent-browser console` — no errors, no React key or
   hook-order warnings.
2. **No failed requests.** `agent-browser network requests` — nothing 4xx/5xx
   that the flow didn't intend.
3. **The screen is right.** `agent-browser screenshot <path>` and read it.
   For dark mode, **`set media dark` does not work here** — it returns `✓ Done`
   but `document.documentElement.className` stays `"light"`, because the theme is
   class-based, not `prefers-color-scheme`. Toggle through the app's own UI
   control instead.
4. **The data changed.** Re-read the list or detail view and confirm the value
   you wrote is the value shown. A green toast is not evidence.
5. **The regression didn't.** `agent-browser diff screenshot --baseline` if a
   baseline exists for that page.

Report what you observed. If step 4 could not be run because of the mutation
protocol, say so explicitly instead of implying the feature works.

## Relationship to the existing suites

- `bun run test` — 1500+ vitest units. Fast, run always.
- `e2e/*.spec.ts` — six Playwright journeys (dashboard, recipe editor, batch
  transfer, customer order, packaging session, production workflow), booted via
  `playwright.config.ts`'s own `webServer: bun dev`. Durable regression guards.
- **This skill** — one-off confirmation that *this* change works, before you
  claim it does. If a flow keeps breaking, promote it into `e2e/`.

`gstack browse` is the better tool for reading a docs page or poking a deployed
URL — a warm daemon and one-shot verbs like `perf`, `responsive`, `links`. It is
not the tool for driving an authenticated, mutating flow.

## Verified 2026-07-09

Driven live against the app on `localhost:3001`, read-only, no writes:

- `bun dev` starts in a worktree with a symlinked `.env` (~5s), **sandbox off**.
- `agent-browser` 0.31.1 drives it: `open`, `snapshot` (refs), `get url/title`,
  `find … click`, `eval`, `screenshot`, `console`, `close --all` all work.
- `/login` renders the sign-in form; `/auth/login` renders 404.
- The login page's console is clean (one HMR log, one React DevTools notice).
- `set media dark` is a no-op for this app's theme.

## Known broken, not fixed by this skill

`e2e/auth.setup.ts:16` navigates to `/auth/login`, which 404s. Every spec in the
`chromium` project depends on that setup, and `playwright.config.ts:22` hardcodes
`baseURL: "http://localhost:3000"` — a port other worktrees routinely occupy.
The Playwright suite cannot be green. Fix those two before trusting `e2e/`.

If you learn something here is wrong, correct it in this file the same day.
A skill that lies is worse than no skill.
