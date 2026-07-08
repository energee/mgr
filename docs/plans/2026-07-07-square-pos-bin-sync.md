# Square POS per-bin sync + keg bin-tracking + unified sellable inventory

**Status:** Phase 1 — PLAN (no implementation). Awaiting approval.
**Date:** 2026-07-07
**Owners:** `integrations-expert` (Square), `data-layer-expert` (migrations/views/RLS), `brewing-domain-expert` (keg fleet), `entity-architect` + `ui-systems-expert` (bin/keg entities + settings UI).

---

## Goal (settled with the user)

Make Square POS sync driven by **bins** instead of the current location-level, two-column setup, with a **selectable sales channel per bin** for pricing, and Square locations **pulled live from Square**. Along the way, give the keg fleet a **bin dimension** (empties included) and unify "sellable product on hand" into a **single read model** so kegs and packaged goods are treated uniformly.

### Decisions locked
- **Config lives on the bin.** A bin optionally carries `square_location_id` + `pos_sales_channel_id`; a bin with both set is a POS target. `locations.square_location_id` / `locations.pos_bin_id` are retired.
- **Bin ↔ Square location is 1:1.** Square locations are chosen from a picker populated by querying Square (`locations.list`), not pasted.
- **Sales channel is selectable, never hardcoded.** `resolveTaproomPrices()` becomes `resolveChannelPrices(brandIds, salesChannelId)`; "taproom" is just one selectable channel. Pricing is usually shared across bins (pick the same channel) but may differ per bin.
- **Single price now, per-location price overrides later.** One price per item variation (from its bin's channel). Square location-level price overrides are out of scope for v1.
- **Kegs are bin-tracked, empties included.** The keg ledger gains a bin dimension so the *whole on-premise fleet* lives in bins (empty-storage → fill → cold-room → ship). `bin_id` is **nullable** for off-premise states (a keg at a customer is in no bin).
- **Clean model = unify the read, not the tables.** Keep the keg ledger as the source of truth for the *vessel* (state/owner/deposit/location/bin); add a `sellable_inventory` view that UNIONs packaged FG + filled-keg contents so every downstream consumer (Square, sales, reports) reads one shape.

---

## Current state (what exists today)

- **Connection:** token in `system_settings` (`square_api_key`); `is_enabled` + sync timestamps in the `square_settings` singleton (`src/integrations/square/client.ts`).
- **Which locations sync:** every `locations` row with both `square_location_id` (text) and `pos_bin_id` (one bin) set.
- **Catalog push** `src/app/api/square/sync/catalog/route.ts`: per location, brands + selling-format variations from that location's single `pos_bin` (`bin_inventory`) + filled kegs at the location (`keg_filled_contents`, via PR #344). Prices from `resolveTaproomPrices()` — **hardcoded** to `sales_channels.code='taproom'`.
- **Inventory push** `src/app/api/square/sync/inventory/route.ts`: per location, counts `pos_bin` FG + filled kegs, resolves `square_catalog_map` variation IDs, pushes counts scoped to `square_location_id`.
- **Keg fleet:** `keg_transactions` (movement ledger, `from_location_id`/`to_location_id`) → `keg_inventory` / `keg_filled_contents` views. **No bin dimension.** `keg_filled_contents` carries `finished_good_id` + `brand_id`.
- **Entities (triads):** `src/entities/{bin,keg-transaction,keg-inventory,location,sales-channel}/`. Settings UI: `src/app/(app)/settings/integrations/page.tsx`.

### Hard dependency
- **PR #344 (migration 00207) must merge first.** It rewrote `keg_inventory` and created `keg_filled_contents`; Milestone A extends both. (PR #344 is currently open with a review fix + a live-catalog snapshot commit.)

### Migration numbering
Highest tracked on main is **00218**; next new migration is **00219**. Verify the head at build time (PRs #344/00207 and #348/00210 may land in between).

---

## Open verification (do this FIRST — it gates Milestone B)

**B0 spike — does filling a keg deplete the source finished_good, or only reference it?**
`keg_transactions.finished_good_id` links a filled keg to a `finished_goods` row. If a fill **depletes** that FG (removes it from `bin_inventory`), then `sellable_inventory = bin_inventory ∪ keg_filled_contents` is correct. If a fill only **references** the FG for brand identity while leaving it counted in a bin, a naive union **double-counts**. Resolve before writing the view.
- **Acceptance:** documented finding (trace `create_finished_goods_from_packaging`, `record_keg_transaction`, and how `bin_inventory` changes on fill) committed to this plan as an addendum, plus the resulting union rule.

---

## Milestone A — Keg fleet gains a bin dimension
*Depends on: PR #344 merged. Owner: brewing-domain-expert + data-layer-expert.*

- **A1. Migration `00219_keg_bin_tracking.sql`** — add `from_bin_id uuid REFERENCES bins(id)`, `to_bin_id uuid REFERENCES bins(id)` (both nullable) to `keg_transactions`; add FK indexes (mirror `00129`/`00136` pattern).
  *Acceptance:* `db push --include-all` applies; `\d keg_transactions` shows both columns + indexes; applied to live and snapshot reconciled.
- **A2. (same migration) `record_keg_transaction()`** — add `p_from_bin_id uuid`, `p_to_bin_id uuid` params (default null, appended to signature to avoid breaking positional callers) and persist them.
  *Acceptance:* function replaces cleanly; existing callers still type-check; new params optional.
- **A3. (same migration) extend `keg_inventory` + `keg_filled_contents` views** — surface current `bin_id` (derived from the latest transaction's `to_bin_id`, same way current location is derived) and add `bin_id` to the `keg_inventory` grouping. Builds on PR #344's view definitions.
  *Acceptance:* both views expose `bin_id`; netting still holds (re-run #344's receive→fill→ship proof); live-catalog snapshot regenerated (views not captured, but functions are).
- **A4. Regenerate `src/types/supabase.ts`** (`supabase gen types`).
  *Acceptance:* `bun typecheck` clean.
- **A5. Keg transaction UI** — add a bin selector (relation to `bins`, filtered to the transaction's location, nullable) to the keg-transaction create/fill/ship forms. Files: `src/entities/keg-transaction/{core.ts,presentation.tsx}`, and the fill/ship dialogs under `src/components/domain/inventory/`.
  *Acceptance:* forms let a user set from/to bin; `bun lint && bun typecheck`; characterization test via `test-surgeon` for the new field mapping.
- **A6. Backfill decision** — existing `keg_transactions` rows get `bin_id = NULL` (no lossy guessing). Document that pre-existing kegs show "no bin" until their next transaction.
  *Acceptance:* migration performs no destructive backfill; note in the migration header.

---

## Milestone B — Unified `sellable_inventory` read model
*Depends on: A3 (keg views carry bin_id) + B0 spike. Owner: data-layer-expert.*

- **B1. Migration `00220_sellable_inventory_view.sql`** — `CREATE VIEW sellable_inventory` = `UNION ALL` of (a) packaged FG from `bin_inventory` and (b) filled-keg contents from `keg_filled_contents`, common shape: `bin_id, location_id, brand_id, selling_format_id, finished_good_id, quantity, source ('packaged'|'keg')`. `security_invoker = true`.
  *Acceptance:* view returns the same totals as the two existing queries summed (no double-count — per B0); live values spot-checked; snapshot unaffected (views not captured).
- **B2. Regenerate types.** *Acceptance:* `bun typecheck` clean.
- **B3. (optional) read hook / entity** — expose `sellable_inventory` via `src/lib/query-keys.ts` + a hook for reuse beyond Square (sales, reports).
  *Acceptance:* key added via the central registry only; no hardcoded key arrays.

---

## Milestone C — Square per-bin config + channel pricing
*Depends on: B1 (reads sellable_inventory) + A. Owner: integrations-expert + entity-architect + ui-systems-expert.*

- **C1. Migration `00221_square_bin_pos_config.sql`** — add `square_location_id text` + `pos_sales_channel_id uuid REFERENCES sales_channels(id)` to `bins`; create `square_locations` (`square_location_id text PRIMARY KEY, name text, status text, synced_at timestamptz`). Migrate existing `locations.(square_location_id, pos_bin_id)` → the referenced bin, then `DROP` those two `locations` columns. RLS: `square_locations` readable by staff, writable by `integrations:manage`.
  *Acceptance:* existing POS config preserved on the bin; live-applied; snapshot reconciled (new table appears).
- **C2. Regenerate types.** *Acceptance:* `bun typecheck` clean.
- **C3. Square locations pull** — `listSquareLocations()` in `src/integrations/square/client.ts` (calls Square `locations.list`); route `POST /api/square/locations/refresh` (`withPermission("integrations:manage")`) upserting `square_locations`.
  *Acceptance:* refresh populates `square_locations` from a sandbox account; unit test with a mocked Square client.
- **C4. Channel pricing** — generalize `resolveTaproomPrices(brandIds)` → `resolveChannelPrices(brandIds, salesChannelId)` in `src/integrations/square/pricing.ts` (drop the `code='taproom'` lookup; take channel id from the caller). Update all callers.
  *Acceptance:* passing the taproom channel id reproduces today's prices byte-for-byte; unit test parametrized by channel.
- **C5. Rewrite sync routes** — `sync/catalog/route.ts` + `sync/inventory/route.ts` iterate **POS-configured bins** (`bins` with both `square_location_id` and `pos_sales_channel_id` set), read stock from `sellable_inventory` (single query, kegs + packaged), price via `resolveChannelPrices(brandIds, bin.pos_sales_channel_id)`, push to `bin.square_location_id`. Remove the two-query bin+keg reconciliation.
  *Acceptance:* a bin with a channel + Square location round-trips catalog + inventory to a sandbox Square location; `square_sync_log` keyed by bin; `bun lint && bun typecheck && bun test`.
- **C6. UI** — `src/entities/bin/presentation.tsx`: add a Square-location picker (relation to `square_locations`) + a `pos_sales_channel_id` relation to `sales-channel`. `src/app/(app)/settings/integrations/page.tsx`: a "Refresh Square locations" action + a per-bin POS-config surface (which bins push where, at which channel).
  *Acceptance:* a user can, end to end, refresh locations, pick one for a bin, pick its channel, and sync; `bun lint && bun typecheck`.
- **C7. `square_catalog_map`** — confirm the single-price model needs no location dimension (it does not for v1). Document that per-location price overrides (future) would add a location dimension here.
  *Acceptance:* note recorded; no schema change in v1.

---

## Parallelism & sequencing
- **Sequence:** PR #344 merge → **A** → **B** (after B0 spike) → **C**. B0 spike can start immediately (read-only).
- **Within a milestone:** type-regen + UI tasks parallelize behind their migration. A5 (keg UI) parallels A4. C3/C4 parallel each other; C6 waits on C1/C3/C4.
- **Independent now:** B0 spike, and C4 (pricing generalization is behavior-preserving and can be prepped/tested against the current routes before C5).

## Out of scope (v1)
- Square per-location **price overrides** (single price now).
- Automatic/scheduled sync (stays manual-trigger as today).
- Non-keg returnable-asset modeling changes beyond adding `bin_id`.

## Approval gate
Per the two-phase process: **stop here for approval.** On approval, Phase 2 executes per-task with `tsc --noEmit` + relevant tests after each, migrations applied only in this branch/worktree, and the live-drift snapshot regenerated + verified after each migration lands live.
