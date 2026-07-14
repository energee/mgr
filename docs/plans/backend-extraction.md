# Backend extraction — lifting business logic out of the frontend

**Status:** awaiting approval (Phase 1 of the two-phase process — no implementation code written)
**Branch:** `refactor/backend-extraction-plan`
**Worktree:** `~/.agents/worktrees/mgr/backend-extraction`
**Date:** 2026-07-13

## Why

The frontend is a candidate for rebuild (`src/components` is 71.7k lines, `src/app` 33.2k
— about 60% of the source). Two independent read-only audits on 2026-07-13 found that the
database and entity layers are a sound foundation, but that **business logic is stranded
inside React**:

- **211 raw `.from(...)` Supabase calls in `src/components/` and 223 in `src/app/`, vs 60
  in `src/services/`.** Components talk straight to Postgres.
- **~1,700–2,000 lines of business rules live in components and hooks.** If the frontend
  were deleted tomorrow, those rules would go with it.

This plan lifts that logic into `src/domain/` (pure calculation) and `src/services/`
(orchestration) **before** any rebuild starts. It is the difference between rebuilding *on*
the backend and rebuilding *around* it.

**This is a refactor, not a rewrite. No behavior changes.** Every task is behavior-preserving
and must pass the `refactor-reviewer` read-only gate.

## Scope boundary

In scope: moving/extracting logic that already exists. Out of scope: fixing the 434 raw
`.from()` call sites (that is the rebuild's job), changing any business rule, and touching
the entity registry, `query-keys.ts`, or `transition-side-effects.ts` — all three are
already clean and stay as they are.

## Verification (every task)

`make check` must pass — lint, typecheck, vitest, DB rules, build. Tasks that extract logic
from a component additionally require a characterization test **written and passing against
the OLD code first**, so the test proves the behavior did not change. Use the `test-surgeon`
agent for those; the repo has no `@testing-library/react`, so component tests use
`createRoot` + `act` (see `src/test/react-harness.ts`).

---

## Tier 1 — Pure relocations (~922 lines, near-zero risk)

These eight files are **already React-free** and simply misfiled under `src/components/`.
They import no React, and each has only 1–3 importers. Moving them is mechanical: `git mv`,
update imports, run `make check`. Tests move with them.

Litmus test per `AGENTS.md`: these know what a "batch"/"order" is → they belong in `src/domain/`.

| # | File (from `src/components/domain/`) | Lines | Importers | Has tests | Destination |
|---|---|---|---|---|---|
| T1.1 | `order/order-allocation-utils.ts` | 134 | 2 | ✗ | `src/domain/allocation/` |
| T1.2 | `order/order-item-edit-utils.ts` | 60 | 2 | ✓ | `src/domain/orders/` |
| T1.3 | `purchasing/po-accept-utils.ts` | 93 | 2 | ✗ | `src/domain/purchasing/` |
| T1.4 | `purchasing/material-shortfall-po-draft.ts` | 193 | 1 | ✓ | `src/domain/purchasing/` |
| T1.5 | `recipe/recipe-editor/recipe-estimate-calc.ts` | 236 | 3 | ✓ | `src/domain/recipes/` |
| T1.6 | `batch/vessel-transfer-utils.ts` | 68 | 2 | ✗ | `src/domain/batches/` |
| T1.7 | `batch/planned-addition-matching.ts` | 75 | 1 | ✓ | `src/domain/batches/` |
| T1.8 | `recipe/plan-batch-from-recipe.ts` | 63 | 1 | ✓ | `src/domain/recipes/` |

**Three files have no tests** (T1.1, T1.3, T1.6). Add characterization tests for those
*before* moving — a silent behavior change in allocation or PO acceptance is exactly the
kind of thing a "pure move" can hide.

**Parallelism:** the eight moves are independent in content but all touch imports. Run them
sequentially in one agent (one commit per file) rather than in parallel worktrees, to avoid
import-resolution conflicts.

**Acceptance:** `tsc --noEmit` clean; `make check` green; no remaining imports of the old
paths anywhere in `src/`.

---

## Tier 2 — Logic extraction from components (higher risk)

Here the rule is *embedded in a component*, so extraction is surgery, not a move.

### T2.1 — PO receiving status rules (`po-receiving.tsx:258–286`, 621-line file, **no tests**)

The rule that decides whether a received PO becomes `fulfilled` or `partial` (compare
received vs ordered quantity, validate the transition, write the status) lives inside a React
component. It exists in no service. **Deleting the frontend deletes this rule.**

- Write characterization tests against current behavior first (none exist today).
- Extract the decision to `src/domain/purchasing/po-receipt-status.ts` — a pure function
  over ordered/received quantities, plus transition validation.
- Extract the write to a service (`src/services/`).
- Component calls the service. No UI change.

### T2.2 — Customer tier pricing (`order-items-editor.tsx:242–250`, 946-line file, **no tests**)

The component calls `dynamicRpc(supabase, "get_price_for_customer")` directly. The pricing
rule is split between the DB function and the component with no service wrapper — so a new
frontend must know to call that RPC and what to do with the result.

- Characterization test first.
- Wrap in a pricing service: `getPriceForCustomer(customerId, sellingFormatId)`.
- Component calls the service.

**Acceptance:** characterization tests pass against old code, still pass against new;
`make check` green; `refactor-reviewer` gate passes.

---

## Tier 3 — Hook → service extraction (highest risk, 762 lines)

### T3.1 — `use-material-planning.ts` (520 lines, **no tests**)

`useCalculateOrderMaterials` (line 401) recalculates the shipping-material BOM when an order
line changes. Core business logic implemented as a React hook — a new frontend must either
reimplement it or drag React in to call it.

- Characterization tests first. **This is the riskiest single file in the plan.**
- Split: pure BOM math → `src/domain/`; Supabase reads/writes → a material-planning service.
- The hook becomes a thin React-Query wrapper over the service. Keep the hook — the current
  frontend still needs it; it just stops *owning* the logic.

### T3.2 — `use-packaging.ts` (242 lines, has tests)

Same treatment. Lower risk — tests already exist.

**Acceptance:** every extracted function is callable with no React import; `make check` green;
existing packaging tests unchanged and passing.

---

## Sequencing

1. **Tier 1** — safe, mechanical, do first. Builds confidence in the move pattern. (~1 session)
2. **Tier 2** — characterization tests first. (~1 session)
3. **Tier 3** — characterization tests first; T3.1 is the riskiest item. (~1–2 sessions)

Checkpoint with the user after each tier — report scope remaining before continuing (per the
guardrails in `docs/agents/process.md`).

## What this explicitly does NOT fix

- The 434 raw `.from()` calls in components/app. The rebuild should route through
  `src/services/` instead of copying that pattern, but rewriting the existing call sites is
  not worth it if the frontend is being replaced anyway.
- 13 migrations with blanket `USING (true)` RLS (kegs, QuickBooks, Slack, recipe_variants) —
  any authenticated user, including portal customers, can write those tables. **The new
  frontend cannot rely on RLS to gate those screens.** Separate issue.
- `package_types`/`keg_types` are dead tables still referenced by 27 and 17 migrations; the
  live model is `selling_formats`/`containers`. `get_inventory_overview` references the
  dropped table and is **broken live**. Separate issue.

## Follow-up issues to file

1. Blanket-permissive RLS on kegs/QBO/Slack/recipe_variants (security).
2. `get_inventory_overview` is broken live (references dropped `package_types`).
3. Dead `package_types`/`keg_types` still in the migration chain; `db reset` is not
   reproducible against production.
