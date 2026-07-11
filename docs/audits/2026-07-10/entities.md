# Entity Architect Audit — raw report (agent: entity-architect, 2026-07-10)

**Audit base:** original worktree @ e891a647 (2 behind main); every candidate finding cross-checked against PR #363's diff — nothing below is already fixed on main (now merged as 00fbe791).

## Re-verification (RECONFIRMED / REGRESSED)
- **H1 (order fulfillment side effects) — RECONFIRMED.** transition-side-effects.ts:228-314 (orders→fulfilled completes planned FG→order allocations, stamps completed_at + volume_bbl via computeUnitFillVolumeBbl, status-guarded idempotent); :324-346 (orders→cancelled releases planned reservations, M12). All six transition call sites route through registry; guard tests pass (59/59 incl transition-call-sites.test.ts).
- **H6 (volume_oz semantics) — RECONFIRMED.** 00202 normalized rows; use-catalog.ts:83-88 documents per-unit invariant (heuristic gone); webhook reuses computeUnitFillVolumeBbl.
- **Transition enforcement — RECONFIRMED.** 00205 restored validate_state_transition + triggers; 00232 Part 5 (837+) registers 'revised' enum; packaging-session core documents DB backstop (core.ts:66-71).
- **H5 — RECONFIRMED fixed.** consumption-service.ts:709-711 counts revised as packaged/closed.
- **C3 (change-request approve) — RECONFIRMED still broken, known/deferred.** approve route still calls dropped apply_change_request RPC — matches backlog #10 decision (fold into portal rebuild #20).
- **Registry — CLEAN.** 39 entity dirs = 39 allEntities = 39 allCores; core-registry.test.ts + entity-configs.test.ts pass. Bin POS columns (00222/00225) wired end-to-end.

## Fresh findings

**EA-1 · M · Create-mode status select bypasses the entire transition machinery**
packaging-session/presentation.tsx:110-115, order/presentation.tsx:121, batch/presentation.tsx:177 (free status selects); 00026:206 (AFTER UPDATE OF status — INSERT not covered); validate_state_transition BEFORE UPDATE (INSERT not covered); entity-detail-unified.tsx:939-944 strips state field on EDIT only.
Scenario: create packaging session with status "Completed" → no FG-creation trigger, no depletion, no side effects; session immediately read-only (line editors gate on planned) = stuck FG-less "completed" record. Same for orders created as fulfilled.
Fix: restrict create-form status options to state machine initial state(s); optionally INSERT-time DB check. Owner: entity-architect.

**EA-2 · M · No deliveries → completed side effect — order fulfillment not synced from delivery runs**
delivery/core.ts:8-9 + relations :115/:120-123 (orders.delivery_id); covered-pairs list (transition-side-effects.ts:12-17) has no deliveries entry.
Scenario: staff complete delivery run = "beer shipped"; linked orders stay packed, planned FG allocations never complete, TTB removals under-report — H1 re-enters through the delivery door.
Fix: register deliveries→completed → flip linked orders packed→fulfilled (pattern of pick_lists sync :171-202, chains into orders→fulfilled effect). Owner: entity-architect.

**EA-3 · M · 00212 availability guard can reject recording a physically-completed Square sale**
00212:33-47 (exempts only destination_type='adjustment'; counts planned reservations); webhook :628-640 inserts completed finished_good→taproom_sale allocations.
Scenario: FG reserved for wholesale (planned) after last inventory push; POS still sells physically → guard trips → line failed; no TTB removal, no bin debit, only sync-log error. Guard blocks recording reality.
Fix: exempt completed taproom_sale inserts, or webhook catches guard error and records clamped allocation. Owner: entity-architect + data-layer. [= IN-7]

**EA-4 · M · Post-completion session revision leaves batch's reconciliation loss allocation stale**
consumption-service.ts:762-780 (reconcileBatchLoss one-shot via reconciliationKey(batchId)); only trigger = terminal batches→completed (transition-side-effects.ts:97); revise_packaging_session adjusts FGs/bins/kegs/materials but never the reconciliation allocation; no packaging_sessions→revised side effect.
Scenario: batch completed (loss booked vs 100 cases) → revise to 90 → true loss grew; TTB losses line stale forever, no warning.
Fix: revise RPC or new packaging_sessions→revised registry entry recomputes delta and updates reconciliation allocation (reason_code='reconciliation' + idempotency key make it addressable). Owner: entity-architect + brewing-domain.

**EA-5 · M (known/documented) · bin_inventory counter drifts HIGH on every non-Square draw**
00226:402-425 — only debit_bin_inventory (Square) and revise deltas decrement; order fulfillment, samples, losses, quick depletion write only the allocation ledger. LEAST clamp protects POS read; bin UI (bins_with_summary, FG breakdowns) shows inflated counts (documented ponytail).
Fix (sketched in 00226): bin-dimension the allocation ledger; interim: debit bin in orders→fulfilled for FGs in bins. Owner: entity-architect.

**EA-6 · L · Bin POS config has no both-or-neither pairing rule**
bin/core.ts:86-90 — square_location_id and pos_sales_channel_id independently optional; no zod refine, no DB CHECK (00222 adds only unique index). Bin with one set silently isn't a sync target.
Fix: .refine() both-or-neither + form hint. Owner: entity-architect.

**EA-7 · L (documented) · Webhook allocation insert + bin debit not atomic** [= IN-5]
webhook :645-655 ponytail comment. Fix: fold into one RPC returning actual debited amount. Owner: integrations (cross-listed).

**EA-8 · L · sellable_inventory per-row LEAST clamp can over-report if one FG ever spans multiple bins**
00226:407-421 — clamp is per (bin, FG) row against whole-FG availability; two bins holding same FG each clamped independently (6+4 vs availability 5 → reports 9). Safe today only because placement writes exactly one row per FG and transfers don't move bin stock.
Fix: note invariant, or clamp against availability minus other bins' claims when bin-transfer writer arrives. Owner: entity-architect.

**EA-9 · L · Status fields typed z.string() instead of state enums**
order/core.ts:29, packaging-session/core.ts:40. Client accepts any string on create (server enum registry catches). Fix: z.enum(stateMachine.states). Folds into EA-1's fix. Owner: entity-architect.

**Verified-clean spot checks:** 00233 order-keyed claim semantics (allocation dedup rides sync-log claim, notes not load-bearing); webhook FIFO splits across lots (audit L5 fixed) with real per-lot allocations + volumes; keg-transaction manual create single-row, keg_inventory view derives both legs from one row; bins/keg-fill bin stamping issues fixed by 00232 + 00228/00229.

**Summary:** All re-verified fix clusters RECONFIRMED, 39-entity registry fully consistent, no criticals. Fresh theme = side-effect completeness at the seams: create-mode status selects bypass transition machinery (EA-1), delivery completion doesn't fulfill orders (EA-2), post-completion revisions never re-flow reconciliation loss (EA-4), availability guard can block recording real Square sales (EA-3). Bin counter one-way drift (EA-5) = main deferred bin-sync debt.
