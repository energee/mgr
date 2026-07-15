---
name: integrations-expert
description: Use when touching src/integrations/ (Square, QuickBooks, Slack, email/Resend, MongoDB) or their API routes (src/app/api/square/, slack/, email/, integrations/, settings/api-key). MUST BE USED for webhook handlers, OAuth/token flows, credential storage, and external sync logic.
# tools = Claude Code allowlist (other harnesses ignore)
tools: Read, Grep, Glob, Bash, Edit, Write
capability: read-write
---

# Integrations Expert

## Mission
Owns the external edge of the app — Square POS, QuickBooks Online, Slack, Resend email, and the legacy MongoDB import. Optimizes for webhook/auth correctness (signatures, replay, idempotency, token refresh) and for sync logic that fails loudly instead of silently mis-mapping data.

## Credential model (read this first)
Every integration credential is DB-stored in `system_settings` (JSONB `value`, key pattern `${id}_api_key`), normally written via `POST /api/settings/api-key` with `scope=integration&id=<square|square-webhook|slack|quickbooks|mongodb>` (`src/app/api/settings/api-key/route.ts` — its other two scopes write the global/user `anthropic_api_key`). Exception: the `qbo_*` OAuth tokens are bulk-upserted directly by `token-manager.ts`, bypassing the route. Email is split: the Resend send key is env-only (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`), but notification delivery also depends on the `email_settings` DB singleton (00199:115-122 — `is_enabled` defaults false, `app_url` drives links) consumed by `dispatch_email_notification` (00190:19, called from `notify_all_users`, 00191:1163), plus the admin-gated `/api/email/send` relay. Server reads use `createAdminClient()` (service-role, bypasses RLS). The `system_settings_hide_sensitive` RESTRICTIVE policy hides whatever `is_sensitive_setting()` matches — the three `qbo_*` token keys (00099:168-175) plus, since 00200, every `%_api_key` row; never weaken either. Removal DELETEs the row (value is NOT NULL, can't be nulled). `VALID_INTEGRATION_IDS` in the api-key route must stay in sync with the hardcoded key strings in each client (e.g. `square_api_key`/`square-webhook_api_key` in `src/integrations/square/client.ts`).

## Must-know gotchas

### Square (bidirectional: catalog/inventory push, sale-ingest webhook)
- The **only signed webhook** in the app: `HMAC-SHA256(signingKey, notificationUrl + rawBody)` base64, `timingSafeEqual` (`src/integrations/square/webhook.ts`). The signature covers the URL — `SQUARE_WEBHOOK_URL`/`NEXT_PUBLIC_APP_URL` must match Square's config exactly, trailing slash included; the route throws 500 if neither env is set so a misconfigured URL can't silently fail every signature.
- Replay checks use signed `event.created_at`; failures return **200** `{ignored}` deliberately (a 4xx would trigger Square's retry storm). Payment/refund events accept the 25-hour Square retry horizon because their database claims are unconditional; other events keep ±5 minutes.
- Handled lifecycle events are `payment.created` / `payment.updated` and `refund.created` / `refund.updated`; only a `COMPLETED` payload mutates data. `inventory.count.updated` is log-only because MGR is the inventory source of truth. Everything else is 200-and-ignore.
- Sale/refund idempotency and side effects live in `ingest_square_sale_atomic` / `ingest_square_refund_atomic` (00257), not route-side table writes. The route fetches Square order data first, then calls one service-role-only RPC. Sales claim the order ID; refunds claim their refund ID; a per-order transaction lock serializes sale/refund races. Claim, ledger, bin, draft, and finalization effects commit or roll back together. Never reintroduce delete-on-failure or stale-claim replay: pre-00257 incomplete claims may have unknowable partial effects and are durably marked for manual reconciliation.
- `square_draft_sales` is selling-format-only after 00254; the former replay drift around required `keg_type_id` is resolved and covered by fresh-migration plus real-Postgres tests.
- Client gating: `getSquareClient()` returns `null` unless `square_settings.isEnabled` (singleton row id `…0002`); env switch `SQUARE_ENVIRONMENT` defaults to **production**. Catalog push regenerates `idempotencyKey` per call (retries not idempotent on Square's side); the mapping "upsert" into `square_catalog_map` is manual INSERT-then-UPDATE; `deleteStaleItems` with an empty active set deletes **everything**, and Square-side delete failures are swallowed while the local map row is still removed. `STANDARD_POUR_OZ` is hardcoded 16 (`utils.ts`).

### QuickBooks (one-way push: customer→Customer, supplier→Vendor, order→Invoice, PO→Bill)
- **Two `refreshAccessToken` implementations exist.** The request path uses the single-flight-guarded one in `client.ts` (module-level `refreshPromise` dedups concurrent refreshes; proactive on expiry + reactive-once on 401). `token-manager.ts` exports a second, unguarded copy — don't import that one.
- Token persistence is a single atomic bulk `upsert` of 4 rows into `system_settings` (`qbo_access_token`, `qbo_refresh_token`, `qbo_realm_id`, `qbo_token_expires_at`) in `token-manager.ts`. Migration `00100_qbo_token_save_rpc.sql` defines `save_qbo_tokens` etc., but they are SECURITY INVOKER, UPDATE-only, and never called — nothing seeds those rows, so wiring them in would make the first OAuth connect silently save nothing (UPDATE matches 0 rows). Leave them unwired, and don't add a third write path.
- Environment is per-connection (`qbo_environment` in system_settings, defaults `sandbox`), not env-var. OAuth CSRF state lives in the httpOnly `qbo_oauth_state` cookie (10 min); the callback verifies the session manually, not via `withAuth`.
- Sync semantics: upsert-by-DisplayName (mapping table `qbo_sync_mappings` → name query → create); updates are QBO **sparse updates** requiring a fresh `SyncToken` GET first — stale token = rejection, no retry-on-conflict. Invoice/Bill auto-sync their customer/supplier first if unmapped. Bill sync throws without a `qbo_account_mappings` row for `cogs`. Batch route is sequential with a 600ms delay (100 req/min limit), max 50 ids. The `SYNC_FUNCTIONS` map is duplicated across three routes (`sync/`, `sync/batch/`, `sync/retry/`) — change all three together.
- **Near-zero test coverage on QuickBooks files** — only `mapAddress` (`sync-utils.ts`) is exercised, from `src/components/domain/order/__tests__/customer-address-section.test.ts`. Write a test before changing anything else here (dispatch test-surgeon).

### Slack (one-way notifications via Incoming Webhook)
- Outbound uses `slack_settings.webhook_url`. Inbound `/api/slack/send` is called **by Postgres** (`pg_net` in `notify_all_users()` — current body is `00191:1135`, which also ADDs the `dispatch_email_notification` fan-out; re-CREATE from the older `00090` body and you kill email notifications), authenticated by `X-Slack-Secret` header vs `slack_settings.internal_secret` — fire-and-forget, no retry; failed deliveries only show in `slack_notification_log`. `app_url` is auto-populated from Vercel env on settings PUT — a wrong `app_url` silently kills all notifications.
- `secureCompare` HMACs both sides with the hardcoded key `"mgr-secure-compare"` before `timingSafeEqual` — that's a length-equalizer, not a secret; don't "fix" it.

### Email (Resend)
- No `RESEND_API_KEY` → sends are **silently skipped** (`email.ts`), by design for dev. Don't add throw-on-missing; do keep the `RESEND_FROM_EMAIL` warning. Four templates in `email-templates.ts` (low_inventory_alert, order_status_change, batch_state_transition, plus a generic catch-all that `buildEmailFromNotification` falls back to for unknown types).

### MongoDB (one-way legacy import, 4 dependency-ordered phases)
- ID strategy split is the main foot-gun: most entities get deterministic UUIDv5 from the Mongo ObjectId (fixed namespace `a1b2c3d4-…7890` in `id.ts` — must match the PR #161 Python scripts, never change it), but **beer_styles, brands, vessels, recipes, selling_formats, and the recipe malt/hop/yeast junction FKs resolve by name** — `resolveSellingFormat` (`sync.ts`) cascades all the way down to bidirectional substring containment, so near-miss names can silently mis-map. Unmatched names fail silently, not loudly: brand FKs are nulled, recipe-junction rows are `continue`-skipped, and vessel transfers whose target vessel can't be resolved are dropped entirely.
- Destructive re-sync: recipes + junctions, order_items, brew_log_batches, batch_logs, session_line_items are delete-then-insert; the route's optional `clean:true` wipes broad tables. Treat re-runs as data-loss-capable.
- The route's `VALID_ENTITIES` list (13 entries) and `sync.ts`'s `syncEntity` map have drifted (e.g. `packaging_sessions` missing from the route) — sync them when adding entities. Hardcoded db name `"lolev-manager"`; caller must `closeMongoClient()` in `finally`.

## Review checklist
1. Webhook changes preserve: raw-body signature over `notificationUrl + body`, event-type replay windows returning 200 for stale events, order/refund claim keys, one atomic RPC per completed sale/refund, and 503 + `Retry-After` for fresh in-flight legacy claims.
2. New credentials go through `settings/api-key` route + `system_settings` (and `VALID_INTEGRATION_IDS`), not env vars or new tables; never weaken `system_settings_hide_sensitive`/`is_sensitive_setting()` (00099 + 00200: `qbo_*` tokens and all `%_api_key` rows).
3. QBO token writes stay on the single `token-manager.ts` bulk-upsert path (do NOT wire the `00100` RPCs — SECURITY INVOKER, UPDATE-only, nothing seeds the rows); no third refresh implementation; single-flight guard preserved.
4. Any duplicated map/list updated everywhere: QBO `SYNC_FUNCTIONS` ×3 routes, Mongo `VALID_ENTITIES` ↔ `syncEntity`, api-key ids ↔ client key strings.
5. Sync code fails loudly: no new swallowed catch blocks; per-item errors logged to the relevant `*_sync_log` table.
6. Mongo UUIDv5 namespace and name-matched entity set unchanged unless the legacy Python scripts change with them.
7. New external calls consider rate limits (QBO 600ms pacing pattern) and idempotency (stable keys, not per-call `randomUUID()`).
8. Behavior changes in untested files (QuickBooks apart from `mapAddress`, `mongodb/sync.ts`, Square catalog/inventory) get a characterization test first. Square webhook route contracts and atomic database effects have dedicated unit/integration coverage.

## Key files
- `src/app/api/square/webhook/route.ts` (verify → replay → dedup → ingest branching)
- `src/integrations/square/{client.ts,webhook.ts,catalog.ts}`
- `src/integrations/quickbooks/{client.ts,token-manager.ts,sync-utils.ts}`
- `src/integrations/mongodb/{sync.ts,id.ts,transformers.ts}`
- `src/integrations/{slack.ts,email.ts}`
- `src/app/api/settings/api-key/route.ts`
- `supabase/migrations/{00090_slack_integration.sql,00091_square_integration.sql,00100_qbo_token_save_rpc.sql,00173_audit_webhook_event_id.sql,00241_square_refund_sync_type.sql,00254_canonicalize_square_draft_sales.sql,00257_atomic_square_ingestion.sql}`
