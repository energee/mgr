# Comprehensive Implementation Roadmap

**Date:** 2026-02-26
**Approach:** Foundation-First (tests → features → hardening → API → polish)
**Branch:** worktree-implementations

## Context

MGR is a mature brewery management system with 37 entity configs, 108 migrations, 91 domain components, and full integrations with Square, Slack, and QuickBooks. Recent work completed: yeast workflow, water additions/chemistry, batch-centric brew logs, permission-based roles, WCAG accessibility, customer order portal, and universal entity delete.

This roadmap covers all remaining outstanding work items from the `.beads/` issue tracker and `docs/spec/` architecture decisions.

## Excluded Items

The following were explicitly deprioritized:
- **Production timeline drag-drop** (`mgr-5f4` enhancements) — timeline view works, enhancements are polish
- **Storybook / DX quick wins** (`mgr-yg6`) — low impact for single-team project
- **Water chemistry calculator** — already implemented via migration 00098 + `recipe-additions-display.tsx`

## Phase 1: Testing Foundation

**Goal:** Expand test coverage to create a safety net for all subsequent work.

**Current state:** 7 test files covering water chemistry, query keys, units, yeast calculations, batch readings/additions, recipe estimates. Vitest configured with jsdom. CI runs tests on every PR.

### 1.1 Brewing Calculation Test Expansion
- Expand OG/FG/ABV/IBU/SRM calculation coverage across edge cases
- Zero grain bill, no hops, extreme values, partial recipes
- Target: comprehensive coverage of `src/lib/calculations/`

### 1.2 State Machine Tests
- Test all entity state machines: batch, order, purchase_order, vessel, packaging_session
- Valid transitions, invalid transitions, guard conditions
- Reusable test helper for state machine validation

### 1.3 Allocation Logic Tests
- FIFO allocation correctness
- Available quantity calculations
- Over-allocation prevention
- Partial allocation scenarios

### 1.4 Integration Test Infrastructure
- Supabase local dev setup for database-level testing
- RLS policy verification per role
- Trigger and view correctness
- Database function tests (`analyze_recipe_style_compliance`, `calculate_production_shortfalls`, etc.)

### 1.5 E2E Test Infrastructure
- Playwright setup with auth fixtures (per-role test users)
- Critical path: recipe → batch → brew log → readings → package → order → fulfill
- Customer portal flow: login → view orders → submit change request

**Validation:** `bun test:coverage` shows >80% for `src/lib/`. Playwright runs critical workflow E2E.

**Dependencies:** None — foundational.

**Issue refs:** `mgr-ko0`, `mgr-ko0.1`, `mgr-ko0.2`, `mgr-ko0.3`, `mgr-ko0.4`

---

## Phase 2: Production Workflows

**Goal:** Complete advanced workflow features for full production management.

### 2.1 PO Generation from Demand (`mgr-7ps.2`)
- `src/lib/purchasing/demand-calculator.ts` — ingredient needs from planned batches, factoring current inventory and supplier lead times
- `src/lib/purchasing/po-generator.ts` — draft POs grouped by supplier, minimum order quantities
- Ingredient projections UI at `/purchasing/demand` — timeline of ingredient needs, shortfall highlighting
- One-click PO generation from shortfalls
- Unit tests for demand calculation and PO generation logic

### 2.2 Formal Pick List Tables (`mgr-7ps.3`)
- Migration (00099+): `pick_lists` and `pick_list_items` tables with RLS, schema registry entries
- FIFO allocation logic (oldest finished goods first)
- Bin location optimization (minimize warehouse travel)
- Update existing `OrderPickList` component to use formal tables
- Mobile-optimized pick list UI for warehouse tablets
- Tests for FIFO allocation and quantity confirmation

### 2.3 Landed Cost Calculation (`mgr-7ps.4`)
- Add `shipping_cost` column to PO receipts
- Landed cost allocation: distribute shipping across line items by weight or value
- Per-unit landed cost stored on inventory lot records
- Update COGS calculations and inventory views
- Tests for cost allocation math

**Validation:** All new logic has unit tests. Integration tests verify PO generation end-to-end.

**Dependencies:** Phase 1 (tests provide safety net).

---

## Phase 3: Security & User Management

**Goal:** Harden access control and complete user management.

### 3.1 RLS Policy Audit (`mgr-xyh`)
- Formal documentation of all 134+ RLS policies
- Per-role access verification: admin, production_manager, brewer, sales
- Integration tests: attempt unauthorized access, confirm denial
- Fix any gaps found during audit

### 3.2 User Management Completion (`mgr-17y`)
- Email invite flow via `auth.admin.inviteUserByEmail()` with role pre-assignment
- Admin-initiated password reset via Supabase auth admin API
- Avatar upload via Supabase Storage (public bucket with RLS)

