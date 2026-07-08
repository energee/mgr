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

## Milestone D — Inbound: debit bins from Square sales
*Depends on: C1 (bin ↔ Square location) + B1 (`sellable_inventory`) + A (keg bin-tracking, for keg pours). Owner: integrations-expert + data-layer-expert.*

**Current state:** the `payment.completed` webhook (`src/app/api/square/webhook/route.ts`) already ingests sales. Packaged goods create a completed `taproom_sale` **allocation** against a finished good chosen by FIFO across **all** stock (`finished_goods_with_availability`), **not bin-scoped**; draft/keg lines are **staged in `square_draft_sales` with no debit**. Signature verify + replay-window + `event_id` dedup (`square_sync_log` unique constraint) are already solid and must be preserved.

- **D0. Spike — `bin_inventory` vs the allocation ledger.** Determine whether a `taproom_sale` allocation already flows to the physical `bin_inventory` count (trigger?) or the two are independent, and define the canonical rule: a Square sale (a) decrements `bin_inventory` directly, (b) writes an allocation a trigger applies to the bin, or (c) both with a double-count guard. *Acceptance:* documented rule; no double-count path. **Start immediately (read-only).**
- **D1. Resolve sale → bin.** In the packaged branch, resolve the Square location to its POS bin (via C1's `bins.square_location_id`) and pick the finished good **within that bin** (FIFO by production date over `bin_inventory` ⋈ FG), replacing today's global lookup. *Acceptance:* a sale at a Square location targets that bin's stock; unit test with a mocked order + mapped bin.
- **D2. Debit `bin_inventory`.** Decrement the resolved bin's FG quantity by the sold qty (per D0's rule), keeping the existing `event_id` dedup + `square_sync_log`. *Acceptance:* bin count drops by the sale qty; idempotent on Square retry; `bun test`.
- **D3. Oversell policy.** Decide sale-qty > bin-qty handling — clamp-to-zero + flag, allow negative, or reject (mirror the #357 outbound-guard call). *Acceptance:* chosen policy enforced + tested.
- **D4. Keg pour depletion.** Apply `square_draft_sales` pours as **volume depletion** against the tapped filled keg in the mapped bin (needs Milestone A keg bin-tracking + a "remaining oz in tapped keg" concept). Keg flips to `empty` (keg transaction) when remaining oz hits zero. *Acceptance:* a pour reduces the tapped keg's remaining volume; empties at zero; documented.
- **D5. Settlement of staged draft sales.** Pre-D4 `square_draft_sales` rows stay as an audit trail; a one-time settlement is out of scope for v1. *Acceptance:* note recorded.

---

## Parallelism & sequencing
- **Sequence:** PR #344 merge → **A** → **B** (after B0 spike) → **C** → **D** (after C1 + B1; D4 also needs A). B0 and D0 spikes can start immediately (read-only).
- **Within a milestone:** type-regen + UI tasks parallelize behind their migration. A5 (keg UI) parallels A4. C3/C4 parallel each other; C6 waits on C1/C3/C4. D1–D3 (packaged debit) parallel D4 (keg pours).
- **Independent now:** B0 + D0 spikes, and C4 (pricing generalization is behavior-preserving and can be prepped/tested against the current routes before C5).

## Out of scope (v1)
- Square per-location **price overrides** (single price now).
- Automatic/scheduled sync (stays manual-trigger as today).
- Non-keg returnable-asset modeling changes beyond adding `bin_id`.

## Approval gate
Per the two-phase process: **stop here for approval.** On approval, Phase 2 executes per-task with `tsc --noEmit` + relevant tests after each, migrations applied only in this branch/worktree, and the live-drift snapshot regenerated + verified after each migration lands live.

---

## Continuation prompt (paste into a fresh session to resume)

> I'm resuming the Square POS bin-sync + keg-bin-tracking work. The Phase-1 plan is on branch **`feat/square-pos-bin-sync`** at **`docs/plans/2026-07-07-square-pos-bin-sync.md`** (Milestones A–D, decisions locked). Read that plan first.
>
> **Before Phase-2 code, do the two read-only spikes and report findings back to me:**
> 1. **B0** — does filling a keg *deplete* the source `finished_goods` row (and its `bin_inventory`), or only reference it? (Trace `create_finished_goods_from_packaging`, `record_keg_transaction`, and what changes in `bin_inventory` on fill.) This decides whether `sellable_inventory = bin_inventory ∪ keg_filled_contents` double-counts.
> 2. **D0** — is `bin_inventory` decremented by a `taproom_sale` allocation today (trigger?), or is it an independent physical count? This decides how a Square sale debits the bin without double-counting.
>
> **Blockers / dependencies to resolve first:**
> - **PR #344** (`fix-audit-p2-integrity`, migration 00207) is a **hard dependency** (it creates `keg_filled_contents` + rewrites `keg_inventory`, which Milestone A extends). It's open and carries an extra commit `5cf07031 "add corrected live-catalog snapshot…"` that a prior session did not author — confirm who made it, then finish merging #344.
> - **PR #348** (`fix-audit-vessel-integrity`, migration 00210) is held; decision made = **"free the source vessel on full-remainder loss"** (implement in `src/components/domain/batch/vessel-transfer-dialog.tsx` + `record-loss-dialog.tsx` — free the vessel when a recorded loss brings the source to 0). Not yet built.
>
> Then propose the Phase-2 execution order (I expect: resolve #344 → Milestone A → B → C → D), and confirm the open decisions (D3 oversell policy; A6 backfill) with me before writing migrations. Follow repo rules: `bun lint && bun typecheck && bun test` before any commit; migrations `00219+`; regenerate + verify the live-drift snapshot after each migration lands live; expert agents per `CLAUDE.md`.

---

## Phase-2 continuation prompt (spikes DONE — paste into a fresh session to resume EXECUTION)

> Resume the Square POS bin-sync feature — **Phase 2 (execution)**. Branch **`feat/square-pos-bin-sync`**, plan **`docs/plans/2026-07-07-square-pos-bin-sync.md`**, tracking **PR #360**, status in **`PROGRESS.md`** (read the `2026-07-08` entry). Read the plan + that entry first.
>
> **Spikes are DONE — findings locked (do NOT re-derive):**
> - **B0:** nothing writes `bin_inventory` (no trigger/RPC/app-write/seed; only a version-bump trigger; live = 0 rows). Kegs are never in `bin_inventory`. **Union rule** → `sellable_inventory = (bin_inventory JOIN fg JOIN selling_formats JOIN containers WHERE container.type <> 'keg') UNION ALL keg_filled_contents`. The `<> 'keg'` filter is the entire double-count guard.
> - **D0:** `finished_goods_with_availability.available = fg.quantity − Σ(planned+completed allocations)` (00191), independent of the physical `bin_inventory` count. A `taproom_sale` allocation does NOT debit `bin_inventory`. **D2 must explicitly decrement** the resolved bin; the allocation stays as the audit/TTB ledger (no double-count — only one path writes `bin_inventory`).
>
> **CONFIRM THESE TWO before writing any migration:**
> 1. **PR #344 merge** — conflicts are only 2 non-code files (backlog doc + `live-catalog.snapshot.txt`); `00207` + all code merge clean; `5cf07031` is a benign snapshot-only commit (authored by claude[bot], co-author Ted). Resolve (take main's snapshot + merged doc) and merge to main? (Unblocks Milestone A.)
> 2. **D3 oversell** — sale qty > bin qty: **clamp-to-zero + flag** (rec, mirrors #357) / allow-negative / reject.
> (**A6 = NULL / no backfill** already decided.)
>
> **Execution order:** #344 merge → **A0** → A → B → C → D. C4 (pricing generalization, behavior-preserving) preppable in parallel; PR #348 independent.
>
> **Migration renumbering (A0 inserted before the original plan):** A0 = **`00219`**, A = `00220`, B = `00221`, C = `00222` (verify head after #344's `00207` lands — it fills the 00207 gap so the top stays 00218 → next-free 00219).
>
> **Milestone A0 (NEW prerequisite — build FIRST; it's what populates `bin_inventory`):**
> - Migration `00219_bin_placement.sql`: add `packaging_sessions.default_bin_id uuid REFERENCES bins(id)` + `bins.is_default_fg boolean` with partial-unique index `(location_id) WHERE is_default_fg`.
> - `AFTER INSERT ON finished_goods` trigger `place_finished_good_in_bin()` — **non-keg FGs only** (guard `container.type <> 'keg'`), **same-transaction** INSERT into `bin_inventory` (atomic → cannot orphan; also fires on `revise_packaging_session`'s FG inserts). Bin resolution order: `session_line_items.target_bin_id` (future/NULL now) → `packaging_sessions.default_bin_id` → location's `bins.is_default_fg` → else `RAISE`. `ON CONFLICT (finished_good_id, bin_id) DO NOTHING`. **DECIDED: on a missing session bin, fall back to the location-default bin — never hard-block the brewer; session-level grain.**
> - Extend `revise_packaging_session` to mirror `fg.quantity` deltas onto the production bin's `bin_inventory.quantity` (same txn). Reversibility of full teardown is free via existing `bin_inventory … ON DELETE CASCADE`.
> - Owners: data-layer-expert (migration/trigger/revise-mirror) + entity-architect/ui-systems-expert (packaging-session bin picker; `is_default_fg` toggle on the bin entity). test-surgeon: characterization for the trigger (placement, keg-skip, fallback, RAISE-on-no-bin) + the revise mirror.
>
> Then **A** (keg bin dimension, `00220` — `from_bin_id`/`to_bin_id` on `keg_transactions`, extend `record_keg_transaction`, surface `bin_id` on `keg_inventory`/`keg_filled_contents`), **B** (`sellable_inventory` view, `00221`, per the B0 union rule), **C** (bin POS config + `square_locations` + channel pricing + rewrite sync routes off `sellable_inventory`, `00222`), **D** (webhook: resolve Square location→bin, debit `bin_inventory` per D0/D3, keg pours per D4).
>
> **Repo rules:** `bun lint && bun typecheck && bun test` before every commit; regenerate `src/types/supabase.ts` after each migration; regenerate + verify the live-drift snapshot after each migration lands live; expert agents per `CLAUDE.md`; **NEVER Co-Authored-By**.
