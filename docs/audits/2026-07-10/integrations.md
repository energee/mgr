# Integrations Audit — raw report (agent: integrations-expert, 2026-07-10)

**Audit base caveat:** worktree is 2 commits behind origin/main — lacks PR #363 (77e841b9: 00228/00229/00234/00235 + catalog $0-price/variation-preservation fixes) and #367. Agent audited worktree + origin/main diffs for #363-touched files; findings reflect true current origin/main. Line numbers cite worktree copy unless marked (origin/main).

## Square webhook / sale ingestion

**IN-1 · H · Stale-claim takeover is unreachable in the crash scenario it was built for — sale silently lost**
webhook/route.ts:59 (STALE_CLAIM_MS = 15 min), :369-384 (unfinished-but-fresh claim → 200 "Duplicate sale, skipping"), square/webhook.ts:47 (±5-min replay window).
Handler crashes after claim upsert commits → Square retries within ~1 min → retry finds claim unfinished but 1 min old (<15 min) → treated as duplicate → 200 → Square marks delivered, never retries. Takeover never receives a delivery; even a later retry rejected by checkReplayWindow after 5 min (another 200). Takeover only fires on incidental later event for same order. Mid-processing crash permanently loses the sale (bin debit + TTB allocation), info-level log only. webhook-route.test.ts:475 fabricates fresh event, never exercises this interplay.
Fix: return 500/503 for unfinished not-yet-stale claim ("still processing — retry"); make STALE_CLAIM_MS coherent with replay window (shorten below 5 min or widen window per IN-2). Owner: integrations-expert.

**IN-2 · H · ±5-min replay window converts any >5-min outage into permanent, silent sale loss**
webhook/route.ts:230-237 (replay rejection returns 200 {ignored}) vs route's own model of Square retrying non-2xx up to 24h (:227-229).
Transient DB outage → claim throws → 500 → Square retries on backoff → every retry after created_at+5min rejected as stale_event WITH 200 → cancels retry stream. 10-min Supabase blip during service permanently drops every sale in window; only log.warn; no square_sync_log row (claim never succeeded). Window predates order-keyed dedup; with uniq_square_sync_log_square_payment_id giving exactly-once, 5-min window is redundant for payment events and actively harmful.
Fix: widen window for payment.* to cover Square's 24h retry horizon (dedup carries idempotency) or exempt retries whose order id has no completed claim. Keep tight window for un-deduped event types. Cross-cuts IN-1 — fix together.

**IN-3 · M · Refunds/voids never reversed — TTB removals and bin counts permanently overstate refunded sales**
webhook/route.ts:241-258 — switch handles only payment.created/updated + inventory.count.updated; no refund.* arm. Refund on POS: taproom_sale allocation (volume_bbl feeds get_ttb_removals_summary) + debit_bin_inventory decrement stand forever; no documented manual-reversal. Fix: handle refund.created (reverse allocation + credit bin, same order-keyed dedup), or document manual path + surface refunds in sync log.

**IN-4 · M · Order-keyed claim ingests full line-item list at FIRST completed tender — later items on same order lost**
webhook/route.ts:305-344 (claim on order_id before fetching lines), :421-424 (single orders.get snapshot). Open tab: first round paid (order claimed, 2 lines ingested), 3 more added, paid again → second payment dedup-skips; 3 later lines never debited/counted. Split tenders of a FIXED order handled (00233); incrementally-paid orders are the residual hole.
Fix: on dedup hit for completed claim, compare order's current line count/version vs details.line_item_count and flag delta (cheap), or persist ingested line uids and ingest deltas (full).

**IN-5 · M · KNOWN (in-code) — allocation insert + debit_bin_inventory not atomic**
webhook/route.ts:646-652 ponytail comment; 00223. Debit failure after allocation insert orphans allocation; clamped race → allocation records more than debited. Accepted; upgrade = fold both into one RPC. Track only.

