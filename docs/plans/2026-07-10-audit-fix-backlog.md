# Audit Fix Backlog — 2026-07-10

Source: `docs/audits/2026-07-10-full-site-audit.md` (finding IDs reference the raw reports in `docs/audits/2026-07-10/`).
Owners per `CLAUDE.md` expert-agent table. Check items off as PRs land; note the PR # next to each.

## P0 — Do first (live correctness + sale loss + security residual)

- [x] **1. Push the pending migration chain to live** (DL-1/IN-13, C) — **PUSH DONE out-of-band** (verified 2026-07-10 via `supabase migration list`: live has 00230–00235); **snapshot refresh (DL-3) still OUTSTANDING** — user action
  The push happened without `scripts/db-push.sh`, so `supabase/live-catalog.snapshot.txt` (last regenerated at PR #361) still has zero POLICY/RLS lines and predates 00230–00235: the watchdog's policy-drop protection stays dormant and the next cron will warn on every new object. Run `SUPABASE_DB_URL='postgresql://readonly:…' bash scripts/check-live-drift.sh --update`, review the REMOVED-lines diff (expect only objects replaced by 00230–00235), commit the snapshot. Do not transfer the snapshot through MCP (known homoglyph corruption).
- [ ] **2. Close the staff OTP self-registration door** (DL-2, H) — owner: `data-layer-expert`
  `shouldCreateUser: false` on `src/app/(auth)/login/login-form.tsx` passwordless path; verify/disable the hosted "allow new signups" toggle (user action; flagged since 2026-07-06).
- [ ] **3. Make webhook recovery actually recover** (IN-1 + IN-2 + SF-1, H/H/C) — owner: `integrations-expert`
  (a) Return 5xx (not 200-duplicate) for an unfinished, not-yet-stale claim so Square keeps retrying through a crash; (b) widen the ±5-min replay window for `payment.*` events (order-keyed dedup already guarantees exactly-once) so a >5-min outage doesn't permanently drop sales; (c) destructure and throw the one unchecked `square_catalog_map` read at `webhook/route.ts:487-498`. Add the crash-retry test the current suite fabricates around.
- [ ] **4. Real upsert for `square_catalog_map`** (SF-4 = IN-8 = PERF-1) — owner: `integrations-expert` + `data-layer-expert` (constraint)
  UNIQUE on `(brand_id, object_type, selling_format_id)` + batched `.upsert()` with thrown errors, replacing INSERT-then-blind-UPDATE. One change closes the remaining catalog-duplication vector and the 6–12s sequential-write latency.

## P1 — Money & compliance

- [ ] **5. TTB period attribution: bucket removals by `completed_at`** (BD-1, H) — owner: `brewing-domain-expert` + `data-layer-expert`
  One migration switching removals AND begin/end inventory keying to `COALESCE(completed_at, created_at)` together (preserves the identity validators).
- [ ] **6. Wholesale removals: synthesize allocations at fulfillment** (BD-5, H) — owner: `entity-architect` + `brewing-domain-expert`
  At `orders → fulfilled` with no planned reservations, create completed allocations from `order_items` (brand+format FIFO, `computeUnitFillVolumeBbl`), or hard-require allocation before fulfillment. Also register `deliveries → completed` → fulfill linked orders (EA-2).
- [ ] **7. Draft-sale reconciliation flow** (BD-2 + BD-3 + BD-4, H/M/M) — owner: `integrations-expert` + `brewing-domain-expert`
  Build the staged `square_draft_sales` → `taproom_sale` allocation reconciliation (dedup-linked); replace the hard-coded 16-oz pour with per-variation pour size on `square_catalog_map`; pick one unit (kegs vs pour-equivalents) for keg-mapped variations in the inventory push.
- [ ] **8. Handle Square refunds** (IN-3, M) — owner: `integrations-expert`
  `refund.created` arm reversing the allocation and crediting the bin with the same dedup discipline — or, minimum, documented manual reversal + sync-log surfacing.
- [ ] **9. QBO swallowed-read sweep** (SF-2, SF-3, SF-7, SF-9, SF-11) — owner: `integrations-expert`
  `getMapping` throws on error (stops duplicate Bills/Invoices); `po_line_items` read checked (stops shipping-only Bills); account-mapping/payment-terms lookups logged. Characterization tests first per IN-15 (test-surgeon).
- [ ] **10. Keg netting residuals** (DL-4 + DL-5 + PG-2/PG-3) — owner: `data-layer-expert` + `brewing-domain-expert` (owner rule)
  Decide keg-owner attribution and fix the owner-dimension inflation; add the advisory lock to `revise_packaging_session`'s keg-decrease branch; ORDER BY on BOM-lock acquisition (or deadlock retry); `CHECK (quantity >= 0)` on `bin_inventory`.
- [ ] **11. Mongo recipe resync: no destructive delete without a verified rebuild** (SF-5, H) — owner: `integrations-expert`
  Check every FK-lookup error and abort BEFORE the deletes; wrap in a transaction. Legacy tool — required only if a re-run is ever planned; treat as data-loss-capable until then.

## P2 — Correctness & UX integrity

- [ ] **12. Query-invalidation drift, structural fix** (UI-1..UI-5, 3×H) — owner: `ui-systems-expert` + `entity-architect` (config shape)
  `relatedInvalidations` on `EntityConfig` (kills UI-1/2/4/5 as a class); pass `queryClient` at the three universal transition call sites (UI-3); viewTable invalidation in `QuickCreateDialog`.
- [ ] **13. Create-mode status bypass** (EA-1 + EA-9) — owner: `entity-architect`
  Create forms offer only initial state(s); `z.enum(stateMachine.states)` for status fields; optional INSERT-time DB check.
- [ ] **14. Guard vs physical POS sale precedence** (EA-3 = IN-7) — owner: `entity-architect` + `data-layer-expert`
  Exempt completed `taproom_sale` inserts from the 00212 guard (or clamp-and-flag in the webhook) — physical sales must be recordable.
- [ ] **15. Revision follow-through** (EA-4 + BD-6) — owner: `entity-architect` + `brewing-domain-expert`
  `packaging_sessions → revised` side effect recomputing reconciliation-loss delta; route cross-month revision deltas to the revision month's `adjustments_bbl` (don't rewrite filed months).
