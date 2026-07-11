# Brewing Domain Audit — raw report (agent: brewing-domain-expert, 2026-07-10)

All targeted domain tests pass (363/363 across src/domain, ttb-sql.test.ts, consumption-service.test.ts).

**Worktree caveat:** worktree HEAD (e891a647) is behind origin/main — PR #363 (00228/00229/00234/00235) and PR #367 merged after worktree creation; agent verified 00229's ship-writer via `git show origin/main:...`; findings hold on both trees.

## Re-verification of shipped fixes
- **H2 (TTB SQL volume math) — RECONFIRMED.** 00203:49,162 uses COALESCE(volume_bbl, volume_oz/3968.0) * unit_count, matches computeUnitFillVolumeBbl (consumption-planning.ts:259-268). taproom_sale CASE arm present (00203:242-246). Pinned by ttb-sql.test.ts; no later migration redefines; get_ttb_report composes. validateRowBalance/validateEndingInventory wired into reports/ttb/page.tsx:216-221. H6 MIN_PER_UNIT_OZ heuristic gone from use-catalog.ts.
- **H3 (Plato/SG actual_og) — RECONFIRMED.** 00204 converts once in view (formula ≡ platoToSg, units.ts:288); consumers take SG as-is; analyze_batch_performance filtered+converted; ABV>25 repair included.
- **H5/M6 (loss-reconciliation filters) — RECONFIRMED.** consumption-service.ts:708-714: OPEN=[planned,in_progress], PACKAGED=[completed,revised]; reconciliation idempotence keys on allocations.idempotency_key (batch_reconcile:<id>, :570,679), not notes.
- **H1 (removals ~0) — PARTIALLY FIXED, see BD-5.** orders→fulfilled side effect exists (transition-side-effects.ts:228-313); Square packaged sales stamp volume_bbl per FIFO draw (webhook/route.ts:596-640).

## New findings

**BD-1 · H · TTB removals bucket by created_at, not completed_at — materially wrong now that H1 fulfillment fix is live**
00203:231-233 (status='completed' AND created_at in period; same keying :66-67,:102-103 for begin/end inventory) vs transition-side-effects.ts:272-283 (June-created planned reservations flip to completed at July fulfillment). Order allocated June 28, fulfilled July 3 → removal lands in JUNE's (possibly filed) report, never July's; filed month silently mutates. Identity validators can't catch (begin/end use same wrong key). Fix: bucket removals AND alloc_before/alloc_end on COALESCE(completed_at, created_at) together, one migration. Owner: brewing-domain + data-layer.

**BD-2 · H · Draft (keg pour) taproom sales never reach TTB removals — square_draft_sales is a write-only dead end**
Webhook keg branch writes only square_draft_sales (webhook/route.ts:689-726) — no allocation, no volume_bbl. Only readers repo-wide: types/supabase.ts + webhook's own test; no reconciliation UI/job despite entity-model.md:15 ("staged for reconciliation"). Every pint sold via Square = taxpaid removal (brewing-domain.md:19) but reports 0.00 on Form 5130.9 unless staff independently recordQuickDepletion (double-counts once reconciliation ships). Fix: staged→taproom_sale-allocation reconciliation flow (volume from keg's actual container, see BD-3), dedup link to square_draft_sales.id. Owner: brewing-domain + integrations.

**BD-3 · M · Hard-coded 16-oz pour poisons draft volume at source**
square/utils.ts:24-26 (quantity * STANDARD_POUR_OZ), consumed webhook:703. Any keg-mapped variation (4-oz taster, crowler, whole to-go keg) recorded 16 oz/unit. Half-bbl to-go keg = 16 oz vs 1,984 oz (124× under). Becomes direct TTB error when BD-2 reconciliation consumes volume_oz. Fix: per-variation pour size on square_catalog_map (or derive whole-keg volume from containers.volume_bbl). Owner: integrations, sign-off brewing-domain.

**BD-4 · M · Same Square variation counted in kegs by inventory push but sold in pours by webhook**
sync/inventory/route.ts:160-188 pushes sellable_inventory keg rows AS-IS (quantity = filled-keg count, 00221:57-65); webhook:517-518 classifies same mapping's sale as draft pour. 3 half-bbls push "3 in stock"; 3 pints sold → tap marked sold out with ~2.9 kegs on hand. Fix: one unit per keg variation — exclude source='keg' from PHYSICAL_COUNT pushes, or convert kegs→pour-equivalents. Owner: integrations.

**BD-5 · H · Wholesale-order removals still ~0 in practice — fulfillment only completes reservations that were never created**
Side effect reads status='planned' FG→order allocations (transition-side-effects.ts:229-235), no-ops when none; live had ZERO FG→order allocations as of 2026-07-07 (backlog #9 note); nothing forces allocation/pick-list before fulfillment. Keg shipments write keg_transactions (00229) — TTB never reads. taxpaid_domestic_bbl stays 0.00 despite H1 fix being code-complete. Fix: at orders→fulfilled synthesize completed allocations from order_items (brand+format FIFO, volume via computeUnitFillVolumeBbl) when no reservations exist, or hard-require allocation before fulfillment. Owner: entity-architect + brewing-domain.

**BD-6 · M · Revisions now actually work (00232 Part 5) — and retroactively rewrite filed TTB months**
00232:844-853 reveals every live revision had been ABORTING since 00184 ('revised' missing from enum_values) — path only now live. revise_packaging_session updates finished_goods.quantity in place (00232:444-447); TTB reads current fg.quantity keyed on production_date (00203:49,162). August revision of July session changes July's filed beer_packaged_bbl/ending inventory, no adjustment entry. Fix: route cross-month revision deltas to adjustments_bbl of revision month, or snapshot filed months. Owner: brewing-domain + data-layer.

**BD-7 · L · TTB page and totals silently omit adjustments_bbl**
get_ttb_report includes adjustments in total_removals_bbl (00041:494-499); TTBTotals/calculateTotals (ttb-utils.ts:94-166) have no adjustments field; page renders no adjustments column. Non-zero adjustment → displayed components don't sum to Total Removals; validators still pass. Fix: add adjustments to TTBTotals + page. Owner: brewing-domain.

**BD-8 · L · Yeast-lineage fallback no cycle guard (known quirk, reconfirmed unfixed)**
yeast-lineage.ts:29-41 — unbounded for(;;) walking parent_pitch_id; corrupted cycle infinite-loops client, one query/iteration. Fix: visited-set + cap (~32).

**BD-9 · L · Gravity dual-implementation persists in batch-readings.ts (known, reconfirmed)**
batch-readings.ts:190-195 uses 259−259/SG approximation vs canonical polynomial units.ts:287-296 (~0.0002–0.0007 SG divergence — disagrees at packaging-completion 3rd-decimal rounding). yeast-calculations.ts:257 re-exports canonical. Fix: point batch-readings.convertGravity at units, re-baseline chart tests.

Known-open reconfirmed unchanged: in-process cellar inventory uses current batch statuses regardless of month; production dated on batches.updated_at; direct keg fills outside sessions not counted; brew_log_batches DECIMAL(8,2) quantization (mitigated by reconciliationThresholdBbl).

**Summary:** H2/H3/H5-M6/H1-code RECONFIRMED, SQL↔TS parity green; 00219–00233 netting genuinely sound. Live compliance risk moved from formula bugs to FLOW bugs: BD-1 (created_at bucketing), BD-2/BD-3 (draft pours TTB-invisible), BD-5 (wholesale removals stay zero). Secondary: BD-4 unit mismatch, BD-6 revisions rewriting filed months.
