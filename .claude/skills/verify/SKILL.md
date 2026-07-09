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

```bash
# 1. Env. Worktrees only have .env.example; the real one lives in the main checkout.
ls .env.local .env 2>/dev/null || ln -s /Users/tedslesinski/Repos/mgr/.env .env

# 2. Is the app already up? Reuse it rather than starting a second server.
curl -s -o /dev/null -w '%{http_code}\n' --max-time 2 http://localhost:3000

# 3. Start it if not. Turbopack; first compile is slow.
bun dev   # run_in_background, then poll :3000 until it answers 200
```

## Authenticate

`e2e/auth.setup.ts` logs in through the real login page with `E2E_USER_EMAIL` /
`E2E_USER_PASSWORD`, defaulting to `test@brewery.com` / `testpassword123`, and
persists Playwright `storageState` to `e2e/.auth/user.json`.

Drive the login form directly rather than importing that state — it is three
commands and avoids a storageState-format interop question:

```bash
agent-browser open http://localhost:3000/auth/login
agent-browser find label Email fill "${E2E_USER_EMAIL:-test@brewery.com}"
agent-browser find label Password fill "${E2E_USER_PASSWORD:-testpassword123}"
agent-browser find role button click "Sign in"
agent-browser wait 2000 && agent-browser get url    # expect /dashboard
```

## Drive

Use `agent-browser` (v0.31.x, Playwright-backed, auto-waiting). Prefer semantic
targeting over CSS — the UI is config-driven and class names are not stable.

```bash
agent-browser snapshot                    # accessibility tree with @refs
agent-browser find role button click "Save"
agent-browser find testid batch-status get text
```

`agent-browser skills get core --full` prints the version-matched command
reference. Read it rather than guessing flags.

## Evidence to collect

A change is verified when you can show, not assert:

1. **Console is clean.** `agent-browser console` — no errors, no React key or
   hook-order warnings.
2. **No failed requests.** `agent-browser network requests` — nothing 4xx/5xx
   that the flow didn't intend.
3. **The screen is right.** `agent-browser screenshot` and read it. The app has a
   theme toggle; check both with `agent-browser set media dark` / `light`.
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

## Unverified in this file

Written from the command surface, not from a live run. The first person to use
this skill should confirm and then correct:

- that `agent-browser find label Email fill …` matches the login page's actual
  labels (`auth.setup.ts` uses `getByLabel("Email")`, so it should);
- that `bun dev` starts cleanly in a worktree with a symlinked `.env`;
- that `agent-browser set media dark` flips this app's theme (it may be
  class-based rather than `prefers-color-scheme`, in which case toggle via the
  UI control).

Fix them here when you learn the truth. A skill that lies is worse than no skill.
