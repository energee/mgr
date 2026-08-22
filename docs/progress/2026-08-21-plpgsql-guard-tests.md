# Integration-harness fixtures + plpgsql guard tests

Date: 2026-08-21
Branch: `test/plpgsql-guard-fixtures`
Backlog: item 21, P3 "Test debt" (`docs/plans/2026-07-10-audit-fix-backlog.md`), audit refs TC-1, TC-2, TC-7, TC-10.

## Audit premise corrected

TC-1 was filed as CRITICAL on the framing that the integration harness "has no
usable fixtures, which is why the DB layer has near-zero behavioral coverage".
That is **stale**. As of this branch's base the harness already provided:

- `vitest.integration.config.ts` — node environment, 15 s timeout,
  `fileParallelism: false` (with a measured justification in its docstring).
- `src/__tests__/integration/_helpers/role-client.ts` — role impersonation via
  `SET LOCAL request.jwt.claims`, `withRoleClient`, `requireDatabaseUrl`.
- `src/__tests__/integration/_fixtures/seed-roles.sql` (283 lines) and
  `bootstrap-plain-postgres.sql`.
- `scripts/db-local.sh` / `make db-local` — a documented zero-to-running path
  that replays every migration and loads the role fixtures.
- **36 integration test files / 239 tests**, most of them genuinely behavioral.

So the CRITICAL framing no longer describes reality. What was actually missing
was coverage of the four named DB guards, and one reusable seed helper for the
packaging chain. That is what this branch adds.

## What landed

### Harness

`src/__tests__/integration/_helpers/packaging-fixture.ts` — a reusable builder
for the parent chain every packaging/finished-goods test needs
(brand → container → selling_format → batches → session → line items, plus an
optional location + bin), with `completePackagingSession()` to fire the
completion trigger and return the created finished goods index-aligned to the
line items. Container type (`package` vs `keg`) is a first-class option because
that is the branch `create_finished_goods_from_packaging` and
`revise_packaging_session` both switch on.

`packaging-completion-trigger.test.ts` deliberately keeps its own inlined seed
helpers. It is long-standing passing coverage of the exact ids it seeds, and
rewriting it to route through the shared helper would risk that coverage for no
behavioral gain. New suites use the helper.

### Guard coverage

| Guard | Before | After |
|---|---|---|
| `debit_bin_inventory` clamp | none | **16 tests** (`bin-inventory-clamp.test.ts`, incl. `credit_bin_inventory`) |
| availability / outbound guards (00212, 00216) | already covered — 5 behavioral tests in `inventory-guards.test.ts` | unchanged |
| keg receive → fill → ship netting | none | **9 tests** (`keg-netting.test.ts`) |
| `revise_packaging_session` | 1 test (below-committed rejection) | **+16 tests** (`revise-packaging-session.test.ts`) |

Integration suite: **36 files / 239 tests → 38 files / 280 tests**, all passing.

Highlights of what is now pinned:

- **`debit_bin_inventory`**: the exact-sellout boundary (`old = qty` lands at 0
  but is NOT a clamp) versus a true oversell; clamping at zero instead of
  violating `chk_bin_inventory_quantity_nonneg`; refusal of a negative quantity
  (which would silently CREDIT the bin through the `GREATEST`); the
  missing-row defensive path returning a full clamp without resurrecting the
  row; and that only the addressed `(bin, finished_good)` pair moves.
- **Keg netting**: the conservation invariant — kegs received must always equal
  empty + filled + shipped. That is the only assertion that catches the
  `HAVING sum > 0` failure mode behind migrations 00228/00229/00232/00234/00238,
  where a stranded outflow is silently dropped and the fleet inflates with no
  error. Includes the 00238 owner re-attribution case (fill owner NULL, ship
  owner named → fleet stays 50, not 62) and its other half, that customer
  deposits still key on the raw stamp.
- **`revise_packaging_session`**: every input-validation refusal (unknown
  session, never-completed session, empty payload, missing `line_item_id`,
  cross-session line item, negative/fractional quantity, no-op), each asserting
  the rows are unchanged afterwards; plus the revalue-down/up paths, the audit
  note, re-revision of an already-`revised` session, and the status flip itself
  — the mechanism behind the `revised` live outage cited in backlog item 22.

