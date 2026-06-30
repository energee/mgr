# Codebase Audit & Remediation Plan

_Date: 2026-06-30_
_Scope: Next.js 16 / React 19 / Supabase · ~139k LOC TS/TSX · 41 entity configs · ~60 Postgres views · 151 migrations_
_Method: 6-dimension parallel audit (42 agents), every falsifiable claim adversarially verified (40/41 findings survived); AI-chat layer read end-to-end._

---

## Verdict (TL;DR)

**Refactor incrementally. Do not rebuild.** Every hard problem is already solved in the repo: an entity-config system drives 97/133 pages through universal list/detail/mobile renderers, ~60 views already derive almost all totals/balances/costs at read time, and **all nine KEEP domains are real, wired, and substantive.** A rebuild would discard working views, RLS, integrations, and the entire KEEP surface to re-solve problems whose solutions already live here.

The real work is three sentences: **route the UI through the service layer you already built, turn two drift-prone stored values into views, and give QA a real table.** Each is surgical and gateable on `bun typecheck` + `vitest run`.

> **"Voice-first" is currently aspirational.** There is zero `SpeechRecognition` / `MediaRecorder` / `getUserMedia` / STT code anywhere; the only AI surface is a text chat panel. Voice is net-new work, not a refactor — and the QA-logging gap (§4) is the thing standing between the current app and a credible voice story.

---

## 1. What's already right (don't break these)

| Strength | Evidence |
|---|---|
| **View-derivation is a real, applied pattern** | `order_totals`, `customer_keg_balances`, `inventory_lots_with_quantities`, `recipes_with_cogs`, `yeast_pitches_with_remaining` all compute live. `keg_inventory` was *refactored from a stored-quantity table into a view* over `keg_transactions` (mig 00139) — proof the team actively applies the principle. |
| **Entity-config core** | 41 configs → universal `EntityDataTable` / `EntityDetailUnified` / `EntityMobileCardList`. 97/133 pages config-driven. Mobile genuinely wired (`useIsMobile`). |
| **Query-key discipline** | Every query routes through `src/lib/query-keys.ts` factories. Zero inline literal `queryKey` arrays in non-test src. |
| **A clean service layer exists** | `src/services/entity-service.ts` — no React deps, injected Supabase client, `ServiceResult<T>`, validated state transitions, optimistic locking. Already unit-tested. |
| **Exemplary domains** | Yeast pitch-events (immutable event log + remaining-quantity *view*, never a stored balance) and packaging (`packaging_sessions` + `session_line_items` + `finished_goods_with_availability` + server-side state machine). |

Decisive fact for the rebuild question: **the right abstractions are present and reused.** The defects are about *wiring*, not *absence*.

---

## 2. Core architectural defect: a bypassed seam

`entityService` — the clean, validated, optimistic-locked CRUD layer — **is imported only by the AI chat tools.** The entire human UI (`entity-data-table.tsx`, `entity-detail-unified.tsx`, `use-entity-record.ts`, plus 116 files with direct `.from()`) re-implements list/get/create/update/transition/delete inline against an `any`-typed `dynamicFrom()` helper.

Consequences, severity order:

1. **Divergent concurrency safety (data-loss class).** Four state-transition paths, three optimistic-lock paths. The **detail-page transition** (`entity-detail-unified.tsx:462`) — the primary way users change status via action buttons — is the one path that *omits* the `.eq(stateField, currentState)` lost-update guard the others enforce. Two users advancing the same batch can silently clobber each other.
2. **The validated path is the one users never hit.** Declarative state machines in the configs are enforced on the AI write path but not the UI write path.
3. **No compile-time safety where it's actually used.** The 9,950-line generated `supabase.ts` buys nothing on the `any`-typed UI query path — surfacing as 54 hand-rolled `as unknown as` casts.

> _Refuted claim, corrected:_ an auditor flagged "view names hardcoded across ~100 files, no registry." Verification narrowed this — `EntityConfig.viewTable` *is* the registry; ~⅔ of cited hits are auto-generated types. Real literal `.from('view')` bypass sites total ~15 (API routes, dialogs, AI tools), not 100. Bounded and largely intentional.

---

## 3. Derived-data violations (the central principle)

Principle is **strongly honored overall.** Two genuine violations, one systemic gap:

