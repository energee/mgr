# Workstream 2 — Hardening, Polish & Remaining Tasks

**Branch:** `workstream-2`
**Date:** 2026-03-05
**Status:** COMPLETE

---

## P0 — Production Blockers (7/7)

- [x] Add error tracking (Sentry) — client config created, server/edge configs updated, global-error captures
- [x] Add security headers to `next.config.ts` — CSP added; rest already in place
- [x] Fix `NEXT_PUBLIC_SITE_URL` — fallback added in users/invite/route.ts; .env.example already documented
- [x] Fix mutation retry (`retry: 0` for mutations) — already `retry: false` in providers.tsx
- [x] Fix Slack secret timing-vulnerable comparison (`crypto.timingSafeEqual`) — already fixed in #206
- [x] Add rate limiting on `/api/chat` and `/api/customers/[id]/invite` — already in place
- [x] Regenerate Supabase types — regenerated via MCP (0 → 9,921 lines)

## P1 — Quality Gaps (11/11)

- [x] Renumber duplicate migrations — 48 files renamed, 0 duplicates remaining (00001–00130)
- [x] Migrate 5 legacy `EntityDetail` pages to `EntityDetailUnified` — already migrated
- [x] Add missing FK indexes (~20 columns) — migration 00129 with 22 indexes
- [x] Fix settings mobile navigation — already has Select dropdown on mobile
- [x] Centralize admin client creation (4 routes bypass `createAdminClient`) — already fixed in #206
- [x] Make chat route use `withAuth` wrapper — already fixed in #206
- [x] Add per-page metadata/titles — already configured with template pattern in all domain layouts
- [x] Entity config validation tests — 27 tests covering all 37+ entity configs
- [x] API route tests — 50 tests (withAuth, response helpers, schema validation, state transitions)
- [x] Add `global-error.tsx` at root level — rewritten with zero imports, Sentry capture added
- [x] Add `.env.example` missing variables (SITE_URL, ANTHROPIC_API_KEY, etc.) — already documented

## P2 — Polish & Features (16/16)

- [x] Implement Production Summary Report — already existed, enhanced with 12-month trend chart
- [x] Implement Inventory Valuation Report — already fully implemented
- [x] Implement Batch Cost Analysis Report — enhanced with brand column, COGS fallback, 6-month default
- [x] Add production logging (pino) — pino added, 6 API routes updated with structured logging
- [x] Tighten RLS on `keg_owner_deposits` — migration 00130 with permission-based policies
- [x] Fix timeline DEC-007 violation — already derives colors from stateDisplay
- [x] Add `@next/bundle-analyzer` and audit bundle — already configured
- [x] Lazy-load `shiki` and `@rive-app/react-webgl2` — shiki dynamic import added; rive unused
- [x] Mobile responsiveness improvements — 5 files: timeline, pricing, TTB, sales dashboard, data tables
- [x] Accessibility: add `aria-live` on form errors, `aria-label` on icon buttons — 14 files updated
- [x] Fix `recipe-analyzer.ts` module-level client — lazy import added
- [x] Use `escapeLike()` in API route search queries — already in place
- [x] Centralize hardcoded query keys (notifications, revision-history) — already centralized
- [x] Enhance `/api/health` to check database connectivity — already checks _schema_registry
- [x] Disable `poweredByHeader` in `next.config.ts` — already set
- [x] REST API layer — deferred (no immediate consumer; existing PostgREST + API routes sufficient)

## Verification

- `bun typecheck`: 0 errors
- `bun test`: 719 passing (+50 new), 2 pre-existing failures (api-utils getClientIp)
- `bun lint`: 0 errors, 10 pre-existing warnings (React Hook Form + React Compiler)
