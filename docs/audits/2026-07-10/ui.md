# UI Systems Audit — raw report (agent: ui-systems-expert, 2026-07-10)

Base: worktree @ e891a647. Severity context: query-client.ts:8-11 sets global staleTime 2 min (CACHE_DURATIONS.DYNAMIC_DATA), refetchOnWindowFocus prod-only, no global MutationCache error handler — a missed invalidation = up to 2 min of confidently-wrong data even after navigating; any useMutation without onError fails silently.

**UI-1 — H — Packaging-session completion never refreshes the finished-goods, keg, or bin caches its own DB trigger just wrote**
packaging-completion-review.tsx:303-317 invalidates packaging_sessions, session line items, ["allocations"], inventoryKeys.lots(), material planning — nothing else. Revise path proves intent exists: revise-packaging-session.tsx:139-144 invalidates finishedGoodKeys.all() + entityKeys.all("finished_goods_with_availability"). Host adds only session-detail invalidation (packaging-day-view.tsx:112-118).
Failure: completion fires create_finished_goods_from_packaging (FG lots + keg fills + default-FG-bin per 00227). Complete keg-fill run → open /inventory/finished-goods, /inventory/kegs, bin detail, keg fleet report — new lots/fills absent up to 2 min; staff can double-enter.
Fix: also invalidate finishedGoodKeys.all(), entityKeys.all("finished_goods_with_availability"), entityKeys.all("keg_inventory_with_details"), kegKeys.*, binKeys.all(). Owner: ui-systems.

**UI-2 — H — Systemic key mismatch: domain mutations invalidate key roots no universal list reads**
Universal lists key on fetchTable = viewTable || table (entity-data-table.tsx:277, :832). Domain mutations invalidate inventoryKeys.lots() = ["inventory","lots"] — ZERO query readers (only countLots sub-key); real lots list rooted at ["inventory_lots_with_quantities"]. Five flows: count-adjust-dialog.tsx:144, quick-depletion-dialog.tsx:182, brew-consumption-dialog.tsx:135, packaging-completion-review.tsx:314, revise-packaging-session.tsx:135. Same shape: po-accept-inventory-dialog.tsx:449 invalidates binKeys.all() (["bins"]) while bins list roots at ["bins_with_summary"] (bin/core.ts:102).
Failure: adjust lot count from lots page row action — visible row keeps old quantity; accept PO into bins — bin counts don't move.
Fix: invalidate entityKeys.all(viewTable) alongside domain keys, or (better, structural) config-driven relatedInvalidations on EntityConfig. Owner: ui-systems + entity-architect. (Appendix G c7 listed invalidation as unaudited — this is the concrete confirmation; NEW.)

**UI-3 — H — Transition side-effect cache invalidations run for exactly one of four-plus call sites**
transition-side-effects.ts:337-345 guards allocation/FG-availability invalidations on optional queryClient param. Only production/batches/[id]/page.tsx:283 passes it. Universal paths — entity-data-table.tsx:390, :1107 (bulk), entity-detail-unified.tsx:710 — and packaging-completion-review.tsx:229 do not.
Failure: cancel order from list/kanban/detail — side effect releases planned FG reservations server-side but FG availability + order-allocation caches stay stale; staff can re-release or oversell against phantom reservations. Batch completion from list leaves vessel/allocation/loss caches stale.
Fix: pass queryClient at all call sites (in scope at each); note existing invalidations also miss ["finished_goods_with_availability"] root (UI-2). Owner: ui-systems.

**UI-4 — M — Keg-transaction CRUD never refreshes keg inventory or fleet surfaces**
Universal create/edit invalidates only entity.table + entity.viewTable (entity-detail-unified.tsx:651-659) = ["keg_transactions"]/["keg_transactions_with_details"]. /inventory/kegs is a different entity over derived view (keg-inventory/core.ts:81-82 → ["keg_inventory_with_details"]); kegKeys.* (fleet/turnover/aging/balances, query-keys.ts:558-568) invalidated nowhere except keg-owner-deposits-editor.tsx:163.
Failure: record keg receive/fill/return — kegs-page counts and fleet report unchanged; per-bin keg tracking stale.
Fix: same mechanism as UI-2 (config-driven related invalidations). Owner: entity-architect + ui-systems.

