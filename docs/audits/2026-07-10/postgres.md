# Postgres-Specialist Audit — raw report (agent: ecc:database-reviewer, 2026-07-10)

Scope: migrations 00200–00233, live-catalog.snapshot.txt, call sites in src/app/api/square/, src/services/consumption-service.ts, src/services/transition-side-effects.ts. Cross-checked against 2026-07-06 backlog; overlaps marked KNOWN.

Chain-numbering note: this worktree's chain jumps 00227 → 00230 (00228/00229/00234/00235 live on unmerged sibling branch `fix/square-bin-integrity`, commit 77e841b9, PR #363), which independently rewrites the same functions (revise_packaging_session, create_finished_goods_from_packaging, keg_inventory). See PG-1.

**PG-1 — Medium/High — Two branches independently claim overlapping migration numbers against the same functions, coordinated only by prose**
Evidence: 00226_bin_inventory_integrity.sql, 00227_keg_fill_bin_assignment.sql, 00232_keg_fill_netting_integrity.sql:87-105 vs branch fix/square-bin-integrity files 00228/00229/00234/00235. 00232's header documents "INTERPLAY WITH PR #363" — correctness of 00232/00233 depends on a human keeping two branches' migration bodies mentally in sync. On merge, replay order 223…227,228,229,230…233,234,235: each CREATE OR REPLACE silently overwrites the previous; whichever sorts last wins. Byte-for-byte duplicated bodies across ~6 files mean an unmirrored edit or reorder reintroduces an already-fixed bug (e.g. 00229's ship-leg contents-copy fix silently dropped if 00232 merges after it without rebase).
Fix: before merging PR #363, rebase one branch's migrations onto the other's final numbers and diff resulting function bodies statement-by-statement; consider CI check failing when two migrations both CREATE OR REPLACE the same function without explicit ordering comment.

**PG-2 — High — guard_allocation_availability FOR UPDATE locks acquired in caller-determined, not canonically-sorted, order → deadlock risk**
Evidence: 00212_allocation_availability_guard.sql:52-59 (locks inventory_lots/finished_goods FOR UPDATE on every qualifying allocations INSERT/UPDATE); 00232_keg_fill_netting_integrity.sql:601-606 (BOM materials loop, no ORDER BY); src/services/consumption-service.ts:439-486 (byBatch Map iteration + BOM order, unordered, feeds multi-row allocations.insert).
Failure: two concurrent packaging completions/revisions consuming the same shared materials (case/cap SKU in two selling formats' BOMs) lock inventory_lots rows in opposite orders → deadlock_detected aborts one transaction; no retry in consumption-service or revise_packaging_session → raw DB error to user. FEFO within one item is consistently ordered (deadlock-safe); the outer BOM/session-line loops are not.
Fix: sort BOM-materials query and packaging-completion insert batch by stable key (inventory_item_id or locked row id); or catch deadlock_detected/serialization_failure and retry once.

**PG-3 — Medium — bin_inventory.quantity has no CHECK (quantity >= 0) despite two independent decrementing writers**
Evidence: 00010_unified_allocations.sql:221-229 (no CHECK) vs allocations' chk_allocation_quantity_positive (00010:308). debit_bin_inventory (00223/00232 Part 4) and revise_packaging_session bin mirror (00226/00227/00232 Part 2) clamp with GREATEST(0,…) in PL/pgSQL — application guarantee, not schema invariant.
Failure: any future writer (manual PostgREST UPDATE with inventory:write, third writer bug, incident SQL) can drive quantity negative silently; sellable_inventory's LEAST(bi.quantity,…) clamp then reports spuriously low/negative sellable count to POS.
Fix: ALTER TABLE bin_inventory ADD CONSTRAINT chk_bin_inventory_quantity_nonneg CHECK (quantity >= 0);

**PG-4 — Medium — keg/bin netting views recompute full transaction history on every read; no bound, no materialization**
Evidence: keg_inventory (00220:119-170), keg_filled_contents (00220:243-278, layered by sellable_inventory in 00221/00226) — plain views GROUP BY over entire keg_transactions, no time bound; sellable_inventory further UNION/JOINs bin_inventory + keg_filled_contents + finished_goods_with_availability (00010:451-464). Read on every Square sale and sync poll (sync/inventory/route.ts:119-121, sync/catalog/route.ts:87-89).
Failure: keg_transactions append-only, grows forever; every POS sync poll pays ever-increasing aggregation cost. Fine at current scale; classic netting-view-over-unbounded-ledger anti-pattern.
Fix: EXPLAIN ANALYZE checkpoint at ~100k keg_transactions rows; long-term = trigger-maintained materialized balance table (like bin_inventory) or checkpoint/rollup.

**PG-5 — Low — ALTER TABLE … ADD CONSTRAINT UNIQUE on continuously-written log table takes full-table lock inline**
Evidence: 00224_square_sale_idempotency.sql:70-71 (UNIQUE on square_sync_log.square_payment_id); 00233:32-36 (DROP/ADD CHECK inline). ACCESS EXCLUSIVE while building index/validating blocks concurrent webhook inserts. Instant at current counts; if table reaches millions of rows, use CREATE UNIQUE INDEX CONCURRENTLY + ADD CONSTRAINT … USING INDEX.
Fix: no action now; note for future migrations on this table.

**PG-6 — Low/Info — bins_with_summary's SELECT b.* freezes column set at CREATE time (self-documented footgun, already bit once)**
Evidence: 00225 exists solely because 00073's view missed 00222's new bins columns; 00225:24-26 says it will bite again. No lint/CI enforcement.
Fix: process — drift-check assertion (pattern like 00231's pg_policies assertion) comparing bins_with_summary column count to bins.

**KNOWN:** keg_filled_contents not ship-netted (backlog #11 follow-up; subject of unmerged 00229); guard_allocation_availability existence/design = shipped #12 (PG-2 is a new narrower locking-order observation); bin_inventory writer gaps (L6) — 00219+ wiring supersedes; backlog should mark L6 resolved.

**Summary:** 00219–00233 unusually well-engineered (consistent FK indexing, self-rolling-back verification blocks, careful netting invariants). Most consequential: PG-1 (unmerged-branch migration-number collision risking silent function-body regression on merge) and PG-2 (unordered multi-source lock acquisition → genuine deadlock hazard under concurrent packaging sharing BOM materials). PG-3–PG-6 opportunistic hardening.
