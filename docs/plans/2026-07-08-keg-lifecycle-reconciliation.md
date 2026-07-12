# Keg Lifecycle + Draft Reconciliation

> **Status:** design / planning. Supersedes the old Milestone **D4/D5** ("pours
> auto-deplete a virtual remaining-oz, flip keg to empty at zero") from
> `docs/plans/2026-07-07-square-pos-bin-sync.md`. **Not started.**
>
> **Prerequisite / sequencing:** ship Square **D1–D3** (packaged bin debit) first
> — it is independent of this epic and fixes a live bug (see the bottom of this
> doc for the D1–D3 kick-off prompt). This epic replaces D4/D5.
>
> **2026-07 update (audit BD-2/BD-3/BD-4, migration 00240):** a MINIMAL TTB
> bridge shipped separately and does not preempt this epic: staged
> `square_draft_sales` rows are converted into COMPLETED finished_good →
> taproom_sale allocations (brand-level FIFO over keg-format lots, fractional
> keg quantities, volume_oz/3968 bbl) by `api/square/reconcile-draft-sales`,
> marked via `square_draft_sales.reconciled_at`; per-variation pour size lives
> in `square_catalog_map.pour_size_oz`; keg rows are excluded from Square
> PHYSICAL_COUNT pushes. The per-keg QR/tap-window reconciliation below remains
> the full design — when it lands, it should subsume the brand-level FIFO
> source choice.

## Why this exists

A Square draft (keg pour) sale tells us **volume** (`square_draft_sales.volume_oz`),
a **brand/selling-format**, and a **location** — never *which physical keg* it came
from. The old D4 tried to make the continuous pour stream drive a discrete
"keg is empty" event by tracking a virtual remaining-oz and flipping at zero.

New model (decided with the user): **the physical keg swap is the source of truth**
for "this keg emptied," captured by a **bartender QR scan at swap time**. Draft
pours stay a **parallel ledger**. We **reconcile** the two — expected volume from
the emptied keg vs actual draft sales during its tap window — and surface the
variance (foam, comps, over-pour, shrinkage, theft).

## Decisions locked (with the user)

1. **Fill-instance QR.** A new QR label is printed **at packaging/fill time**, one
   per physical keg (an N-keg fill produces N labels). The label identifies *this
   fill* (brand, selling format, batch, fill date) — **not** a durable
   physical-asset id. No permanent keg-asset registry in v1. A scan resolves the
   **SKU** (brand) and **keg type/size** (1/2 BBL, 1/6 BBL…) straight from the
   fill's `selling_format → container`; we **do not snapshot a per-keg volume**.
2. **Taps are serving slots.** A **tap** belongs to a bin (the taproom
   cold-room/keg cooler) and holds **at most one active keg at a time**. The keg
   stays physically in the bin while on tap (lines run to the tap) — the binding
   is an overlay, it does not move the keg between bins.
3. **Swap scan = bind fresh keg → tap.** One scan does double duty: it **activates**
   the scanned keg (tap-on = now) and **closes** whatever keg it replaced on that
   tap (emptied = now). Tap windows fall out of consecutive scans automatically;
   `window = [bound_at, unbound_at]`.
4. **Keg states:** `filled` (backstock, a whole sellable keg) → `on_tap` (serving,
   being poured, **not** a whole sellable keg) → `empty`. **Binding requires a free
   tap;** filled kegs beyond the tap count wait as backstock.
5. **On-tap kegs leave whole-keg sellable inventory.** A half-poured keg must not
   be advertised to Square as a sellable whole keg. → **edits the shipped
   `sellable_inventory` / `keg_filled_contents` (Milestone C era) to exclude (or
   reclassify) `on_tap` kegs.**
6. **Reconciliation per keg (kept — the audit overlay).** expected = the keg's
   **size**, i.e. `containers.volume_oz` reached via `keg_fills.selling_format_id →
   container` — **no per-fill volume snapshot**; kegs are always filled whole, so
   size = volume exactly. actual = Σ `square_draft_sales.volume_oz` for that brand
   at that bin during the keg's tap window; variance = expected − actual. Exact
   per-keg for this brewery (they do **not** run the same brand on two taps at once,
   so brand → the one active keg is unambiguous). Pool-level fallback documented for
   same-brand multi-tap.
7. **Draft pours are never used to *decide* an empty** — only to compare. The scan
   is authoritative.

## Current schema reality (what exists today)

- **Kegs are tracked as fungible counts, NOT serialized.** `keg_transactions.quantity`,
  the netted `keg_filled_contents` view, and `keg_inventory_summary` all count kegs
  by `(selling_format/owner/state/location/bin)`. **There is no per-physical-keg
  identity** — introducing the fill-instance QR is the core new dimension.
- `keg_transaction_type` enum: `fill | ship | receive | empty | return` (from the
  `00037` enum registry; `empty` = "Mark keg as empty"). `keg_state` enum drives
  `from_state`/`to_state`. `keg_transactions` already carries `from_bin_id`/`to_bin_id`
  (00220) + `finished_good_id`.
- `containers.volume_oz` (and `volume_bbl`) give a keg's total volume; all kegs of a
  `(brand, selling_format)` share one container → **same volume**.
- `square_draft_sales`: `brand_id, selling_format_id, quantity, volume_oz,
  location_id (NOT NULL), sold_at, unit_price_cents, square_order_id,
  square_payment_id`. **No `bin_id` yet.**
- `sellable_inventory` (00221) = packaged FGs in bins `UNION ALL` `keg_filled_contents`;
  **counts every filled keg as sellable** (no on-tap distinction).
- Kegs are created by `create_finished_goods_from_packaging` (00183): one
  `finished_goods` row (keg selling format) + a `fill` `keg_transaction`. **The FG
  row carries a count (`quantity`), not N individual units** — so serialization means
  exploding a fill into N labeled units.
- Migration head is **`00222`**; next new migration = **`00223`** (verify at build
  time).

## The core architectural addition: serialized keg identity

The QR-per-fill requires exploding an N-keg fill into N identifiable units. Proposed
new table (name TBD):

```
keg_fills            -- one row per physical keg filled (a "fill instance")
  id                 uuid pk
  qr_token           text unique         -- printed on the label; scanned at swap
  finished_good_id   uuid -> finished_goods
  brand_id           uuid -> brands       -- the SKU (brand)
  selling_format_id  uuid -> selling_formats
  container_id       uuid -> containers   -- keg type/size (1/2 BBL, 1/6 BBL…);
                                          --   nominal volume via containers.volume_oz
                                          --   on demand — NOT snapshotted per fill
  bin_id             uuid -> bins         -- where it physically lives
  packaging_session_id uuid -> packaging_sessions
  state              text                 -- filled | on_tap | empty
  filled_at          timestamptz
  emptied_at         timestamptz null
```

Taps + bindings:

```
taps
  id        uuid pk
  bin_id    uuid -> bins        -- serving position lives at a bin
  label     text                -- "Tap 4"
  is_active boolean

-- binding as a column on taps (current keg) + history via a bindings table,
-- OR bindings as the event log with bound_at/unbound_at. Decide in K1.
keg_tap_bindings
  id           uuid pk
  tap_id       uuid -> taps
  keg_fill_id  uuid -> keg_fills
  bound_at     timestamptz
  unbound_at   timestamptz null   -- set when the next keg is scanned onto this tap
```

**Reconciliation** for a closed binding: `expected = containers.volume_oz` (the keg's
size, via `keg_fills.selling_format_id → container` — no per-fill snapshot); `actual =
Σ square_draft_sales.volume_oz WHERE brand_id = keg_fills.brand_id AND bin =
tap.bin_id AND sold_at ∈ [bound_at, unbound_at]`; `variance = expected − actual`.

## Milestones (rough — refine at build)

- **K0. Spike (read-only).** Confirm how `keg_filled_contents` nets an `'empty'`
  leg — does `record_keg_transaction('empty', …)` actually remove a keg from filled
  contents? (`'empty'` is tagged `affects_inventory:false` in the enum registry —
  a yellow flag.) Confirm `keg_state` values. This decides the flip mechanism and
  whether state lives on `keg_fills` vs is derived from transactions.
- **K1. Migration:** `keg_fills` (serialized fill instances) + `taps` +
  `keg_tap_bindings` + the `on_tap` state. Explode `create_finished_goods_from_packaging`
  (and the revise path) into N `keg_fills` rows. `00223+`.
- **K2. QR generation + label print** at packaging (token + printable label; wire
  into the packaging-session complete flow).
- **K3. Scan-at-swap flow** — bind a fresh keg to a tap (default UX: **scan tap,
  then scan keg**); auto-close the prior keg on that tap (state → empty, `unbound_at`,
  and a `record_keg_transaction('empty', from_bin_id=…)`).
- **K4. `sellable_inventory` edit** — exclude `on_tap` kegs from whole-keg sellable
  stock (touches the shipped 00221 view). Decide what a **taproom** Square location
  should show at all (whole kegs vs by-the-glass — see open questions).
- **K5. `square_draft_sales.bin_id`** — resolve inbound pours to a bin (like the
  packaged D1 path) so reconciliation can scope by bin.
- **K6. Reconciliation report** (per-keg + per-brand/period variance) + a live
  **"what's on tap now"** board (byproduct of taps + bindings).

## Open questions (resolve during build, not blockers now)

1. **Swap-scan UX:** tap-then-keg (2 scans, explicit, robust — **default**) vs
   keg-only (1 scan, must infer the tap — fragile). Do taps need their own QR
   stickers for the tap scan?
2. **Taproom Square semantics (K4):** does the taproom Square location sell **whole
   kegs** at all, or only **by-the-glass pours**? This decides whether on-tap kegs
   are merely *excluded* from sellable stock or the taproom bin syncs differently
   from a wholesale bin. (Milestone C currently treats all bins uniformly.)
3. **Same-brand multi-tap:** rare for this brewery; when it happens, reconciliation
   falls back to pool-level (Σ overlapping kegs vs brand pours over the combined
   window). Accept for v1?
4. **Fill vs permanent asset:** chose fill-instance labels. Note if durable
   physical-asset tracking (keg loss, cleaning cycles) is ever wanted — that's a
   different, bigger table.
5. **Return/clean cycle:** `empty → returned → cleaned → refilled` — out of scope
   for v1? (The existing `receive`/`return` keg transactions already cover the
   fungible-count side.)
6. **Label/printing infra:** format, printer, where the QR is affixed.
7. **Oversell / no-keg-on-tap pours:** a pour with no active keg (scan missed) —
   flag as an unreconcilable pour; do not fabricate a keg.

## Relationship to the Square feature

- **Square D1–D3** (packaged bin debit) is **independent** — ship it first (prompt
  below). It has no dependency on this epic.
- This epic **replaces D4 (draft keg depletion) and D5 (draft-sale settlement)** from
  the `2026-07-07` plan.

---

## Immediate next step — Square D1–D3 kick-off prompt (paste into a fresh session)

> Resume the Square POS bin-sync feature at **Milestone D1–D3** (packaged bin debit).
> Branch **`feat/square-pos-bin-sync`**, plan **`docs/plans/2026-07-07-square-pos-bin-sync.md`**,
> status in **`PROGRESS.md`** (read the top `2026-07-08` entry). **D4/D5 are
> superseded** by `docs/plans/2026-07-08-keg-lifecycle-reconciliation.md` — do NOT
> build keg depletion here; draft/keg lines stay staged in `square_draft_sales`.
>
> **Spike findings (locked — do NOT re-derive):** nothing but the Square sale path
> writes `bin_inventory`; a `taproom_sale` allocation does NOT debit `bin_inventory`
> (it is the audit/TTB ledger). So D2 must **explicitly** decrement `bin_inventory`;
> keeping both is not a double-count.
>
> **Live bug this fixes:** `src/app/api/square/webhook/route.ts` still resolves the
> sale via `locations.square_location_id`, a column `00222` **dropped**. It compiles
> (loose supabase filter typing) but errors at runtime → `locationId` is always null →
> every draft line fails "not mapped to an MGR location." D1 must resolve via
> **`bins.square_location_id`** instead.
>
> **D1 — resolve sale → bin.** In `handlePaymentCompleted`, replace the location
> lookup with: `bins.select("id, location_id, pos_sales_channel_id").eq("square_location_id",
> squareLocationId).maybeSingle()` (the `bins_unique_square_location` partial-unique
> index guarantees at most one). For **packaged** lines, pick the finished good
> **within that bin**, FIFO by production date: join `bin_inventory ⋈ finished_goods`
> WHERE `bin_id = resolvedBin` AND `fg.brand_id = mapping.brand_id` AND
> `fg.selling_format_id = mapping.selling_format_id` AND `bin_inventory.quantity > 0`
> ORDER BY `fg.production_date ASC` LIMIT 1 — replacing today's global
> `finished_goods_with_availability` lookup. For **draft/keg** lines, keep staging in
> `square_draft_sales` but resolve `location_id` from **`bin.location_id`** (fixes the
> dropped-column bug); do NOT deplete kegs (deferred to the keg-lifecycle epic).
>
> **D2 — debit `bin_inventory`.** Decrement the resolved bin's finished-good quantity
> by the sold qty, **atomically + clamped**, via a small RPC
> `debit_bin_inventory(p_bin_id, p_finished_good_id, p_qty)` (migration **`00223`**;
> `UPDATE bin_inventory SET quantity = GREATEST(0, quantity - p_qty) … RETURNING` the
> new qty + whether it clamped) — an inline read-modify-write would lose updates under
> concurrent sales. **Keep the existing `taproom_sale` allocation insert** (audit/TTB
> ledger) alongside the debit. Idempotency is already guaranteed by the webhook's
> `event_id` dedup.
>
> **D3 — oversell.** Clamp-to-zero + **flag** (locked policy; mirrors #357): when
> `sold qty > bin qty`, clamp to 0 and record the line in the `square_sync_log`
> `details` (e.g. `oversoldLines`) + response. Do NOT allow negative; do NOT reject.
>
> **Preserve** the existing signature verify + replay window + `event_id` dedup +
> per-line error collection. **Tests** (mirror `sync-routes.test.ts` idiom): packaged
> sale debits the mapped bin's FIFO FG by qty AND inserts the allocation; oversell
> clamps + flags; Square retry (same `event_id`) is a dedup no-op (no double debit);
> unmapped Square location → packaged lines flagged (can't resolve bin); draft line
> still staged with `location_id` from the bin.
>
> **Repo rules:** `bun lint && bun typecheck && bun test` before commit; regenerate
> `src/types/supabase.ts` after `00223`; regenerate + verify the live-drift snapshot
> after it lands live; expert agents (integrations-expert + data-layer-expert);
> **NEVER Co-Authored-By.** Commit D1–D3 to **PR #361** (or its successor — confirm
> #361's state first; #360 was docs-only and already merged).
