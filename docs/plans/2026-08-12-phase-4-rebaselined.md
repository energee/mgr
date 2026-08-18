# Phase 4, re-baselined against the tree

**Status:** EXECUTED — every node is merged; schedule nothing from this plan. A (buildSearchTool
factory) = PR #808. B (generic chat writes behind the confirm gate) = PR #820. C1 (portal INSERT
policy, migrations 00290 + the 00291 sequence guard) = PR #809, live. C2 (order builder + 00292)
= PR #821; 00292 applied live 2026-08-18 (#818, PR #828). C3 (Mailpit OTP harness) = PR #807;
exercised 2026-08-18 — chromium-portal 3/3 and customer-order 5/5 pass locally. Closeout entry:
`docs/progress/2026-08-18-phase4-closeout.md`.
**Date:** 2026-08-12 (executed by 2026-08-18)
**Baseline:** `main` @ `dcec7c13`

## Why this document exists

The audit driving Wave 3 / Phase 3 was stale. Ten of its claims were wrong, and three of its
highest-value work items described **code that no longer existed** — the work had already been
done, twice by relocating a rule into an atomic Postgres function. Agents were dispatched to
implement things that were already implemented.

So Phase 4 was re-verified against the tree, the migration chain,
`supabase/live-catalog.snapshot.txt`, `docs/feature_list.json` and merged PRs before any
scoping. **One of its three areas turned out to be finished.**

## Already done — schedule nothing

| Item | Evidence |
|---|---|
| **Cellar board** | Shipped in PR **#340**. `src/components/domain/vessel/cellar-board.tsx` (255 lines: vessel tiles grouped fermenter / foeder / brite, fill vs capacity, days in tank, Transfer + Mark Clean, over `vessels_with_batch`), routed at `src/app/(app)/production/cellar/page.tsx`, linked in `nav-items.ts`. **Confirmed by the operator on 2026-08-12 as what "cellar board" meant.** Not greenfield, not partial. |
| **TTB cellar reconciliation** | #618 and #698 both CLOSED by PR #761 = migration `00287_ttb_period_keyed_in_process.sql`. Applied live 2026-08-12 (PR #791) and **confirmed by reading `supabase_migrations.schema_migrations` directly**, not inferred from a snapshot hash. |
| **Chat 4C confirmation gate** | PR **#745** shipped `src/app/api/chat/write/route.ts` (`withPermission("batches:write")`, re-validates via `src/lib/schemas/chat-write.ts`, RLS-final), the `recordBatchReading` proposal tool, and the Confirm/Cancel card in `chat-panel.tsx`. Tested. |

### Trap: #706 is closed but portal ordering is NOT shipped

**#706 is CLOSED as COMPLETED — but only its documentation half** (PR #718 corrected F114's
overstated description). The feature is absent. Anyone treating "706 closed" as "portal ordering
works" will build on sand. This is precisely the class of error that cost three nodes last wave.

## What actually remains

### A. Chat 4A — `buildSearchTool` factory (no DB, parallel-safe)

`buildSearchTool` **does not exist**: zero hits in `src/`; only design-doc references in
`docs/superpowers/specs/`. `src/app/api/chat/tools.ts` is 1,313 lines with ~10 hand-written
search tools (`searchEntity`, `lookupEntity`, `searchOrders`, `searchBrewLogs`,
`searchPurchaseOrders`, `searchSuppliers`, `searchPickLists`, `searchYeastPitches`, plus getters).

Consolidate them behind one factory. Full original scope stands. Characterization tests first —
each existing tool's argument shape and result shape must be pinned before consolidation, because
the chat's behaviour is only observable through them.

### B. Chat 4B — generic writes (no DB, after A)

Currently the chat can persist **exactly one thing**: a `batch_logs` measurement, via 4C's gate.
Everything else write-shaped is navigational — `createBatch` (`tools.ts:1035`), `transitionBatch`
(`:1113`), `addBatchReading` (`:1164`), `createPackagingSession` (`:1193`) all return
`{action: "navigate", url, prefillData}` and persist nothing.

4C already built the pattern, so 4B is now **"add a case to the existing `/api/chat/write` switch
plus a proposal tool per write"**, not new architecture. Do it after A, or each new write gets
written twice.

Cleanup owed: `addBatchReading` (navigational) and `recordBatchReading` (gated write) now overlap.
One should go.

