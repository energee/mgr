# `relatedInvalidations` design — killing TanStack Query invalidation drift

**Date:** 2026-07-11 · **Backlog:** 2026-07-10 audit P2 item 12 (UI-1..UI-5, three High) · **Status:** DESIGN — no implementation yet
**Owners:** `entity-architect` (config shape, per-entity matrix) + `ui-systems-expert` (universal-layer wiring)

## 1. Problem, restated as the four drift classes

All five findings are instances of four mechanical classes:

| Class | Example (audit) |
|---|---|
| **A. View-root mismatch** — mutation invalidates a domain root no universal list reads; lists key on `viewTable` | `inventoryKeys.lots()` = `["inventory","lots"]` vs list root `["inventory_lots_with_quantities"]` (UI-2, five flows); `binKeys.all()` vs `["bins_with_summary"]` (po-accept) |
| **B. Cross-entity blindness** — a write to entity X changes derived data of entity Y, but only X's keys are invalidated | packaging completion → FG lots/keg fills/bins untouched (UI-1); keg-transaction CRUD → keg-inventory/fleet untouched (UI-4) |
| **C. `queryClient` starvation** — `runTransitionSideEffects` can invalidate cross-entity caches but only 1 of 4+ call sites passes `queryClient` (UI-3) | order cancel from list/kanban/detail leaves FG-availability + order-allocation caches stale |
| **D. Partial own-key handling** — `QuickCreateDialog` invalidates `table` but not `viewTable` (UI-5) | quick-created vessel absent from `/production/vessels` for up to 2 min |

Root cause: every call site hand-picks its invalidation list. Nothing ties "what a write to entity X touches" to X itself. New concrete miss found during this design pass (same class C/A): `transition-side-effects.ts:198` invalidates `entityKeys.all("orders")` after pick-list→order sync but **not** `order_list_details`, the orders list's actual `viewTable` root.

## 2. Decisions (summary)

1. **`relatedInvalidations` lives on `EntityCore`** (not presentation) — it's pure data, server-safe, and `transition-side-effects.ts` (a React-free service) must read it via `src/entities/cores.ts`.
2. **Keys are static values produced by `src/lib/query-keys.ts` factories, evaluated at module load.** No functions, no per-id keys in config. Per-id keys (e.g. `orderKeys.allocations(orderId)`) stay in `transition-side-effects.ts` where the ids exist. Repo law preserved: no literal key arrays anywhere.
3. **Shape is `{ always, onTransition }` — no create/update/delete split.** Every concrete miss in UI-1/2/4/5 is either "on any write" or "on reaching state S". A three-way CRUD split adds config surface with zero driving case; add it later only if one appears.
4. **One composition function**: `invalidateEntityWrite()` in a new `src/lib/entity-invalidation.ts`. It is the *only* place that turns (entity, write kind, ids) into invalidation calls. Baseline (own table + viewTable + detail + revision + dynamic-options keys) + `relatedInvalidations`.
5. **Two consumption tiers**: CRUD surfaces call `invalidateEntityWrite` directly; **all transition invalidation moves inside `runTransitionSideEffects`** (which calls `invalidateEntityWrite` itself). Call sites just pass `queryClient` — that *is* the UI-3 fix, and per-call-site invalidation lists die because the call sites no longer own any.
6. **Cross-entity table writes inside side effects resolve cores via a new `coresByTable` map** exported from `src/entities/cores.ts` — so e.g. the pick-list→orders sync invalidates orders' `table` *and* `viewTable` without hardcoding `"order_list_details"`.

## 3. Config shape (TypeScript)

```ts
// src/types/entity.ts (type-only import; erased at compile time, stays React-free)
import type { QueryKey } from "@tanstack/react-query";

/**
 * Query keys of OTHER entities/views/domains that must be invalidated when
 * this entity is written. Values MUST come from src/lib/query-keys.ts
 * factories (repo law). Static, root-level keys only — per-record keys
 * belong in transition-side-effects.ts where the ids are known.
 */
export type RelatedInvalidations = {
  /** Invalidated after EVERY successful write: create, update, delete, and any transition. */
  always?: readonly QueryKey[];
  /** Extra keys per state transition, keyed by target state (must be a stateMachine.states member). */
  onTransition?: Readonly<Record<string, readonly QueryKey[]>>;
};

export type EntityCore<T = Record<string, unknown>> = {
  // ... existing fields ...
  relatedInvalidations?: RelatedInvalidations;
};
```

