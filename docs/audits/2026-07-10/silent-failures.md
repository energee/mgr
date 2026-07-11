# Silent Failure Audit — raw report (agent: ecc:silent-failure-hunter, 2026-07-10)

Read-only sweep of `src/integrations/**`, `src/app/api/**`, `src/services/**`, and mutation call sites. Ranked by blast radius (money/inventory/compliance first). Note: `src/app/api/square/webhook/route.ts`, `src/app/api/square/sync/catalog|inventory/route.ts` are largely well-hardened from the recent fix commits (fa4089e4, 17a54e8c) — most `error` reads there are checked and thrown loudly. The findings below are gaps that survived that pass, plus equivalent unfixed patterns in QuickBooks and MongoDB sync.

---

**SF-1 — Critical — Unread catalog-mapping error silently drops a real MGR sale line as "not our product"**
`src/app/api/square/webhook/route.ts:487-498`
The only Supabase call in this file that doesn't destructure `error` (`const { data: mapping } = ... .maybeSingle()`). A transient read failure makes `mapping` null → indistinguishable from "not an MGR product" → line silently `continue`d: not counted in itemsSynced/itemsFailed, no bin debit, no TTB allocations row, no square_draft_sales row. A real completed sale is permanently lost from inventory and TTB removals with zero observability.
Fix: destructure `error` and throw (same pattern as every other read in this function) so the per-line catch records it as failed.

**SF-2 — Critical — Swallowed QBO mapping-lookup error causes duplicate Bill/Invoice creation in QuickBooks**
`src/integrations/quickbooks/sync-utils.ts:5-17` (`getMapping`)
No `error` check; returns `data ?? null`. syncBill/syncInvoice (`sync-bill.ts:108`, `sync-invoice.ts:70`) use `existing ? "update" : "create"` — transient DB error ≡ "never synced" → posts a brand-new Bill/Invoice, duplicating a real QuickBooks document. Same bug class already fixed for Square catalog duplication (fa4089e4), unfixed here.
Fix: throw on error; callers must not fall through to "create" on a failed lookup.

**SF-3 — Critical — Unread line-item read error can create a QBO Bill missing all COGS lines**
`src/integrations/quickbooks/sync-bill.ts:56-75`
`po_line_items` read errors → `lineItems` null → `lines` []. Guard only throws when there's also no shipping cost. With shipping cost > 0, a QBO Bill is created containing only the shipping line — entire COGS omitted, understating AP and COGS silently.
Fix: destructure and check `error`; throw immediately.

**SF-4 — Critical — Unchecked `square_catalog_map` UPDATE error lets Square catalog duplication recur (fa4089e4 fix incomplete)**
`src/integrations/square/catalog.ts:148-159` and `:190-202`
On insert conflict, the fallback `update()` result is discarded entirely. If both insert and update fail, the mapping row is never persisted, yet `itemsSynced++` still runs and no error is pushed. Next sync's mapLookup misses this brand/variation → pushes with fresh `#brand-`/`#var-` temp id → recreates the duplicate-catalog production incident.
Fix: capture `{ error: updateError }`, push to errors and skip itemsSynced++ on failure.

**SF-5 — High — Destructive recipe re-sync has no rollback and multiple unchecked FK-lookup reads**
`src/integrations/mongodb/sync.ts:311-370` (`syncRecipes`)
Deletes all recipes/recipe_malts/recipe_hops/recipe_yeasts unconditionally, no transaction, before rebuilding from Mongo. Every rebuild lookup (pgBrands/pgMalts/pgHops/pgYeasts, mongoStyleIdToPgId) discards `error`. Transient failure → empty NameToId map → every re-inserted recipe gets null FKs — and the original rows are already gone, irrecoverably.
Fix: transaction (or check every lookup error and abort BEFORE the deletes); don't delete until rebuild data is confirmed fetchable.

**SF-6 — High — Stale-catalog cleanup silently no-ops on a failed initial read**
`src/integrations/square/catalog.ts:262-275` (`deleteStaleItems`)
`if (error || !staleEntries || staleEntries.length === 0) return { deleted: 0, failed: 0, errors: [] };` — real read failure folded into "nothing to clean". Caller reports success:true. Discontinued Square items never pruned, nobody told why.
Fix: propagate the error distinctly from the empty case.

**SF-7 — Medium — Silent fallback miscategorizes shipping cost in QuickBooks chart of accounts**
`src/integrations/quickbooks/sync-bill.ts:80-95`
`qbo_account_mappings` lookup: no error check; on failure shipping line posted to COGS account instead of Shipping. Bill total correct, P&L breakdown wrong, unlogged.
Fix: check error; distinguish failed-lookup from unconfigured.

**SF-8 — Medium — Pricing-channel toggle mutation has no `onError`, fired with `.mutate()` (fire-and-forget)**
`src/components/domain/pricing/format-management.tsx:80-108, 172`
channel_formats insert/delete throw is swallowed (no onError, no catch). Switch silently fails to persist — no toast/console/visual state — while this table drives which selling formats are exposed per channel (feeds Square catalog push). Operator believes format is live/hidden when write never happened.
Fix: add onError with toast, or mutateAsync with try/catch.

**SF-9 — Medium — Unread error produces misleading "no line items" exception, masking real DB failure**
`src/integrations/quickbooks/sync-invoice.ts:45-52`
Transient order_items read error reported to qbo_sync_log as "has no line items"; actual Postgres error discarded. Fails closed but misleads debugging.
Fix: check `error` separately with its own message.

**SF-10 — Low — Square settings reads unchecked; failures masquerade as "not connected"**
`src/integrations/square/client.ts:28-31, 41-45`
tokenRows/settings reads don't check error → getSquareClient returns null → "Square not connected" shown for a DB error. Fails closed; cause invisible.
Fix: log the error before falling through to null.

**SF-11 — Low — Payment-terms fallbacks swallow read errors (due-date only, not amount)**
`src/integrations/quickbooks/sync-utils.ts:93-101`, `sync-bill.ts:99-103`, `sync-invoice.ts:35-39`
All destructure data only; silently fall back to 30-day default on read failure. Bounded impact (due date), unlogged divergence.
Fix: log a warning when a payment-terms read fails before defaulting.

---

**Summary:** Square webhook/sync routes are now the best-hardened code in the repo, but two of the same anti-patterns that caused the historical incident survive nearby (SF-1 dropped sale, SF-4 catalog re-duplication). QuickBooks integration has the "read error ≡ empty/missing" gap systemically (SF-2/SF-3 can duplicate or under-bill real financial documents). MongoDB recipe resync (SF-5) is the highest-risk data-integrity gap: destructive delete, no transaction, unchecked rebuild reads. Recommend fixing SF-1..SF-6 before the next Square/QBO/Mongo sync run, in that order.
