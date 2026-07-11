# Test-Coverage Gap Audit — raw report (agent: test-surgeon, 2026-07-10, final version @ 00fbe791)

## Suite map & baseline
- **Baseline: 2078 tests / 131 files, all passing** via `bun run test` (vitest, ~28s) on recreated worktree at 00fbe791 (current origin/main, includes PRs #363/#367). Earlier run at e891a647 gave 2072 — #363 added behavior tests.
- Separate tier NOT in baseline: 4 files in src/__tests__/integration/ run only via `bun run test:integration` (live Postgres, CI job).
- DB layer's only "tests": self-rolling-back DO blocks inside migrations, re-run on PR migration-replay. PR #363's own commit message: "vitest mocks the Supabase client and cannot exercise plpgsql."

## Findings

**TC-1 · C · DB money/inventory RPC-and-trigger layer has zero repeatable behavioral tests**
Untested: debit_bin_inventory (00223/00226 clamp), guard_allocation_availability (00212), guard_finished_good_outbound (00216), create_keg_ship_transactions_from_order FIFO+shortfall-RAISE (00229/00234), handle_vessel_transfer occupancy/empties_source (00210/00228/00235), revise_packaging_session (00217/00219/00232). Backlog line 93 says triggers/RPCs/views "have zero coverage" — still true; grep: no test references any. Minimal: extend vitest.integration.config.ts live-Postgres harness with fixture seeding; per RPC one happy path + one guard rejection. Effort: L (fixtures once), then M per RPC.

**TC-2 · H · Keg fill/ship netting views untested — the area that produced three live bugs in one week**
keg_inventory regrouping (00228 fleet-inflation fix), keg_filled_contents ship-leg netting (00229), sellable_inventory incl <> 'keg' double-count guard (00221). Square sync tests mock these views' output — view regressions pass the suite. Minimal: integration seed receive→fill→ship; assert keg_inventory nets to physical fleet, keg_filled_contents decrements on ship, no FG under both sellable_inventory sources. Effort: M (given TC-1 harness).

**TC-3 · H · Known-unfixed 00219/00221 review findings have nothing pinning them**
(a) 00219 location-blind default-bin fallback — placement trigger NOTICE+skips, FG can silently never reach a bin and vanish from Square sync; (b) 00221 packaged-branch INNER JOIN drops NULL-selling_format_id FGs from sellable_inventory; (c) WHEN-less AFTER INSERT trigger on finished_goods. Zero characterization. Effort: S/M.

**TC-4 · H · P1 compliance fixes guarded only by SQL-text assertions**
ttb-sql.test.ts, actual-og-sg.test.ts, analyze-batch-performance.test.ts assert migration-body substrings via sql-def-helpers — cannot catch runtime failures (the dropped-column class that broke get_inventory_overview/start_batch_fermentation live) nor numeric regressions keeping matched text. TTB Form 5130.9 numbers. Minimal: integration invoke get_ttb_inventory_summary on seeded FGs asserting per-unit bbl = COALESCE(volume_bbl, volume_oz/3968) × unit_count; taproom_sale bucketed as taxpaid removal. Effort: M.

**TC-5 · H · P0 customer-role/RLS fix (#341) shipped with text assertions, not a round-trip**
customer-role-scoping.test.ts asserts pg_get_functiondef text; rls-policy-coverage.test.ts asserts pg_policies text (both self-acknowledged). Behavioral = only rls-fail-closed.test.ts (2 scenarios). Backlog "multi-user RLS round-trip with real JWTs" (line 95) unchecked. Minimal: seed two customers + orders; customer-A JWT on customer-B's orders = 0 rows; invited portal email gets roles=['customer']. Effort: M (auth.users seeding needs service-role).

**TC-6 · H · No TS↔DB state-machine parity test — the exact class of the 'revised' live-abort bug**
00232 fixed "every live packaging revision aborting" (DB registry lacked revised while state-machines.test.ts asserted completed→revised in TS). Nothing compares get_state_transitions() to TS maps in src/lib/state-machines.ts. Minimal: integration diff per entity — read-only query. Effort: S. Cheap test that would have caught a shipped live outage.

**TC-7 · M · Allocation-guard × app-writer interactions + webhook's acknowledged non-transactional residue uncharacterized**
No test exercises app allocation writers (webhook taproom_sale, order FIFO, pick-list, packaging depletion) against 00212's rejection path; webhook comment (~:645) documents orphan-allocation residue — accepted, uncharacterized. Minimal: integration — taproom_sale at exact-available passes; oversell surfaces the DB block message. Effort: M.

**TC-8 · M · Two largest UI engine files zero tests**
entity-detail-unified.tsx (2,063 LOC), entity-data-table.tsx (1,622 LOC) render every entity's detail/list. Minimal: setupRenderHarness() smoke matrix over entities registry asserting sections/tabs/columns render without throwing. Effort: L.

**TC-9 · M · Whole domain component dirs with no __tests__: pricing (7), brew (10), yeast (6), reports (2)**
Pricing is sharp — $0-price bug class lives in pricing UI; backlog #17 (M10 add-path || null coercion, auto-price overwriting explicit $0) open and untested. Minimal: pricing-matrix/order-item price characterization — parse/format round-trip, explicit $0 preserved vs empty→null. Effort: M.

**TC-10 · M · Packaging 'revised' flow covered in TS pieces but not as a flow**
packaging-revision.test.ts (payload builder) + consumption-planning.test.ts (ceiling parity) exist, but revise_packaging_session itself — delta-of-ceils (00217), bin mirror (00219, reproduced byte-for-byte across migrations, fragile), status registration (00232) — no repeatable test. Minimal: integration revise of completed session asserting FG quantity, bin mirror, status='revised' move together. Effort: M.

**TC-11 · M · src/app/** route handlers near-zero coverage outside api/chat + api/square**
Entity API routes guarded only by transition-call-sites.test.ts (source-walking structural test — asserts source text, not behavior). Minimal: request-level tests for 2–3 side-effect-bearing routes (batch transfer, order fulfill). Effort: M/L.

**TC-12 · L · Flagged planned-allocation double-count in report-utils uncharacterized**
report-utils.ts ~:33 sums allocations status IN ('completed','planned'); backlog Appendix G flags possible COGS double-count; report-utils.test.ts has no planned case. Minimal: one planned + one completed allocation on same lot — pin intended sum. Effort: S.

**TC-13 · L · Pure mock-echo suite: client-logger.test.ts** (13/13 assertions toHaveBeenCalled*). Assert emitted payload shape/level. Effort: S.

## Explicitly NOT gaps
- Post-07-06 Square app layer is the best-tested code in the repo: webhook-route.test.ts (21 behavior cases), sync-routes.test.ts ($0-unpriced flagging, swallowed-read aborts, sold-out keep-set, explicit-zero pushes), pricing.test.ts (throws instead of empty map; determinism). $0-price class covered at app layer — residual risk one layer down (TC-1/TC-2).
- Audit P0/P1 fixes did NOT ship test-free (#341/#342/#352/#355/#358/#359 added tests) — but the KIND is the issue for #341/#342 (TC-4/TC-5). Purely-DB fixes (#343–#350, #353, #357, 00228–00235) have only apply-time DO blocks (TC-1).

## Summary
Baseline 2078/131 passing at 00fbe791 (+4 integration files in separate tier). Risk concentrated in plpgsql: every inventory-integrity fix and the keg/bin netting stack shipped with one-shot DO blocks; P0/P1 compliance fixes pinned by text assertions. Top: TC-1 (harness fixtures + RPC guard tests), TC-2 (netting views), TC-6 (TS↔DB parity — cheap, would have caught a live outage).
