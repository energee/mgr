# Repository Structure Reorg — Draft Plan

**Date:** 2026-05-18
**Status:** Draft — for review, not yet approved
**Scope:** Top 3 structural issues + cosmetic quick wins. Type-location consolidation and
top-level docs/config sprawl are deferred (see "Deferred" at end).

---

## 1. Goals & non-goals

**Goals**
- Give `src/lib/` a single, stateable purpose so new code has an obvious home.
- Give `src/components/domain/` (92 flat files) a navigable structure.
- Make the `lib` vs `services` boundary explicit and documented.
- Land the cosmetic fixes that have no design cost.

**Non-goals**
- No behavior changes. Every PR is move + import-rewrite only; `tsc --noEmit` and the
  test suite must be green before and after with no logic edits.
- No new abstractions, no renamed exports — only files relocate.
- Type-definition consolidation and doc-sprawl cleanup are out of scope here.

---

## 2. Guiding principle: what each top-level dir means

The core problem is that `src/lib/` is a grab-bag. The reorg is driven by one rule:

| Directory        | Holds                                                            |
|------------------|------------------------------------------------------------------|
| `src/lib/`       | **Cross-cutting infrastructure** — no brewery domain knowledge. Logging, errors, env, query client/keys, formatting, parsers, ids, Supabase/API plumbing, Zod schemas. |
| `src/domain/`    | **Brewery business logic** — calculations and rules that mention batches, brews, yeast, water, allocation, TTB, purchasing, planning. |
| `src/integrations/` | **Third-party service clients** — QuickBooks, Square, Slack, email, MongoDB. |
| `src/services/`  | **Entity orchestration** — CRUD/transition services over domain logic + Supabase. (Already exists; stays.) |

Litmus test for a new file: *does it know what a "batch" is?* → `domain/`.
*Does it talk to an outside vendor?* → `integrations/`. *Neither?* → `lib/`.

---

## 3. Target structure

### `src/lib/` — after (infra only)

```
src/lib/
  api/            (unchanged)
  supabase/       (unchanged)
  schemas/        (unchanged — Zod schemas are validation infra)
  __tests__/      (unchanged)
  auth-utils.ts          client-logger.ts    combobox-filter.ts
  compose-refs.ts        constants.ts        data-table.ts
  data-table-config.ts   enums.ts            env.ts
  errors.ts              form-resolver.ts    format.ts
  help-content.ts        id.ts               logger.ts
  optimistic-lock.ts     parsers.ts          permissions.ts
  pg-error-codes.ts      query-client.ts     query-keys.ts
  report-export.ts       sentry-config.ts    utils.ts
```

`data-table-config.ts` is `src/config/data-table.ts` moved in and **renamed** —
`lib/` already has a `data-table.ts`, so the bare name would collide.
`report-export.ts` stays here: it is generic CSV/print mechanics (`toCSV`) with only
one domain import.

### `src/domain/` — new (business logic moved out of `lib/`)

```
src/domain/
  allocation-calculations.ts   batch-additions.ts   batch-readings.ts
  brew-events.ts               inventory-units.ts   report-utils.ts
  ttb-utils.ts                 units.ts             water-chemistry.ts
  yeast-calculations.ts        yeast-lineage.ts
  ai/             (moved from lib/ai/ — encodes recipe/style domain knowledge)
  purchasing/     (moved from lib/purchasing/)
  planning/       (moved from lib/planning/)
```

`report-utils.ts` moves here (not `lib/`): it fetches batch ingredient-cost and COGS
detail from Supabase — brewery business logic, not a generic utility.

### `src/integrations/` — new (vendor clients moved out of `lib/`)

```
src/integrations/
  quickbooks/   (moved from lib/quickbooks/)
  square/       (moved from lib/square/)
  mongodb/      (moved from lib/mongodb/)
  slack.ts      email.ts      email-templates.ts
```

### React files leaving `src/lib/`

Three `.tsx` files in `lib/` render JSX and belong with components/providers:

| File                          | Destination                          |
|--------------------------------|--------------------------------------|
| `lib/providers.tsx`            | `src/app/providers.tsx`              |
| `lib/portal-context.tsx`       | `src/contexts/portal.tsx`            |
| `lib/data-table-adapter.tsx`   | `src/components/data-table/adapter.tsx` |

### `src/components/domain/` — after (sub-grouped)

92 flat files grouped by domain noun. Exact buckets to be confirmed from the file list,
but the shape:

