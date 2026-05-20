# RLS Coverage Completion — Missing Policies for Post-00097 Tables

**Date:** 2026-05-19
**Branch:** `chore/rls-coverage-gaps` (off `main`)
**Status:** Phase 1 plan — NOT YET APPROVED FOR EXECUTION
**Reviewers:** Opus adversarial review applied 2026-05-19 (see [Revision history](#revision-history))
**Related:**
- `docs/security/rls-policy-audit.md` (original 2026-02-26 audit + 2026-05-19 addendum)
- `docs/superpowers/specs/2026-05-19-mgr-simplification-and-multi-org-design.md` (clarification needed — see Task 1)
- Memory: `mgr-rls-model`, `project-phase-4-decomposition`

---

## Honest scope

This plan **closes the RLS coverage gap** for tables introduced after migration `00097_permission_based_roles.sql` and a handful of legacy tables the original audit flagged. It is **not** a "single source of truth" project — that title overpromises.

For RLS to genuinely become the single point of access control, three additional surfaces need their own audits (called out in [Out of scope](#out-of-scope) below). Those are sequenced after this plan.

## Goal (this plan)

Every table in `public` either (a) has a role-based RLS policy gated by `user_has_permission(...)`, or (b) carries a documented inline exception via `COMMENT ON POLICY`. Closes the regressions introduced by migrations `00158`, `00160`, `00162`, `00165`, plus the legacy gaps from the original audit.

## Out of scope (deliberately — file follow-up plans)

- **`createAdminClient` audit across non-chat routes.** 36 files in `src/` call `createAdminClient`. Some are legitimate platform ops (auth admin, webhooks, health check), but routes like `src/app/api/customers/[id]/invite/route.ts:57,99,104`, `src/app/api/settings/api-key/route.ts:31,78,111,157`, `src/app/api/integrations/quickbooks/*` write user-initiated data under service-role and bypass RLS. Until these are classified, the SSoT claim is false. **Follow-up plan required.**
- **`SECURITY DEFINER` function audit.** 22 migrations contain `SECURITY DEFINER`. Some (notification triggers, `00082_fix_user_profiles_rls_recursion.sql`) are intentional bypasses; others may not have internal `user_has_permission(...)` checks. **Follow-up plan required.**
- **Supabase Storage RLS** (avatar uploads via `src/components/domain/shared/avatar-upload.tsx`) and **Realtime authorization** (`src/contexts/notifications.tsx`). Separate access models, separate audit.
- **Phase 4-B/C** (generic write tools, confirmation gates). Prerequisite: this plan + the two follow-ups above.

## Non-goals

- Adding `org_id` or any tenancy column.
- Replacing `user_has_permission()` with a different authorization model.
- Refactoring the `PERMISSION_MAP` in `src/lib/permissions.ts`.

## Migration numbering decision

Tasks 2–6 each create a new migration file. To avoid number collisions when multiple sub-agents run in parallel, **migration numbers are assigned serially by the human/agent merging tasks** (e.g., `00174`, `00175`, …); sub-agents draft their migration as `00XXX_<description>.sql` and the merger renumbers in commit order. Timestamp migrations (`YYYYMMDDHHMMSS_*`) are reserved for `supabase db pull` artifacts and NOT used for hand-written migrations.

## Approach

Each task lists:
- Files to create/modify
- Acceptance criteria verifiable with `tsc --noEmit`, `bun lint`, or `vitest run` (where the test infra exists — see Task 0)
- Dependencies
- Parallelism marker (`[PAR]` = can run alongside other `[PAR]` tasks; `[SEQ]` = blocks downstream)

---

## Tasks

### 0. [SEQ — PREREQUISITE for 2–6] Postgres-backed integration-test harness

CI today (`.github/workflows/test.yml`) is unit-tests-only. Tasks 2–6's acceptance criteria depend on running policy checks against a real Postgres with role-impersonated users, which does not exist.

- **Files:**
  - `.github/workflows/test.yml` — add a job (or step) that spins up the existing `postgres:15` container used by `db-lint.yml`, applies all migrations, seeds users at each role.
  - `src/__tests__/integration/_helpers/role-client.ts` (NEW) — helper that returns a Supabase client authenticated as a seeded test user with a chosen role (issues a signed JWT or uses `SET LOCAL ROLE` + `auth.jwt()` claims).
  - `src/__tests__/integration/_fixtures/seed-roles.sql` (NEW) — seeds at minimum: `viewer`, `inventory_manager`, `production_manager`, `admin`, plus a "no roles" user for fail-closed tests.
- **Acceptance:**
  - A trivial integration test (`select-as-viewer.test.ts`) passes in CI: viewer cannot SELECT from `keg_inventory` (which currently *can* — the test will fail until Task 6 lands; that's fine, marker test).
  - Two locked-in fail-closed tests pass: (a) user with empty `roles TEXT[]` is denied on every domain table; (b) authenticated user with no `user_profiles` row is denied on every domain table.
- **Depends on:** —

### 1. [PAR] Correct the simplification design doc

- **File:** `docs/superpowers/specs/2026-05-19-mgr-simplification-and-multi-org-design.md`
- **Change:** the line *"No tenancy, `org_id`, or RLS work is planned"* is misleading because mgr already has role-based RLS. Replace with: *"No tenancy or `org_id` work is planned. Role-based RLS (introduced in migration `00097_permission_based_roles.sql`) remains the authorization model; outstanding RLS coverage gaps are tracked in `docs/plans/2026-05-19-rls-single-source-of-truth-plan.md`."*
- **Acceptance:** spec doc text updated; commit references this plan file.
- **Depends on:** —

### 2. [PAR] Fix `yeast_pitch_events` policy regression (audit HIGH-1, addendum CRITICAL)

- **Files:**
  - `supabase/migrations/00XXX_fix_yeast_pitch_events_rls.sql` (NEW; renumber on merge)
- **Change:** drop the `yeast_pitch_events_access` policy from `00158` and replace with the standard production-domain pattern (`batches:read` / `batches:write`).
- **Acceptance:** migration applies cleanly; integration test (depends on Task 0) covers viewer denied / `batches:write` role permitted.
- **Depends on:** 0.

### 3. [PAR] Tighten `selling_format_materials` policy (addendum CRITICAL)

- **Files:**
  - `supabase/migrations/00XXX_fix_selling_format_materials_rls.sql` (NEW)
- **Change:** replace open policy from `00160` with `inventory:read` / `inventory:write`. **Verify domain mapping first** — `src/entities/` should be checked to confirm this is treated as inventory, not catalog/settings (see Open Question 1).
- **Acceptance:** migration applies; integration test for both roles.
- **Depends on:** 0.

### 4. [PAR] Tighten shipping/materials/pallet/order policies (addendum CRITICAL — 4 tables from `00162`)

- **Files:**
  - `supabase/migrations/00XXX_fix_order_shipping_rls.sql` (NEW)
- **Tables:** `brewery_shipping_defaults`, `customer_shipping_materials`, `customer_pallet_configs`, **`order_materials`** (this fourth table was missed in the first plan draft — see audit addendum line 406).
- **Change:**
  - `brewery_shipping_defaults` → `settings:manage`.
  - `customer_shipping_materials`, `customer_pallet_configs` → `customers:read` / `customers:write`.
  - `order_materials` → `orders:read` / `orders:write`.
- **Acceptance:** migration applies; integration test covers all four tables, denied and permitted roles each.
- **Depends on:** 0.

### 5. [PAR] Restrict `mongodb_sync_log` and `mongodb_sync_mappings` (addendum MEDIUM)

- **Files:**
  - `supabase/migrations/00XXX_fix_mongodb_sync_rls.sql` (NEW)
- **Change:** replace open SELECT from `00165` with `settings:manage` for both tables. Verify writes are going through `createAdminClient` from the sync worker (`src/integrations/mongodb/sync.ts`) so tightening SELECT doesn't break write paths.
- **Acceptance:** migration applies; non-`settings:manage` role gets empty SELECT, `settings:manage` role sees rows.
- **Depends on:** 0.

### 6. [PAR] Address original-audit findings still outstanding

- **Files:**
  - `supabase/migrations/00XXX_fix_audit_2026_02_26_remaining.sql` (NEW)
- **Tables (from original audit):**
  - `water_addition_profiles` (CRITICAL-1) → catalog pattern (read: any auth, write: `settings:manage`).
  - `keg_inventory` (CRITICAL-2) → `inventory:read` / `inventory:write`.
  - `customer_portal_users`, `order_change_requests`, `order_change_request_items` (MEDIUM) → tighten staff side; **also verify customer side** isn't leaking data across customers.
- **Verify each table's current policy state before writing** — intervening migrations may have addressed some.
- **Acceptance:** migration applies; integration tests cover denied / permitted per table + customer-portal isolation test (customer A cannot read customer B's data).
- **Depends on:** 0.

### 7. [PAR] No-op the duplicate keg-owner-deposits migration

- **Files:**
  - `supabase/migrations/00130_tighten_keg_owner_deposits_rls.sql` — leave as-is, add comment header.
  - `supabase/migrations/00137_tighten_keg_owner_deposits_rls.sql` — replace body with `-- No-op: duplicate of 00130. Kept to avoid migration-history rewrites.`
- **Note:** `diff 00130 00137` returns no output — they're byte-identical, a rebase artifact.
- **Acceptance:** running migrations from scratch on a fresh DB still succeeds.
- **Depends on:** —

### 8. [SEQ] `pg_policies` guardrail test — fail on undocumented weak policies

- **Files:**
  - `src/__tests__/integration/rls-coverage.test.ts` (NEW)
- **Approach:** query `pg_policies` joined with `pg_description` (policy comments). For every policy in `public` whose `qual` or `with_check` is `true` or `(auth.uid() IS NOT NULL)`, assert the policy carries a `COMMENT ON POLICY ... IS 'RLS-EXCEPTION: <reason>'`. Migrations that introduce a deliberate weak policy must add the comment.
- **Why a per-policy comment instead of an allowlist file:** allowlist files rot silently; comments live next to the policy and fail loudly if missing.
- **Acceptance:** test passes after Tasks 2–7 land (each migration adds the comment where the policy is deliberately permissive, e.g., audit-log inserts).
- **Depends on:** 0, 2, 3, 4, 5, 6.

### 9. [SEQ] Consolidate audit + document the "user-session client" rule

- **Files:**
  - `docs/security/rls-policy-audit.md` — collapse original body + 2026-05-19 addendum into one dated coverage table reflecting post-merge state.
  - `docs/security/README.md` (NEW) — one-paragraph rule: "Tool/route writes must go through the user-session Supabase client. The documented exceptions are: [list]. Adding a new `createAdminClient` call site requires an inline justification comment and a row in this table."
- **Acceptance:** doc reads coherently top-to-bottom; severity counts match the new state; future implementers can find the rule in one place.
- **Depends on:** 2, 3, 4, 5, 6, 7.

---

## Open questions (need user input before Phase 2)

1. **Domain mapping for `selling_format_materials`** — `inventory:*` or `settings:manage`? 30-second look at `src/entities/` should resolve.
2. **Production impact of tightening RLS.** Querying production: are there active users with `viewer`-only roles who currently read any of these tables via the open policies? If so, the migrations need a staged rollout, not a single apply. Out of scope for the plan but required before execute.
3. **Is the Task 0 CI work owned by this plan, or is there an existing branch / ticket for it?** Don't want to duplicate work if integration tests are already in flight elsewhere.

---

## Parallelism summary

- Task 0 must complete first (blocks 2–6).
- Tasks 1, 7 can run immediately.
- Tasks 2–6 run in parallel after Task 0.
- Task 8 follows Tasks 2–6 + 0.
- Task 9 follows Tasks 2–7.

Suggested execution order: 0 → (1, 7 in parallel with 0) → (2, 3, 4, 5, 6 in parallel) → 8 → 9.

---

## What this plan deliberately does NOT do

- Does not change `src/app/api/chat/` — the user-session client wiring there is already correct.
- Does not audit non-chat `createAdminClient` call sites (separate follow-up).
- Does not audit `SECURITY DEFINER` functions (separate follow-up).
- Does not configure Storage or Realtime RLS (separate follow-up).
- Does not introduce confirmation-gate UX (Phase 4-C).

---

## Revision history

- **2026-05-19 v1** — Initial draft (Claude Opus 4.7).
- **2026-05-19 v2** — After adversarial review (Opus sub-agent). Changes:
  - Title renamed from "RLS as Single Source of Truth" to honest scope.
  - Migration number references corrected `00092` → `00097` throughout.
  - Added `order_materials` to Task 4 (was missed in v1).
  - Promoted v1's Open Question 3 to **Task 0** (CI Postgres harness as upstream prerequisite); reversed dependency arrow on Tasks 2–6.
  - Added [Out of scope](#out-of-scope) section enumerating the three follow-up audits (`createAdminClient`, `SECURITY DEFINER`, Storage/Realtime) so this plan stops over-claiming.
  - Migration numbering strategy documented (serial, assigned by merger).
  - Demoted Task 7 (duplicate-investigation) to a 5-minute no-op fix — `diff` confirmed byte-identical.
  - Collapsed v1 Tasks 9 + 10 into one task; explicit fail-closed tests added to Task 0; per-policy `COMMENT` mechanism replaces the allowlist for Task 8.
