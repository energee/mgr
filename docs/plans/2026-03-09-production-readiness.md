# Production Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden MGR for its first production release by fixing security issues, data integrity bugs, and adding critical test coverage.

**Architecture:** Fix database constraints, tighten security configuration, replace admin client usage, increase password requirements, and add test coverage for TTB compliance, state machine transitions, and allocation calculations. All changes are backward-compatible — no schema redesigns.

**Tech Stack:** Vitest (unit tests), Supabase migrations (SQL), Zod (validation), Next.js API routes, pino (logging)

---

## Phase 1: Security Fixes

### Task 1: Increase Password Minimum Length

**Files:**
- Modify: `src/app/(auth)/login/login-form.tsx:26`
- Modify: `src/app/(auth)/signup/signup-form.tsx:21`

**Step 1: Update login form schema**

In `src/app/(auth)/login/login-form.tsx`, change line 26:
```typescript
// FROM:
password: z.string().min(6, "Password must be at least 6 characters"),
// TO:
password: z.string().min(8, "Password must be at least 8 characters"),
```

**Step 2: Update signup form schema**

In `src/app/(auth)/signup/signup-form.tsx`, change line 21:
```typescript
// FROM:
password: z.string().min(6, "Password must be at least 6 characters"),
// TO:
password: z.string().min(8, "Password must be at least 8 characters"),
```

**Step 3: Run typecheck**

Run: `bun typecheck`
Expected: Zero errors

**Step 4: Commit**

```bash
git add src/app/\(auth\)/login/login-form.tsx src/app/\(auth\)/signup/signup-form.tsx
git commit -m "fix: increase minimum password length to 8 characters"
```

---

### Task 2: Replace Admin Client in Health Endpoint

The `/api/health` endpoint uses `createAdminClient()` (service role key) to query `_schema_registry`. This is an unauthenticated endpoint — it should not use elevated privileges. Replace with `createClient()` which uses the anon key and respects RLS. `_schema_registry` is readable by authenticated users, but we just need to verify the database connection — any query will do.

**Files:**
- Modify: `src/app/api/health/route.ts`
- Modify: `src/lib/__tests__/health-route.test.ts`

**Step 1: Update the health route**

In `src/app/api/health/route.ts`, change the import and client creation:
```typescript
// FROM:
import { createAdminClient } from "@/lib/supabase/server";
// ...
const supabase = createAdminClient();

// TO:
import { createClient } from "@/lib/supabase/server";
// ...
const supabase = await createClient();
```

**Step 2: Update the test mock**

In `src/lib/__tests__/health-route.test.ts`, update the mock to match the new import. The mock should mock `createClient` instead of `createAdminClient`.

**Step 3: Run tests**

Run: `bun test src/lib/__tests__/health-route.test.ts`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/app/api/health/route.ts src/lib/__tests__/health-route.test.ts
git commit -m "fix: use anon client in health endpoint instead of admin client"
```

---

### Task 3: Remove CSP unsafe-inline for Scripts

**Files:**
- Modify: `next.config.ts`

**Step 1: Check current CSP**

Read `next.config.ts` and find the Content-Security-Policy header. Remove `'unsafe-inline'` from `script-src`. Next.js requires `'unsafe-inline'` for its inline scripts in production unless using nonces. Check if the app uses `nonce` prop on `<Script>` tags.

**Note:** If removing `'unsafe-inline'` breaks the production build, add it back with a comment explaining why it's needed and document this as a known limitation. Next.js App Router currently requires `'unsafe-inline'` for its hydration scripts.

**Step 2: Build and verify**

Run: `bun build`
Expected: Build succeeds. If it fails with CSP violations, revert and document.

**Step 3: Commit (if change was possible)**

```bash
git add next.config.ts
git commit -m "fix: tighten CSP script-src (remove unsafe-inline if possible)"
```

---

## Phase 2: Data Integrity Fixes

### Task 4: Fix Allocation Quantity Constraint Conflict

Migration 00102 added `CHECK (quantity > 0)` but the original 00010 had `CHECK (quantity >= 0)`. The stricter constraint breaks zero-quantity adjustment workflows. Write a new migration to drop the conflicting constraint.

**Files:**
- Create: `supabase/migrations/00140_fix_allocation_quantity_constraint.sql`

**Step 1: Write the migration**

```sql
-- Fix: allocation quantity constraint conflict
-- Migration 00102 added allocations_quantity_positive CHECK (quantity > 0)
-- which conflicts with the original chk_allocation_quantity_positive CHECK (quantity >= 0).
-- The original >= 0 is correct: zero-quantity adjustments are valid for
-- approved-but-not-yet-executed inventory write-downs.