| # | Stored value | Why it's wrong | Fix |
|---|---|---|---|
| **1 (HIGH)** | `inventory_lots.landed_cost` | Fully derivable (lot → `po_receives` → `po_line_items` unit_price/qty → PO shipping/tax, allocated by line value). Instead **stored, NULL until `calculate_landed_cost()` is invoked as an UPDATE side-effect from a read-path display helper**, never recomputed when inputs change — and **feeds stale numbers into `cogs_by_period`.** Derivable yet stored, and not even an immutable snapshot. | Read-time view `inventory_lots_with_landed_cost` (reuse the mig-00146 formula); drop the RPC's UPDATE. |
| **2 (MED)** | `vessels.current_batch_id` | Cellar occupancy ("which batch in which tank") is derivable from the `vessel_transfers` ledger, but is denormalized onto a **trigger-maintained column that drifts** on out-of-band edits — so badly that an **undocumented `vessel_batch_drift_check` view exists solely to detect the divergence.** The principled replacement `vessels_with_current_batch` is **specced in docs and marked "Implemented" in DECISIONS.md — but was never built.** Can't model split/blended fermentation. | Build the spec'd view over `vessel_transfers` + batch status; retire the column, its trigger, and the drift-check view. Keep `vessels.status` (genuine workflow state). |
| **3 (MED)** | Report/dashboard aggregates | The 6 report pages + 3 dashboards compute COGS, cost-per-bbl, inventory valuation, TTB rollups in **500–1500-line React client components** that `reduce()` over base tables in JS — bypassing both the view principle and the universal table/filter/mobile infra. | Back each with a Postgres reporting view (`cogs_by_sku`, `inventory_valuation`, `ttb_summary`); reduce pages to thin shells. |
| **4 (LOW)** | QA measurements in `brew_logs.events` JSONB | mash pH, pre-boil gravity, OG live only inside a JSONB blob, reachable only via fragile repeated `jsonb_array_elements` subqueries. Not aggregatable by a view. | Keep `events` as log-of-record; add `brew_log_measurements` view flattening phase/metric/value. |

_Correctly NOT flagged:_ `batches.actual_fg/actual_abv` are manual finalized lab inputs (documented intentional); order/PO line totals are correctly unstored. Verified as snapshots/inputs, not drift.

---

## 4. Schema: batch tracking & QA logging

**Batch tracking is modeled well.** `brew_log_batches` (M:N) cleanly supports split-ferment, parti-gyle, and blend-at-knockout; lifecycle is enforced server-side (mig 00143). Healthy.

**QA logging is the most serious functional gap — with a live bug.** Three disconnected notions of a batch "reading", **no first-class home for any**:

- `src/domain/batch-readings.ts` (312 lines) — app-side validation logic.
- `brew_logs.events` JSONB / `batch_logs` JSONB — where measurements *actually* live (untyped, unqueryable by views).
- A **phantom `batch_readings` table** — referenced by `analyze_batch_performance()` but **never created by any migration.** Migration `00167` "resolved" the dangling reference by **hardcoding `readings_count → 0, latest_reading → NULL`** (verified at `00167:172-173`).

`analyze_batch_performance` is called from 7 sites in the AI layer. Net effect: **on a "voice-first" platform, the assistant is structurally blind to the readings it exists to capture — it always answers "zero readings."** No typed columns, no constraints, no sensory/lab concept, no hold/release/disposition gate before allocation or sale. This single gap is why voice can't ship: there's nowhere for a voice-logged reading to land queryably.

---

## 5. Feature bloat — verified removable

All confirmed zero-importer (grepped during verification):

| Item | Size | Action |
|---|---|---|
| **22 orphaned components** (recipe sub-editors fruit/sugar/spice/adjunct/mash/fermentation; batch cost-breakdown, start-fermentation-dialog, additions-display, recipe-context; purchasing po-line-items-editor, po-receiving, po-receive-dialog; yeast-selector; 2 data-table; ai-elements/panel) — survived the #317 reorg as dead code | **~7,083 LOC** | Delete |
| **MongoDB import subsystem** (`src/integrations/mongodb/*`, API routes, settings UI, `mongodb` npm dep) — one-shot legacy importer, a smell in a Postgres app | ~1,860 LOC + heavy dep | Delete (keep `mongodb_sync_*` tables only if history wanted) |
| **`media-chrome`** npm dep | zero refs repo-wide | Drop |
| **`@xyflow/react`** npm dep | sole importer is orphaned `ai-elements/panel.tsx` | Drop after panel deletion |
| **Deprecated `EntityConfig` fields** (`detailSections`/`formFields`/`createFields`/`editFields` + dead renderer fallback at `entity-detail-unified.tsx:126`) | 0 of 39 configs use them | Delete (update 3 test fixtures) |
| **Unused batches/recipes REST routes** (`api/batches`, `api/recipes` CRUD) — no frontend calls; PATCH already drifted | — | Delete; **keep** `/api/batches/[id]/transfer` (real server logic) |
| **~35 unused exports** in `ai-elements/prompt-input.tsx` | — | Trim to 4 used (PromptInput, PromptInputTextarea, PromptInputFooter, PromptInputSubmit) |

