# Square bin-sync — code-review follow-ups

**Status:** open. Created 2026-07-09 after an xhigh `/code-review` of `feat/square-pos-bin-sync`
(15 findings). Thirteen findings were fixed in `506f9daf`, `cf795a80`, `b4ee38d4`. This doc
tracks what remains, with a resolution for each and a paste-in kickoff prompt at the bottom.

Branch: `feat/square-pos-bin-sync` · PR [#361](https://github.com/energee/mgr/pull/361)

---

## 1. Keg-only brands still deleted-and-recreated on stockout (REGRESSION)

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

- *Preferred:* make discontinuation explicit. Check whether `brands` already carries an
  `is_active` / `is_discontinued` column (grep the schema; do not assume). If it does,
  `deleteStaleItems` should key off it and delete only explicitly-inactive brands. Stock level
  stops being an input.
- *Lazy fallback, if no such column exists:* union the keep set with every brand that has any
  `finished_goods` row whose `selling_format → containers.type = 'keg'`. That means "this brand
  is sold on draft," independent of current inventory. Pair it with a `// ponytail:` comment —
  the ceiling is that a genuinely discontinued keg brand must be removed from Square by hand.

Add a test: a keg-only brand with zero filled kegs survives a catalog sync.

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

## 3. `00223`'s header and function comment are now false

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

## 5. Cleanup: `location/core.ts` vestiges

`src/entities/location/core.ts`:
- line 65 — `viewTable: "locations"` is identical to `table: "locations"`, which is exactly what
  the engine falls back to (`entity-service.ts`: `entity.viewTable ?? entity.table`). It reads
  as "this entity has a computed view" when `00222` dropped `locations_with_pos`.
- line 23 — `export type LocationWithPos = Location` is a pure forwarding alias with no external
  importers (only the location triad itself).

**Resolution.** Delete the `viewTable` line. Replace `LocationWithPos` with `Location` in
`core.ts`, `presentation.tsx`, and `index.ts`, and drop the alias.

---

## 6. Cleanup: the `makeAdmin` Supabase mock is duplicated five times

`webhook-route.test.ts`, `refresh-route.test.ts`, `sync-routes.test.ts`, `catalog.test.ts`,
`pricing.test.ts` each define their own chainable in-memory admin-client builder plus its
`QueryResult` / `TableData` types. The review found four copies; `cf795a80` added a fifth.

**Resolution.** Extract one shared helper — `src/integrations/square/__tests__/mock-admin.ts`
(or `src/test/`, matching whatever `src/test/supabase-mock.ts` already does — read it first;
it may already cover this). Import it from all five. The variants differ in which builder
methods they stub (`.not`, `.in`, `.gt`, `.limit`, `.maybeSingle`, `.upsert`), so the shared
builder needs the union of them.

---

## 7. Branch hygiene

`feat/square-pos-bin-sync` forked at `c3dba263` and is two commits behind `origin/main`.
Merging `origin/main` in conflicts in three files:

- `PROGRESS.md`
- `docs/plans/2026-07-07-square-pos-bin-sync.md`
- `src/entities/bin/core.ts`

`00210_vessel_transfer_integrity.sql` and `vessel-transfer-dialog.tsx` are **not** reverted by a
merge — the branch never touches them, so git keeps `origin/main`'s copies. A two-dot
`git diff origin/main` makes it *look* like they are deleted; that is a diff artifact, not a
merge outcome. Do not "restore" them.

**Resolution.** Merge `origin/main` before pushing. Resolve the three conflicts by hand.

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

```
We're on branch feat/square-pos-bin-sync in /Users/tedslesinski/Repos/mgr (PR #361).
An xhigh code review found 15 defects in the Square POS <-> bin inventory sync. Thirteen are
fixed in commits 506f9daf, cf795a80, b4ee38d4. Read docs/plans/2026-07-09-square-review-followups.md
first — it has the full context and the resolution for each remaining item.

Do these, in this order:

1. Fix the keg-only-brand regression (section 1 of that doc). This is the only item with real
   design in it. sync/catalog/route.ts infers "discontinued" from current stock, but kegs are
   never in bin_inventory and keg_filled_contents is positive-only, so a draft-only brand loses
   its Square catalog objects the moment its last keg blows. First grep the brands table for an
   is_active / is_discontinued column; if one exists, make deleteStaleItems key off it and stop
   inferring from stock entirely. If not, fall back to keeping any brand with a finished_goods
   row whose selling_format -> containers.type = 'keg', and mark it with a ponytail: comment.
   Add a test: a keg-only brand with zero filled kegs survives a catalog sync.

2. Correct the false prose in 00223_debit_bin_inventory.sql — the header block and the
   COMMENT ON FUNCTION string both claim event_id idempotency and a single bin_inventory writer.
   Comments only. Do NOT touch its DDL; it is already applied live.

3. Clean up src/entities/location/core.ts (section 5): drop the redundant viewTable line and
   inline the LocationWithPos alias across the triad.

4. Extract the duplicated makeAdmin Supabase test mock into one shared helper (section 6). Read
   src/test/supabase-mock.ts first — it may already do this. Five test files currently each
   define their own.

5. Merge origin/main into the branch. Expect conflicts in PROGRESS.md,
   docs/plans/2026-07-07-square-pos-bin-sync.md, and src/entities/bin/core.ts. 00210 and
   vessel-transfer-dialog.tsx are NOT reverted by the merge — do not "restore" them.

Gates before every commit: bun run lint, bun run typecheck, bun run test (vitest — never
`bun test`). No Co-Authored-By lines. Commit each item as its own logical unit.

Do NOT run `supabase db push` — ask me first. Migrations 00224-00227 are committed but
unapplied, and the deployed webhook is broken until 00224 lands (it upserts a
square_payment_id column that does not exist yet). When we do push, it's
`supabase db push --include-all`, then regenerate src/types/supabase.ts from live (it was
hand-edited) and regenerate the drift snapshot.

Do NOT touch the four items under "Deferred on purpose" in that doc.
```