### C. Portal ordering — the only substantial greenfield

Today a portal customer **cannot place an order**. `src/app/portal/` has four routes (login,
orders list, order detail, change-request/new). They can amend a *staff-created* order via
`src/components/portal/change-request-builder.tsx` into `order_change_requests`, applied by
`apply_change_request` (migration `00264`, live).

Live portal RLS is read + lock only: `customers_customer_select`,
`customer_portal_users_customer_select`, `customer_orders_select`, `customer_order_items_select`,
`orders_customer_lock` (UPDATE, per `00276`), `change_requests_customer_insert`. **There is no
customer INSERT policy on `orders`.** That is the crux.

#### C1. Write path — operator decision, 2026-08-12

Three shapes were put to the operator: an atomic staff-confirm RPC mirroring 00264 (recommended),
a scoped customer INSERT policy, or a separate `order_requests` entity. **The operator chose the
customer INSERT policy on `orders`.**

The concern raised at decision time, recorded here so it is not lost: this widens the portal's
write surface against a core sales table, and the repo carries 13 migrations with blanket
`USING (true)` RLS, so customer write policies deserve care. The decision stands; the constraints
below are how it is made as narrow as the choice allows, and they are **requirements, not
suggestions**:

1. The policy is `INSERT`-only, on `orders` and `order_items`, `TO authenticated`, and carries a
   `WITH CHECK` binding the row's `customer_id` to the caller's own customer via the existing
   `customer_portal_users` join used by `customer_orders_select`. A customer must not be able to
   insert an order for another customer.
2. The insertable `status` is constrained to a single staff-confirm state. A customer must not be
   able to create an order that is already confirmed, allocated, or fulfillable. Enforce this in
   the policy's `WITH CHECK`, not only in the UI.
3. Customer-settable columns are enumerated. Pricing must not be customer-supplied — resolve it
   server-side through the existing `get_price_for_customer` path (now behind
   `src/services/pricing-service.ts`, PR #789), or the portal becomes a price-setting surface.
4. `orders_customer_lock` (UPDATE) already restricts what a customer may change post-creation.
   Verify the new INSERT policy cannot be composed with it to escape that lock.
5. An integration test per constraint, in `src/__tests__/integration/` (the db-lint lane is the
   only gate that runs these). At minimum: cross-customer insert denied; elevated status denied;
   customer-supplied price ignored or rejected.

Per `docs/agents/db-security.md`: RLS enabled, `search_path = public` on any function,
`security_invoker = true` on any view. New migration number = highest + 1 (currently 00289).

#### C2. Order-placement UI

A portal order-create route under `src/app/portal/`, reusing the availability-capping logic
already in `change-request-builder.tsx` (607 lines) rather than reimplementing it.

#### C3. Playwright OTP harness — needed regardless

`e2e/customer-order.spec.ts:66-79` is skipped for **two independent** reasons: there is no
order-placement UI to drive, and portal auth is OTP/magic-link only
(`shouldCreateUser: false` in `portal-login-form.tsx`), so a portal `storageState` must scrape a
code from Mailpit (port 54324) each run.

**The second blocker blocks every authenticated portal E2E, including read-only ones.** It is
worth doing on its own merits and is parallel-safe with everything else.

## Dependency order

```
C1 (portal INSERT policy + migration)  -- SERIAL, live DB, do first
   `-> C2 (order-placement UI) -> un-skip e2e/customer-order.spec.ts
A  (buildSearchTool factory)           -- parallel-safe, no DB
   `-> B (generic chat writes)
C3 (Mailpit OTP harness)               -- parallel-safe, start any time
```

- **C1 is serial and touches live.** Stop for the operator before applying anything, per the
  Phase 3 precedent.
- **A and C3 are parallel-safe with everything** and need no product decisions.
- **B waits on A.** **C2 waits on C1.**
- Cellar board: nothing scheduled.

## Gate note

Dispatched agents cannot run `refactor-reviewer`, `/simplify`, or `/code-review` (#803). The
orchestrator must run those centrally, in a second pass over each node's branch. Do not write
them into a node brief — see `docs/agents/dispatching-agents.md`.

## What this plan explicitly does NOT do

- Rebuild the cellar board.
- Treat #706's closure as evidence portal ordering exists.
- Touch the ~400 raw `.from()` call sites (out of scope, unchanged from the backend-extraction plan).
