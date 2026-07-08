# Audit Fix Backlog — 2026-07-06

Source: `docs/audits/2026-07-06-feature-audit.md` (finding IDs C/H/M/L reference that doc).
Owners per `CLAUDE.md` expert-agent table. Check items off as PRs land; note the PR # next to each.

## P0 — Security (do first)

- [ ] **1. Assign and enforce the `customer` role** (C1) — owner: `data-layer-expert`
  Migration: restore customer-email→role linking in `create_user_profile()` (lost in 00097); invite route sets `roles=['customer']`; backfill existing mis-roled portal users. Fix the `(app)/layout.tsx` redirect to not require exactly `['customer']`. Add a multi-user RLS round-trip test (customer JWT vs another customer's orders).
- [ ] **2. Close self-registration** (C1/M16) — owner: `data-layer-expert`
  DECIDED 2026-07-06: portal is invite-only, no signup. `shouldCreateUser: false` on portal OTP login; remove or invite-gate the public `/signup` page; **verify the hosted Supabase "allow new signups" toggle today** (not visible from repo).
- [ ] **3. Scope order notifications** (H9) — owner: `data-layer-expert`
  Replace `notify_all_users()` broadcast for order events with staff-only (or role-filtered) recipients; stop embedding customer identity in rows readable by other customers.

## P1 — Compliance & data corruption (continuously wrong today)

- [ ] **4. Order fulfillment side effect** (H1 root) — owner: `entity-architect` + `data-layer-expert`
  On `orders → fulfilled`: complete FG→order allocations, set `volume_bbl` (via `computeUnitFillVolumeBbl`), decrement `finished_goods.quantity` (or formalize ledger-only stock). On `orders → cancelled`: release planned allocations (M12).
- [ ] **5. TTB SQL volume math** (H2) — owner: `brewing-domain-expert` + `data-layer-expert`
  Add `unit_count` and keg `volume_bbl` fallback to `get_ttb_inventory_summary`/`get_ttb_production_summary`; add `taproom_sale` to removals CASE; wire the unused `validateRowBalance`/`validateEndingInventory` into the TTB page.
- [ ] **6. Plato/SG `actual_og`** (H3) — owner: `brewing-domain-expert`
  Convert in the `batches_with_brew_info` view (or at write time); repair pitch dialog, packaging-completion ABV, blend dialog, `analyze_batch_performance`. Add an integration test that crosses the view→consumer unit boundary. Clean up any live batches with absurd `actual_abv`.
- [ ] **7. Loss reconciliation skip on revised/cancelled sessions** (H5) + session-status filter for `packagedBbl` (M6) — owner: `brewing-domain-expert`
  `hasOpenSessions` should ignore terminal statuses; packaged-volume sum should include only `completed`/`revised`-lineage line items (decide semantics for revised).
- [ ] **8. `volume_oz` semantics normalization** (H6) — owner: `entity-architect`
  Migrate container rows to per-unit `volume_oz` (or add an explicit flag); remove the `MIN_PER_UNIT_OZ` display heuristic; make TTB SQL and `computeUnitFillVolumeBbl` agree.

## P2 — Live drift & integrity

- [x] **9. Restore server-side enforcement on live** (C2) — owner: `data-layer-expert` — **DONE (migration 00205, applied live 2026-07-07)**
  Migration `00205_restore_server_side_enforcement.sql` re-asserts: `validate_state_transition()` + the 8 `trg_validate_*_status` triggers, `cancel_pick_list_allocations()`/`set_pick_list_timestamps()` + their triggers, the advisory-lock number generators (`generate_next_number`/`generate_next_po_number`/`generate_lot_number`/`generate_delivery_number` + the `finished_goods_lot_number` UNIQUE) and `calculate_ingredient_shortfalls` (on_order_qty), plus two app-used functions dropped in the same drift (`get_yeast_lineage_root`, `get_unaccepted_po_receives`). `get_state_transitions()` was re-synced to the current entity state machines (the live 00167 map was stale: it lacked orders' `picking`/`packed` and used non-existent delivery states). Drift detection shipped: `scripts/check-live-drift.sh` + `supabase/live-catalog.snapshot.txt` + `.github/workflows/live-drift.yml` (needs read-only `SUPABASE_DB_URL` secret).
  The live diff was **broader than C2 described** — a cluster of 00100–00143-era objects was missing. Deferred (documented in 00205's header, NOT restored): `apply_change_request` (#10), `project_*`/`margin_by_channel` (#19, unused), QBO token RPCs (no app caller). Two need a schema-aware rewrite (they reference dropped columns/tables, so restoring the chain body would re-break) — see items 21/22 below.
  Stranded-reservation release: **verified moot 2026-07-07** — live has zero finished_good→order allocations of ANY status (39 orders, 9 fulfilled/cancelled; the FG-allocation flow was never used in production, so H1's "0 completed" was "0 total"). Re-check at #342 deploy: `SELECT count(*) FROM allocations a JOIN orders o ON o.id=a.destination_id WHERE a.destination_type='order' AND a.source_type='finished_good' AND a.status='planned' AND o.status IN ('fulfilled','cancelled');`
  Period-attribution note: TTB removals (00203) bucket by `allocations.created_at`, not `completed_at` — fine for the normal flow; revisit here if attribution matters.
- [ ] **21. `get_inventory_overview()` is broken live** (found while doing #9) — owner: `data-layer-expert`
  Live def == chain (00155) but JOINs the dropped `package_types` table (errors on invoke) AND its return shape no longer matches the `InventoryOverview` TS type (`inventory-service.ts`, `inventory-alerts.tsx`). Not drift — a pre-existing chain bug. Needs a `selling_formats` rewrite that also matches the TS shape (`brand_name`/`package_type_name`/`committed_quantity`/`low_stock_items`).
- [ ] **22. `start_batch_fermentation()` is broken live** (found while doing #9) — owner: `data-layer-expert`
  Missing on live; the chain body (00024) `UPDATE batches SET fermenter=...`, but `batches.fermenter` was dropped (vessel assignment now lives on `vessels.current_batch_id` + `vessel_transfers`). The brew-log completion dialog's "start fermentation" RPC path errors. Rewrite to the current vessel model, or drop the RPC and route through the existing `current_vessel_id` fallback the dialog already has.
- [ ] **10. Change-request feature: rebuild, simplified** (C3) — DECIDED 2026-07-06, folded into #20 phase 1
  Rebuild tables against the current selling-formats schema. **Drop the auto-apply RPC** (`apply_change_request` broke twice on schema drift): requests are stored structured, "approve" = staff applies the edit via the normal order editor and marks the request applied. Remove the approve-route RPC call; keep the audit record.
- [ ] **11. `keg_inventory` netting** (H4) — owner: `data-layer-expert`
  Make fill/ship legs net against pools (strip batch/FG from the negative leg's grouping, or restructure the view); backfill/verify against physical fleet count.
- [x] **12. Server-side availability guard** (H7) — owner: `data-layer-expert` — **PR (branch `fix-audit-availability-guard`), 00212 applied live**
  Trigger or RPC-level check that allocations cannot exceed availability (with row locking); decide policy for intentional negative (count corrections).
  DONE 2026-07-07 (00212, decision: block; exempt adjustments). `guard_allocation_availability()` BEFORE INSERT/UPDATE on allocations: for inventory_lot/finished_good sources, locks the source row (`FOR UPDATE`) and rejects a depletion exceeding `stock − Σ active allocations`. Exempts `destination_type='adjustment'` (count corrections) and inactive statuses; skips batch/external sources. Proven via rolled-back tests (oversell blocked, exact-available allowed, adjustment exempt).
- [ ] **13. `chk_fg_entry_point` conflict** (H8) — owner: `data-layer-expert`
- [x] **13. `chk_fg_entry_point` conflict** (H8) — owner: `data-layer-expert` — **PR (branch `fix-audit-h8-fg-entrypoint`), 00206 applied live**
  Relax the CHECK or require batch on session line items; unblock batch-less session completion and manual FG-with-batch creation.
  DONE 2026-07-07: dropped `chk_fg_entry_point` (00206). All four batch_id/session_line_item_id combinations are now legitimate (batch-less session lines → session-only FGs; manual FG-with-batch → batch-only FGs), so no weaker CHECK is meaningful. Column comments document the independent-optional-provenance semantics. Live impact zero (1 FG row, external).
- [ ] **14. Pricing model** (H10, M9) — DECIDED 2026-07-06: dual model is intentional
  Wholesale orders price by **customer tier × sales channel** (matrix cell); taproom/Square prices by **product tier** — different channels, both by design. Remaining work: (a) M9 — require `price_tier_id` + `sales_channel_id` before a customer can be portal-invited / auto-priced, fix the customer-form copy about "default tier" — **customer-form copy FIXED 2026-07-07 (this PR); invite-gate DEFERRED to #20 portal rebuild (decided 2026-07-07: the invite/pricing loop is reworked there)**; (b) bring live `get_price_for_customer` into the migration chain (drift item #4); (c) document the dual model in `docs/knowledge/entity-model.md`.
- [ ] **15. Ledger audit-trail hardening** (M11, M13, plus audit-doc gaps) — owner: `data-layer-expert`
  Wholesale orders price by **customer tier × sales channel** (matrix cell); taproom/Square prices by **product tier** — different channels, both by design. Remaining work: (a) M9 — require `price_tier_id` + `sales_channel_id` before a customer can be portal-invited / auto-priced, fix the customer-form copy about "default tier"; (b) bring live `get_price_for_customer` into the migration chain (drift item #4); (c) document the dual model in `docs/knowledge/entity-model.md`.
  - [x] **(b)** migration `00214_capture_get_price_for_customer.sql` captures the out-of-band live def verbatim (body byte-identical, md5 unchanged → applying is a no-op); closes drift item #4. (PR: `fix-audit-pricing-capture`)
  - [x] **(c)** dual model + "no default tier per channel" documented in `docs/knowledge/entity-model.md` (same PR).
  - [ ] **(a) M9** — customer-form copy ("Determines default pricing tier" / "Override default tier") is misleading and portal-invite/auto-price isn't gated on tier+channel. Owner: `entity-architect` (`src/entities/customer/presentation.tsx`) + data-layer for the invite gate. Its own PR.
- [ ] **15. Ledger audit-trail hardening** (M11, M13, plus audit-doc gaps) — owner: `data-layer-expert`
- [x] **15. Ledger audit-trail hardening** (M11, M13, plus audit-doc gaps) — owner: `data-layer-expert` — **PR (branch `fix-audit-ledger-hardening`), 00211 applied live** (scope: allocations-focused)
  `entity_revisions` triggers on `allocations` (+ consider `inventory_lots`, `packaging_sessions`, `pricing_tier_prices`, `keg_transactions`); default `created_by = auth.uid()`; block deletes of completed allocations; require `reason_code` on adjustments; stop keying idempotence/reversal on mutable `notes` strings (dedicated column or unique constraint).
  - [x] **mutable-notes idempotence** — packaging depletion now keys on a dedicated `allocations.idempotency_key` column (`pkg_session:<id>`, migration `00215` + partial index); batch-loss reconciliation keys on the structured `reason_code='reconciliation'` it already writes. Neither keys on `notes` anymore. No backfill (0 live rows either pattern). (PR: `fix-audit-notes-idempotence`) — note: the allocations-trigger + broad-extension parts of #15 are in PRs #349/`fix-audit-ledger-revisions`.
  - [x] allocations trigger + `created_by` default + completed-delete block + adjustment `reason_code` CHECK — migration `00211` (PR #349), applied live 2026-07-07.
  - [x] **broad extension** — `entity_revisions` triggers on `inventory_lots`, `packaging_sessions`, `pricing_tier_prices`, `keg_transactions` — migration `00213` (PR: `fix-audit-ledger-revisions`), applied live 2026-07-07. WHO captured via `log_entity_revision`'s `changed_by = auth.uid()`; no base-table `created_by` columns added.
  - [ ] **mutable-notes idempotence** — still keyed on `notes` strings (depletion idempotence / reversal matching). Deferred to its own PR: needs a dedicated idempotency column + unique constraint and a migration of every notes-matching guard; correctness-critical, kept separate from the additive revision triggers above.
  DONE 2026-07-07 (00211): `tr_allocations_revision` (INSERT/UPDATE/DELETE via `log_entity_revision`); `created_by` DEFAULT `auth.uid()`; `prevent_completed_allocation_delete()` BEFORE DELETE (proven blocked via rolled-back test); `chk_allocation_adjustment_reason` CHECK (adjustment ⇒ reason_code, proven). Allocations page surfaces the DB block message. **Deferred (chose allocations-focused scope):** entity_revisions on inventory_lots/packaging_sessions/pricing_tier_prices/keg_transactions, and the notes-string idempotence rework (L2/reconcile — separate item).
- [ ] **16. Vessel integrity** (M3, M4, M5) — owner: `data-layer-expert`
  Create the missing `idx_vessel_transfers_unique_per_batch` (or equivalent); double-booking guard in `handle_vessel_transfer()`; partial-transfer semantics (don't free source on partial moves).
- [ ] **17. Order item price validation** (M10) — owner: `entity-architect`
  Fix add-path `|| null` coercion (reuse edit-path parser); DB CHECK `unit_price >= 0`; stop the auto-price effect overwriting explicit $0.
- [x] **18. Remaining mediums** — ~~M1/M2~~ **DONE 2026-07-07 (00218, applied live): recipes_with_estimates IBU now uses gravity-adjusted Tinseth via `hop_utilization_factor` (decided canonical = Tinseth; fixes the stepped-lookup + ~2.3× first-wort gap); view↔TS parity test added**, ~~M7 (revise RPC whole-unit ceiling)~~ **DONE (00217)**, ~~M8 (per-batch vs session ceiling)~~ **DONE (per-batch, 00217 + preview hook)**, ~~M14 (FG edit outbound guard)~~ **DONE (00216)**, ~~M15 (count optimistic lock)~~ **DONE (#352)**. All of #18 shipped.
- [ ] **18. Remaining mediums** — M1/M2 (recipe editor ↔ view formula parity; single source of truth), M7 (revise RPC whole-unit ceiling), M8 (per-batch vs session ceiling — pick one semantic), M14 (FG edit outbound guard), M15 (count optimistic lock + FG counts).
  - [x] **M15a — count-increase lost-update race**: `recordInventoryCount` now compare-and-swaps on the pre-image `inventory_lots.quantity` (no `version` column exists on that table), returning `CONFLICT` on a stale write. App-only, no migration. (PR: `fix-audit-m15-count-lock`)
  - [ ] **M15b — FG cycle-count workflow**: deferred. FG increases still require destructive `finished_goods.quantity` edits; a non-destructive FG stocktake is a new UI surface (ui-systems lane) + count-session UX (see audit "No stocktake" gap), not a bug fix.
- [ ] **18. Remaining mediums** — M1/M2 (recipe editor ↔ view formula parity; single source of truth), ~~M7 (revise RPC whole-unit ceiling)~~ **DONE 2026-07-07 (00217, applied live): revise delta now ceils whole-unit materials via `whole_unit_material_qty` (delta-of-ceils, not ceil-of-delta)**, ~~M8 (per-batch vs session ceiling — pick one semantic)~~ **DONE (decided PER-BATCH): preview hook now ceils per-batch to match completion; TS↔SQL parity test added**, M14 (FG edit outbound guard — DONE 00216), M15 (count optimistic lock — DONE #352).
- [ ] **18. Remaining mediums** — M1/M2 (recipe editor ↔ view formula parity; single source of truth), M7 (revise RPC whole-unit ceiling), M8 (per-batch vs session ceiling — pick one semantic), ~~M14 (FG edit outbound guard)~~ **DONE 2026-07-07 (00216, applied live): BEFORE UPDATE trigger `guard_finished_good_outbound` blocks reducing `finished_goods.quantity` below active allocations — twin of 00212, block-hard (corrections go through an adjustment allocation)**, ~~M15 (count optimistic lock + FG counts)~~ **DONE (M15a → #352 quantity-CAS)**.

## P3 — Product decisions / feature builds (from requirement verdicts)

- [ ] **19. Planned-batch ordering** — design doc first: reserve against projected batch volume, future-oversell guard, delay/cancel/under-yield handling. Raw material: `project_finished_goods()` (00139), dead `order_items.batch_id` FK.
- [ ] **20. Customer portal: rebuild for wholesale, invite-only** — DECIDED 2026-07-06. Depends on #1/#2 (P0) + #10.
  Model: customers exist **only to make orders**; everything a customer does is a request, staff confirmation is the gate. Buyers are wholesale (cases + kegs), priced by their tier × channel (see #14).
  - **Phase 1 (the loop):** staff create suggested orders for a customer (reuse `reorder.ts`; new `awaiting_customer` status or flag). Customer accepts → order moves to `accepted`; **staff always confirm** (decided — no auto-confirm). Customer can instead file a structured change request (#10, manual apply). Post-confirmation edits: change-request only. Rebuild `customer_portal_users` junction (multiple buyer contacts per customer). Staff notification on request submitted (L11).
  - **Phase 2:** portal catalog view — their channel's case/keg selling formats at their tier prices + in-stock flag (dedicated DB view; no direct reads on pricing/inventory tables). Keg balances page from `customer_keg_balances` (kegs out, deposits outstanding).
  - **Phase 3:** customer-initiated order requests from the catalog (same request machinery, customer-started). Futures/"order next month's batch" waits on #19.

## P4 — Low severity (batch up opportunistically)

- [ ] L1 mash-temp warning NULL guard · L2 atomic idempotency (unique constraint incl. NULL-safe dest) · L3 cross-session depletion upsert · L4 line-item qty ≥ 0 · L5 webhook multi-lot split · L6 delete or wire `bin_inventory` · L7 pricing history INSERT trigger + a UI reader · L8 QBO rounding/qty/tax-exempt · L9 unify revenue definitions · L10 notification enum refresh (also fires on `fulfilled`).

## Test-infrastructure debt (enables everything above)

- [ ] **pgTAP (or equivalent) DB-layer test harness** — triggers, RPCs, views, CHECKs are where all three criticals live and have zero coverage.
- [x] **Live-drift CI check** — **DONE (with #9)**: `scripts/check-live-drift.sh` diffs the live catalog (functions + signatures + body hashes, triggers, tables) against `supabase/live-catalog.snapshot.txt`; `.github/workflows/live-drift.yml` runs it daily + on migration-touching PRs. Needs a read-only `SUPABASE_DB_URL` repo secret. Regenerate the snapshot (`--update`) in any PR that intentionally changes the catalog.
- [ ] **Multi-user RLS round-trip tests** — real JWTs, not policy-text assertions.
- [ ] **View↔consumer unit-parity tests** — SQL estimate formulas vs TS ports (`recipes_with_estimates` vs `recipe-estimate-calc`, `batches_with_brew_info.actual_og` units).

## Phase-2 audit candidates (unaudited, from Appendix G)

Highest value next: **deliveries** (spans fulfillment + transfers, side effects unverified) · **production planning suite** (second write-path into batch lifecycle) · **COGS/batch-cost/landed-cost chain** (incl. the flagged planned-allocation double-count in `report-utils.ts:31-35`) · **brew-log blending/split junction semantics** · **keg fleet reports deposit math** · **entity-service.ts generic CRUD engine** · **timezone/date bucketing in reports** · staff auth + users/roles admin · QuickBooks non-invoice sync paths · Square inventory sync.
