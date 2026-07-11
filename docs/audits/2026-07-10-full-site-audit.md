# Full-Site Expert Audit — 2026-07-10

**Base:** `00fbe791` (origin/main incl. PRs #363/#367). Branch `worktree-site-audit-2026-07`.
**Method:** 11 read-only expert auditors run in parallel — repo experts (data-layer, entity-architect, brewing-domain, integrations, ui-systems, test-surgeon) plus specialist lenses (Postgres/database-reviewer, security-reviewer, silent-failure-hunter, a11y-architect, performance-optimizer). Generalist reviewers deliberately not used. Each was primed with the 2026-07-06 audit + backlog, so prior findings return as KNOWN/RECONFIRMED/REGRESSED rather than duplicates.
**Raw reports (full evidence, file:line, per-finding fixes):** `docs/audits/2026-07-10/{data-layer,postgres,entities,brewing-domain,integrations,ui,silent-failures,security,a11y,performance,test-coverage}.md`. Finding IDs below (DL-, PG-, EA-, BD-, IN-, UI-, SF-, SEC-, A11Y-, PERF-, TC-) refer to those files.

## Verdict in three lines

1. **Nothing shipped since 2026-07-06 regressed** — all P0/P1 fixes reconfirmed intact by four independent auditors; the Square webhook/sync app layer is the best-hardened, best-tested code in the repo.
2. **The top risk is operational, not code:** live is six migrations behind the merged chain (DL-1) — packaging revisions abort on live today, webhook inventory-event logging is silently rejected, and the drift watchdog's new policy protection is dormant until the same push+re-baseline (DL-3). One `scripts/db-push.sh` run closes it.
3. **The dominant new defect classes are flow-level:** TTB compliance flows that never produce removals (BD-1/2/3/5), webhook recovery mechanisms that cancel each other out and can permanently lose sales (IN-1/2, SF-1), systemic TanStack Query invalidation drift (UI-1..5), and the swallowed-read pattern surviving in QuickBooks/Mongo (SF-2/3/5).

## Re-verification of the 2026-07-06 fixes

RECONFIRMED with no code regressions: C1 customer role + backfill (00201), H9 notification scoping, M16 portal self-registration closed, H1 fulfillment side effects, H2 TTB volume math, H3 Plato/SG, H5/M6 loss-reconciliation filters, H6 volume_oz, server-side enforcement (00205), sensitive-settings RESTRICTIVE policy, query-key discipline, 39-entity registry consistency. Two residuals discovered:
- **DL-2 (H):** the *staff* OTP login never got `shouldCreateUser: false` — the portal half of M16 was fixed, the staff half still self-registers `viewer`-role users while the hosted signup toggle is on.
- **BD-5 (H):** H1's fulfillment side effect only completes reservations that are never created in practice (live had zero FG→order allocations) — wholesale removals still report ~0.

## Cross-cutting themes (deduped)

| Theme | Findings | One fix |
|---|---|---|
| Live behind merged chain | DL-1 = IN-13 (superset), DL-3 | `scripts/db-push.sh` from main, commit snapshot; push BEFORE re-baseline |
| Catalog-map fake upsert | SF-4 = IN-8 = PERF-1 | UNIQUE constraint + one real batched `.upsert()` (fixes correctness AND the 6–12s sync latency) |
| Webhook recovery cancels itself | IN-1 + IN-2 (+ SF-1 same file) | 5xx for fresh unfinished claims; widen replay window for deduped `payment.*` events; check the one unchecked read |
| Guard vs physical POS sale | EA-3 = IN-7 | exempt completed `taproom_sale` or clamp-and-flag in webhook |
| TTB flow gaps | BD-1 (created_at bucketing), BD-2/BD-3 (draft pours dead-end + 16-oz constant), BD-5, BD-6 (revisions rewrite filed months), IN-3 (refunds never reversed) | one compliance workstream, brewing-domain + data-layer + integrations |
| Query-invalidation drift | UI-1, UI-2, UI-3, UI-4, UI-5 | config-driven `relatedInvalidations` on `EntityConfig` + pass `queryClient` at 3 universal call sites |
| Swallowed reads (the fa4089e4 class) | SF-1..SF-11, UI-8/9/10, IN-11/12 | error-check sweep: QBO first (SF-2/3 duplicate/under-bill money docs), Mongo resync (SF-5 destructive, no transaction) |
| plpgsql test vacuum | TC-1 (C), TC-2, TC-6, TC-4/5 | integration-harness fixtures once, then per-RPC guard tests; TS↔DB state-machine parity test is S-effort and would have caught the 'revised' outage |
| Keg netting residuals | DL-4 (owner-dimension inflation), DL-5 (revise-down lock), PG-2 (deadlock ordering) | data-layer migrations, small |
| A11y systemics | A11Y-4 (C, login feedback), A11Y-1/2/3 | two are trivial (aria-label, login error wiring); two have in-repo reference patterns to copy |

## Counts (new findings only, after dedupe)

| Area | C | H | M | L |
|---|---|---|---|---|
| Data layer (DL) | 1 | 2 | 4 | 3 |
| Postgres (PG) | – | 1 | 2 | 3 |
| Entities/services (EA) | – | – | 5 | 4 |
| Brewing domain (BD) | – | 3 | 3 | 3 |
| Integrations (IN, deduped) | – | 2 | 6 | 6 |
| UI systems (UI, deduped) | – | 3 | 4 | 3 |
| Silent failures (SF, deduped) | 3 | 2 | 3 | 3 |
| Security (SEC) | – | – | – | 3 |
| Accessibility (A11Y) | 1 | 3 | 3 | 2 |
| Performance (PERF, deduped) | – | – | 3 | – |
| Test coverage (TC) | 1 | 5 | 6 | 2 |

Security is the standout clean area: the entire bin-sync surface reviewed with zero exploitable findings; the three SEC lows are pre-existing hardening items (Host-header self-fetch cookie forward, OTP rate limiting, CSP `unsafe-inline`).

## Per-area summaries

- **Data layer** (`2026-07-10/data-layer.md`): live six migrations behind (DL-1, C); staff OTP self-registration residual (DL-2, H); drift snapshot missing POLICY/RLS baseline so the new watchdog protection is dormant and the next cron will emit a misleading warning wall (DL-3, H); keg owner-dimension fleet inflation (DL-4); revise-down advisory-lock residual (DL-5); portal email case-sensitivity lockout (DL-6); portal junction tables still absent live (DL-7, carried C3).
- **Postgres** (`postgres.md`): migrations 00219–00233 judged unusually well-engineered; deadlock hazard from unordered BOM/lot lock acquisition under the 00212 guard (PG-2, H); `bin_inventory` missing non-negative CHECK (PG-3); unbounded netting-view scans — fine now, checkpoint at ~100k keg_transactions (PG-4). PG-1 (branch migration-number collision) largely overtaken by the #363 merge; its CI-check suggestion survives as hardening.
- **Entities/services** (`entities.md`): no criticals; theme = side-effect completeness at the seams — create-mode status selects bypass all transition machinery (EA-1), delivery completion doesn't fulfill orders (EA-2), post-completion revisions never re-flow reconciliation loss (EA-4), availability guard can block recording real Square sales (EA-3).
- **Brewing domain** (`brewing-domain.md`): formula layer sound (363/363 parity tests green); risk moved to flows — removals bucketed by `created_at` mutate already-filed TTB months (BD-1), draft pours are a TTB-invisible write-only dead end (BD-2) fed by a hard-coded 16-oz pour (BD-3), keg-vs-pour unit mismatch at the Square boundary (BD-4), newly-unblocked revisions retroactively rewrite filed months (BD-6).
- **Integrations** (`integrations.md`): the two webhook recovery mechanisms cancel out — crash or >5-min outage = permanently lost sales with only info-level logs (IN-1/IN-2, both H); refunds never reversed (IN-3); open-tab incremental payments lose later lines (IN-4); catalog keep-set derived from bin config can bulk-delete the live Square catalog on a bin re-point (IN-9). QBO/Slack/email/Mongo unchanged — all KNOWN carries. Credentials/RLS clean.
- **UI systems** (`ui.md`): TanStack invalidation drift is the dominant class (UI-1..5) — packaging completion, lot adjustments, order cancellation, and keg/bin surfaces all show up-to-2-min-stale data after their own writes; PO line-item editor repeats the M10 `$0→NULL` bug (UI-6); silent mutation failures on the Square-enable and channel-format toggles (UI-7).
- **Silent failures** (`silent-failures.md`): four criticals — the one unchecked read in the webhook can silently drop a real sale (SF-1); QBO mapping-lookup and line-item reads can duplicate or under-bill real financial documents (SF-2/3); the catalog-map blind update re-opens the duplication incident (SF-4). Mongo recipe resync is destructive with no transaction (SF-5).
- **Security** (`security.md`): all five prior P0/critical items verified fixed; bin-sync surface has no exploitable findings; three Low residuals, SEC-1 (swap `request.url` origin for `SITE_URL` in the sync self-fetch) is the one worth doing soon.
- **Accessibility** (`a11y.md`): radix/shadcn foundation solid; login forms give screen-reader users zero failure feedback (A11Y-4, C — can fully block sign-in); entity-table rows mouse-only (A11Y-1); unlabeled row-actions trigger app-wide (A11Y-2); dialogs hand-roll form errors instead of using the repo's own `Form` primitives (A11Y-3).
- **Performance** (`performance.md`): foundations (EntityDataTable, Square sync batching) already solid; sequential catalog-map writes are the one hotspot (PERF-1 — same code as SF-4/IN-8, one fix); duplicate batch-detail fetch (PERF-2); unmemoized ChatContext value re-rendering consumers per streamed token (PERF-4, verify mount scope).
- **Test coverage** (`test-coverage.md`): baseline 2078/131 green; the entire plpgsql layer (bin debit, guards, keg netting, revise) has zero repeatable behavioral tests — exactly where every recent live bug occurred (TC-1, C); P0/P1 fixes are pinned by SQL-*text* assertions that can't catch runtime breakage (TC-4/5); a cheap TS↔DB state-machine parity test would have caught the shipped 'revised' outage (TC-6).

## Fix backlog

Prioritized, owner-assigned checklist: `docs/plans/2026-07-10-audit-fix-backlog.md`.
