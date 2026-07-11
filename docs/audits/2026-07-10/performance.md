# Performance Audit — raw report (agent: ecc:performance-optimizer, 2026-07-10)

**Scope note:** worktree became inaccessible mid-audit (session restart deleted it); all findings from real file reads while it was live. No production build completed (permission-blocked, then restart). Inventory list/detail pages and ChatProvider mount point not fully re-verified — flagged inline.

**PERF-1 · H · Sequential, unbatched DB writes in Square catalog-map persistence**
src/integrations/square/catalog.ts, pushCatalog(), ~121–205: nested per-product/per-variation loop issues up to ~2 × B × (1+V) SEQUENTIAL Supabase round trips (insert, fallback update on conflict) — none parallelized or batched. At ~50–100ms/round-trip, 30 brands × 3 variations ≈ 120 mappings → 6–12+ s pure DB latency every catalog sync. The one leftover hotspot in an otherwise-optimized surface.
Fix: replace insert-then-fallback-update with two batched .upsert() calls (ITEM rows keyed brand_id+object_type; ITEM_VARIATION rows keyed brand_id+object_type+selling_format_id). [Same code as SF-4/IN-8 — one fix covers correctness + perf.]

**PERF-2 · M · Duplicate detail fetch on batch detail page**
production/batches/[id]/page.tsx:~95-111 (batch query, key batchKeys.detail(id) = ["batches", id]) vs use-entity-record.ts inside EntityDetailUnifiedWithErrorBoundary (mounted :~419), key entityKeys.detail("batches_with_brew_info", id). Both hit the same view for the same row under different key namespaces — two independent round trips per batch-detail load (busiest page).
Fix: point BatchDetailPage's query at the key EntityDetailUnified uses (or lift record via shared hook) to share one cache entry.

**PERF-3 · L–M · Packaging session detail: artificial two-step waterfall**
production/packaging/[id]/page.tsx:38-49 status-only probe query → conditionally mounts EntityDetailPage (:74) which fires its own full-record fetch. Full round trip of pure latency before content on every non-in-progress session view.
Fix: probe selects full row and passes as initialData to EntityDetailPage, or merge fetches.

**PERF-4 · M (confidence lowered — mount point unverified) · ChatContext provider value unmemoized**
src/contexts/chat-context.tsx:148 — Provider value={{ isOpen, toggle, close, chat, pageContext }} not wrapped in useMemo (siblings NotificationsContext/PermissionContext do it right). chat = useChat() return (new object nearly every render during streaming) → every useChatContext() consumer re-renders per streamed token. Blast radius depends on ChatProvider mount point (likely app-shell) — re-verify before prioritizing.
Fix: useMemo keyed [isOpen, toggle, close, chat, pageContext]; if chat unstable, split into two contexts so non-chat consumers don't depend on the streaming object.

## Already well-optimized (confirmed, no action)
- All recharts usages behind next/dynamic; no pdf/barcode/qrcode libs in client code.
- EntityDataTable: full server-side pagination (.range()), server-side filter/sort, debounced search isolated, FK relation-display lookups batched via Promise.allSettled keyed by unique ids (one query per relation table) — not an N+1 source.
- Square inventory sync parallelized across bins (E1); resolveChannelPrices batches brand→tier once across channels (E3). pushCatalog (PERF-1) is the one unbatched loop left.
- query-keys.ts clean factory; CACHE_DURATIONS/POLLING_INTERVALS differentiate tiers; every poller sets refetchIntervalInBackground:false — no refetch storms.

**Summary:** Shared foundations (EntityDataTable, Square sync batching E1–E3) are solid — busiest list pages are not the risk. Actionable: PERF-1 sequential catalog-map writes (highest impact; same code as the SF-4/IN-8 correctness fix), PERF-2 duplicate batch-detail fetch, PERF-4 chat context memoization (verify mount scope). Recommend re-running inventory-page + production-build sections later (cut short by the restart).