Every refusal test drives the function to the actual rejection and then reads
the rows back. No test asserts that a function exists or that policy text
matches a string.

## DB bug found — issue #917

**`enum_values` registry drift blocks keg receive/ship on any from-scratch database.**
<https://github.com/energee/mgr/issues/917>

The `enum_values` registry for `keg_transaction_type` (seeded by
`00037_enum_registry.sql`) holds a vocabulary that never matched the Postgres
enum:

```
pg enum:   receive, fill, ship, return, clean, adjust, retire, maintain
registry:  fill, deliver, return, tap, empty, adjust, lost, found
```

The 00040 `validate_enum_value` trigger validates against the registry, so
`receive`, `ship`, `clean`, `retire` and `maintain` are all rejected:

```
ERROR:  Invalid keg_transaction_type value: receive. Valid values are: fill, deliver, return, tap, empty, adjust, lost, found
```

Impact: a keg fleet cannot be received into a chain-replayed database at all,
and `create_keg_ship_transactions_from_order` cannot insert its ship legs — so
fulfilling an order with keg line items aborts. This is very likely why keg
netting had no integration coverage: the scenario was unreachable. Live is
evidently hand-patched, so this is chain-vs-live drift rather than a live
outage, but it means the chain is not reproducible.

Not fixed here (tests-only scope). `keg-netting.test.ts` seeds the missing
registry rows inside its own transaction via `seedEnumRegistry()`, loudly
commented as compensating for #917 — **delete it when #917 lands**, and if the
tests then fail, the fix is incomplete.

## Verification

- **Integration suite: GREEN.** 38 files / 280 tests passing.
  ```
  make db-local     # once, if you have no local DB
  DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' bun run test:integration
  ```
  The local database was already running and fully migrated (274 migrations,
  role fixtures seeded), so no `make db-local` reset was performed — it is
  shared infrastructure and the reset is destructive.
- **`make check`: GREEN** (lint + typecheck + unit suite + check-db + check-wip +
  check-deploy-state + build). Lint required the repo's `interface` → `type`
  convention on the added files.

  Worth recording, because the first diagnosis was wrong. `make check` initially
  failed with 11 unit files / 22 tests erroring on `Cannot find package 'pino'
  imported from src/lib/logger.ts`. `pino@10.3.1` was declared in `package.json`
  and resolved fine from Node, and this branch touches no tracked source file, so
  it was written up as pre-existing and unrelated to the change. **That was
  wrong.** The worktree simply had an incomplete `node_modules` — a
  fresh-worktree artifact, not a repository problem. `bun install` in the
  worktree (1150 packages) fixed it and `make check` passed with no code change.

  Two other sessions hit the identical 22-test / 11-file pino signature in
  freshly created worktrees the same day, with the same fix. **Run `bun install`
  in a new worktree before concluding anything about a pino resolution
  failure**: the "declared, resolves from Node, fails only under vitest"
  combination looks like a toolchain bug and is not one. "My diff cannot have
  caused this" is evidence about the diff, not evidence that the environment is
  sound.

## Not reached

- **Concurrency coverage.** `create_keg_ship_transactions_from_order` takes a
  transaction-scoped advisory lock and `debit_bin_inventory` row-locks
  `FOR UPDATE`; neither is exercised under contention. The
  `beginBounded` two-connection pattern in `inventory-guard-concurrency.test.ts`
  is the right model.
- **Ship-writer idempotency and brand-scoped FIFO ordering.** The
  per-`(selling_format, keg_owner)` idempotency guard and the
  `ORDER BY oi.brand_id NULLS LAST` / production-date FIFO tiebreak (00234) are
  untested; only the single-lot draw is covered.
- **The `revise_packaging_session` keg and BOM arms.** The revision paths that
  rewrite keg transactions and re-drive BOM material consumption are untested —
  the new suite covers package-container lines with no BOM rows.
- **The 00232(b) stranded-outflow negative case.** Omitting `from_location_id`
  on a fill silently strands the empty-pool decrement. Worth a characterization
  test; not written.