ALTER TABLE allocations DROP CONSTRAINT IF EXISTS allocations_quantity_positive;
```

**Step 2: Commit**

```bash
git add supabase/migrations/00140_fix_allocation_quantity_constraint.sql
git commit -m "fix: drop conflicting allocation quantity > 0 constraint

The original >= 0 constraint is correct. Zero-quantity adjustments
are valid for approved-but-not-yet-executed inventory write-downs."
```

---

### Task 5: Add Version Column to Batches, Orders, Purchase Orders

These high-contention tables lack optimistic locking. Add a `version` column (default 1, auto-increment on update via trigger) to prevent lost updates.

**Files:**
- Create: `supabase/migrations/00141_optimistic_lock_high_contention_tables.sql`

**Step 1: Write the migration**

```sql
-- Add optimistic locking to high-contention tables.
-- Prevents lost updates when multiple users edit concurrently.
-- The entity-service.ts already supports version checks when a version column exists.

-- Batches
ALTER TABLE batches ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Purchase Orders
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Trigger function to auto-increment version on update
CREATE OR REPLACE FUNCTION increment_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER batches_version_trigger
  BEFORE UPDATE ON batches
  FOR EACH ROW EXECUTE FUNCTION increment_version();

CREATE TRIGGER orders_version_trigger
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION increment_version();

CREATE TRIGGER purchase_orders_version_trigger
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION increment_version();
```

**Step 2: Commit**

```bash
git add supabase/migrations/00141_optimistic_lock_high_contention_tables.sql
git commit -m "feat: add optimistic locking to batches, orders, purchase_orders

Adds version column and auto-increment trigger. The entity service
already checks version on update when the column exists."
```

---

## Phase 3: Critical Test Coverage

### Task 6: TTB Report Calculation Tests

The TTB report is federal tax compliance. It calls `get_ttb_report(p_year, p_month)` RPC. We can't call the real RPC in unit tests, but we can test the data transformation and formatting logic that happens client-side.

**Files:**
- Create: `src/lib/__tests__/ttb-report.test.ts`
- Read: `src/app/(app)/reports/ttb/page.tsx` (to understand the transformation logic)

**Step 1: Read the TTB page to identify testable logic**

Read `src/app/(app)/reports/ttb/page.tsx` and extract any pure functions for formatting, aggregation, or calculation. If all logic lives inline in the component, extract it to a utility file first.

**Step 2: Write tests for TTB data transformations**

Test at minimum:
- TTB line item mapping (production volumes to correct form lines)
- Beginning/ending inventory calculation
- Tax class categorization (cellar operations, removals, etc.)
- Barrel-to-gallon conversions (1 BBL = 31 gallons)
- CSV export row formatting

Pattern to follow (from existing tests):
```typescript
import { describe, it, expect } from "vitest";

describe("TTB Report Calculations", () => {
  it("converts BBL to gallons correctly", () => {
    expect(bblToGallons(10)).toBe(310);
  });

  it("categorizes batch into correct TTB line", () => {
    // ...
  });
});
```

**Step 3: Run tests**

Run: `bun test src/lib/__tests__/ttb-report.test.ts`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/lib/__tests__/ttb-report.test.ts
git commit -m "test: add TTB report calculation tests for compliance verification"
```

---

### Task 7: State Machine Transition Validation Tests

The existing `state-machines.test.ts` tests structural integrity. Add tests that verify the `transitionEntity` logic in `entity-service.ts` — specifically that it rejects invalid transitions and handles concurrent updates.

**Files:**
- Create: `src/services/__tests__/entity-transitions.test.ts`
- Read: `src/services/entity-service.ts:286-370`

**Step 1: Write tests for transition validation**

Mock the Supabase client and test:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase before imports
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

describe("Entity State Transitions", () => {
  describe("Batch transitions", () => {
    it("allows planned -> fermenting", async () => { /* ... */ });
    it("rejects planned -> completed (skip states)", async () => { /* ... */ });
    it("rejects transition from terminal state (completed)", async () => { /* ... */ });
    it("handles concurrent state change (PGRST116)", async () => { /* ... */ });
  });

  describe("Order transitions", () => {
    it("allows draft -> confirmed", async () => { /* ... */ });
    it("rejects fulfilled -> draft (backward)", async () => { /* ... */ });
    it("allows cancellation from non-terminal states", async () => { /* ... */ });
  });

  describe("Purchase Order transitions", () => {
    it("allows draft -> submitted -> confirmed -> fulfilled", async () => { /* ... */ });
    it("rejects transition after closed", async () => { /* ... */ });
  });
});
```

**Step 2: Run tests**

Run: `bun test src/services/__tests__/entity-transitions.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/services/__tests__/entity-transitions.test.ts
git commit -m "test: add state machine transition validation tests