```
src/components/domain/
  batch/      brew/       customer/   order/
  keg/        inventory/  recipe/     packaging/
  shared/     (cross-domain pieces that don't belong to one noun)
```

**No barrel files.** The two existing barrels (`dashboard/index.ts`,
`universal/index.ts`) are deleted in PR 5; the whole `components/` tree imports direct.
Barrels defeat tree-shaking and invite circular imports, and most of the tree already
imports direct — so the uniform rule is "no `index.ts`".

---

## 4. Delivery — incremental PRs

Each PR is independently reviewable, mergeable, and revertable. Order matters: the
churn-heavy moves go first so later branches rebase onto stable paths.

| PR | Title | Touches | Risk |
|----|-------|---------|------|
| **1** | `chore: quick-win structure fixes` | `vessel-transfer.ts`→`.tsx`; delete `src/config/` (move `data-table.ts` → `lib/data-table-config.ts`); retire `src/stores/` (move `prefill-store.ts` into `contexts/`) | Low |
| **2** | `refactor: extract src/domain from lib` | Move ~12 files + `purchasing/` + `planning/` out of `lib/`; rewrite `@/lib/...` imports | High (import fan-out) |
| **3** | `refactor: extract src/integrations from lib` | Move `quickbooks/`, `square/`, `mongodb/`, `slack.ts`, `email*.ts` | Medium |
| **4** | `refactor: move React files out of lib` | The 3 `.tsx` relocations above | Low |
| **5** | `refactor: sub-group components/domain` | Bucket 92 files; delete `dashboard/` + `universal/` barrels, rewrite their importers | High (import fan-out) |
| **6** | `docs: document lib/domain/integrations/services boundary` | Add the §2 table to `AGENTS.md`; update `docs/agents/autoharness.md` (its loop screens `src/lib`) | Low |

PRs 1 and 4 can land anytime. PRs 2, 3, 5 should land in quick succession to minimize
the window where contributors' branches reference moved paths.

---

## 5. Mechanics — how to move safely

There is a single path alias (`@/* → src/*` in `tsconfig.json`), so **every move
requires rewriting every importer**. Per PR:

1. **Move files** with `git mv` (preserves history).
2. **Rewrite imports.** Prefer an IDE "move file" refactor (updates references), or a
   scripted `@/lib/foo` → `@/domain/foo` replace across `src/`, `e2e/`, `scripts/`.
3. **Update non-`@/` references:** relative imports inside moved folders, `vitest.config.ts`,
   `eslint.config.mjs`, any path in `scripts/`.
4. **Gate:** `bun lint` + `bun typecheck` (`tsc --noEmit`) + `bun run test` must pass.
   `tsc` catches missed imports immediately — treat a clean run as the proof the move
   is complete.
5. **Grep guard:** after each PR, `grep -rn "@/lib/<movedname>"` must return nothing.
6. One logical move per commit; never mix a move with a logic change.

**Sequencing risk:** PRs 2/3/5 are merge-conflict magnets. Land them when no large
feature branches are open, or coordinate a rebase window.

---

## 6. Resolved decisions

1. **`src/domain/` is its own dir**, not folded into `services/`. Pure calculations
   and entity orchestration are genuinely different concerns; keeping them apart is
   what makes the boundary in §2 stateable.
2. **`lib/ai/` moves to `domain/ai/`** — it encodes recipe/style domain knowledge.
3. **`report-export.ts` stays in `lib/`** (generic CSV/print mechanics);
   **`report-utils.ts` moves to `domain/`** (Supabase batch-cost/COGS logic). The two
   files were one concern in name only.
4. **No barrel files.** Delete `dashboard/index.ts` and `universal/index.ts`; the
   whole `components/` tree imports direct.
5. **`src/config/` is deleted.** Its one file moves to `lib/data-table-config.ts`
   (renamed to avoid colliding with the existing `lib/data-table.ts`).
   `constants.ts`/`env.ts`/`sentry-config.ts` are infra and stay in `lib/`.

---

## Deferred (not in this plan)

- **Type-location consolidation** — ~137 types in `lib/` vs `src/types/`; needs its
  own rule (generated types vs shared domain types vs co-located).
- **Top-level docs/config sprawl** — `README`/`PROGRESS`/`AGENTS`/`DECISIONS` + `docs/`
  tree + four `autoharness.*` files + three workspace dirs.
- **Test-file conventions** — standardize `.test.ts`/`.test.tsx`/`.spec.ts` and
  `__tests__/` placement.