_Keep:_ Square + QuickBooks + Slack integrations are genuinely wired into settings/entity flows. AI chat is real (text-only). Reports (6) and settings (~20) are genuine, not stubs.

---

## 6. AI chat interaction layer

Read end-to-end: `src/app/api/chat/{route,tools,entity-map}.ts` (1,786 LOC) + `chat-panel.tsx` + `chat-context.tsx`.

**Verdict: architecture good, implementation fraying.** Solid bones, accumulating drift. Not a rewrite — same "one source of truth" treatment as the rest of the app.

### Good (keep)
- **Write-safety model is correct.** AI never mutates directly. Write tools (`createBatch`, `transitionBatch`, `addBatchReading`, `createPackagingSession`) return a `NavigationIntent` action card; the client renders it and the **user clicks through to a prefilled form/dialog and submits via the normal UI path** (`chat-panel.tsx:191-218`). Human-in-the-loop for all mutations.
- **Reads are config-driven through the clean service.** `searchEntity` / `getEntityDetail` → `entityService` + `CHAT_ENTITY_MAP`, reading from views. The one place in the app that actually uses the service layer.
- Route hygiene: `withAuth`, 10-req/min rate limit, per-user API key + system fallback.

### Messy (fix)
1. **Entity list hand-copied across 3 files that must stay in sync:** `CHAT_ENTITY_MAP` (412 lines, 39 entities, `entity-map.ts`), `ENTITY_TYPE_TO_REGISTRY` (`route.ts:34`), `ENTITY_MAP` (`chat-context.tsx`, comment: "Must stay in sync with..."). Add an entity → edit 3 files or chat can't see it.
2. **Batch state machine copied a 4th time, needlessly:** `transitionBatch` re-declares `validTransitions` inline (`tools.ts:1033`) with a "Keep in sync" comment that is **stale** — `batchTransitions` already lives in the React-free `src/lib/schemas/batch.ts` and can just be imported.
3. **Tool sprawl:** header claims `searchEntity` "replaced ~16 hand-crafted tools", but ~15 bespoke search tools exist anyway (`searchOrders`, `searchBrewLogs`, `searchPurchaseOrders`, `searchSuppliers`, `searchPickLists`, `searchYeastPitches`, `getKegInventory`, `getCustomers`, `getFinishedGoods`…), most just `searchEntity` + custom columns. ~30 tools where ~12 would do.
4. **Three data-access styles in one file:** raw `supabase.from()`, `any`-typed `dynamicFrom()`, and `entityService`/`inventoryService`.
5. **Inherits the QA bug:** `addBatchReading` (writes `batch_logs` JSONB) and `analyzeBatch` (`readings_count=0`) are exposed as a pair — invites logging a reading it then can't read back (see §4).

