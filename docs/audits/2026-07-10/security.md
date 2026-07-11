# Security Audit — raw report (agent: ecc:security-reviewer, 2026-07-10)

Scope: 2026-07-06 P0/security items re-verified; Square POS bin-sync surface (PRs #360–#367, migrations 00219–00233); webhook signature/replay; API-key routes; portal auth; RLS backstop for new bin/POS tables; proxy.ts; injection/XSS/SSRF/secrets spot-checks site-wide.

## KNOWN — confirmed resolved (re-verified at current HEAD)
- C1 (portal customers defaulted to viewer = brewery-wide read) — fixed in 00201; create_user_profile() assigns customer role on email match; backfill included; invite route (src/app/api/customers/[id]/invite/route.ts:27-54) re-asserts via ensureCustomerRole; src/lib/permissions.ts excludes customer from every staff grant. Verified.
- H9 (notify_all_users broadcast leak) — fixed same migration; recipient loop filters NOT ('customer' = ANY(roles)). Verified.
- M16 (public self-registration) — fixed: portal-login-form.tsx:43 shouldCreateUser:false; public /signup route absent. Verified.
- Sensitive system_settings exposure — RESTRICTIVE system_settings_hide_sensitive extended in 00200 to hide %_api_key rows; covers square_api_key/square-webhook_api_key read by square/client.ts:19-20,31,37,49. Verified — no integration secret readable via PostgREST.
- square_locations RLS — briefly widened (00222) then narrowed within same PR chain by 00231 to user_has_permission('inventory:read') with hard-gate DO-block assertion. Self-corrected before merge; no live exposure.

## Bin-sync surface — reviewed, no exploitable findings
- Webhook: HMAC-SHA256 with timingSafeEqual (src/integrations/square/webhook.ts:19-37), signed-created_at replay window, order-keyed idempotency + stale-claim takeover — solid.
- debit_bin_inventory (00223/00232): SECURITY DEFINER but REVOKE ALL FROM PUBLIC / GRANT EXECUTE TO service_role only.
- bins/bin_inventory RLS route through generic inventory:read/write (00097); customer role's empty permission set fails by construction.
- All new/changed Square sync routes gated by withPermission("integrations:manage", …).

## New findings

**SEC-1 — L — Host-header-trusted self-fetch forwards session cookie**
src/app/api/square/sync/route.ts:17,23-26,31-34,54-57 — origin = new URL(request.url).origin, forwards caller's cookie header to ${origin}/api/square/sync/catalog and /inventory. request.url derives from incoming Host header. On a deployment that doesn't strictly validate Host (Vercel does; self-hosted might not), spoofed Host → server forwards admin's session cookie to attacker-chosen origin. Same request.url-origin pattern (without cookie) in quickbooks/auth/route.ts:29 and callback/route.ts:60 (bounded by Intuit registered-URI matching). Pre-existing pattern, predates 2026-07-06.
Fix: derive internal call target from SITE_URL (src/lib/env.ts:54-60, already used by invite route), or call catalog/inventory sync logic as internal functions instead of HTTP self-call.

**SEC-2 — L — No application-level rate limiting on portal OTP send/verify**
portal-login-form.tsx calls supabase.auth.signInWithOtp/verifyOtp directly from client — src/lib/api/rate-limit.ts (used by invite route, 5/min-per-IP) can't apply. Relies on Supabase platform throttling (not verifiable from repo). Not a regression.
Fix: if tighter control desired, proxy OTP send/verify through first-party API route wrapped in rateLimit().

**SEC-3 — L — CSP allows script-src 'unsafe-inline'**
next.config.ts:21 (documented as Next.js App Router hydration constraint, no nonce support). Defense-in-depth gap only; no dangerouslySetInnerHTML sink takes user input (chart.tsx theme config is developer-authored; safe-svg.tsx sanitizes). Pre-existing, informational.

## Summary
Bin-sync surface carefully built — no exploitable injection, authz, or signature-bypass issues; one RLS overreach (square_locations) introduced and self-corrected within the same PR chain. All five prior P0/critical items confirmed fixed at current HEAD. Residual SEC-1–3 all Low and pre-date bin-sync; SEC-1 worth a quick fix (swap request.url origin for SITE_URL).
