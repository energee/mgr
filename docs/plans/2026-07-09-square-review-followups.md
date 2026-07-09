# Square bin-sync — code-review follow-ups

**Status:** all code follow-ups DONE; **one operational item remains (§2, the migration push).**
Created 2026-07-09 after an xhigh `/code-review` of `feat/square-pos-bin-sync` (15 findings).
Thirteen were fixed in `506f9daf`, `cf795a80`, `b4ee38d4`; the rest were worked 2026-07-09:

| § | Item | Outcome |
|---|---|---|
| 1 | keg-only-brand keep-set regression | **FIXED** `593dedaa` |
| 2 | `00224`–`00227` committed but unapplied | **OPEN — blocks deploy** |
| 3 | `00223` header + `COMMENT ON FUNCTION` false | **FIXED** `b35ad3b7` |
| 4 | `00222` `DISTINCT ON` without `ORDER BY` | won't fix (recorded) |
| 5 | `location/core.ts` vestiges | **FIXED** `c9d94e6b` |
| 6 | `makeAdmin` duplicated 5× | **FIXED** `c9cc8c8e` |
| 7 | branch behind `origin/main` | **MERGED** `3dea7bd6` |

Branch: `feat/square-pos-bin-sync` · PR [#361](https://github.com/energee/mgr/pull/361)

---

## 1. Keg-only brands deleted-and-recreated on stockout — FIXED (`593dedaa`)

**Severity:** high. Introduced by the fix for review finding #11, which only protected
packaged brands.

`src/app/api/square/sync/catalog/route.ts` builds `keepBrandIds` as the union of
(a) `activeBrandIds` — brands currently in `sellable_inventory`, and
(b) brands with any `bin_inventory` row at a POS bin, quantity unfiltered.

Kegs are never in `bin_inventory` — that is the explicit double-count guard in `00221`
(`WHERE c.type <> 'keg'`). And `keg_filled_contents` is positive-only. So a draft-only brand
is in the keep set *only while it has beer*. The moment its last keg blows, `deleteStaleItems`
treats it as discontinued and destroys its Square item, variations, images, modifier lists,
and Item-Sales reporting continuity. It returns as a fresh Square object with a new id.

The route's own comment already names the hole: *"UNIONed with the currently in-stock brands
(which also covers filled kegs, whose contents view is positive-only)."*

**Resolution.** Stop inferring "discontinued" from stock at all — that is the altitude error.

- *Preferred:* make discontinuation explicit via an `is_active` / `is_discontinued` column on
  `brands`. **Checked: no such column exists.** `brands` is `(id, name, sku, variant, style_id,
  abv, hops, description, untappd_rating, untappd_url, created_at, updated_at)`. So the preferred
  route needs a migration and was not taken.
- *Applied (the lazy fallback):* the keep set now unions every brand sold on draft, independent
  of stock. Read off `finished_goods_with_ttb_class` — an existing view that is exactly
  `finished_goods ⋈ selling_formats ⋈ containers` with **no quantity filter** — via
  `.select("brand_id").eq("container_type", "keg")`. One flat query, no embed. Carries a
  `// ponytail:` comment naming the ceiling (a genuinely retired draft brand must be removed
  from Square by hand) and the upgrade path (add `brands.is_active`, key the whole keep set off
  it, drop stock inference entirely).

Test added in `sync-routes.test.ts`: *"keeps a KEG-ONLY brand whose last keg blew"* — brand-2 has
zero stock and no `bin_inventory` row, appears in no other fixture, and must still land in the
keep set passed to `deleteStaleItems` while being absent from the catalog push.

---

## 2. Migrations are committed but never applied, and their assertions never ran

`00224`–`00227` exist only as files. The deployed webhook (`506f9daf`) upserts
`square_sync_log.square_payment_id` with `onConflict: "square_payment_id"`; without `00224`
that column does not exist and **every Square sale fails at the dedup claim**.

Each migration ends in the repo's self-rolling-back `DO $$` block, but no database was
available when they were authored — the assertions are reviewed-by-construction, not proven.
`00226` asserts that place-10 → debit-3 → revise-to-12 lands the bin at 9; `00227` asserts a
packaging-filled keg surfaces in `sellable_inventory` with a resolved bin. Expect the first
real execution to be the push.

**Resolution.** `supabase db push --include-all` (the `--include-all` flag is always required
here). Watch for `ASSERT_FAIL` from each verification block; a failure aborts the migration by
design. Then regenerate `src/types/supabase.ts` from the live database — it was **hand-edited**
in `b4ee38d4` (`square_sync_log.square_payment_id`, plus `bins_with_summary.square_location_id`
/ `pos_sales_channel_id` / `is_default_fg`) and should not be trusted until regenerated.
Regenerate the drift snapshot too.

---

## 3. `00223`'s header and function comment are now false — FIXED (`b35ad3b7`)

`00223_debit_bin_inventory.sql` still states that idempotency comes from the webhook's
`event_id` dedup (it now comes from payment-id dedup, `00224`) and that "only this path writes
`bin_inventory`, so keeping both is not a double-count" (`revise_packaging_session` is a second
writer — that is precisely what `00226`(A) fixes).