Declaration example (`src/entities/keg-transaction/core.ts` — `core.ts` may import `@/lib/query-keys`; it is a pure module):

```ts
import { entityKeys, kegKeys, binKeys } from "@/lib/query-keys";

export const kegTransactionCore: EntityCoreInput<KegTransaction> = {
  // ... existing fields ...
  relatedInvalidations: {
    always: [
      entityKeys.all("keg_inventory"),
      entityKeys.all("keg_inventory_with_details"),
      kegKeys.fleetSummary(), kegKeys.turnoverMetrics(),
      kegKeys.agingReport(), kegKeys.customerBalances(),
      binKeys.all(), entityKeys.all("bins_with_summary"),
    ],
  },
};
```

## 4. Consumption — the choke points

### 4.1 `src/lib/entity-invalidation.ts` (new)

```ts
import type { QueryClient } from "@tanstack/react-query";
import type { EntityCore } from "@/types/entity";

export type EntityWriteKind =
  | { type: "create" | "update" | "delete" }
  | { type: "transition"; toState: string };

/**
 * THE single composition point for post-write cache invalidation.
 * Baseline (always): entityKeys.all(table); entityKeys.all(viewTable) if set;
 * per id: entityKeys.detail(table, id) + entityKeys.detail(viewTable, id) +
 * revisionKeys.forEntity(table, id); dynamicOptionsKeys.all().
 * Then: relatedInvalidations.always, plus onTransition[toState] for transitions.
 * Returns Promise.all of the invalidations — callers `void` it except
 * QuickCreateDialog, which awaits so the host combobox resolves the new label.
 */
export function invalidateEntityWrite<T>(
  queryClient: QueryClient,
  core: Pick<EntityCore<T>, "table" | "viewTable" | "relatedInvalidations">,
  kind: EntityWriteKind,
  ids?: readonly string[],
): Promise<void>;
```

Notes: `dynamicOptionsKeys.all()` on every kind is a deliberate widening (today only QuickCreate does it) — status/name edits legitimately change filtered option sets, and the cache is tiny. `relatedInvalidations` keys fire unconditionally (no success-conditional gating as `transition-side-effects` does for vessels today) — an occasionally-unnecessary refetch of a small query is the cheap side of the trade.

### 4.2 Transitions — `runTransitionSideEffects` owns ALL transition invalidation