### 3.3 Email Notifications (`mgr-nge.4`)
- Supabase Edge Function for email delivery via configured SMTP provider
- Email templates: low inventory alert, order status change, weekly digest
- Respect existing `notification_preferences.email_enabled` flag
- Wire into existing notification triggers (migration 00022)
- Unsubscribe handling

**Validation:** RLS integration tests pass. Email sends verified in staging.

**Dependencies:** Phase 1 (integration test infra for RLS testing).

---

## Phase 4: REST API Layer

**Goal:** Build comprehensive REST API for future consumers.

**Note:** No immediate consumer. API routes are thin wrappers around existing Supabase client logic.

### 4.1 API Infrastructure (`mgr-27q.1`)
- `src/lib/api/response.ts` — standard response format: `{ data, meta }` / `{ error: { code, message, details } }`
- `src/lib/api/auth.ts` — `withAuth()` and `withRoles()` middleware wrappers
- `src/lib/api/validation.ts` — request body validation using existing Zod schemas
- `src/lib/api/errors.ts` — API error classes with PostgreSQL error code mapping

### 4.2 Production API Routes (`mgr-27q.2`)
- CRUD: batches, recipes, brew logs, vessels
- Batch actions: readings, additions, transfers
- Recipe clone endpoint

### 4.3 Sales & Orders API Routes (`mgr-27q.3`)
- CRUD: orders, customers
- Order actions: allocate, fulfill
- Order items management

### 4.4 API Tests
- Integration tests for each route group
- Auth middleware verification
- Error response format validation

**Validation:** All API routes have integration tests. OpenAPI-compatible response format.

**Dependencies:** Phase 3 (RBAC enforcement informs API auth middleware).

---

## Phase 5: Polish & Remaining Items

**Goal:** Close out remaining open issues and tie up loose ends.

### 5.1 Unit System: Brew Log Integration (`mgr-3p8`)
- Update brew log event forms to use `UnitInput` for measurements
- Reports always show canonical units (BBL for TTB compliance)

### 5.2 UI/UX Quick Wins (`mgr-4tu`)
- Bulk status change on batch list (multi-select → transition)
- Keyboard shortcuts for common actions (document in help page)

### 5.3 Integration Settings UI (`mgr-5tj`)
- Consolidate Square, QuickBooks, Slack settings into unified integrations page
- Connection status indicators, test buttons, sync logs

### 5.4 Performance Indexes (DEC-PERF-001/002)
- Apply pending allocation indexes
- Create `inventory_lots_with_quantities` and `finished_goods_with_availability` views

### 5.5 Housekeeping
- Archive outdated plan docs (water chemistry calculator)
- Close completed issues in `.beads/issues.jsonl` (Square, Slack, QuickBooks)
- Update `docs/spec/decisions.md` with completed decisions

**Validation:** `bun lint`, `bun typecheck`, `bun test` all clean. Performance queries verified.

**Dependencies:** Phases 1-4 complete.

---

## Issue Tracker Cross-Reference

| Issue | Title | Phase |
|-------|-------|-------|
| `mgr-ko0` | Testing & Quality (Phase 15) | 1 |
| `mgr-ko0.1` | Unit Testing Setup | 1.1-1.3 |
| `mgr-ko0.2` | Integration Testing | 1.4 |
| `mgr-ko0.3` | E2E Testing with Playwright | 1.5 |
| `mgr-ko0.4` | CI/CD Pipeline | 1 (CI already exists) |
| `mgr-7ps.2` | PO Generation from Demand | 2.1 |
| `mgr-7ps.3` | Formal Pick List Tables | 2.2 |
| `mgr-7ps.4` | Landed Cost Calculation | 2.3 |
| `mgr-xyh` | RLS Policy Audit & Documentation | 3.1 |
| `mgr-17y` | User Management: Email Invite & RBAC | 3.2 |
| `mgr-nge.4` | Email Notifications | 3.3 |
| `mgr-27q` | REST API Routes (Phase 12) | 4 |
| `mgr-27q.1` | API Infrastructure | 4.1 |
| `mgr-27q.2` | Production API Routes | 4.2 |
| `mgr-27q.3` | Sales & Orders API Routes | 4.3 |
| `mgr-3p8` | Unit System: Brew Log Integration | 5.1 |
| `mgr-4tu` | UI/UX Quick Wins | 5.2 |
| `mgr-5tj` | Integration Settings UI | 5.3 |

## Parallelism Notes

Within each phase, many tasks can run in parallel via sub-agents:
- **Phase 1:** 1.1/1.2/1.3 are independent; 1.4/1.5 need infra setup first
- **Phase 2:** 2.1/2.2/2.3 are largely independent (different domains)
- **Phase 3:** 3.1 should precede 3.2 (audit informs RBAC gaps); 3.3 is independent
- **Phase 4:** 4.1 must precede 4.2/4.3; routes are parallelizable
- **Phase 5:** All items independent
