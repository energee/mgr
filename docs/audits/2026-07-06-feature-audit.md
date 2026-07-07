# mgr Feature Audit — 2026-07-06

- **Codebase:** `main` @ `8ef6f256`
- **Method:** six parallel audit agents, one per feature area, plus a seventh completeness-critic pass (Appendix G). Every finding was traced end-to-end through the actual code path before being reported; several were verified against the live database (read-only). Findings independently hit by two or more agents are marked *(corroborated)*.
- **Scope (user-requested):** recipes + calculations, batch lifecycle + brewlog, packaging (kegs/cases), finished goods + inventory audit trail, pricing, orders against planned batches + customer self-service.
- **Fix backlog:** `docs/plans/2026-07-06-audit-fix-backlog.md`
- **Appendices A–F** contain each agent's full unabridged report with file:line references. **Appendix G** lists what this audit did NOT cover.

---

## Executive summary

- **Requirement #6 mostly doesn't exist.** Orders against planned batches: no real reservation (`order_items.batch_id` is a dead column nothing writes). Customer self-signup: none — invite-only, and the invite is broken. Self-service ordering: none — the portal is view-only, and it is **dead on production anyway** because its backing tables were dropped from the live DB.
- **Three critical clusters:** (1) a broken portal security model that gives every invited customer brewery-wide read access, (2) live-DB drift that silently removed server-side enforcement the code relies on, (3) a TTB compliance chain that is wrong end-to-end — shipped beer never appears as taxpaid removals.
- **Recurring root causes:** live-DB drift (repo believes in triggers/RPCs/tables that don't exist live), unit-semantics mismatches (Plato vs SG; per-unit vs per-case `volume_oz`), and side effects that were never wired (order fulfillment does nothing to inventory).

---

## Consolidated findings

### Critical

**C1 — Every portal/invited customer gets `viewer` role = brewery-wide read access.**
`create_user_profile()` (00097) assigns `['viewer']` to every non-first user; the customer-role linking from 00089/00095 was removed in that rewrite and never restored, and the invite route never sets roles. `viewer` passes the `orders_select` / `customers:read` / `recipes:read` / pricing RLS policies, so the per-customer row scoping is OR'd away — an invited customer sees **every** order, price, recipe, and customer, and isn't redirected out of the internal app (`(app)/layout.tsx:38-44` only redirects exact `['customer']`). Compounding it: portal OTP login and `/signup` both allow self-registration (`shouldCreateUser` defaults true) — if the hosted project's signup toggle is on, anyone can mint themselves a viewer account. That toggle is not verifiable from the repo. *(Details: Appendix F #1, #5.)*

**C2 — Live DB is missing the server-side enforcement layer.**
Verified live: `validate_state_transition()` absent, `pick_lists` has zero triggers, `cancel_pick_list_allocations` missing — despite 00108/00143. Cancelling a pick list strands its `planned` reservations forever (stock invisibly unsellable), and any authenticated PostgREST caller can flip allocation/batch statuses arbitrarily. *(Details: Appendix D #1.)*

**C3 — The order change-request feature is dead end-to-end.** *(corroborated ×3)*
Tables (`order_change_requests`, `order_change_request_items`, `customer_portal_users`) dropped out-of-band on live; `apply_change_request` RPC absent live **and** broken in-repo (references `package_type_id`/`keg_type_id` columns dropped in the selling-formats refactor — the same drift that broke `generate_pick_list`, fixed in 00182 while this was not). Portal submit errors; staff approve 500s. *(Details: Appendix D #2, E #1, F #3/#4.)*

### High

**H1 — TTB removals are permanently ~0.00.** *(corroborated; live data confirms)*
Root cause: there is **no order-fulfillment side effect at all** — nothing completes FG→order allocations (they stay `planned` forever), nothing sets `volume_bbl` on them (no writer does, anywhere), and `finished_goods.quantity` is never decremented on shipment. Additionally `taproom_sale` is not among the removals CASE arms, so Square taproom sales are excluded even in principle. Live data: 0 completed FG→order allocations, 0 with volume. *(Appendix C #3, D #3/#4, F #6.)*

**H2 — TTB production/inventory volume math is wrong in SQL.**
`quantity × volume_oz / 3968` omits `unit_count` (100 cases of 24×12oz reports 0.30 bbl instead of 7.26 — 24× under) and keg containers have `volume_oz` NULL → the whole keg tax class reports 0.00. The correct math exists client-side in `computeUnitFillVolumeBbl`; the SQL diverges from it. *(Appendix C #2.)*

**H3 — `actual_og` is stored in Plato but consumed as SG everywhere.**
`batches_with_brew_info.actual_og` averages raw `gravity_plato` with no conversion, while every consumer (contract documented at `src/domain/units.ts:334`) expects SG. Pitch dialog does `sgToPlato(12.5)` → suggests absurd pitch weights; packaging completion writes `actual_abv ≈ 1508%` to the batch; blend dialog and batch insights display garbage. Unit tests feed the correct unit, masking the bug. *(Appendix B #1.)*

**H4 — `keg_inventory` counts inflate monotonically.**
Fill/ship transaction legs carry `batch_id`/`finished_good_id` while pool legs don't, so negative legs land in separate GROUP BY buckets and get dropped by `HAVING sum > 0`. Receive 50 → fill 10 → ship 10 shows a 70-keg fleet. *(Appendix C #1.)*

**H5 — Loss reconciliation permanently skipped after a session is revised or cancelled.** *(corroborated ×2)*
`hasOpenSessions` treats `revised`/`cancelled` as open; `batches→completed` is the only trigger and is terminal — a routine "Revise Quantities" means that batch's shrinkage never reaches the TTB losses line. *(Appendix B #4, C #4.)*

**H6 — Mixed `volume_oz` semantics (per-unit vs case-total) break volume math in both directions.**
`use-catalog.ts:86-106` documents that live container rows are mixed; `computeUnitFillVolumeBbl` assumes per-unit (24× overstatement for rolled-up rows → absurd suggested-loss values a user can confirm into the ledger), while the TTB SQL is only correct for rolled-up rows. *(Appendix C #5.)*

**H7 — No server-side availability guard on allocation inserts.**
Only the client caps quantity; two concurrent users oversell the same lot silently; `available_quantity` goes negative. Quick depletion explicitly warns-but-allows. *(Appendix D #5.)*

**H8 — `chk_fg_entry_point` CHECK (live-verified present) blocks legitimate flows.**
Completing any packaging session containing a batch-less line item fails with a check violation (trigger inserts FG with `session_line_item_id` set + `batch_id` NULL); manually creating an external finished good with "Source Batch" set also always errors. *(Appendix D #6.)*

**H9 — Notifications broadcast every order to every user.**
`notify_all_users()` writes rows for all auth users with customer name + order number embedded — any portal user can read other customers' order activity. Independent of C1. *(Appendix F #2.)*

**H10 — Two contradictory pricing models in production.**
Staff orders price by the *customer's* tier (live `get_price_for_customer` ignores brand); Square taproom prices by the *product's* tier (the COGS-band design `pricing_tiers.cogs_max` exists for). Same DIPA 4-pack: $16 on the POS, $10 auto-suggested on a Tier-1 customer's order. Needs a product decision, but it is user-visible mispricing today. *(Appendix E #2.)*

### Medium

| ID | Area | Finding | Detail |
|---|---|---|---|
| M1 | Recipes | Editor FG/ABV ignores selected yeast's attenuation (defaults 75%) while the SQL view uses `COALESCE(target, yeast_typical, 75)` — same recipe shows different ABV/FG in editor vs list/detail/brew-log | App. A #1 |
| M2 | Recipes | Editor IBU (gravity-adjusted Tinseth) diverges from the SQL view's stepped lookup table it claims to port; first-wort factor 2.3× off | App. A #2 |
| M3 | Batches | Vessel-transfer dedup relies on a DB unique index (`idx_vessel_transfers_unique_per_batch`) that **does not exist** — only a client-side 5-min single-row check; double-submit double-counts transferred volume | App. B #2 |
| M4 | Batches | `handle_vessel_transfer()` overwrites destination occupancy unconditionally — two batches can silently double-book a tank, orphaning the first | App. B #3 |
| M5 | Batches | Partial/split transfer always frees the source vessel and prompts to book still-resident beer as loss — contradicts the documented split-batch model | App. B #5 |
| M6 | Packaging | `packagedBbl` counts line items from cancelled/planned sessions (no session-status filter) — skews loss reconciliation, can double-count on re-package | App. C #6 |
| M7 | Packaging | `revise_packaging_session` material delta skips the whole-unit ceiling — accumulates fractional trays/lids that can never match a physical count | App. C #7 |
| M8 | Packaging | Per-batch ceiling in `consumePackagingMaterials` over-consumes vs the session-level preview (+1 unit per extra batch per discrete item); contradicts documented semantics | App. C #8 |
| M9 | Pricing | No default tier per sales channel, but the customer form promises one ("Determines default pricing tier") — auto-pricing silently never fires for customers without an explicit tier | App. E #3 |
| M10 | Pricing | Order add-path coerces $0 → NULL and accepts negative prices (the edit path guards both); no DB CHECKs on `order_items` at all | App. E #4 |
| M11 | Fin. goods | Allocation ledger rows are hard-deletable and fully editable with zero revision history — deleting a completed depletion silently restores stock untraced; deleting an FG orphans its allocations | App. D #7 |
| M12 | Fin. goods | Cancelled/fulfilled orders never release or finalize planned allocations; the UI blocks editing them after cancel, so the leaked reservation is unfixable from the app | App. D #8 |
| M13 | Fin. goods | `revise_packaging_session` stamps corrections `created_by` = original session creator, not the reviser | App. D #9 |
| M14 | Fin. goods | Generic FG edit can set `quantity` below allocated (no outbound guard like the revise RPC has) — availability goes negative with no movement row | App. D #10 |
| M15 | Fin. goods | Count-increase path is read-then-write with no optimistic lock (lost-update race); no FG cycle-count workflow exists at all (counts are raw-lot-only) | App. D #11 |
| M16 | Portal | Public OTP/signup self-registration (`shouldCreateUser` default true, public `/signup`) lands as `viewer` with full internal read — escalate to CRITICAL if the hosted signup toggle is on | App. F #5 |

### Low

| ID | Area | Finding | Detail |
|---|---|---|---|
| L1 | Recipes | Mash-temp fermentability warning suppressed when `target_attenuation` NULL (`NULL > 75` → never fires) — exactly the case it was written to catch | App. A #3 |
| L2 | Batches/Pkg | Reconcile/depletion idempotency guards are SELECT-then-INSERT on notes strings (TOCTOU); reconciliation loss row has `destination_id` NULL so the unique index doesn't protect it — concurrent completions double-book *(corroborated ×2)* | App. B #6, C #10 |
| L3 | Batches | Cross-session packaging depletion can collide with `idx_allocations_unique_active_source_dest` → session silently under-depletes materials | App. B #7 |
| L4 | Packaging | Negative quantities accepted on session line items (`parseIntOrNull` passes "-5"; no DB CHECK) — inflates suggested loss, negative variance | App. C #9 |
| L5 | Fin. goods | Square webhook books an entire sale against the single oldest lot uncapped — drives lots negative, misstates traceability | App. D #12 |
| L6 | Fin. goods | `bin_inventory` is a dead limb: no write path anywhere, 0 rows live; FG bin breakdowns always empty; transfers never move stock | App. D #13 |
| L7 | Pricing | Price *inserts* write no `pricing_history` row (UPDATE/DELETE triggers only), contradicting entity-model doc; nothing in the app reads the history | App. E #5 |
| L8 | Pricing | QBO invoice sends unrounded float math (`3 × 1.13 → 3.3899…`), silently rewrites qty 0 → 1, and never uses the tax-exempt flag it fetches | App. E #6 |
| L9 | Pricing | Dashboard revenue (`get_sales_trends`) counts drafts; customer stats count fulfilled-only — inconsistent revenue for the same period | App. E #7 |
| L10 | Orders | Order-status notifications switch on stale enum values (`ready_to_ship`/`out_the_door`) — nothing fires on fulfillment | App. F #7 |
| L11 | Orders | No staff notification (Slack/email/trigger) when a customer submits a change request | App. F #8 |

---

## Requirement verdicts (feature #6)

| Requirement | Verdict | Notes |
|---|---|---|
| Orders against planned batches | **Partial → effectively No** | Orders can be *created* before stock exists, but there is no reservation against planned/future batch volume, no oversell guard on futures, and `order_items.batch_id` is never written. `project_finished_goods()` (00139) is analytics-only raw material for this feature. |
| Customer self-signup | **No (and broken)** | Invite-only; invite links `customer_portal_users` but never assigns the `customer` role (C1). No registration flow exists. |
| Customer self-service ordering | **No** | Portal is view + change-request only; no place-order page; `orders:write` is admin/sales. Portal is dead on live (C3). |

## Thoroughness gaps (not bugs — things that don't exist)

- **Mash temp → FG is not modeled anywhere.** `mash_temp_f` is stored/displayed but never feeds any attenuation/FG calculation. The mash pH estimator (`estimateMashPH`, `calculateResidualAlkalinity`) is fully built and tested but wired to nothing.
- **Planned-batch ordering** needs actual design: reservation against projected volume, oversell guard on futures, behavior when a batch is delayed/cancelled/under-yields.
- **Customer ordering portal** needs: signup, a `customer` role that actually gets assigned, a place-order flow, and the dropped tables restored or the feature rebuilt.
- **Audit trail** (finished goods): ledger architecture is right, but `created_by` is NULL on most rows (6 of 8 live), `reason_code` optional nearly everywhere, notes strings are load-bearing for idempotence/reversal matching, and `requires_approval`/`approved_by` are never set by anything. No stocktake/count sessions; no variance reporting. `entity_revisions` triggers exist on exactly 5 tables (batches, recipes, orders, purchase_orders, finished_goods — 00019:94-116, never extended); allocations, packaging_sessions, pricing tables, inventory_lots, keg_transactions have none.
- **Salt-addition solver limitations:** chalk/MgCl2 never suggested; epsom overshoot on SO4; sodium <50 ppm deltas ignored; grams computed on total water but tagged `timing: "mash"`.
- **Recipe schema bounds:** no limits on `mash_efficiency`, `target_attenuation`, volumes — 150% efficiency accepted silently.
- **Dry-hop/fermentation additions never touch hop inventory** — recipe hops deplete all-at-once at brew day/completion; logged `batch_additions` create no allocations; no planned-vs-actual reconciliation.
- No FG > OG sanity check on readings; gravity validation is Plato-only; temperature floor 32°F rejects legitimate sub-freezing lagering readings.
- No over-packaging guard (per-line suggestion uses full batch volume, doesn't subtract sibling lines); depletion shortfalls are toast-only and never persisted; client-orchestrated depletion has no re-run UI if the browser dies mid-flow.
- Keg deposits are reference data only — never priced onto orders/invoices; keg returns manual; no per-serial keg tracking (by design).
- Pricing: no effective-dated/scheduled changes, no discounts of any kind, no tax anywhere, USD hard-coded, no missing-price guard at confirm/fulfill/invoice, Square sync one-way with no `catalog.version.updated` handling.
- TTB historical accuracy: in-process inventory uses current batch statuses regardless of requested month; production dated on `updated_at`; no re-flow of revised sessions into filed months.
- Sample/taproom/destruction quick depletions default to null volume → roll into generic loss (TTB accuracy gap, documented).
- Direct keg fills outside a session aren't packaged volume (documented limitation).
- Vessel capacity is UI-only; no backward batch transitions; asymmetric cancel/archive escape hatches.

## Test coverage pattern

Pure domain functions are well tested (consumption planning, yeast calcs, TTB utils — including identity validators production never calls). But there are **zero DB-layer tests** (no pgTAP, no `supabase/tests`) — exactly where the critical findings live: triggers, RPCs, views, CHECK constraints, live-drift. RLS tests are static policy-text assertions and cannot catch C1/H9. Several unit tests feed functions the correct unit (SG) while production feeds the wrong one (Plato), actively masking H3. No integration test crosses the view→consumer boundary; no concurrency tests; no multi-user RLS round-trips.

## Coverage limits

This audit covered the six requested areas. A completeness pass (Appendix G) identified what it did **not** examine — notably: production planning suite (forward/backward planners, interactive timeline — a second write-path into batch lifecycle), deliveries (spans transfers + order fulfillment, fell between two scopes), brew-log↔batch blending/split junction semantics, the entire **cost** side of pricing (COGS report, batch-cost, landed cost — including a flagged possible planned-allocation double-count in `report-utils.ts:31-35`), keg fleet reports (deposit money math), lot receiving/PO intake, purchasing, dashboards, QuickBooks beyond invoices, Square inventory sync, staff auth, users/roles admin, and the pg_cron low-inventory job (00174). Cross-cutting engines everyone assumed sound: `entity-service.ts` generic CRUD, optimistic-lock adoption (nearly unused outside entity-detail), hard-delete-only convention, timezone/date bucketing in reports, API middleware, query invalidation.

---

# Appendix A — Recipes & calculations (full agent report)

## Capability map (what exists, file paths)

**Recipe creation / editing flow**
- Entry: `src/app/(app)/production/recipes/new/page.tsx` and `[id]/page.tsx` → generic `EntityDetailPage` driven by `recipeEntity`.
- Entity core + zod schema: `src/entities/recipe/core.ts`, `src/lib/schemas/recipe.ts` (only `name` is required; everything else optional; status state machine draft→spec→complete).
- Editor sections: `src/components/domain/recipe/recipe-editor/` — `recipe-basics-section.tsx`, `fermentables-section.tsx` (grain/hop/yeast/attenuation/pitch), `mash-section.tsx`, `whirlpool-section.tsx`, `knockout-section.tsx`, `fermentation-section.tsx`, `water-chemistry-section.tsx`, plus `recipe-sidebar.tsx` (live estimates) and `recipe-editor-context.tsx` (shared state + live calc).
- Ingredient editors: `grain-bill-editor.tsx`/`grain-bill-section.tsx`, `hop-schedule-editor.tsx`/`hop-schedule-section.tsx`, `other-ingredients-section.tsx`, `mash-schedule-editor.tsx`, `fermentation-schedule-editor.tsx`.
- Cloning: `src/components/domain/recipe/recipe-clone-dialog.tsx` (deep-clones 8 junction tables). Versioning: `version` column (migration 00169) used for optimistic locking, not user-facing recipe versions. No recipe scaling feature exists.
- Plan batch from recipe: `src/components/domain/recipe/plan-batch-from-recipe.ts`.

**Brewing calculations**
- Live client estimates (OG/FG/ABV/IBU/SRM): `src/components/domain/recipe/recipe-editor/recipe-estimate-calc.ts`.
- Persisted estimates (SQL): `recipes_with_estimates` view, current definition in `supabase/migrations/00191_capture_drifted_packaging_objects.sql` lines 548-665.
- Water chemistry: `src/domain/water-chemistry.ts` + UI `src/components/domain/recipe/recipe-additions-display.tsx`.
- Style compliance / suggestions RPCs: `analyze_recipe_style_compliance`, `suggest_recipe_improvements` (SQL, `00008_ai_integration.sql`, redefined in `00014_security_fixes.sql`), wrapped by `src/domain/ai/recipe-analyzer.ts`, surfaced in `recipe-analysis.tsx`.

**Formula correctness (spot-checks):** ABV = (OG-1)·(att/100)·131.25 ≡ (OG-FG)·131.25 — correct standard formula. OG = 1 + points·eff/vol_gal/1000 — correct. SRM = 1.4922·MCU^0.6859 (Morey) — correct. Salt ion constants (ppm/g/gal: gypsum 61.5 Ca/147.4 SO4, CaCl2 72/127, etc.) match Palmer/Bru'n Water references. All work in SG (no Plato confusion in the estimate path).

## Bugs

**#1 — Live editor FG/ABV ignore the selected yeast's attenuation (medium)** *(= M1)*
- Path: selecting a yeast in `fermentables-section.tsx:182-186` sets only `yeast_id`, never populates `target_attenuation`. `recipe-editor-context.tsx:276` passes `targetAttenuation: recipe.target_attenuation` with no yeast fallback. `recipe-estimate-calc.ts:159` then defaults to `DEFAULT_ATTENUATION = 75` when it is null. Meanwhile the persisted SQL view uses `COALESCE(r.target_attenuation, y.attenuation_typical, 75)` for est_fg (`00191` line 642) and est_abv (line 646).
- Failure scenario: recipe with attenuation_typical = 85% yeast, `target_attenuation` blank, OG 1.060. Editor sidebar shows **ABV 5.9% / FG 1.015** (75%), while list/detail/brew-log/batch analysis (view) show **ABV 6.7% / FG 1.009** (85%). The editor — where the brewer is formulating — ignores the yeast they just selected.

**#2 — Live editor IBU diverges from the persisted view IBU (medium)** *(= M2)*
- Path: `recipe-estimate-calc.ts:116-145` (`getHopUtilizationFactor`) uses gravity-adjusted **Tinseth** and treats first_wort as a full 60-min boil (~0.23). The SQL view uses a **stepped lookup table** with no gravity term (0.27/0.24/0.20/0.14/0.10/0.05/0.02) and first_wort = 0.10 (`00191` lines 560-576). The file docstring (`recipe-estimate-calc.ts:5-6`) claims it "Ports the SQL formulas from `recipes_with_estimates` view" — false for IBU.
- Failure scenario: 16 oz @ 13% AA, 60-min boil, 7 BBL (217 gal). SQL est_ibu = **19**; editor sidebar ≈ **17**. First-wort hops: SQL factor 0.10 vs editor ~0.23 (2.3×) — sidebar IBU more than double the list/detail IBU. The test at `recipe-estimate-calc.test.ts:268` hard-codes 0.27 in a comment while the code computes 0.2307 — assertions are loose ranges, so the divergence is never caught.

**#3 — Mash-temp fermentability warning silently suppressed when attenuation unset (low)** *(= L1)*
- Path: `suggest_recipe_improvements`, `00014_security_fixes.sql:765` (and `00008` line 415): `IF v_recipe.mash_temp_f > 156 AND v_recipe.target_attenuation > 75 THEN`. `target_attenuation` is commonly NULL (the editor never auto-fills it — see #1), and `NULL > 75` is NULL → warning never fires.
- Failure scenario: mash_temp_f = 160°F with an 85% yeast selected but `target_attenuation` blank → no "high mash temp may limit fermentability" warning — exactly the case it was written to catch.

## Gaps

- **Mash temperature → FG/attenuation: not modeled anywhere.** `mash_temp_f` is stored and displayed (`mash-section.tsx`, `brew-log-recipe-sheet.tsx`) but never an input to any FG/attenuation/fermentability calculation — neither client `calculateEstimates` nor the SQL view references it. The only acknowledgement is the broken text warning (#3).
- **Yeast attenuation in the live estimate:** the view uses it; the editor does not (#1). The capability half-exists and is inconsistent.
- **Mash pH estimation built but unwired.** `estimateMashPH` and `calculateResidualAlkalinity` (`water-chemistry.ts:382-420`) referenced only by tests — no component calls them. The editor exposes only a manual `target_mash_ph` field.
- **Salt-addition solver limitations** (`water-chemistry.ts:320-379`, greedy): chalk and magnesium_chloride never suggested; epsom-for-Mg adds uncounted sulfate; residual calcium never topped up; sodium only added when delta > 50 ppm (`:374`). Grams computed against total (mash+sparge) water but `mapSaltAdditionsToItems` tags every salt `timing: "mash"` — dosing only the mash per the printed amount would over-concentrate.
- **Input validation:** `recipeSchema` puts no bounds on `mash_efficiency`, `target_attenuation`, or any volume (`recipe.ts:19-41`) — 150% efficiency / negative volumes accepted, silently producing nonsense estimates.

## Test coverage

- **Well covered:** `recipe-estimate-calc.ts` (OG/FG/ABV/IBU/SRM, defaults, gravity correction, rounding, empty/zero edges). Caveat: loose-range assertions do **not** verify parity with the SQL view (#2 slips through); ABV test only checks 4 < abv < 7.
- **Water chemistry partial:** ratio/contribution/profile + `estimateMashPH` covered. **No test** for `calculateAdditions` (the greedy salt solver driving the "Calculated Salt Additions" UI) or `getIonRecommendations`/`mapSaltAdditionsToItems`.
- **Not covered:** the SQL view formulas (no cross-check vs the TS port — how #1/#2 went unnoticed); `suggest_recipe_improvements`/`analyze_recipe_style_compliance` RPCs; clone junction-table copying; mash-temp warning logic.
- Note: the #3 functions live in 00008/00014 and live-DB function drift is a known issue — exact live definitions should be confirmed; both in-repo versions carry the same bug.

---

# Appendix B — Batch lifecycle & brewlog (full agent report)

## Capability map (what exists, file paths)

**State machine.** `planned → fermenting → conditioning → packaging → completed`, plus terminal `cancelled`/`archived`. Defined in `src/lib/schemas/batch.ts:34-59` (TS) and mirrored server-side in `supabase/migrations/00143_server_side_state_machine.sql:82-90` (`BEFORE UPDATE OF status` trigger `validate_state_transition()`). Entity config: `src/entities/batch/core.ts:51-72`. `cancelled`/`archived` require the cancel/archive dialog (`requiresAction`, core.ts:59-62). Transition entry points: `src/app/api/batches/[id]/transfer/route.ts` (validates against `batchTransitions` + optimistic lock), detail page `src/app/(app)/production/batches/[id]/page.tsx` (`completeBatch` 264-297, `handleSuggestTransition` 356-380).

**Transition side effects.** `src/services/transition-side-effects.ts` — registry keyed on `(table, toState)`. `batches→completed` runs (1) `completeBatchConsumption`, (2) `reconcileBatchLoss`, (3) vessel release. `packaging_sessions→completed` runs `consumePackagingMaterials`.

**Brewlog / readings.** Brew-day events in `brew_logs.events` JSONB (`src/components/domain/brew/brew-event-form.tsx`, extraction `src/domain/brew-events.ts`). Fermentation readings in `batch_logs` (`log_type='measurement'`): gravity, temperature, pH, pressure, dissolved_oxygen, diacetyl, clarity — types/validation `src/domain/batch-readings.ts`, form `src/components/domain/batch/batch-reading-form.tsx`, ordering `src/domain/batch-reading-log.ts`.

**Yeast.** Calcs `src/domain/yeast-calculations.ts` (viability decay, pitch rate, cell counts, harvest, generation caps), lineage `src/domain/yeast-lineage.ts`, pitch entity `src/entities/yeast-pitch/core.ts`, pitch UI `src/components/domain/yeast/pitch-yeast-dialog.tsx`, batch display `src/components/domain/batch/batch-yeast-section.tsx`.

**Additions / dry hop.** `src/domain/batch-additions.ts` + `src/components/domain/batch/batch-addition-form.tsx`, persisted to `batch_additions` (`.../[id]/additions/page.tsx`).

**Loss / handoff.** `src/services/consumption-service.ts` (`getBatchLossSummary`, `reconcileBatchLoss`, `recordBatchLoss`), pure math `src/domain/consumption-planning.ts`, card `src/components/domain/batch/batch-loss-summary.tsx`, packaging completion `src/components/domain/packaging/packaging-completion-review.tsx`.

**Vessels.** Transfer dialog + utils `src/components/domain/batch/vessel-transfer-*.{tsx,ts}`, DB trigger `supabase/migrations/00023_vessel_transfer_trigger.sql`.

## Bugs

**#1 — `actual_og` stored in Plato, consumed everywhere as SG (HIGH)** *(= H3)*
`batches_with_brew_info.actual_og` is a volume-weighted average of raw `gravity_plato` with **no Plato→SG conversion** (`supabase/migrations/00101_view_correlated_subquery_fixes.sql:31-40`, originally `00042`/`00005`). Brewers enter Plato (`brew-event-form.tsx:72-87`). Every consumer treats `actual_og` as SG (contract documented `src/domain/units.ts:334`). Downstream:
- **Pitch-rate calc (HIGH):** `batches/[id]/page.tsx:440` passes `recipeOg={batch.actual_og ?? recipe?.target_og}`; `pitch-yeast-dialog.tsx:213` does `sgToPlato(recipeOg)`. With `actual_og=12.5` (Plato), `sgToPlato(12.5)` ≈ 1.8e5 °P → astronomically large `cellsNeeded` → garbage `lbsNeeded` auto-filled into `quantity_lbs` (dialog effect :230-233).
- **ABV auto-record at packaging completion (HIGH):** `src/domain/packaging-completion.ts:149-153` computes `abv = (actualOg − fg) × 131.25` expecting SG; `packaging-completion-review.tsx:160-171` feeds Plato `actual_og` + SG FG → `(12.5 − 1.010) × 131.25 ≈ 1508`. Guard `actualOg > fg` passes → `actual_abv ≈ 1508.1` written via `completeSourceBatch` (review.tsx:213).
- **Blend dialog (MEDIUM):** `batch-blend-dialog.tsx:391` renders `formatGravityFromSg(weightedOg, unit)` where `weightedOg` averages Plato values.
- **Insights (MEDIUM):** `analyze_batch_performance` (`00187:35-43`) sets `actuals.og` to `ko_end` `measurements[0].value` — not even filtered to the gravity metric — and `batch-insights.tsx:309-314` displays it beside SG `target_og`.
Test mask: `packaging-completion.test.ts:136-142` feeds `suggestFgAbv` an SG `actualOg: 1.052`, passing while production supplies Plato.

**#2 — Vessel-transfer dedup relies on a DB unique index that does not exist (MEDIUM)** *(= M3)*
`vessel-transfer-dialog.tsx:208` comments "the DB unique index (`idx_vessel_transfers_unique_per_batch`) provides the actual constraint," and handles `error.code === "23505"` (:253-257). No such index exists anywhere (grep all `.sql`/`.ts`; `vessel_transfers` has only non-unique indexes in `00006`/`00012`/`00060`/`00061`). Only dedup is the client 5-minute window check (`isDuplicateTransfer`, `vessel-transfer-utils.ts:59-68`), which inspects only the single most-recent transfer to the same destination. Double-click / two tabs → duplicate rows; `batchKeys.remainingVolume` (dialog:148-167) double-counts transferred volume, throwing off `remainingVolume` and the implied transfer-loss suggestion. Two identical transfers >5 min apart also both accepted.

**#3 — No double-booking guard: `handle_vessel_transfer()` overwrites destination occupancy unconditionally (MEDIUM)** *(= M4)*
`00023_vessel_transfer_trigger.sql:20-26` sets destination `current_batch_id = NEW.batch_id` with no emptiness check; `vessels.current_batch_id` has no unique constraint (`00006:59,71` — non-unique index). UI filter (dialog:129-143) is advisory only. Two batches transferred into the same brite (stale lists / concurrency) → second silently reassigns the vessel; batch A loses its vessel association with no DB error.

**#4 — Completion loss reconciliation permanently skipped when a source session is `revised`/`cancelled` (MEDIUM→HIGH in synthesis)** *(= H5)*
`getBatchLossSummary` computes `hasOpenSessions = packagedLines.some(l => l.session.status !== "completed")` (`consumption-service.ts:657-659`); `reconcileBatchLoss` returns `ok(0)` while `hasOpenSessions` (:711), writing no guard row. `revise_packaging_session()` (`00184:345`) leaves `session_line_items` pointing at a `'revised'` session → `hasOpenSessions` true forever, no session to "re-complete," reconciliation never runs. Scenario: complete S1 → "Revise Quantities" → S1 `revised` → completing batch books **no** reconciliation loss; shrinkage never reaches the TTB losses line; `BatchLossSummary` shows "provisional" indefinitely. Same for `cancelled`. Related: packaged-volume sum (:641-666) has **no session-status filter** — `cancelled`/`revised`/`planned` line items count toward `packagedBbl`, double-counting after re-package *(= M6)*.

**#5 — Partial/split transfer frees the source vessel and its beer prematurely (MEDIUM)** *(= M5)*
`handle_vessel_transfer()` (`00023:30-37`) always marks source `dirty` and clears `current_batch_id` regardless of volume moved. Entity model advertises split fermentation (`docs/knowledge/entity-model.md:9`). After the first partial transfer, the source is emptied in the DB, current vessel jumps to destination, second transfer "from the fermenter" no longer expressible, transfer-loss prompt suggests booking the remaining half as loss.

**#6 — Idempotency guards are TOCTOU, not atomic (LOW)** *(= L2)*
Module claims idempotence (`transition-side-effects.ts:12-16`). `completeBatchConsumption` genuinely is (atomic UPDATE). `reconcileBatchLoss` and `consumePackagingMaterials` guard via SELECT-then-INSERT on a `notes` prefix (`consumption-service.ts:383-391`, `:634`+`:707`). Reconciliation loss row has `destination_id = NULL` → `idx_allocations_unique_active_source_dest` (00147) doesn't protect (NULLs distinct). Near-simultaneous completion triggers → double loss allocation.

**#7 — Cross-session packaging depletion can hit the allocation unique index (LOW)** *(= L3)*
`consumePackagingMaterials` inserts `(inventory_lot, lot_id, batch, batchId, completed)` (consumption-service.ts:459-470). Same batch packaged across two sessions drawing the same lot → second insert collides with the 00147 index → "Material depletion failed" warning (review.tsx:318-322); session already completed, not rolled back → silent under-depletion.

## Gaps

- **No FG-vs-OG sanity check.** `validateReading` (`batch-readings.ts:121-171`) validates fixed ranges only; FG > OG accepted. Only the ABV guard notices — by silently dropping the suggestion.
- **Gravity range validation Plato-only** (0–40, `batch-readings.ts:32-40`); SG entries not meaningfully checked. Temperature min 32°F (`:42-48`) rejects legitimate lagering/cold-crash readings.
- **Ad-hoc fermentation additions don't touch inventory.** `batch_additions` inserts never create allocations (`additions/page.tsx:183-213`). Recipe hops deplete all-at-once via `buildBrewConsumptionPlan` (consumption-service.ts:184,210), never at dry-hop time. No planned-vs-actual reconciliation.
- **Sample/taproom/destruction removals default to null volume** (`recordQuickDepletion`, consumption-service.ts:741-767) → excluded from `attributedBbl` → rolled into generic auto-reconciliation loss. Documented but a real TTB-accuracy gap.
- **Direct keg fills outside a session aren't packaged volume** (documented, `docs/knowledge/brewing-domain.md:15`).
- **Vessel capacity UI-only** (`exceedsCapacity`, dialog:310); no DB constraint.
- **No backward transitions / stuck-state recovery.** `fermenting` can't be `cancelled` (only `archived`); `planned` can't be `archived` (only `cancelled`) — asymmetric escape hatches.
- **Container with neither `volume_bbl` nor `volume_oz` silently yields 0 packaged** (`computeUnitFillVolumeBbl` → null, consumption-planning.ts:255-264) → line skipped, loss inflated without warning.

## Test coverage

Well-covered (pure functions): `consumption-planning.test.ts` (62 + 23-test duplicate under `src/lib/__tests__`), `consumption-service.test.ts` (46), `yeast-calculations.test.ts` (53), `batch-readings.test.ts` (32), `entity-transitions.test.ts` (31), `batch-schedule.test.ts` (18), `packaging-completion.test.ts` (12), `transition-side-effects.test.ts` (12), `yeast-lineage.test.ts` (12), `vessel-transfer-dedup.test.ts` (9), `batch-loss-summary.test.tsx` (5), `batch-reading-log.test.ts` (6).

Blind spots: no integration test crossing the view→consumer unit boundary (#1 uncaught — tests feed clean SG/Plato respectively); `analyze-batch-performance.test.ts` only string-matches SQL; no test asserting the vessel unique index exists (#2) or trigger double-booking guard (#3); `batch-loss-summary.test.tsx` doesn't cover `revised`/`cancelled` (#4); no concurrency tests (#6/#7); no DB-trigger tests at all.

---

# Appendix C — Packaging (full agent report)

## Capability map (what exists, file paths)

**Session flow (UI)**
- `src/components/domain/packaging/packaging-batch-dialog.tsx` — "Start Packaging" from batch detail/list: new/existing session, format, keg owner; prefills planned qty = floor(batch bbl ÷ unit fill bbl); flips batch → `packaging`.
- `add-to-packaging-session-dialog.tsx` — link an already-`packaging` batch to a session.
- `packaging-day-view.tsx` — live entry view for `in_progress` sessions.
- `session-line-items-editor.tsx` + `session-line-items-display.tsx` — inline editor; read-only once status ≠ `planned`.
- `add-line-item-row.tsx`, `packaging-shared.tsx` — batch-first quick add; keg formats get keg-owner sub-select.
- `packaging-completion-review.tsx` — completion modal: variance table → per-batch implied-loss prompts (`RecordLossDialog`) → status flip (DB trigger creates finished goods) → BOM material depletion → per-batch "complete batch?" toasts with FG/ABV suggestions.
- `revise-packaging-session.tsx` + `src/domain/packaging-revision.ts` — post-completion correction via `revise_packaging_session` RPC (00184); only path into `revised` (trigger-guarded).
- `packaging-session-materials.tsx` + `src/hooks/use-material-planning.ts` — BOM material preview.
- `brand-packaging-summary.tsx`, `batch-packaging-history.tsx`, `batch-loss-summary.tsx` — read-only rollups.

**Domain/services:** `src/domain/consumption-planning.ts` (FIFO lot splitting, BOM whole-unit ratio+ceil, `computeUnitFillVolumeBbl`, `computePackagingLoss`, `computeBatchLossReconciliation`, thresholds), `src/domain/packaging-completion.ts`, `src/services/consumption-service.ts`, `src/services/transition-side-effects.ts`, `src/hooks/use-packaging.ts`, `use-session-line-items.ts`.

**Database:** 00026 + 00183 (`create_finished_goods_from_packaging` trigger: FG per line item, batch→FG allocation, keg `fill` transaction), 00184 (`revise_packaging_session`), 00160 (`selling_format_materials` BOM), 00199 (containers/selling_formats CHECKs: kegs need `volume_bbl`, packages need `volume_oz`, `unit_count ≥ 1`, keg-only deposits). Kegs: 00031/00032/00168/00191 (`keg_inventory` from `keg_transactions`, `customer_keg_balances`), 00183 fill/ship automation. TTB: 00041 + live defs captured in 00191 (`get_ttb_report`); client `src/domain/ttb-utils.ts`; page `src/app/(app)/reports/ttb/page.tsx`.

## Bugs

**#1 — `keg_inventory` never nets outflows against source pools; fleet counts inflate monotonically (HIGH)** *(= H4)*
`00168_recreate_keg_inventory_with_details.sql:26-85` (same live def `00191:37-86`). Legs grouped by `(selling_format, keg_owner, state, location, batch_id, finished_good_id)` with `HAVING sum > 0`. A fill (00183:151-175) carries batch+FG on both legs → its −qty "empty" leg lands in `(empty, batch X, FG Y)` while the real empty pool is `(empty, NULL, NULL)` — negative group dropped by HAVING, pool untouched. Ships (00183:246-266, batch/FG NULL) can't net against the fill's inflow. Scenario: receive 50 → fill 10 → view shows 60 kegs; ship 10 → 70 kegs of a 50-keg fleet. Manual fills hit it too (zod refine requires batch/FG link, `keg-transaction/core.ts:155-166`).

**#2 — TTB volume math omits `unit_count`, no `volume_bbl` fallback for kegs (HIGH, compliance)** *(= H2)*
`00191:915,949` (`get_ttb_inventory_summary`) and `:1027` (`get_ttb_production_summary`): `fg.quantity * c.volume_oz / 3968.0`. (a) No `sf.unit_count`: 100 cases of 24×12oz reports 0.30 bbl vs 7.26 — 24× under. (b) Keg containers only require `volume_bbl` (00199:34), `volume_oz` typically NULL → keg tax class reports 0.00 produced/on-hand. Client-side `computeUnitFillVolumeBbl` (consumption-planning.ts:255-264) does both correctly — SQL diverges.

**#3 — TTB removals permanently ~0.00: no writer sets `volume_bbl` on FG allocations (HIGH, compliance)** *(= H1)*
`get_ttb_removals_summary` (00191:1066-1133) sums `a.volume_bbl` over completed FG-sourced allocations. Writers — pick-list generation (00108:125-136), manual allocation (`order-allocation.tsx:230-241`), Square taproom webhook (`webhook/route.ts:343-352`) — none set `volume_bbl`. `taproom_sale` isn't among the CASE arms at all. Taxpaid domestic/export always 0.00; ending inventory never decremented (masked by `GREATEST(0,…)`). Identity validators `validateRowBalance`/`validateEndingInventory` (`ttb-utils.ts:172-187`) never called by the report page.

**#4 — Loss reconciliation permanently skipped for batches with a `revised`/`cancelled` session (HIGH)** *(= H5; same as Appendix B #4)*
`consumption-service.ts:657-659` counts `revised`/`cancelled` as open; `:711` returns 0 with no guard row; only trigger is terminal `batches→completed` (`transition-side-effects.ts:99`, `schemas/batch.ts:56`) — no retry. Tests only cover `in_progress` (`consumption-service.test.ts:1092-1113`).

**#5 — `computeUnitFillVolumeBbl` ignores rolled-up `volume_oz` rows the codebase itself documents (HIGH, data-dependent)** *(= H6)*
`consumption-planning.ts:255-264` computes `volume_oz/3968 × unit_count` unconditionally. `use-catalog.ts:86-106` documents live `containers.volume_oz` is mixed: per-unit ("11.25oz Glass", unit_count 12) and case totals ("384oz Can", unit_count 24) — with a display-only `MIN_PER_UNIT_OZ = 8` heuristic. For "384oz Can"/24: computed 2.32 bbl/case vs real 0.097 — 24× overstatement flowing into (a) planned-qty suggestion (4 cases from a 10-bbl batch instead of ~103), (b) `computePackagingLoss` → RecordLossDialog suggested loss (user can confirm absurd volume into the TTB loss ledger), (c) `getBatchLossSummary.packagedBbl` → false "packaged exceeds produced". Conversely the TTB SQL (#2) is only correct for rolled-up rows — the two layers disagree on the same column.

**#6 — `packagedBbl` counts line items of cancelled sessions (MEDIUM)** *(= M6)*
`consumption-service.ts:641-666` sums all `session_line_items` with no session-status filter. Actuals editable while `planned` (`session-line-items-display.tsx:20`). Pre-entered actual=50 on a cancelled session (no FGs created) → loss card and reconciliation treat 50 cases as packaged.

**#7 — Revise RPC material delta skips whole-unit ceiling (MEDIUM)** *(= M7)*
`00184:242-325`: `v_needed := quantity_per_unit * v_delta`, no each/case integer handling; completion used `computeBomConsumption` (ratio + ceil). BOM tray 0.25/case; 10 cases → ceil(2.5)=3; revise 10→11 → inserts a 0.25-tray allocation (running total 3.25 vs correct 3). Repeated revisions accumulate fractional discrete-item rows.

**#8 — Per-batch ceiling over-consumes vs the session-level preview (MEDIUM-LOW)** *(= M8)*
`consumption-service.ts:451-476` groups by batch then ceils per batch; preview (`use-material-planning.ts:243-345`) aggregates per session and ceils once. Two batches × 10 cases of a 0.25-tray/case format → consumed 3+3=6 vs preview 5. Contradicts "material draw is attributed to the run as a whole" (`docs/knowledge/brewing-domain.md:11`).

**#9 — Negative quantities accepted on line items (LOW)** *(= L4)*
`src/lib/format.ts:144-146` (`parseIntOrNull`) passes "-5"; inputs only set `min={0}`; no CHECK (00010:157-158). Typed −5 actual: FG trigger skips it, but `computePackagingLoss` (consumption-planning.ts:342) computes planned−(−5) → over-suggests loss; totals/variance negative. Revise RPC validates ≥0 (00184:126); entry editors don't.

**#10 — Concurrent completion paths can double-deplete materials (LOW, race)** *(= L2)*
`consumption-service.ts:382-391` SELECT-then-INSERT notes-string guard, no unique constraint; both the review dialog and the generic transition registry (`transition-side-effects.ts:142-151`) call it.

## Gaps

- **No over-packaging guard anywhere.** Quantities unconstrained vs batch volume; each new line's suggestion uses the *full* batch volume (doesn't subtract sibling lines — cases+kegs from one batch can suggest 2× the batch); completion accepts actual > available silently; only signal is the post-hoc amber note (`batch-loss-summary.tsx:93-98`); negative reconciliation remainder silently not recorded.
- **Depletion shortfalls toast-only** — never persisted; recorded inventory silently understates physical consumption.
- **Client-orchestrated depletion**: browser death between status flip and `consumePackagingMaterials` → materials never consumed, no re-run UI (the guard would make re-run safe).
- **Batches packaged while not in `packaging` status** (quick-add accepts planned/fermenting/conditioning, doesn't transition) never get the post-completion "complete batch?" toast (`packagingBatchCandidates` filters `status === "packaging"`).
- **Keg deposits reference-data only**; keg returns manual; no per-serial tracking (appears by design).
- **Direct keg fills outside a session** not packaged volume (documented).
- **TTB historical accuracy**: in-process ending inventory uses *current* batch statuses regardless of month (00191:989-995); cellar production dated on `batches.updated_at` (:1044) — touching a completed batch moves its production month. `is_export` the only export signal. No re-flow of revised sessions into filed months.
- No DB-level guard against editing/deleting `session_line_items` of completed sessions (read-only is UI-only; revise trigger only guards the status column).

## Test coverage

- **Strong (pure domain):** `consumption-planning.test.ts` (602 lines), `packaging-completion.test.ts`, `packaging-revision.test.ts`, `ttb-utils.test.ts` (incl. identity validators production never calls).
- **Good (service):** `consumption-service.test.ts` (1164 lines), `transition-side-effects.test.ts`. Gap: `hasOpenSessions` tested only with `in_progress`.
- **Thin (UI):** `session-line-items-editor.test.tsx`, `batch-loss-summary.test.tsx`. Nothing for `PackagingCompletionReview`, `PackagingDayView`, start-packaging dialogs, `RevisePackagingSession`.
- **Zero (SQL):** `create_finished_goods_from_packaging`, `revise_packaging_session`, keg fill/ship automation, `keg_inventory`/`customer_keg_balances`, all four TTB functions — exactly where #1-3 and #7 live.

---

# Appendix D — Finished goods & inventory (full agent report)

## Capability map

**Model: ledger-derived availability, not overwritten quantities.** `finished_goods` (00010:167) with `quantity` = produced total per lot. Every movement is a row in the polymorphic `allocations` table (00010:279, COMMENT: "Single audit trail across raw materials, batches, and finished goods"). Availability computed: `finished_goods_with_availability` = `quantity − SUM(planned+completed allocations)` (00010:451, shape via 00065/00080, security_invoker 00156). Raw materials mirror via `inventory_lots_with_quantities`.

- **Creation:** trigger `on_packaging_session_completion` (00026:205) → `create_finished_goods_from_packaging` (current body 00183:52): one FG per line item with `actual_quantity > 0`, advisory-lock-safe lot number `YYYYMMDD-NNN` (00142:153, UNIQUE since 00142/00149), completed `batch→finished_good` allocation (units; `volume_bbl` NULL by design), `fill` keg transaction for keg lines. Idempotent per line item.
- **Corrections:** `revise_packaging_session` RPC (00184) — transactional, locks rows, guards FG reductions below already-allocated outbound, reverses material depletion LIFO, appends reason to session notes. Genuinely well-built.
- **Outbound:** orders via manual dialog (`order-allocation.tsx`, planned allocations, client FIFO in `order-allocation-utils.ts`) and `generate_pick_list` RPC (00108/00182); taproom/sample/write-off via `recordQuickDepletion` (`consumption-service.ts:741`); Square POS packaged sales via webhook → completed `taproom_sale` allocation (`webhook/route.ts:343`); batch loss via `recordBatchLoss`/`reconcileBatchLoss`.
- **Traceability:** `finished_goods.batch_id` + batch→FG allocation + lot uniqueness; bidirectional trace report `src/app/(app)/reports/trace/page.tsx`. Solid.
- **Counts:** lot-only guided cycle count (`count-adjust-dialog.tsx` + `inventory-count-service.ts`): decrease = completed `adjustment` allocation with `reason_code='count_adjustment'`; increase = direct `inventory_lots.quantity` bump + note.
- **Audit tables:** `entity_revisions` (00019) — full before/after JSONB + `changed_by` on INSERT/UPDATE/DELETE for `finished_goods` (+ batches/orders/recipes/POs), surfaced on FG detail (`finished-good/presentation.tsx:174`). **Not** attached to `allocations`, `inventory_lots`, `session_line_items`, `packaging_sessions`.

## Bugs (live DB checked read-only where noted)

**#1 — CRITICAL (live drift): server-side allocation/pick-list enforcement doesn't exist live** *(= C2)*
Live catalog: `validate_state_transition()` absent entirely, `pick_lists` zero triggers, `cancel_pick_list_allocations` not among live functions — despite 00108:150-180 and 00143:206-212. Cancel a pick list → planned FG reservations stay `planned` forever → stock invisibly unsellable; any PostgREST caller can flip allocation statuses arbitrarily.

**#2 — CRITICAL (live drift): `apply_change_request` missing live; repo version unrunnable** *(= C3)*
`approve/route.ts:13` calls it → runtime failure. Repo def (00094:75-96) references `oi.package_type_id`/`fg.keg_type_id` — columns gone. Its `remove` branch is the only code that releases planned FG allocations when an order line is removed.

**#3 — HIGH: order removals never reach the TTB report** *(= H1)*
FG→order allocations inserted `planned` with `volume_bbl` NULL (`order-allocation.tsx:230-241`; 00108:127-138); **no code path ever completes them** — the only allocation-completing update is the inventory_lot→batch flip (`consumption-service.ts:333-355`); fulfillment only creates keg ship transactions (00183:305). TTB removals CTE requires `completed` AND `volume_bbl` (00041:365, 00191:1099). Live data: 0 completed FG→order allocations, 0 with volume.

**#4 — HIGH: `taproom_sale` excluded from TTB removals entirely** *(= H1)*
Case list in 00041/00191 covers order/sample/loss/destruction/adjustment only; Square webhook writes them without `volume_bbl` anyway (`webhook/route.ts:343-353`).

**#5 — HIGH: no availability guard on allocation inserts → concurrent oversell** *(= H7)*
Only quantity cap is client-side (`order-allocation.tsx:263-271`); `generate_pick_list` reads the aggregate view without locking; no trigger/constraint floor (only `quantity >= 0` on the allocation itself, live-verified). Quick depletion soft-warns but allows (`quick-depletion-dialog.tsx:161-164`).

**#6 — HIGH: `chk_fg_entry_point` (live-verified) contradicts two shipping code paths** *(= H8)*
CHECK requires (batch_id AND session_line_item_id) or (neither). (a) `session_line_items.batch_id` nullable (`session-line-item/core.ts:32`); completion trigger inserts FG with `session_line_item_id` + `batch_id` NULL for batch-less lines (00183:100-118) → check_violation blocks completion (same for 00184's revision-create branch). (b) Manual FG form offers "Source Batch" with no session line (`finished-good/core.ts:27-43`, `presentation.tsx:119-124`) → always errors.

**#7 — MEDIUM: ledger rows hard-deletable and mutable with zero audit** *(= M11)*
Order allocations page deletes rows outright regardless of status (`sales/orders/[id]/allocations/page.tsx:143-163`); `/inventory/allocations` is a generic EntityList over a fully editable schema. No revision trigger on `allocations` (live-verified) — deleting a completed depletion silently restores stock untraced. Deleting an FG (hard delete, `entity-service.ts:382-401`) orphans its allocation rows (polymorphic `source_id`, no FK).

**#8 — MEDIUM: cancelled/fulfilled orders never release or finalize planned allocations** *(= M12)*
No trigger, no transition side effect (`transition-side-effects.ts` covers batches/packaging_sessions/pick_lists only); allocations page blocks editing once cancelled (`allocations/page.tsx:167`) — leaked reservation unfixable via UI.

**#9 — MEDIUM: `revise_packaging_session` misattributes corrections** *(= M13)*
New FG rows/allocations/keg transactions stamped `created_by = v_session.created_by` (00184:190-205), not the reviser. `entity_revisions` on FG catches the true actor; the ledger says the wrong "who."

**#10 — MEDIUM: generic FG edit can set `quantity` below allocated** *(= M14)*
Plain update (`entity-service.ts:262-272`), no counterpart of the revise RPC's outbound guard (00184:160-168): availability negative with no movement row; only trace is the revision diff, no reason field.

**#11 — MEDIUM: count-increase lost-update race; counts lot-only** *(= M15)*
`inventory-count-service.ts:70-93` read-then-write of `inventory_lots.quantity`, no version/eq guard (`optimistic-lock.ts` exists, FG/lot-capable, unused here). No FG cycle-count workflow at all — FG increases require destructive quantity edits.

**#12 — LOW: Square webhook allocates whole sale to one lot uncapped** *(= L5)*
Picks the single oldest lot with any availability, books full quantity (`webhook/route.ts:325-353`) — 10-unit sale against a 2-unit lot → lot at −8, traceability misstated.

**#13 — LOW: bins/transfers are a dead limb for FGs** *(= L6)*
`bin_inventory` has no write path anywhere (src + all migrations; 0 rows live) → FG bin breakdowns always empty; `transfer-lines-editor` can never offer FG stock (reads `bin_inventory` :195-200); `ship_transfer_partial` (00109) moves statuses but never stock; no `destination_type='transfer'` allocation written anywhere.

## Gaps — audit trail ("who / what / when / why")

- **WHO systematically missing on the ledger.** `allocations.created_by` has no default (live-verified); none of the client insert paths set it (order allocation, pick-list RPC, quick depletion, count adjustment, batch loss, packaging depletion). Live: 6 of 8 allocation rows NULL. WHAT/WHEN good; WHO only reliable on RPC-created rows — where it's misattributed (#9).
- **WHY optional almost everywhere:** `reason_code` populated only by quick depletion, count decrease, loss capture; order/pick-list/Square rows carry only free-text notes — which are load-bearing (idempotence guards and reversal matching key on exact `notes` strings; an innocent edit breaks idempotence/reversal).
- **Ledger unaudited and non-append-only:** no `entity_revisions` on `allocations`/`inventory_lots`; rows editable/hard-deletable; count increases and lot-note "paper trails" in a mutable text column.
- **No approval workflow in practice:** `requires_approval`/`approved_by` (00010) never set; destructions/adjustments go straight to `completed`.
- **No stocktake:** single-lot count dialog only; no count sessions, variance report; nothing for FGs.

## Test coverage

- **Good (mocked/pure):** `consumption-service.test.ts` (incl. depletion idempotence, loss reconciliation), `inventory-count-service.test.ts`, `transition-side-effects.test.ts` + `transition-call-sites.test.ts`, `src/domain/__tests__/{consumption-planning,inventory-count,packaging-completion,packaging-revision,ttb-utils}.test.ts`, `order-allocation-fifo.test.ts`, `pick-list-scan.test.ts`, `transfer-lines-editor.test.tsx`.
- **Absent where the bugs are:** zero DB-layer tests (no pgTAP, no `supabase/tests`) for `create_finished_goods_from_packaging`, `revise_packaging_session`, `generate_pick_list`, `cancel_pick_list_allocations`, TTB RPCs, availability views — exactly where #1/#2/#6 sit. No tests for order-allocation mutation, allocations-page delete, Square webhook lot selection.

**Cross-cutting takeaway:** the ledger architecture is right, but three systemic holes undermine audit tracking — (1) live DB silently lost the enforcement/release triggers the repo believes exist, (2) the ledger is unattributed and mutable/deletable with no revision coverage, (3) FG→order rows never complete and never carry volume, so both stock semantics and TTB removals are wrong end-to-end.

---

# Appendix E — Pricing (full agent report)

## Capability map

**Where prices live**
- `pricing_tiers` (00077, trimmed 00078): `name`, `default_upc`, `cogs_max` (COGS band upper bound). Entity: `src/entities/pricing-tier/core.ts`.
- `pricing_tier_prices` — the matrix: one `NUMERIC(10,2)` per tier × selling format × sales channel, `UNIQUE(pricing_tier_id, format_id, sales_channel_id)`; live FK `format_id → selling_formats(id)` (verified live). Entity: `src/entities/pricing-tier-price/core.ts` (matrix-managed, `basePath: null`).
- `sales_channels` (00025): Distributor/Retailer/Taproom/Export — wholesale vs taproom modeled as channels.
- Customer-specific: `customers.sales_channel_id` + `customers.price_tier_id`. Product-side tier: `recipes.pricing_tier_id` (COGS auto-assignment) — used **only** by Square sync.
- History: `pricing_history` + `log_pricing_change()` trigger (00077, rewritten 00098), `changed_by = auth.uid()`.
- Old temporal/brand-specific model (`price_tiers`/`tier_prices`, `effective_from/to`, brand/style overrides, `discount_percent`) dropped wholesale in 00077.

**Price → order flow (snapshot model — correct approach)**
- `order_items.unit_price` snapshotted at line-add; nothing re-reads later. Totals always `SUM(qty × unit_price)` — client (`order-items-editor.tsx:457-459,705`), server views `order_list_details` (00190:419, NULL-coalesced), `customers_with_order_summary` (live def verified), `get_sales_trends` (00190:258).
- Auto-suggest via RPC `get_price_for_customer` (`order-items-editor.tsx:250`) + manual override + per-line "Apply tier price" refresh (:358). Reorder/duplicate re-resolves at current prices with fallback to source price (`reorder.ts:83-105`).
- **Live RPC ≠ migrations:** 00077 drops `get_price_for_customer`; live DB has an out-of-band recreation (live def pulled): resolves `customers.price_tier_id` + `sales_channel_id` → matrix cell; **ignores** `p_brand_id`/`p_style_id`/`p_effective_date`. Tracked as drift item #4 in `docs/plans/2026-06-30-migration-reconciliation-10.md:53`; intent documented in `docs/plans/2026-02-19-keg-pricing-integration.md`.

**Currency/tax/deposits:** USD hard-coded (`src/lib/format.ts:7-19`, Square `catalog.ts:36`); no currency column. Tax: only `customers.is_tax_exempt` → QBO `Taxable` flag (`sync-customer.ts:58`); no tax fields/calcs on orders/invoices. Keg deposits: `containers.deposit_amount` (keg-only CHECK, 00199) + `keg_owner_deposits` overrides; used only in balance/deposit-at-risk reporting — never priced onto orders/invoices.

**Integrations:** Square one-way manual: `resolveTaproomPrices` (`square/pricing.ts`) — brand → recipe tier → taproom matrix cell → `dollarsToCents` (proper round) → catalog push (`api/square/sync/catalog/route.ts:194,281`). Inbound `payment.completed` stores integer `unit_price_cents` for **draft** sales; packaged-good sales become allocations with no price. No `catalog.version.updated` handling. QuickBooks manual: `sync-invoice.ts` description-only lines, `Amount = qty × unit_price`, `UnitPrice` from snapshot.

**Validation:** Matrix `PriceCell` rejects negative/NaN (`price-cell.tsx:70-74`); bulk-adjust rounds to cents, skips would-go-negative (`bulk-adjust-popover.tsx:66-78`); RLS write requires `settings:manage` (verified live). No DB CHECK ≥ 0. Order items: edit path rejects negatives, accepts 0 (`order-item-edit-utils.ts`); zod `unit_price` no min; no DB CHECKs on `order_items` (verified live); NULL price allowed at every state.

## Bugs

**#1 — HIGH: change-request pricing/approval path dead end-to-end (live + replay)** *(= C3)*
`approve/route.ts:13` calls `apply_change_request` — absent live (no `%change_request%` functions), tables also absent (dropped out-of-band; 00197 guards with `to_regclass`). Broken even on replay: portal builder inserts `selling_format_id` (`change-request-builder.tsx:326-334`) but 00092 defines only `package_type_id`/`keg_type_id`; 00094's `add` branch (00094:101-121) inserts dropped columns and calls `get_price_for_customer`, which the chain drops at 00077. Portal submit → error toast; staff approve → 500. Portal pages, staff review, and entity-model doc still present this as live.

**#2 — HIGH (design conflict): two contradictory tier resolutions against the same matrix** *(= H10)*
Order pricing uses the *customer's* tier, ignores the product (live `get_price_for_customer` discards `p_brand_id`, always `is_brand_specific=false`). Square taproom sync uses the *product's* tier (`square/pricing.ts`: brand → `recipes.pricing_tier_id` — the COGS-band assignment `pricing_tiers.cogs_max` exists for). Tier-1 blonde and Tier-6 DIPA, 4-pack, taproom Tier1=$10/Tier6=$16 → POS sells DIPA at $16; staff order for a Tier-1 customer auto-prices it $10. Every brand a customer buys resolves to one tier, defeating the COGS-band design. The 2026-02-19 plan documents customer-tier as intended — needs a product decision, but user-visible mispricing today.

**#3 — MEDIUM: no default tier per channel; customer UI promises one** *(= M9)*
Live RPC: `IF v_pricing_tier_id IS NULL OR v_sales_channel_id IS NULL THEN RETURN;` — old channel-default (`price_tiers.is_default`, 00025) has no equivalent. Yet `customer/presentation.tsx:176-190` labels channel "Determines default pricing tier" and tier "Override default tier pricing (optional)". New customer, override empty → auto-pricing silently never fires.

**#4 — MEDIUM: add-item path coerces $0 → NULL and accepts negatives (edit path does neither)** *(= M10)*
`order-items-editor.tsx:341` `unit_price: item.unit_price || null` — deliberate $0 stored NULL ("—", indistinguishable from unpriced) — the exact bug the edit path fixed (`order-item-edit-utils.ts:35-37`; comment `order-item-edit-utils.test.ts:48`). Add row (:848-850, `handleAdd` :494-504) no ≥0 check: "-5" → inserted; no DB CHECK. Auto-price effect (:296) treats `unit_price === 0` as unset and overwrites. Comp keg at $0 → NULL; typo −12.00 → negative totals into revenue views and QBO invoice.

**#5 — LOW/MEDIUM: price creation unaudited; history write-only** *(= L7)*
Live triggers on `pricing_tier_prices` are UPDATE + DELETE only (verified `pg_trigger`) — inserts write no history, so initial price + author unrecorded, contradicting `entity-model.md` ("every price change is written to an audit history automatically"). No app surface reads `pricing_history`.

**#6 — LOW: QBO invoice raw float math** *(= L8)*
`sync-invoice.ts:61` `Amount: (item.quantity || 1) * Number(item.unit_price || 0)` unrounded (3 × 1.13 → 3.3899999999999997 serialized); `quantity || 1` silently rewrites 0; `is_tax_exempt` fetched (:36-41) never used (no `TxnTaxDetail`).

**#7 — LOW: inconsistent revenue definitions** *(= L9)*
`get_sales_trends` (00190:240+) counts every non-cancelled order incl. drafts; `customers_with_order_summary` counts `fulfilled` only (drafts → `pending_revenue`). Dashboard trend inflates vs customer stats.

## Gaps

- No effective-dated/scheduled price changes (temporal pricing from 00028 lost in the 00077 redesign); open drafts keep stale prices unless the per-line refresh is clicked.
- No brand/style overrides, no discounts of any kind (quantity, order-level, promo).
- Keg deposits never priced onto orders/invoices.
- No tax anywhere (only the QBO customer flag).
- Single-currency USD implicit.
- No missing-price guard at confirm/fulfill/invoice — NULL-priced lines reach QBO as $0 with no warning; `transition-side-effects.ts` has no order-pricing entry.
- Square consistency one-way/manual: no `catalog.version.updated` webhook; Square packaged-good sales recorded as allocations with no price — that revenue never captured.
- Migration chain cannot reproduce live pricing behavior (`get_price_for_customer` out-of-band only — known reconciliation item #4).

## Test coverage

- `order-item-edit-utils.test.ts` — thorough for the *edit* path (0-price, negatives, NaN).
- `reorder.test.ts` — price re-resolution, fallback, no-customer skip (mocked).
- `order-items-editor.test.tsx` — render-only (readOnly totals); no auto-pricing/tier badge/add-path coercion/negative input.
- `square-integration.test.ts` — `dollarsToCents` (float traps), pour volume, webhook signature/replay.
- **Zero tests:** pricing matrix components (`price-cell.tsx` commit semantics, `bulk-adjust-popover.tsx`, `copy-channel-popover.tsx`), `resolveTaproomPrices`, `buildCatalogObjects` money, `sync-invoice.ts` line math, and the price-resolution SQL itself (untestable from migrations since the live function isn't in the chain).

---

# Appendix F — Orders & customer portal (full agent report)

## Capability map

**Order model & allocation**
- Order entity + state machine (`draft → confirmed → scheduled → picking → packed → fulfilled`, plus `cancelled`): `src/entities/order/core.ts:42-69`.
- Order line items (`brand_id`, `selling_format_id`, `batch_id?`, `keg_owner_id`, `style_id`, qty, unit_price): `src/entities/order-item/core.ts:22-39`.
- Allocation entity (polymorphic source→destination, `planned→completed/cancelled`): `src/entities/allocation/core.ts`.
- Allocate FG to order (UI): `src/components/domain/order/order-allocation.tsx`; FIFO utils `order-allocation-utils.ts`.
- Availability view `finished_goods_with_availability` (00191:339-379).
- Pick-list generation RPC (planned allocations, FIFO): 00108, fixed for schema drift in 00182.
- Order allocations admin: `src/app/(app)/sales/orders/[id]/allocations/page.tsx`.
- Fulfillment date trigger (date only): 00180.
- Future-supply projection from planned/fermenting batches: `project_finished_goods()` (00139) — analytics only.

**Portal / customer self-service**
- Portal pages (view orders + submit change requests only): `src/app/portal/(main)/orders/page.tsx`, `.../[id]/page.tsx`, `.../[id]/change-request/new/page.tsx`.
- Change-request builder: `src/components/portal/change-request-builder.tsx`.
- Portal OTP login: `src/app/portal/(auth)/login/portal-login-form.tsx`.
- Portal layout (links via `customer_portal_users`, auto-link by email): `src/app/portal/(main)/layout.tsx`.
- Customer invite (admin→customer): `src/app/api/customers/[id]/invite/route.ts`.
- Staff signup (public): `src/app/(auth)/signup/signup-form.tsx`.
- Change-request approve/reject (staff): `src/app/api/orders/[id]/change-requests/[requestId]/{approve,reject}/route.ts`; RPC `apply_change_request()` 00094.
- RLS: role-based `user_has_permission()` 00097; customer-scoped order policies 00092/00095; API-key hiding 00200.

**Notifications:** order INSERT/status triggers → `notify_all_users()` → in-app + Slack via pg_net (00022, `/api/slack/send`); `orderStatusChangeTemplate` email exists (`src/integrations/email-templates.ts`).

## Verdict vs the user's requirement

- **Orders against planned batches: PARTIAL (essentially NO for true reservation).** Orders can exist pre-stock (creation not gated on inventory), but there is **no allocation/reservation against a planned/future batch** — allocations only source from packaged `finished_goods`. `order_items.batch_id` is a real FK **never written by any UI or RPC** (no `batch` references in `order-items-editor.tsx`; explicitly dropped on reorder — `reorder.ts:16`). `project_finished_goods()` is analytics only. No oversell guard on future volume.
- **Customer self-signup: NO (broken, mis-scoped).** No registration flow; invite-only (`/api/customers/[id]/invite`). The invite does not assign the `customer` role, and on live the portal tables are dropped.
- **Customer self-service ordering: NO.** No "place order" page; `orders:write` is admin/sales. Customers can only VIEW staff-created orders and submit change requests. The portal empty state says orders appear "Once your brewery places an order on your behalf."

## Bugs & security findings

**#1 — CRITICAL: no code path assigns the `customer` role; every portal/invited user defaults to `viewer` → brewery-wide read, customer isolation defeated** *(= C1)*
- `create_user_profile()` (final def `00097:105-126`) assigns `['admin']` to the first user, `['viewer']` to everyone else. The customer-email→`customer` linking (00089/00095) was **removed** by this rewrite, never restored.
- Invite route links `customer_portal_users` but never updates `user_profiles.roles`. Staff invite restricts to `STAFF_ROLES` (`api/users/invite/route.ts`). Grep confirms **nothing** sets `roles=['customer']` in `src/` or migrations.
- RLS consequence: `orders` has two permissive SELECT policies — `orders_select` (00097:322-329, grants `orders:read` to `viewer`) OR `customer_orders_select` (00095:54-61, own rows). A viewer-roled "customer" matches the former for **all** rows. `viewer` also has `customers:read`, `inventory:read`, `recipes:read`, `batches:read`, etc. (`src/lib/permissions.ts:73-110`).
- App shell only redirects to portal when `roles.length === 1 && roles[0] === 'customer'` (`(app)/layout.tsx:38-44`) — a viewer-roled customer browses the full internal app.
- Scenario: invite Customer A → A signs in as `['viewer']`. Portal order-list query has **no** `customer_id` filter (`portal/(main)/orders/page.tsx:34-45`), relies on RLS; as viewer, A sees **every** order (numbers, quantities, unit_price), every customer, recipe, batch, pricing tier — via portal, internal app, or direct authenticated Supabase queries.

**#2 — HIGH: cross-customer data leak through broadcast notifications** *(= H9)*
`notify_all_users()` iterates all `auth.users` (00022:30-35). `trigger_new_order_notification` (00022:216-259) and `trigger_order_status_notification` (00022:138-211) embed the customer name and order number. `notifications_select` allows own rows (00020:281-282). Any portal customer runs `supabase.from('notifications').select('*')` → "New Order Received — ORD-2026-0042 from Competitor Brewing Co." Leaks identity/order numbers/status of every other customer. Independent of #1.

**#3 — HIGH: portal backing tables dropped on live → portal + change requests non-functional in production** *(= C3)*
`customer_portal_users`, `order_change_requests`, `order_change_request_items` absent from generated `src/types/supabase.ts` (generated from live; grep = 0 for each while `orders`/`customers`/`finished_goods`/`allocations` present). Matches comments in `00197:60-63,86-89` ("does NOT exist on the live database — dropped out-of-band"). Portal code masks via `dynamicFrom`/`dynamicRpc` for exactly these tables (`layout.tsx:27`, `change-request-builder.tsx`, `orders/[id]/page.tsx`) — type-checks despite missing tables. Live scenario: layout queries `customer_portal_users` → relation does not exist → `customers` empty → order-list query never runs → portal empty for every customer; change requests error.

**#4 — HIGH: `apply_change_request()` broken by selling-formats schema drift** *(= C3)*
00094 references `order_items.package_type_id`/`keg_type_id` (:76,113-114) and `finished_goods.package_type_id`/`keg_type_id` (:88-89) — dropped in the same refactor that broke `generate_pick_list` (fixed in 00182; this never updated). Approving `add`/`remove` → column 42703 → 500. Only `modify` (quantity, :67-69) succeeds. Moot on live (#3), live bug on any migration-built env.

**#5 — MEDIUM: public self-registration lands as `viewer` with full internal read** *(= M16)*
Portal login `signInWithOtp({ email })` with no `shouldCreateUser: false` (`portal-login-form.tsx:34-42`) — supabase-js defaults true, so any email creates an auth user. Public `/signup` does the same via `signUp`. Both → `['viewer']` (#1) → full internal read. Residual risk depends on hosted project's "allow new signups" toggle — **not verifiable from repo** (no `supabase/config.toml`). MEDIUM pending toggle; CRITICAL if signups on.

**#6 — MEDIUM: order fulfillment never depletes inventory or completes allocations** *(= H1 root cause)*
`runTransitionSideEffects` handles only batches/packaging_sessions/pick_lists — no `orders → fulfilled` effect. 00180 stamps date only. No trigger/RPC flips order allocations `planned → completed`; `finished_goods.quantity` never decremented on shipment. Reservations stay planned forever (availability stays reduced — accidental oversell prevention — but) on-hand inflates indefinitely; TTB "removed for sale" never registered.

**#7 — LOW: stale enum in order-status notifications** *(= L10)*
`trigger_order_status_notification` switches on `ready_to_ship`/`out_the_door` (00022:162-182) — not in current state machine. Only `confirmed`/`cancelled` fire; no ship/fulfill notification.

**#8 — LOW: no staff notification when a customer submits a change request** *(= L11)*
No trigger on `order_change_requests`, no Slack/email call in `change-request-builder.tsx`. Staff must poll the UI.

## Gaps

- No customer order placement anywhere (no portal create-order route; `orders:write` admin/sales).
- No true planned-batch order binding: no reservation of projected volume; `order_items.batch_id` dead; no future oversell guard; delayed/cancelled/under-yielding planned batches have zero automatic effect on orders "expecting" them.
- No customer self-signup; invite-only, invite doesn't grant the role.
- Portal dead on production (#3).
- Overselling guarded only for existing packaged FGs.
- Change-request approval can't re-price/allocate reliably (#4).

## Test coverage

- Order utilities covered: `order-allocation-fifo.test.ts`, `order-item-edit-utils.test.ts`, `order-items-editor.test.tsx`, `reorder.test.ts`, `pick-list-scan.test.ts`, `order-list-view.test.ts`, `order-number.test.ts`.
- Portal context: thin characterization only (`src/contexts/__tests__/portal.test.tsx`) — provider/hook wiring, no data-access/isolation behavior.
- RLS tests (`src/__tests__/integration/rls-{coverage,fail-closed,policy-coverage}.test.ts`) are **static policy-text assertions** (e.g. `selectQualContains: "customers:read"`) — no customer JWT exercised against another customer's orders; cannot catch #1/#2.
- **No tests:** customer/portal isolation (multi-user RLS round-trip), notification broadcast leak, `apply_change_request()` (would have caught #4), fulfillment inventory depletion, planned-batch ordering. `permissions.test.ts` confirms `customer` is intentionally excluded from the staff permission map — precisely the invariant #1 violates at the role-assignment layer.

---

# Appendix G — Coverage gap check (completeness-critic report)

What the six audits did NOT examine. Ranked by relevance to the requested feature areas.

## (a) Missed sub-features inside the six audited areas

**RECIPES**
1. Recipe additions CRUD — `src/app/(app)/production/recipes/[id]/additions/page.tsx` (`recipe_additions`: clarifiers, nutrients; reuses batch `AdditionsEditor`, excludes `water_salt`/`acid`). Not examined anywhere: the recipe→batch flow-down (whether `batch_additions` are seeded from `recipe_additions` on batch creation) — the batch audit covered `batch_additions` in isolation.
2. AI recipe analyzer — `src/domain/ai/recipe-analyzer.ts` + `src/domain/ai/prompts.ts` (has tests). Recipe-facing AI output not in scope.
3. Water profile CRUD — `src/app/(app)/settings/water-profiles/` + `src/entities/water-profile/`. The salt math was audited; the source/target profile data management feeding it was not.
4. Beer styles + brands management — `settings/beer-styles/`, `settings/brands/`. Style-compliance RPCs audited; the style range data they compare against was not.
5. Recipe API route — `src/app/api/recipes/[id]/route.ts`.
6. Recipe costing: confirmed absent as a feature (no cost fields on recipe) — cost enters only at batch consumption via allocations. Product-level gap, not an audit miss.

**BATCHES / BREWLOG**
1. Brew-log ↔ batch linking incl. **blending & split fermentation** — `src/components/domain/brew/brew-log-linker.tsx`, `brew_log_batches` junction (1:1, 1:many split, many:1 blend). Unexamined: volume attribution and loss reconciliation across a blend (consumption-service was audited per-batch).
2. **Production planning suite** — `production/planning/` (forward), `planning/backward` + `src/domain/planning/backward-planner.ts` (345 lines, demand from open orders), `planning/timeline/page.tsx` (Gantt with **interactive batch creation/scheduling** — a second write-path into the batch lifecycle), `src/domain/batch-schedule.ts` (fallback durations used by timeline, dashboard, AI tool, shortfall dialog). Entirely unaudited.
3. Cellar tank map — `production/cellar/page.tsx` → `cellar-board.tsx`, quick actions ("transfer", "mark clean") that shortcut the audited vessel-transfer dialog path.
4. `src/domain/batch-reading-log.ts` — effective-time ordering for backdated readings; parses `datetime-local` in local TZ with `created_at` fallback; feeds "latest reading" displays.
5. Yeast brinks view — `production/yeast-pitches/brinks/`.
6. Batch API route beyond `/transfer` — `src/app/api/batches/[id]/route.ts`.

**PACKAGING**
1. Keg fleet reports — `inventory/kegs/reports/page.tsx`: fleet summary, per-customer kegs out, turnover, aging alerts, **deposits_outstanding money math**. Underlying views audited; this consumer not.
2. Selling-format / container CRUD — `settings/selling-formats/`, `settings/containers/` — the definitions that parameterize BOM and FG creation.
3. Keg serial tracking: confirmed absent (counts by state per format). Product observation.

**FINISHED GOODS & AUDIT TRAIL**
1. **Deliveries** — `inventory/deliveries/` + `src/entities/delivery/core.ts`. Groups location transfers AND order fulfillments into runs (planned → in_transit → completed, `DEL-YYYYMMDD-NNN`). Fell between the FG scope (transfers) and orders scope — neither audited it. Unverified: what side effects fire on completion.
2. **Concrete finding:** entity_revisions triggers exist on exactly 5 tables (`00019_entity_revisions.sql:94-116`: batches, recipes, orders, purchase_orders, finished_goods); no later migration adds more. Packaging sessions, allocations, customers, pricing tables, inventory_lots, keg transactions have no revision history.
3. Lot receiving path — `inventory/lots/` + po-receive entity: PO receipt → lot creation → unit cost (the intake half of raw-material inventory).
4. Inventory valuation report — `reports/inventory-valuation/page.tsx`.
5. `src/services/inventory-service.ts` — `get_inventory_overview` RPC + expiring-lot queries shared by AI chat and inventory-alerts; no scope owned it.

**PRICING / COSTING** (selling prices audited; the entire cost side was unowned)
1. COGS report — `reports/cogs/page.tsx` + `src/lib/reports/cogs.ts` (proportional batch-cost→SKU allocation; has tests).
2. Batch-cost report + shared util — `reports/batch-cost/page.tsx`, `src/domain/report-utils.ts`. **Spot-check flag:** `report-utils.ts:31-35` — `fetchBatchIngredientDetail` includes allocations with `status IN ('completed','planned')`, so batch ingredient cost counts not-yet-consumed planned allocations. Possibly intentional (projected cost) but verify whether COGS uses the same statuses — double-counting risk when a planned allocation is later revised away.
3. Landed cost — `src/domain/purchasing/landed-cost.ts` (per-unit lot cost incl. proportional shipping/tax) — seeds the `unit_cost` that flows through allocations into batch cost and COGS.
4. Projections report — `reports/projections/page.tsx`.

**ORDERS / PORTAL**
1. Order number generation — `src/domain/sales/order-number.ts` + `generate_next_order_number()` (00186). Spot-check: clean (advisory-lock RPC, UNIQUE backstop).
2. Notifications beyond 00020/00022: 00042/00070 (batch-cancel notifications + dup fix), 00148 (trigger security fix), 00174 (**pg_cron scheduled low-inventory check** — a background job nobody audited), 00179 (bulk mark-read RPCs), the `/notifications` center page, `/settings/notifications` prefs.
3. Shipping defaults — `settings/shipping-defaults/`.
4. Deliveries as order fulfillment (cross-listed above).
5. Portal has no order-placement flow (confirmed by file listing). Product observation.

## (b) Unaudited surfaces (outside all six scopes)

- Purchasing core — `purchasing/pos/`, entities purchase-order/po-line-item/po-receive, `src/domain/purchasing/{po-generator,supplier-catalog}.ts` (mature; race-safe PO numbering).
- Ingredient demand + material planning pages — `purchasing/demand`, `purchasing/material-planning`, `src/domain/purchasing/demand-calculator.ts`.
- Suppliers — `purchasing/suppliers/` + supplier entity (incl. catalog-items tab from PR #328).
- Dashboards ×3 — `/dashboard`, `/dashboard/inventory`, `/dashboard/sales` (Today panel consumes batch-schedule math).
- Reports hub + production summary — `/reports`, `/reports/production-summary`.
- AI chat — `src/app/api/chat/` + `src/domain/ai/` (explicitly deferred).
- Slack integration — `src/integrations/slack.ts`, `/api/slack/*`, 00090.
- Email sending — `src/integrations/email.ts`, `email-templates.ts`, `/api/email/send`.
- MongoDB sync — `src/integrations/mongodb/` + `/api/integrations/mongodb/*`.
- QuickBooks beyond invoice sync — sync-bill/sync-customer/sync-supplier, token-manager, sync-log/retry/batch routes.
- Square inventory sync — `/api/square/sync/inventory` + `src/integrations/square/inventory.ts` (webhook + catalog were covered).
- Users/roles admin — `settings/users/`, `/api/users/*`, `src/lib/permissions.ts` role map (mirrored into SQL).
- Staff auth — `(auth)` login/signup/forgot-password, `/update-password`, `/api/auth/callback`, dev-login (portal OTP covered; staff auth wasn't).
- Settings misc — brewery, system, account, locations, sales-channels, status-options (enum_values editor).
- Yeast strain library — `settings/yeasts/`.
- Help center — `/help` + `src/lib/help-content.ts`.
- Ops routes — `/api/health`, `/api/dev/confirm-user`.

## (c) Cross-cutting gaps nobody owned

1. **Generic entity CRUD service** — `src/services/entity-service.ts` (408 lines) and `src/components/universal/entity-detail-unified.tsx`: every entity's create/update/state-transition funnels through these; each scope audited its entity configs but assumed the shared engine was sound.
2. **Optimistic locking adoption** — `src/lib/optimistic-lock.ts` used only by entity-detail-unified and recipe-editor sections. Dialogs, line-item editors, services, RPC paths do plain updates — concurrent-edit safety for allocations, packaging revisions, keg counts never assessed; nor which tables even have a `version` column.
3. **Audit-trail coverage** — entity_revisions on exactly 5 tables (00019:94-116, never extended). Financially significant tables (allocations, packaging_sessions, pricing_tier_prices, keg_transactions) have only `updated_by`.
4. **Soft- vs hard-delete** — no `deleted_at`/`is_deleted` anywhere in src: all deletes are hard deletes relying on FK behavior. Nobody verified ON DELETE rules consistently protect ledger/history rows.
5. **Timezone/date conventions** — mixed: `batch-schedule.ts` formats local `yyyy-MM-dd`, `batch-reading-log.ts` parses datetime-local in browser TZ, `lib/reports/cogs.ts` buckets with local `startOfMonth`, DB stores timestamptz, TTB period boundaries are regulatory. No scope owned date-boundary correctness in reports.
6. **API middleware** — `src/lib/api/auth.ts` (permission enforcement for all routes) and `src/lib/api/rate-limit.ts` (in-memory, per-instance; known limitation DEC-SEC-002). Only the api-key slice got audited (00200).
7. **Query invalidation** — no one audited that mutations/RPCs invalidate the right query keys (e.g., stale `keg_inventory`/availability views after packaging revise or allocation edits).
8. **Editable enums vs hardcoded state machines** — `settings/status-options` edits `enum_values` (validated by 00040 triggers) while entity state machines hardcode transitions in TS; drift between the two is unowned.
9. **Silent-failure surfacing** — transition-side-effects error handling audited for batches only; fire-and-forget QB/Slack/email/Mongo failures and their user-visible surfacing were not.
10. **Shared unit conversion** — `src/domain/units.ts` + `inventory-units.ts` underpin recipes, consumption, packaging, and TTB bbl math; each scope implicitly trusted them.
11. **Report CSV export** — `src/lib/report-export.ts`, shared by all report pages.