### Fix (folded into priorities below)
- Import `batchTransitions` in `transitionBatch`; delete inline copy. **(P0/S, free)**
- Collapse the 3 entity maps into one React-free descriptor (the EntityConfig split, #12). **(P2)**
- Delete the ~15 bespoke search tools; add a `columns`/`select` param to `searchEntity`; keep only true multi-table aggregators (`getVesselAvailability`, `getInventoryOverview`, `getIngredientInventory`). **(P2/M)**

---

## 7. KEEP-priority health

| Domain | Health | Reason |
|---|---|---|
| Purchase orders | ⚠️ needs-work | No stored totals (good), but PO-receiving is a non-atomic browser-side multi-table write, and `landed_cost` drift feeds stale cost. |
| Ingredients | ✅ healthy | Demand, shortfall, COGS/margin all derived in views/RPCs. |
| Recipes | ⚠️ needs-work | COGS/estimates view-derived, but ~5k LOC of orphaned sub-editors as dead weight. |
| Batches / brew logs | 🔴 at-risk | No QA readings table; AI analysis blind; detail-page transition skips the concurrency guard. |
| Cellar management | 🔴 at-risk | Drift-prone `current_batch_id`; can't model split fermentation. |
| Packaging | ✅ healthy | Sessions + line items + availability view + server state machine. |
| Orders | ⚠️ needs-work | No stored totals (good), but rides the bypassed UI write path. |
| Finished goods + inventory | ⚠️ needs-work | Availability view-derived, but no QA hold/release gate before allocation; `landed_cost` drift reaches COGS. |
| Pricing | ✅ healthy | COGS, margin-by-channel, projections derived; only risk is inherited `landed_cost` drift. |

---

## 8. Refactoring priorities

### P0 — stop the bleeding (small, this week)
1. **[S]** Repoint `analyze_batch_performance()`'s fermentation block at real `batch_logs` measurement rows (kill the hardcoded `0`/`NULL` from mig 00167). The AI lies about readings today.
2. **[S]** Add `.eq(stateField, currentState)` to the detail-page transition (`entity-detail-unified.tsx:462`), or route it through `entityService.transition`. Closes the lost-update hole on the primary status-change path.
3. **[S]** Import `batchTransitions` in `transitionBatch` (`tools.ts:1033`); delete the inline `validTransitions` copy. Free; removes the 4th state-machine copy + a stale-comment trap.
4. **[M]** Convert `inventory_lots.landed_cost` to a view (`inventory_lots_with_landed_cost`); repoint `cogs_by_period`; drop the `calculate_landed_cost` UPDATE side-effect.

### P1 — structural (the real refactor)
5. **[L]** Route all universal UI writes (EntityDataTable, EntityDetailUnified, dialogs, useEntityRecord) through `entityService`; delete inline `dynamicFrom` CRUD/transition blocks. _Keystone fix._
6. **[L]** Create a first-class `batch_readings` table (+ `batch_readings_latest` and readings-over-time views); migrate existing `batch_logs` measurement rows; make it the single voice-logging target.
7. **[L]** Back the 6 reports + 3 dashboards with reporting views; reduce each page to a thin shell.
8. **[M]** Build `vessels_with_current_batch` over the `vessel_transfers` ledger; retire `vessels.current_batch_id`, its trigger, and the drift-check view.
9. **[S]** Delete the 22 orphaned components (~7,083 LOC), the MongoDB subsystem, deprecated EntityConfig fields, and `media-chrome`/`@xyflow/react`.
10. **[S]** Capture out-of-band schema (the undocumented `vessel_batch_drift_check` view, any other un-migrated objects) in migrations; audit live DB vs migrations — **the DB currently cannot be recreated from migrations**, which is how the QA gap escaped notice.

### P2 — hardening
11. **[M]** Type `DynamicQueryBuilder` as a generic over table/view names; regenerate view types; delete the 54 escape casts behind `tsc`.
12. **[L]** Split `EntityConfig` into a React-free data/schema descriptor (table/view/columns/zod/state-machine) + a presentation descriptor. **Also collapses the 3 hand-synced AI-chat entity maps (§6.1) into one source.**
13. **[M]** Move multi-statement business writes (PO receiving, allocations) behind Postgres RPCs for atomicity; inject `SupabaseClient` into `landed-cost`/`backward-planner`/`po-generator`/`demand-calculator`.
14. **[M]** Delete the ~15 bespoke AI-chat search tools; add `columns` param to `searchEntity`; keep only true aggregators (§6).
15. **[S]** Delete unused batches/recipes REST CRUD routes (keep `/api/batches/[id]/transfer`); reconcile stale `production.md`/`brew-logs.md` with live schema.
16. **[M]** Decompose `entity-detail-unified.tsx` (1,710 lines) into section/relation/action/form modules; split `domain/shared` into app-shell vs feature widgets.

---

## 9. Phased path

- **Phase 0** — P0 items 1–4 (low-risk integrity fixes).
- **Phase 1** — Centralize the schema seam (lift entity → {table, viewTable, columns} into one descriptor; `CHAT_ENTITY_MAP` already proves the shape). Fixes §6.1/§6.2.
- **Phase 2** — Unify the write path through `entityService` (#5); move multi-table writes to RPCs (#13).
- **Phase 3** — Type & split (#11, #12); delete escape casts behind `tsc`; collapse chat entity maps; trim chat tools (#14).
- **Phase 4** — Close the QA gap (#6) + de-drift cellar (#8). _Unlocks voice._
- **Phase 5** — Prune (#9, #15) + back reports with views (#7); reconcile migrations with live DB (#10).

Each phase is independently shippable and gateable on `bun typecheck` + `vitest run`.

---

## Bottom line

This is a codebase ~80% of the way to its own stated architecture (views + configs), held back by **one bypassed service, two stored-derived columns, one missing QA table, and a chat layer that needs single-source-of-truth dedup** — plus actually building voice. A quarter of focused work, not a rewrite.