Verifies invalid transitions are rejected, terminal states are
enforced, and concurrent update conflicts are handled."
```

---

### Task 8: Allocation Calculation Tests

Test that allocation-based inventory calculations are correct. Focus on the view logic: `available_quantity = fg.quantity - SUM(allocated)`.

**Files:**
- Create: `src/lib/__tests__/allocation-calculations.test.ts`
- Read: `src/services/inventory-service.ts` (to find testable functions)

**Step 1: Read inventory service for testable logic**

Identify pure functions that calculate availability, check over-allocation, or aggregate allocations. If all logic is in SQL views, write tests for the TypeScript layer that processes the query results.

**Step 2: Write tests**

Test at minimum:
- Available quantity calculation (total - allocated)
- Over-allocation detection (available < requested)
- Zero-quantity edge case
- Multiple allocations against same source
- Allocation status filtering (only planned + completed count)

**Step 3: Run tests**

Run: `bun test src/lib/__tests__/allocation-calculations.test.ts`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/lib/__tests__/allocation-calculations.test.ts
git commit -m "test: add allocation calculation tests for inventory integrity"
```

---

### Task 9: Auth Flow Tests

Add tests for the auth callback route that verify session creation and error handling beyond the existing open-redirect tests.

**Files:**
- Modify: `src/lib/__tests__/auth-callback-route.test.ts`

**Step 1: Add test cases**

Add to existing test file:
- Missing code parameter returns redirect to `/login?error=missing_code`
- Failed code exchange returns redirect to `/login?error=auth_exchange_failed`
- Successful exchange redirects to specified path
- Default redirect goes to `/` when no redirect param

**Step 2: Run tests**

Run: `bun test src/lib/__tests__/auth-callback-route.test.ts`
Expected: All tests pass (existing + new)

**Step 3: Commit**

```bash
git add src/lib/__tests__/auth-callback-route.test.ts
git commit -m "test: expand auth callback tests for session creation paths"
```

---

### Task 10: Square Pricing & Webhook Tests

Test the Square integration — specifically price resolution and webhook signature validation.

**Files:**
- Create: `src/lib/__tests__/square-integration.test.ts`
- Read: `src/app/api/square/webhook/route.ts` (webhook handler)

**Step 1: Identify testable functions**

Read the Square integration code. Find:
- `resolveTaproomPrices()` or similar pricing function
- Webhook signature verification logic
- Price conversion (dollars to cents)

**Step 2: Write tests**

Test at minimum:
- Price resolution returns correct cents value
- Dollar-to-cents conversion (10.13 * 100 = 1013, not 1012.9999...)
- Webhook with valid signature passes verification
- Webhook with invalid signature is rejected
- Idempotent processing (same event ID twice doesn't duplicate)

**Step 3: Run tests**

Run: `bun test src/lib/__tests__/square-integration.test.ts`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/lib/__tests__/square-integration.test.ts
git commit -m "test: add Square pricing and webhook verification tests"
```

---

## Phase 4: Final Validation

### Task 11: Full Test Suite & Type Check

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 2: Run type check**

Run: `bun typecheck`
Expected: Zero errors

**Step 3: Run lint**

Run: `bun lint`
Expected: No new errors

**Step 4: Run build**

Run: `bun build`
Expected: Build succeeds

**Step 5: Final commit if any remaining changes**

```bash
git add -A
git commit -m "chore: production readiness — all checks pass"
```

---

## Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| 1 — Security | Tasks 1-3 | Password length, admin client, CSP |
| 2 — Data Integrity | Tasks 4-5 | Allocation constraint, optimistic locking |
| 3 — Test Coverage | Tasks 6-10 | TTB, state machines, allocations, auth, Square |
| 4 — Validation | Task 11 | Full suite green |

**Parallelism:** Tasks 1-3 are independent. Tasks 4-5 are independent. Tasks 6-10 are independent. Task 11 depends on all others.

**Estimated effort:** 4-6 hours total.