**UI-5 — M — QuickCreateDialog invalidates base table but not viewTable**
quick-create-dialog.tsx:312-315 invalidates entityKeys.all(config.table) + dynamic options only. ~19 configs declare viewTable; every universal list keys on it; entity-detail-unified.tsx:653-657 handles both, quick-create missed it.
Failure: quick-create vessel/keg-owner from combobox, open list page — record absent up to 2 min.
Fix: if (config.viewTable) invalidate entityKeys.all(config.viewTable). Owner: ui-systems.

**UI-6 — M — PO line-item editor repeats M10's $0 → NULL add-path bug, plus unvalidated inline updates**
po-line-items-editor.tsx:184 — unit_price: item.unit_price || null ($0 stored as NULL ≡ unpriced); updateItem (:200-214) writes raw {[field]: value}, no ≥0/NaN validation — HTML min={0} (:303,:339) bypassable by typing. 2026-07-06 audit + backlog #17 cover only the ORDER editor (order-items-editor.tsx:341 — KNOWN, open); PO twin never flagged. Exactly the shared line-item-editor bug class the dedup arc predicted.
Fix: reuse order-item-edit-utils.ts parser in both add paths; fold into backlog #17. Owner: ui-systems.

**UI-7 — M — Silent mutation failures on integration/pricing toggles (no onError, no global handler)**
(a) Square enable/disable: settings/integrations/page.tsx:255-267 — failed POST = no toast, switch snaps back silently. Fresh bin-sync install: user believes sync enabled, nothing pushes. (b) Channel-format toggle: format-management.tsx:80-108 via bare .mutate at :172 — checkbox reverts silently; format never joins channel, pricing-matrix cells never appear. [= SF-8]
Fix: onError toasts + consider global MutationCache.onError fallback in query-client.ts. Owner: ui-systems.

**UI-8 — L — Pick-list bin/brand lookups ignore query errors**
order-pick-list.tsx:152-172 — three parallel queries (brands/selling_formats/bin_inventory) errors never checked ({data:[]} fallbacks have no error field). Transient failure → "Unknown" brand/format and NO bin location, no error state — picker walks warehouse without bin guidance.
Fix: check all three, render error row with retry. Owner: ui-systems.

**UI-9 — L — FG bin breakdown renders errors as "empty"**
fg-inventory-section.tsx:41-56 — neither query destructures error/isError; failed bin_inventory read ≡ genuinely unbinned lot. Square sales now debit bin_inventory; staff reconcile with this panel — error-as-empty invites false "missing stock" conclusions.
Fix: surface isError with retry. Owner: ui-systems.

**UI-10 — L — Square status endpoint failure displays as "not connected"**
settings/integrations/page.tsx:228-231 — if (!res.ok) return null → 500 renders card as not-connected (badge + hidden sync controls), prompting credential re-entry. [same class as SF-10]
Fix: distinguish query error from unconfigured. Owner: ui-systems.

## KNOWN (verified still present; tracked)
- M10 order add-path unit_price || null — order-items-editor.tsx:341 (backlog #17, open).
- L4 negative quantities via parseIntOrNull — add-line-item-row.tsx:243,260, packaging-day-view.tsx:251,269, session-line-items-editor.tsx:160.
- M15b FG cycle-count workflow absent (backlog #18 ui lane).
- P4 editor/schema drift (no DB CHECKs behind editors) — unchanged.

## Clean checks
- Zero direct @hookform/resolvers/zod imports — form-resolver.ts wrapper convention holds.
- All 287 non-test files under src/components/ imported somewhere (path-level; per-export deadness not assessed — knip unreliable here).
- No entity-name literals driving logic in universal/*.tsx; entity-relation-table.tsx read-only.
- Optimistic transition machinery in entity-data-table.tsx:305-408 sound: cache-guarded validity, optimistic write, state-guarded UPDATE with 0-row rollback, error rollback via parsePostgresError; entity-kanban.tsx:268-271 rolls back + toasts on drag failure.

**Summary:** Dominant defect class = TanStack Query invalidation drift: domain mutations invalidate hand-picked key roots while universal lists key on view-table names; shared side-effect hook gets queryClient at only 1 of 4+ call sites — packaging completion (UI-1), lots/bins (UI-2), order cancellation (UI-3), new keg/bin surfaces (UI-4/5) all show minutes-stale data after their own writes. Secondary: PO editor repeats M10 (UI-6); four mutation/query paths swallow errors (UI-7–10), two on the Square bin-sync setup path. Fix order: config-driven relatedInvalidations on EntityConfig (kills UI-1/2/4/5) → pass queryClient at three universal call sites (UI-3) → fold UI-6 into backlog #17 → global MutationCache error fallback (UI-7).