**IN-6 · L · Finalize-failure + late fresh event = double-debit vector**
route.ts:752-767 (finalize error leaves completed_at NULL, deliberately not thrown) + :369-376 (takeover keys on completed_at IS NULL). Finalize UPDATE fails after debits succeed + fresh event >15 min later → takeover re-processes, re-debits whole order. Two independent failures needed; log-visible. Consider best-effort-retry stamping completed_at or marking takeover rows for reconciliation.

**IN-7 · L · 00212 availability guard can reject taproom_sale allocation and skip physical debit in one stroke**
Webhook allocation insert route.ts:628-640; guard applies to finished_good sources, no taproom_sale exemption. Bin counter says stock exists but ledger availability exhausted (reserved to wholesale) → insert raises → line FAILED → debit skipped though beer physically left. Loud in sync log, nothing alerts. Decide precedence (physical sale should probably win w/ flagged negative-availability adjustment). [Cross-listed as EA-3.]

## Square catalog / inventory push

**IN-8 · M · square_catalog_map "upsert" is INSERT-then-blind-UPDATE — transient insert failure silently drops mapping, seeds duplicate-catalog failure**
catalog.ts:135-159, :178-202 — fallback UPDATE's error/rowcount never checked; itemsSynced++ regardless. Insert fails non-conflict → UPDATE matches 0 rows → no mapping persisted while Square object WAS created → next sync pushes #brand- temp ids → full duplicate item. Swallowed-READ side was fixed (mapsError throw in route); write side wasn't.
Fix: UNIQUE on (brand_id, object_type, selling_format_id) (NULL handling for ITEM rows) + real .upsert() with error thrown. Owner: integrations (+data-layer for constraint). [Same finding as SF-4.]

**IN-9 · M · Catalog keep-set derived from POS-bin config state — re-pointing bins can bulk-delete live Square catalog**
sync/catalog/route.ts:292-361 — keep set = in-stock brands at POS bins ∪ bin_inventory rows at POS bins ∪ any keg-format FG brand; deleteStaleItems destroys everything else. Operator moves POS target bin A→B before physically moving stock, syncs → packaged brands have no bin_inventory at any POS bin → dropped from keep set → Square items/variations/images/sales-history deleted; return later as fresh objects. Empty-keep-set guard (:354-361) covers only fully-empty case; keg brands immune, packaged not. KNOWN ceiling: no brands.is_active (ponytail :337-340, followups §1).
Fix: add brands.is_active and key keep set off it; interim: refuse/confirm when delete set exceeds threshold. Owner: integrations + entity-architect.

**IN-10 · L · KNOWN — per-call crypto.randomUUID() idempotency keys make Square-side retries non-idempotent**
catalog.ts:86 (batchUpsert), inventory.ts:35 (batchCreateChanges). Client-timeout-then-retry can double-apply. Stable keys (hash of payload+started_at bucket) would fix. Long-standing.

**IN-11 · L · deleteStaleItems swallows stale-entries SELECT error**
catalog.ts:271-275 — fail-safe direction (skips deleting) but silent; route reports staleDeleted:0, no error. Surface in DeleteStaleResult.errors. [Same as SF-6.]

**IN-12 · L · Settings toggle write failures are silent successes**
sync/status/route.ts:100-116 POST uses updateSquareSettings which logs-not-throws (client.ts:106-121, designed for post-sync timestamp bookkeeping). Enable/disable can no-op while returning success. Split toggle onto throwing write path.