- [ ] **16. Catalog keep-set safety** (IN-9, M) — owner: `integrations-expert` + `entity-architect`
  Add `brands.is_active` and key the keep-set off it (recorded upgrade path); interim: confirmation/threshold before bulk stale-deletes.
- [ ] **17. Portal email-case lockout** (DL-6, M) — owner: `data-layer-expert`
  Normalize the portal auto-link email comparison to match 00201's `lower()=lower()`.
- [ ] **18. Silent mutation/error-state sweep, UI** (UI-6, UI-7=SF-8, UI-8, UI-9, UI-10=SF-10, IN-12) — owner: `ui-systems-expert`
  PO editor reuses the order-item price parser (folds into 2026-07-06 backlog #17); `onError` toasts on Square-enable + channel-format toggles (+ global `MutationCache.onError` fallback); error states on pick-list/FG-bin/Square-status reads; throwing write path for the settings toggle.
- [ ] **19. A11y quick wins + systemics** (A11Y-4 C, A11Y-2, A11Y-5 trivial; A11Y-1/3/6/7 systemic) — owner: `ui-systems-expert`
  Login error wiring (`role="alert"` + `aria-describedby`/`aria-invalid`) and `aria-label="Row actions"` first; then Form-primitive migration for the 7 hand-rolled dialogs and a keyboard path for entity rows (copy `entity-mobile-card-list`'s Link pattern).
- [ ] **20. SEC-1: stop deriving self-fetch origin from `request.url`** (L, quick) — owner: `integrations-expert`
  Use `SITE_URL` (or call the sync logic as functions) in `api/square/sync/route.ts`.

## P3 — Test debt (order = risk)

- [ ] **21. Integration-harness fixtures + plpgsql guard tests** (TC-1 C, TC-2, TC-7, TC-10) — owner: `test-surgeon` + `data-layer-expert`
  Seed fixtures for `vitest.integration.config.ts`; behavioral tests for `debit_bin_inventory` clamp, availability/outbound guards, keg receive→fill→ship netting, `revise_packaging_session` flow.
- [ ] **22. TS↔DB state-machine parity test** (TC-6, S effort) — owner: `test-surgeon`
  Diff `get_state_transitions()` against `src/lib/state-machines.ts` per entity — would have caught the 'revised' live outage.
- [ ] **23. Behavioral upgrades for text-assertion suites** (TC-4, TC-5) — owner: `test-surgeon` + `data-layer-expert`
  One seeded TTB summary invocation; two-customer JWT RLS round-trip.
- [ ] **24. Characterization for known-unfixed edges** (TC-3, TC-12) — owner: `test-surgeon`
  Pin 00219 placement-skip / 00221 NULL-format exclusion semantics; pin `report-utils` planned+completed cost semantics.

## P4 — Opportunistic / polish

- [ ] **25.** PERF-2 duplicate batch-detail fetch; PERF-3 packaging probe waterfall; PERF-4 ChatContext memoization (verify mount scope first) — owner: `ui-systems-expert`.
- [ ] **26.** EA-5 bin-counter drift (bin-dimension the ledger or bin recount UI — pairs with 2026-07-06 #18 cycle-count); EA-6 both-or-neither bin POS config refine; EA-8 multi-bin clamp invariant note — owner: `entity-architect`.
- [ ] **27.** IN-4 open-tab delta detection (cheap line-count flag first); IN-6 finalize best-effort retry; IN-10 stable Square idempotency keys; IN-11=SF-6 deleteStaleItems error surfacing — owner: `integrations-expert`.
- [ ] **28.** BD-7 adjustments line on TTB page; BD-8 yeast-lineage cycle guard; BD-9 gravity dual-implementation dedup — owner: `brewing-domain-expert`.
- [ ] **29.** PG-4 netting-view EXPLAIN checkpoint at ~100k keg_transactions; PG-6 bins_with_summary column-freeze assertion; PG-1's CI check for duplicate CREATE OR REPLACE across migrations; DL-10 push-discipline note — owner: `data-layer-expert`.
- [ ] **30.** SEC-2 OTP rate-limit proxy (optional); SEC-3 CSP nonce investigation; A11Y-8/9; TC-8/9/11/13 — as capacity allows.

## Carried from 2026-07-06 (unchanged, tracked there)

Portal rebuild #20 (DL-7 junction tables absent live = its phase 1), change-request rebuild #10, M9 invite-gate 15(a), QBO L8/#IN-15, Slack/email KNOWNs (IN-16/17), Mongo IN-18, M15b cycle-count, L4 negative-quantity parses.