`00226` supersedes the `COMMENT ON FUNCTION` in the database, but the file still misleads the
next reader.

**Resolution.** Correct the prose comments in `00223` — the header block and the
`COMMENT ON FUNCTION` string. **Comments only; do not touch its DDL**, which is already applied
live. Point both at `00224` (payment-id idempotency) and `00226` (the two-writer fix).

---

## 4. `00222` seeds `square_locations` with `DISTINCT ON` and no `ORDER BY`

`00222_square_bin_pos_config.sql:135`. Postgres permits this but the surviving row is arbitrary,
so the seeded `name` for a duplicated `square_location_id` is non-deterministic. Verified as
PLAUSIBLE, low consequence: it is a one-time seed, `ON CONFLICT DO NOTHING`, the migration then
drops `locations.square_location_id`, and the first live `POST /api/square/locations/refresh`
overwrites the name from Square.

**Resolution.** Leave it. Not worth a migration. Recorded here so it isn't rediscovered.

---

## 5. Cleanup: `location/core.ts` vestiges — FIXED (`c9d94e6b`)

`src/entities/location/core.ts`:
- line 65 — `viewTable: "locations"` is identical to `table: "locations"`, which is exactly what
  the engine falls back to (`entity-service.ts`: `entity.viewTable ?? entity.table`). It reads
  as "this entity has a computed view" when `00222` dropped `locations_with_pos`.
- line 23 — `export type LocationWithPos = Location` is a pure forwarding alias with no external
  importers (only the location triad itself).

**Resolution.** Delete the `viewTable` line. Replace `LocationWithPos` with `Location` in
`core.ts`, `presentation.tsx`, and `index.ts`, and drop the alias.

---

## 6. Cleanup: the `makeAdmin` Supabase mock is duplicated five times — FIXED (`c9cc8c8e`)

`webhook-route.test.ts`, `refresh-route.test.ts`, `sync-routes.test.ts`, `catalog.test.ts`,
`pricing.test.ts` each define their own chainable in-memory admin-client builder plus its
`QueryResult` / `TableData` types. The review found four copies; `cf795a80` added a fifth.

**Resolution.** `src/test/supabase-mock.ts` does **not** already cover this — it queues one
response per `.from()` call and throws when dry, records no writes, and stubs no
`.rpc`/`.upsert`/`.delete`/`.maybeSingle`. Twenty-plus tests depend on that contract, so it was
left alone.

Extracted a sibling instead: **`src/test/supabase-admin-mock.ts`** (`makeAdminMock`) — one
response per *table*, reused across `.from()` calls, plus a write log and an `.rpc` recorder.
Imported by all five. Fidelity was preserved rather than flattened: a table's response may be a
*function* of the chain built on its builder, so `pricing.test.ts` still honors
`.in("sales_channel_id", […])` and `webhook-route.test.ts` still simulates
`UNIQUE(square_payment_id)` by advancing a claim queue on `upsert` (keyed on the write ops, so
the finalize `UPDATE` and failure-path `DELETE` on the same table leave the queue alone).
`pricing.test.ts` keeps its throw-on-unexpected-table via `onUnknownTable: "throw"`.

---

## 7. Branch hygiene — MERGED (`3dea7bd6`)

`feat/square-pos-bin-sync` forked at `c3dba263` and was two commits behind `origin/main`:
`#348` (vessel-transfer integrity) and `#360` — which is a **squash of an earlier slice of this
same branch**. The merge conflicted in seven files, not three; the extra four are all
Square code where our side is simply the later revision of its own ancestor:

`PROGRESS.md`, `docs/plans/2026-07-07-square-pos-bin-sync.md`, `src/entities/bin/core.ts`,
`src/entities/location/core.ts`, `src/integrations/square/pricing.ts`,
`src/app/api/square/sync/{catalog,inventory}/route.ts`,
`src/app/api/square/sync/__tests__/sync-routes.test.ts`,
`src/integrations/square/__tests__/pricing.test.ts`

All resolved to **ours**, but only after checking per file that `origin/main` contributes no line
absent from `HEAD` (`git diff HEAD origin/main -- <file>`). The two that looked risky both came
back clean: main's `resolveChannelPrices` is still the single-channel C4 signature our E3 batch
rewrite replaced, and main's `bins.is_default_fg` addition is already on this branch. Note
`git checkout --ours` takes the *whole* HEAD file, discarding main's cleanly auto-merged hunks —
verify before reaching for it.

`00210_vessel_transfer_integrity.sql` and `vessel-transfer-dialog.tsx` were **not** reverted, as
predicted: git kept `origin/main`'s copies (`A` and `M` in the merge index, dialog byte-identical
to main). A two-dot `git diff origin/main` makes them *look* deleted; that is a diff artifact.

---

## Deferred on purpose (do not "fix" these)

- **`bin_inventory` counter drift.** Only the Square sale path decrements it; order
  fulfillment, samples, and losses write the allocation ledger instead. `00226`(B) clamps
  `sellable_inventory` to `LEAST(bin count, ledger availability)`, which kills the oversell.
  The counter itself still drifts high in the bin UI. The deep fix — a bin dimension on
  `allocations`, deriving per-bin availability the way `finished_goods_with_availability`
  derives FG availability — was consciously declined. A `ponytail:` comment in `00226` names it.
- **Per-bin inventory pushes run under `Promise.all`,** not concatenated into one
  `pushInventoryCounts` call. `pushInventoryCounts` reports errors keyed only by
  `catalogObjectId`, so a single call cannot attribute a failure back to a bin for the per-bin
  `square_sync_log` rows.
- **The `binOrder` / `binIndex` tie-break in the catalog route stays.** It looks like YAGNI, but
  the stock query has no bin ordering, so removing it would let the chosen channel flip between
  syncs on DB row order and churn the Square catalog.
- **Hardcoded `currency: "USD"`** in `catalog.ts`. Correct-by-context: single-tenant app whose
  domain layer computes TTB reports in US barrels. Reviewed and refuted as a defect.

---

## Kickoff prompt for a new session

The five code follow-ups shipped on 2026-07-09 (see the table at the top). What remains is §2,
and it is a database operation, not a code change.

```
We're on branch feat/square-pos-bin-sync in /Users/tedslesinski/Repos/mgr (PR #361).
The code follow-ups from docs/plans/2026-07-09-square-review-followups.md are all done and the
branch is merged up to origin/main. One item is left: §2, applying migrations 00224-00227.

THE BRANCH IS NOT DEPLOYABLE UNTIL THIS LANDS. The webhook upserts
square_sync_log.square_payment_id, a column that only exists in unapplied 00224, so every Square
sale currently fails at the dedup claim.

1. `supabase db push --include-all` (the flag is always required here). Each migration ends in a
   self-rolling-back DO block whose assertions have NEVER run against a real database — no DB was
   available when they were authored. Expect this push to be their first execution. Watch for
   ASSERT_FAIL; a failure aborts the migration by design. 00226 asserts place-10 -> debit-3 ->
   revise-to-12 lands the bin at 9; 00227 asserts a packaging-filled keg surfaces in
   sellable_inventory with a resolved bin.
2. Regenerate src/types/supabase.ts from live. It was HAND-EDITED in b4ee38d4
   (square_sync_log.square_payment_id, plus bins_with_summary.square_location_id /
   pos_sales_channel_id / is_default_fg) and should not be trusted until regenerated.
3. Regenerate the drift snapshot.
4. Gates: bun run lint, bun run typecheck, bun run test (vitest — never `bun test`).
   No Co-Authored-By lines.

Do NOT touch the four items under "Deferred on purpose" in that doc.
```