Fixed since milestone (verified, no action): $0-price pushes gone (unpriced-unmapped omitted; unpriced-mapped preserved at live Square price via retrieveVariationPricing — origin/main PR #363); price-read failures throw (pricing.ts:65,92); brand→tier ordering deterministic; inventory sync-log location_id from bin (origin/main); square_locations RLS converged (00231). 00223/00224/00233 idempotency chain (row-locked clamp debit, UNIQUE order-first claim key, historical re-key) sound and well-verified.

## Migrations / deployment state

**IN-13 · M · 00234/00235 merged but (per repo evidence) NOT applied live — keg-ship serialization race still open in production**
PR #363 commit message: "NOT applied live. Deploy: scripts/db-push.sh after merge"; origin/main's live-catalog.snapshot.txt last regenerated by #361, still carries pre-00234 hashes for create_keg_ship_transactions_from_order / handle_vessel_transfer (f125f5b7…/bcbaa2b8…). Until pushed, two concurrent fulfillments can double-draw same filled-keg lots (00229 shortfall guard passes in both txns), inflating fleet total — exact blocker 00234's advisory lock fixes. Drift watchdog CANNOT flag (snapshot matches live; chain is ahead; nothing alerts "chain ahead of live").
Fix: run scripts/db-push.sh from main, commit regenerated snapshot; consider CI check for unapplied trailing migrations. Owner: data-layer-expert.

**IN-14 · M · KNOWN — 00091 replay drift now load-bearing for Milestone D**
00091:181,190 (square_draft_sales.keg_type_id NOT NULL + UNIQUE (square_order_id, brand_id, keg_type_id)) — no migration drops them; live dropped out-of-band. Webhook draft insert (route.ts:710-723) omits keg_type_id → from-scratch replay DB rejects every draft sale. PR-gate replay (db-lint #365) won't catch — 00091 applies cleanly; breakage is runtime.
Fix: one reconciliation migration dropping column/index IF EXISTS. Owner: data-layer-expert.

## QBO / Slack / Email / MongoDB / credentials (unchanged since 2026-06-25; all KNOWN)

**IN-15 · M · KNOWN — QBO: duplicate unguarded refreshAccessToken still exported from token-manager.ts:122** alongside single-flight one in client.ts:22-66; 00100 token RPCs deliberately unwired; SYNC_FUNCTIONS duplicated ×3 (sync/, sync/batch/, sync/retry/); near-zero test coverage outside mapAddress; backlog L8 (unrounded invoice math, qty 0→1 rewrite, unused tax-exempt flag) open in P4. Owners: integrations; characterization tests (test-surgeon) before touching.

**IN-16 · L · KNOWN — Slack: fire-and-forget pg_net delivery, no retry; wrong slack_settings.app_url silently kills all notifications** (visible only in slack_notification_log); secureCompare's hardcoded HMAC key is a length-equalizer, not a secret — do not "fix". /api/slack/send header auth intact (route.ts:29-49).

**IN-17 · L · KNOWN — Email: no RESEND_API_KEY → sends silently skipped by design** (email.ts:31); email_settings.is_enabled defaults false, app_url drives links — fresh deploy sends nothing until both set, no surfaced warning. /api/email/send gated on integrations:manage.

**IN-18 · M · KNOWN — MongoDB import: name-resolution silent mis-mapping** (resolveSellingFormat bidirectional substring cascade; unmatched brand FKs nulled, junction rows skipped, unresolvable vessel transfers dropped), destructive re-sync (delete-then-insert + clean:true wipes), VALID_ENTITIES ↔ syncEntity drift (packaging_sessions missing from route list). Gated on integrations:manage. Legacy tool; treat as data-loss-capable if re-run planned.

**Credentials: no findings.** VALID_INTEGRATION_IDS matches client key strings; %_api_key rows and qbo_* tokens hidden by RLS (00200/00099); Square status route reads square_settings_safe, never the token.

**Summary:** Bin-sync core idempotency chain well-built and well-tested, but its two recovery mechanisms cancel each other out — 200-on-fresh-duplicate skip + 5-min replay window make both the stale-claim takeover and Square's 24h retry stream unable to recover a crashed or outage-hit sale (IN-1/IN-2, both H, permanent silent loss). Second tier: catalog map fake upsert (IN-8), config-state-derived keep set (IN-9) — each independently reproduces the duplicate/deleted-catalog failure modes — and 00234/00235 merged-but-unapplied live (IN-13). Everything outside Square unchanged; QBO/Slack/email/Mongo are KNOWN carries; credential storage/RLS clean.