- Signature unchanged: `(supabase, table, ids, toState, queryClient?)`.
- At the **top** of the function (before any `await`, so list reconcile stays immediate for fire-and-forget callers): resolve `coresByTable.get(table)` and call `invalidateEntityWrite(queryClient, core, { type: "transition", toState }, ids)` when `queryClient` is present.
- Existing hardcoded **root-level** invalidations move into the entity configs (batch/order/pick-list matrices below); **per-id** keys (`orderKeys.allocations(orderId)`) stay in the service. Cross-entity table writes (pick_lists→orders sync, batches→vessels release) invalidate via `coresByTable` lookup of the *written* table — table + viewTable both, killing the `order_list_details` miss.
- **UI-3 fix**: pass `queryClient` at `entity-data-table.tsx:390` (single), `:1107` (bulk), `entity-detail-unified.tsx:710` (detail), and `packaging-completion-review.tsx:229`. `pick-list-items.tsx:319` and `batches/[id]/page.tsx:283` audited in the same pass (the latter already passes it). Server call site `api/batches/[id]/transfer/route.ts` stays queryClient-less by design (no client cache).
- The universal components then **delete** their own post-transition invalidation lines (`entity-data-table.tsx:398-405`, `:1114-1121`; `entity-detail-unified.tsx` transition `onSuccess`'s `invalidateEntityCaches`) — the service covers them. Failure-path reconcile invalidations (0-row guard at `:332`/`:379`, kanban dialog-cancel snap-back at `:1426`) stay: those are "refresh, nothing was written", not write invalidation.

### 4.3 CRUD surfaces

| Surface | Change |
|---|---|
| `entity-detail-unified.tsx` `invalidateEntityCaches` (:651-662) | Body becomes `void invalidateEntityWrite(queryClient, entity, kind, [recordId])`; save mutation passes `create`/`update` per mode; transition path drops it (4.2). |
| `quick-create-dialog.tsx` (:312-315) | Replace the two hand lines with `await invalidateEntityWrite(queryClient, config, { type: "create" }, [id])` — viewTable (UI-5) and related keys come for free. |
| Delete `onSuccess` handlers (`entity-data-table.tsx:1463-1471`, `:1496-1508`; detail page delete `entity-detail-unified.tsx:1527-1530`) | Replace hand lines with `invalidateEntityWrite(..., { type: "delete" }, ids)`. |

### 4.4 Domain dialogs (the UI-1/UI-2 call sites)

These don't flow through universal components; they adopt the same helper with the *affected* entity's core (direct `core.ts` import — React-free, already in the bundle via the registry):

| File | Replace hand list with |
|---|---|
| `count-adjust-dialog.tsx:144-146`, `quick-depletion-dialog.tsx:181-183`, `brew-consumption-dialog.tsx:134-135` | `invalidateEntityWrite(qc, inventoryLotCore, { type: "update" })` (+ keep dialog-specific extras like `inventoryKeys.finishedGoodsAvailable()` where the dialog touches FGs) |
| `po-accept-inventory-dialog.tsx:443-449` | `invalidateEntityWrite(qc, inventoryLotCore, { type: "create" })` + `invalidateEntityWrite(qc, binCore, { type: "update" })` |
| `packaging-completion-review.tsx:303-317` | Pass `queryClient` to its `runTransitionSideEffects` call; drop the hand list (packaging-session `onTransition.completed` config covers UI-1's whole set) |
| `revise-packaging-session.tsx:125-143` | `invalidateEntityWrite(qc, packagingSessionCore, { type: "transition", toState: "revised" }, [sessionId])` (revise flow ends in the real `revised` state) |

## 5. Per-entity `relatedInvalidations` matrix

Baseline own-key handling (table/viewTable/detail/revisions/dynamic-options) is automatic — the matrix lists only extras. Entities not listed (`brew_log`, `recipe`, `vessel`, `beer_style`, `brand`, `customer`, `bin`, `keg_owner`, `keg_inventory`, `supplier`, `location`, `user_profile`, `water_profile`, `sales_channel`*, `po_receive`*: see rows) need **none** — 20 of 39 entities declare nothing.

Two recurring patterns: **[alias]** = the entity's hand-named domain key root differs from its table name, so the entity must self-declare it; **[cross]** = derived data of another entity.

| Entity | `always` | `onTransition` |
|---|---|---|
| `batch` | — | `completed`: `inventoryKeys.lots()`, `entityKeys.all("inventory_lots_with_quantities")`, `inventoryKeys.itemOnHand()`, `inventoryKeys.allocations()`, `entityKeys.all("vessels")`, `entityKeys.all("vessels_with_batch")`, `reportKeys.ttb()` (moves the service's hardcoded vessel/allocation roots into config) |
| `packaging_session` | — | `completed` AND `revised` (same list): `finishedGoodKeys.all()` [alias], `entityKeys.all("finished_goods")`, `entityKeys.all("finished_goods_with_availability")`, `entityKeys.all("keg_inventory")`, `entityKeys.all("keg_inventory_with_details")`, `kegKeys.fleetSummary()`, `kegKeys.turnoverMetrics()`, `kegKeys.agingReport()`, `binKeys.all()`, `entityKeys.all("bins_with_summary")`, `inventoryKeys.lots()`, `entityKeys.all("inventory_lots_with_quantities")`, `inventoryKeys.itemOnHand()`, `inventoryKeys.allocations()`, `materialPlanningKeys.all()`, `entityKeys.all("batches")` — **this row is the UI-1 fix** |
| `session_line_item` | `entityKeys.all("packaging_sessions")`, `entityKeys.all("packaging_sessions_with_summary")`, `materialPlanningKeys.all()` [cross] | — |
| `keg_transaction` | `entityKeys.all("keg_inventory")`, `entityKeys.all("keg_inventory_with_details")`, `kegKeys.fleetSummary()`, `kegKeys.turnoverMetrics()`, `kegKeys.agingReport()`, `kegKeys.customerBalances()`, `binKeys.all()`, `entityKeys.all("bins_with_summary")`, `entityKeys.all("customers")` (per-customer keg-balance panels) — **this row is the UI-4 fix** | — |
| `order` | `entityKeys.all("customers_with_order_summary")` [cross: customer viewTable aggregates orders] | `fulfilled`: `inventoryKeys.allocations()`, `finishedGoodKeys.all()`, `entityKeys.all("finished_goods_with_availability")`, `reportKeys.ttb()`, `entityKeys.all("keg_inventory")`, `entityKeys.all("keg_inventory_with_details")`, `kegKeys.fleetSummary()`, `kegKeys.customerBalances()` (fulfillment trigger creates keg ship legs); `cancelled`: `inventoryKeys.allocations()`, `inventoryKeys.finishedGoods()`, `inventoryKeys.finishedGoodsAvailable()`, `entityKeys.all("finished_goods_with_availability")` (adds the miss UI-3 flagged) |
| `order_item` | `entityKeys.all("orders")`, `entityKeys.all("order_list_details")`, `entityKeys.all("customers_with_order_summary")` [cross: totals] | — |
| `pick_list` | `pickListKeys.all()` [alias `["pick-lists"]` ≠ `pick_lists`] | `in_progress`, `completed`: `entityKeys.all("orders")`, `entityKeys.all("order_list_details")` (fixes the `order_list_details` miss in the pick-list sync) |
| `delivery` | — | `completed`: `entityKeys.all("orders")`, `entityKeys.all("order_list_details")` (declared now; becomes load-bearing when EA-2's deliveries→orders side effect lands, backlog #6) |
| `inventory_lot` | `inventoryKeys.lots()` [alias], `inventoryKeys.itemOnHand()`, `inventoryKeys.summary()`, `inventoryKeys.overview()` — **this row is the UI-2 fix** (dialogs get view root + domain roots from one call) | — |
| `inventory_item` | `inventoryKeys.items()` [alias `["inventory","items"]` ≠ `inventory_items`] | — |
| `allocation` | `finishedGoodKeys.all()`, `entityKeys.all("finished_goods_with_availability")`, `inventoryKeys.lots()`, `entityKeys.all("inventory_lots_with_quantities")`, `reportKeys.ttb()` [cross: availability + TTB removals derive from allocations] | — |
| `finished_good` | `finishedGoodKeys.all()` [alias `["finished-goods"]` ≠ `finished_goods`], `inventoryKeys.finishedGoodsAvailable()` | — |
| `location_transfer` | `transferKeys.all()` [alias `["transfers"]` ≠ `location_transfers`] | `completed` (stock physically moves): `binKeys.all()`, `entityKeys.all("bins_with_summary")`, `inventoryKeys.lots()`, `entityKeys.all("inventory_lots_with_quantities")`, `finishedGoodKeys.all()`, `entityKeys.all("finished_goods_with_availability")` |
| `vessel_transfer` | `entityKeys.all("vessels")`, `entityKeys.all("vessels_with_batch")`, `entityKeys.all("batches")` [cross: occupancy + remaining volume] | — |
| `yeast_strain` | `yeastKeys.strainMaxGenerations()` [alias; table is `yeasts`] | — |
| `yeast_pitch` | `yeastKeys.all()` [alias `["yeast-pitches"]` ≠ `yeast_pitches`] | — |
| `yeast_pitch_event` | `yeastKeys.all()`, `entityKeys.all("yeast_pitches")`, `entityKeys.all("yeast_pitches_with_remaining")` [cross] | — |
| `purchase_order` | `purchaseOrderKeys.all()` [alias `["purchase-orders"]`] | — |
| `po_line_item` | `purchaseOrderKeys.all()`, `entityKeys.all("purchase_orders")` [cross: totals/status]; **requires new root factory** `purchaseOrderKeys.allLineItems()` = `["po-line-items"]` in `query-keys.ts` (today only the per-PO key exists) — include it here once added | — |
| `container` / `selling_format` | `packagingFormatKeys.all()` [alias: view spans both tables] | — |
| `pricing_tier` | `settingsKeys.pricingTiers()` [alias] | — |
| `pricing_tier_price` | `settingsKeys.pricingMatrix()` [cross] | — |
| `sales_channel` | `settingsKeys.pricingChannels()` [alias], `channelFormatKeys.all()` | — |
| `po_receive` | `poReceiveKeys.all()` [alias `["po-receives"]`] (lot/bin effects handled at the accept dialog per §4.4 — the receive record itself doesn't move stock) | — |
| `enum_value` | `settingsKeys.enums()` [alias] | — |

Deliberately **excluded** everywhere: `dashboardKeys.*`, `planningKeys.*`, `purchasingKeys.*`, non-TTB `reportKeys.*` — dashboards/reports tolerate the 2-min staleTime and adding them to every write nearly doubles the matrix for no confirmed defect. Revisit only against a reported staleness bug.

## 6. Implementation task list (follow-up pass)

Ordered; tasks marked ∥ can run in parallel once their dependency lands.

1. **Foundation** — `src/types/entity.ts` (add `RelatedInvalidations` + field on `EntityCore`), new `src/lib/entity-invalidation.ts`, new `src/lib/__tests__/entity-invalidation.test.ts` (real `QueryClient`, spy on `invalidateQueries`; asserts exact key set per kind, ids handling, transition-extra merge).
2. **Cores lookup** — `src/entities/cores.ts`: export `coresByTable: ReadonlyMap<string, EntityCore>` built from `allCores` (39 entries; assert no duplicate table names at module load). Does NOT change `coreRegistry` or the 39-key contract in `core-registry.test.ts`.
3. **Transition choke point** (needs 1+2) — `src/services/transition-side-effects.ts`: call `invalidateEntityWrite` at top when `queryClient` present; migrate root-level hardcoded invalidations to configs (task 5); cross-entity writes invalidate via `coresByTable`; update module header. Extend `src/services/__tests__/transition-side-effects.test.ts`.
4. ∥ **Universal CRUD surfaces** (needs 1) — `entity-detail-unified.tsx`, `entity-data-table.tsx` (transitions: pass `queryClient`, drop own post-transition lines; deletes: helper), `quick-create-dialog.tsx` (UI-5). Extend `quick-create-dialog.test.tsx` for viewTable invalidation.
5. ∥ **Per-entity configs** (needs 1; parallelizable by domain) — apply §5 matrix to the listed `core.ts` files; add `purchaseOrderKeys.allLineItems()` to `src/lib/query-keys.ts`.
6. ∥ **Domain dialogs** (needs 1+5) — the six files in §4.4.
7. **Guard tests** (needs 3+4+5) — new `src/entities/__tests__/related-invalidations.test.ts`: for every core in `allCores`, each `onTransition` key is a member of `stateMachine.states`, every declared array is non-empty, every key is a non-empty array (typo guard). Extend `src/services/__tests__/transition-call-sites.test.ts` with a second source-walk over `src/components` + `src/app/(app)`: every client `runTransitionSideEffects(` call expression must pass `queryClient` (API routes exempt) — makes the next UI-3 regression fail CI.
8. **Docs** — module comments in new files; update `transition-side-effects.ts` header; one-line convention in `CLAUDE.md` ("cross-entity invalidation via `relatedInvalidations` + `invalidateEntityWrite`, never hand lists"); check off backlog item 12.

**Acceptance criteria** (all checkable via `tsc`/`vitest`): `bun run typecheck` clean; full `bun run test` green including the four new/extended suites; grep-verifiable: zero `invalidateQueries` calls remain in `quick-create-dialog.tsx` / the §4.4 dialogs' success paths outside the helper, and `entity-data-table.tsx` retains only the failure-path/reconcile invalidations enumerated in §4.2.

## 7. Out of scope (explicit)

- **Server-side cache semantics** — API routes and future AI writes (Phase 4B) have no `QueryClient`; unchanged. Cross-browser-session freshness (Supabase realtime/broadcast) is a different mechanism entirely.
- **UI-6..UI-10** (PO editor `$0→NULL`, silent mutation toasts, error-as-empty reads) — backlog #18.
- **EA-1/EA-9** create-mode status bypass — backlog #13; `onTransition` fires only on real transitions, so create-as-completed stays broken until #13.
- **Per-id relation keys in config** — rejected; they stay in `transition-side-effects.ts` / call sites.
- **Dashboard/planning/report keys** beyond `reportKeys.ttb()` — see §5 exclusion note.
- **Optimistic-update machinery** in `entity-data-table.tsx` — untouched; this design changes only what happens after a confirmed write.
- **Global `MutationCache.onError`** (UI-7) — backlog #18.
